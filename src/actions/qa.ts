'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { actionError, actionOk, type ActionState } from '@/components/admin/action-state'
import { audit } from '@/lib/audit'
import { currentAdmin } from '@/lib/auth/guards'
import { checkbox, optionalText, requiredText, zodFieldErrors } from '@/lib/form-values'
import { loadPortalView } from '@/lib/portal/data'
import { readInvestorAccount } from '@/lib/portal/session'
import { authorizeQaAction, qaActionLabel, type QaAction } from '@/lib/qa/authority'
import { QUEUED_PUBLICATION_NOTICE, canAskQuestion } from '@/lib/qa/visibility'
import { anyRoundOpen } from '@/lib/qa/data'
import { readServiceConfig } from '@/lib/auth/service-config'
import {
  QA_QUEUE_PATH,
  QUESTION_RECEIVED_MESSAGE,
  askQuestion,
  createSeededEntry,
  moveEntry,
  notifyOperatorOfQuestion,
  recordAnswer,
  sendAnswerReply,
  setPinned,
  unpublishEntry,
} from '@/lib/qa/service'

/**
 * Questions and answers. BUILD_SPEC §6.7.
 *
 * Two halves with two different authorities:
 *
 *   - The investor half takes its account from the session and never from the
 *     form, and every refusal is worded so it cannot be used to learn whether
 *     some other record exists.
 *   - The operator half calls `authorize()` first — before parsing, before
 *     touching the database — and writes a refused attempt to the audit log
 *     before returning it. Nothing here trusts that a button was not rendered.
 *
 * Publishing and emailing are separate actions in this file, as they are in
 * the spec. Nothing below sends a reply as a side effect of saving one.
 */

const PORTAL_PATH = '/portal'

// ---------------------------------------------------------------------------
// Authorization — the same three lines at the top of every admin action
// ---------------------------------------------------------------------------

interface Authorized {
  ok: true
  admin: { id: string; email: string }
}

async function authorize(action: QaAction): Promise<Authorized | { ok: false; state: ActionState }> {
  const admin = await currentAdmin()
  const decision = authorizeQaAction(admin?.role ?? null, action)

  if (decision.allowed && admin) {
    return { ok: true, admin: { id: admin.id, email: admin.email } }
  }

  await audit({
    actor: admin
      ? { kind: 'user', id: admin.id, label: admin.email }
      : { kind: 'system', label: 'unauthenticated' },
    entityType: 'qa_entry',
    entityId: null,
    action: 'qa.refused',
    metadata: { attemptedAction: action, attemptedLabel: qaActionLabel(action) },
  })

  return { ok: false, state: actionError(decision.allowed ? 'Sign in first.' : decision.message) }
}

// ---------------------------------------------------------------------------
// Investor — asking a question (§6.7.1)
// ---------------------------------------------------------------------------

const askSchema = z.object({
  body: z
    .string()
    .trim()
    .min(1, 'Type your question before sending it.')
    .max(4000, 'That is longer than this box takes. Please shorten it, or email David directly.'),
  entryId: z.string().min(1).nullable(),
})

/**
 * §6.7.1. The confirmation is the plain one from PORTAL_COPY — no fake urgency
 * and no promised timeframe the app cannot keep.
 *
 * The notification to the operator is attempted after the question is recorded
 * and its failure is never shown to the investor: whether the mail connection
 * is configured is not their business, and "your question has been sent" stays
 * true because it has been — it is sitting in the operator's queue.
 */
export async function askQuestionAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const account = await readInvestorAccount()
  if (!account) redirect('/portal/signin')

  const view = await loadPortalView(account.id)
  if (!view) redirect('/portal/signin')

  if (!canAskQuestion(view.access)) {
    return actionError(
      'This portal is currently read-only. You can view your record and download your ' +
        'documents, but questions are not being accepted at this time.',
    )
  }

  const parsed = askSchema.safeParse({
    body: requiredText(formData.get('body')),
    entryId: optionalText(formData.get('entryId')),
  })
  if (!parsed.success) {
    return actionError('That question could not be sent.', zodFieldErrors(parsed.error))
  }

  const result = await askQuestion({
    accountId: account.id,
    body: parsed.data.body,
    entryId: parsed.data.entryId,
  })

  if (!result.ok) return actionError(result.message)

  // Best effort, deliberately. The question is already recorded; a notification
  // that cannot get out is the operator's problem and it is shown to him in the
  // queue, not to the person who asked.
  await notifyOperatorOfQuestion(result.entryId)

  revalidatePath(PORTAL_PATH)

  return actionOk(QUESTION_RECEIVED_MESSAGE)
}

// ---------------------------------------------------------------------------
// Operator — answering (§6.7.2)
// ---------------------------------------------------------------------------

const answerSchema = z.object({
  entryId: z.string().min(1),
  answer: z
    .string()
    .trim()
    .min(1, 'Write the answer before saving it.')
    .max(20000, 'That answer is longer than this field takes.'),
  questionPublic: z.string().trim().max(4000).nullable(),
  publish: z.boolean(),
  acknowledged: z.boolean(),
})

export async function recordAnswerAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const auth = await authorize('ANSWER')
  if (!auth.ok) return auth.state

  const parsed = answerSchema.safeParse({
    entryId: requiredText(formData.get('entryId')),
    answer: requiredText(formData.get('answer')),
    questionPublic: optionalText(formData.get('questionPublic')),
    publish: checkbox(formData.get('publish')),
    acknowledged: checkbox(formData.get('acknowledged')),
  })
  if (!parsed.success) {
    return actionError('That answer could not be saved.', zodFieldErrors(parsed.error))
  }

  const result = await recordAnswer({
    entryId: parsed.data.entryId,
    answer: parsed.data.answer,
    questionPublic: parsed.data.questionPublic,
    publish: parsed.data.publish,
    acknowledgedIdentifyingDetail: parsed.data.acknowledged,
    actor: { kind: 'user', id: auth.admin.id, label: auth.admin.email },
    actorUserId: auth.admin.id,
  })

  if (!result.ok) return actionError(result.message)

  revalidatePath(QA_QUEUE_PATH)
  revalidatePath(PORTAL_PATH)

  if (!result.published) {
    return actionOk(
      'Answer saved. Nothing has gone to the person who asked — the reply email is a separate ' +
        'button, and this answer is not on the shared page.',
    )
  }

  const config = await readServiceConfig()
  const queued = !config.qaVisibleDuringRaise && (await anyRoundOpen())

  return actionOk(
    queued
      ? `Answer saved and published. ${QUEUED_PUBLICATION_NOTICE}`
      : 'Answer saved and published to the shared Q&A, with the asker’s identity removed. ' +
          'The reply email to them is a separate button and has not been sent.',
  )
}

// ---------------------------------------------------------------------------
// Operator — publication controls (§6.7.3)
// ---------------------------------------------------------------------------

const entrySchema = z.object({ entryId: z.string().min(1) })

export async function unpublishEntryAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const auth = await authorize('UNPUBLISH')
  if (!auth.ok) return auth.state

  const parsed = entrySchema.safeParse({ entryId: requiredText(formData.get('entryId')) })
  if (!parsed.success) return actionError('That entry could not be found.')

  const result = await unpublishEntry({
    entryId: parsed.data.entryId,
    actor: { kind: 'user', id: auth.admin.id, label: auth.admin.email },
  })
  if (!result.ok) return actionError(result.message)

  revalidatePath(QA_QUEUE_PATH)
  revalidatePath(PORTAL_PATH)

  return actionOk(
    'Removed from the shared page. It does not un-send it — anyone who has already read it ' +
      'has already read it. The removal is in the audit log.',
  )
}

const pinSchema = z.object({ entryId: z.string().min(1), pinned: z.boolean() })

export async function setPinnedAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const auth = await authorize('ORDER')
  if (!auth.ok) return auth.state

  const parsed = pinSchema.safeParse({
    entryId: requiredText(formData.get('entryId')),
    pinned: checkbox(formData.get('pinned')),
  })
  if (!parsed.success) return actionError('That entry could not be found.')

  const result = await setPinned({
    entryId: parsed.data.entryId,
    pinned: parsed.data.pinned,
    actor: { kind: 'user', id: auth.admin.id, label: auth.admin.email },
  })
  if (!result.ok) return actionError(result.message)

  revalidatePath(QA_QUEUE_PATH)
  revalidatePath(PORTAL_PATH)

  return actionOk(parsed.data.pinned ? 'Pinned to the top.' : 'Unpinned.')
}

const moveSchema = z.object({
  entryId: z.string().min(1),
  direction: z.enum(['UP', 'DOWN']),
})

export async function moveEntryAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const auth = await authorize('ORDER')
  if (!auth.ok) return auth.state

  const parsed = moveSchema.safeParse({
    entryId: requiredText(formData.get('entryId')),
    direction: requiredText(formData.get('direction')),
  })
  if (!parsed.success) return actionError('That entry could not be moved.')

  const result = await moveEntry({
    entryId: parsed.data.entryId,
    direction: parsed.data.direction,
    actor: { kind: 'user', id: auth.admin.id, label: auth.admin.email },
  })
  if (!result.ok) return actionError(result.message)

  revalidatePath(QA_QUEUE_PATH)
  revalidatePath(PORTAL_PATH)

  return actionOk('Order updated.')
}

// ---------------------------------------------------------------------------
// Operator — writing an entry directly (§6.7.4)
// ---------------------------------------------------------------------------

const seedSchema = z.object({
  question: z.string().trim().min(1, 'Write the question.').max(4000),
  answer: z.string().trim().min(1, 'Write the answer.').max(20000),
  publish: z.boolean(),
})

export async function createSeededEntryAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const auth = await authorize('CREATE_SEEDED')
  if (!auth.ok) return auth.state

  const parsed = seedSchema.safeParse({
    question: requiredText(formData.get('question')),
    answer: requiredText(formData.get('answer')),
    publish: checkbox(formData.get('publish')),
  })
  if (!parsed.success) {
    return actionError('That entry could not be saved.', zodFieldErrors(parsed.error))
  }

  const result = await createSeededEntry({
    question: parsed.data.question,
    answer: parsed.data.answer,
    publish: parsed.data.publish,
    actor: { kind: 'user', id: auth.admin.id, label: auth.admin.email },
    actorUserId: auth.admin.id,
  })
  if (!result.ok) return actionError(result.message)

  revalidatePath(QA_QUEUE_PATH)
  revalidatePath(PORTAL_PATH)

  return actionOk(
    parsed.data.publish
      ? 'Entry written and published to the shared Q&A.'
      : 'Entry saved as a draft. It is not on the shared page.',
  )
}

// ---------------------------------------------------------------------------
// Operator — sending the reply (§6.7.2, explicit press)
// ---------------------------------------------------------------------------

/**
 * The one place a reply goes to an investor.
 *
 * The operator has already seen the rendered email on the entry page; this is
 * the press. It sends to one address, and there is no form of this function
 * that takes a list (§14).
 */
export async function sendAnswerReplyAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const auth = await authorize('SEND_REPLY')
  if (!auth.ok) return auth.state

  const parsed = entrySchema.safeParse({ entryId: requiredText(formData.get('entryId')) })
  if (!parsed.success) return actionError('That entry could not be found.')

  const result = await sendAnswerReply({
    entryId: parsed.data.entryId,
    actor: { kind: 'user', id: auth.admin.id, label: auth.admin.email },
  })

  if (!result.ok) return actionError(result.message)

  revalidatePath(QA_QUEUE_PATH)
  revalidatePath(PORTAL_PATH)

  return actionOk('Sent. The reply is now on their portal record as well.')
}

/** Re-attempt the §6.7.1 notification after fixing the mail connection. */
export async function retryQuestionNotificationAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const auth = await authorize('VIEW_QUEUE')
  if (!auth.ok) return auth.state

  const parsed = entrySchema.safeParse({ entryId: requiredText(formData.get('entryId')) })
  if (!parsed.success) return actionError('That entry could not be found.')

  const outcome = await notifyOperatorOfQuestion(parsed.data.entryId)
  revalidatePath(QA_QUEUE_PATH)

  return outcome.sent
    ? actionOk('Notification sent.')
    : actionError(outcome.detail ?? 'The notification could not be sent.')
}
