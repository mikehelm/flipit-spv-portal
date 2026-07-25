'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { actionError, actionOk, type ActionState } from '@/components/admin/action-state'
import { audit } from '@/lib/audit'
import { currentAdmin } from '@/lib/auth/guards'
import { checkbox, requiredText, zodFieldErrors } from '@/lib/form-values'
import { canManageQa } from '@/lib/qa/authority'
import type { UpdateAudience } from '@/lib/updates/audience'
import {
  UPDATES_PATH,
  createDraft,
  deleteDraft,
  editDraft,
  notifyOneRecipient,
  publishUpdate,
  withdrawUpdate,
} from '@/lib/updates/service'

/**
 * The updates feed. BUILD_SPEC §6.
 *
 * Entirely an admin surface — an investor reads updates and does nothing else
 * to them, so there is no investor-facing action in this file at all.
 *
 * Note what publishing does NOT do: send. §14 forbids a bulk send anywhere in
 * the UI or the API, and a notification that went to forty people because one
 * button was pressed is a bulk send whatever it is called. Publishing queues
 * them; each one is its own press, from its own button, to one address.
 */

const PORTAL_PATH = '/portal'

interface Authorized {
  ok: true
  admin: { id: string; email: string }
}

async function authorize(action: string): Promise<Authorized | { ok: false; state: ActionState }> {
  const admin = await currentAdmin()

  if (admin && canManageQa(admin.role)) {
    return { ok: true, admin: { id: admin.id, email: admin.email } }
  }

  await audit({
    actor: admin
      ? { kind: 'user', id: admin.id, label: admin.email }
      : { kind: 'system', label: 'unauthenticated' },
    entityType: 'portal_update',
    entityId: null,
    action: 'update.refused',
    metadata: { attemptedAction: action },
  })

  return {
    ok: false,
    state: actionError(
      'You are not signed in as an administrator, so you cannot work on updates. Sign in ' +
        'first. Nothing has been changed.',
    ),
  }
}

// ---------------------------------------------------------------------------
// Reading the audience off the form
// ---------------------------------------------------------------------------

const audienceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('ALL') }),
  z.object({
    kind: z.literal('STATUS'),
    statuses: z.array(z.enum(['INVITED', 'ACTIVE', 'CLOSED'])).min(1, 'Choose at least one status.'),
  }),
  z.object({ kind: z.literal('ONE'), accountId: z.string().min(1, 'Choose an investor.') }),
])

function readAudience(formData: FormData): UpdateAudience | null {
  const kind = requiredText(formData.get('audienceKind'))

  const raw =
    kind === 'STATUS'
      ? { kind, statuses: formData.getAll('statuses').map(String) }
      : kind === 'ONE'
        ? { kind, accountId: requiredText(formData.get('audienceAccountId')) }
        : { kind: 'ALL' as const }

  const parsed = audienceSchema.safeParse(raw)
  return parsed.success ? (parsed.data as UpdateAudience) : null
}

const draftSchema = z.object({
  title: z.string().trim().min(1, 'An update needs a title.').max(200),
  body: z.string().trim().min(1, 'An update needs something to say.').max(20000),
})

// ---------------------------------------------------------------------------
// Drafting
// ---------------------------------------------------------------------------

export async function createDraftAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const auth = await authorize('CREATE_DRAFT')
  if (!auth.ok) return auth.state

  const parsed = draftSchema.safeParse({
    title: requiredText(formData.get('title')),
    body: requiredText(formData.get('body')),
  })
  if (!parsed.success) {
    return actionError('The draft was not saved.', zodFieldErrors(parsed.error))
  }

  const audience = readAudience(formData)
  if (!audience) {
    return actionError(
      'The audience could not be read. Choose everyone, a set of statuses, or one investor.',
    )
  }

  const result = await createDraft({
    title: parsed.data.title,
    body: parsed.data.body,
    audience,
    notifyByEmail: checkbox(formData.get('notifyByEmail')),
    authorId: auth.admin.id,
    actor: { kind: 'user', id: auth.admin.id, label: auth.admin.email },
  })
  if (!result.ok) return actionError(result.message)

  revalidatePath(UPDATES_PATH)
  return actionOk(
    'Draft saved. Nothing is on anybody’s portal and no email has been sent — preview it, then ' +
      'publish when you are happy with it.',
  )
}

export async function editDraftAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const auth = await authorize('EDIT_DRAFT')
  if (!auth.ok) return auth.state

  const updateId = requiredText(formData.get('updateId'))
  if (updateId === '') return actionError('That update could not be found.')

  const parsed = draftSchema.safeParse({
    title: requiredText(formData.get('title')),
    body: requiredText(formData.get('body')),
  })
  if (!parsed.success) {
    return actionError('The draft was not saved.', zodFieldErrors(parsed.error))
  }

  const audience = readAudience(formData)
  if (!audience) return actionError('The audience could not be read.')

  const result = await editDraft({
    updateId,
    title: parsed.data.title,
    body: parsed.data.body,
    audience,
    notifyByEmail: checkbox(formData.get('notifyByEmail')),
    actor: { kind: 'user', id: auth.admin.id, label: auth.admin.email },
  })
  if (!result.ok) return actionError(result.message)

  revalidatePath(UPDATES_PATH)
  return actionOk('Draft saved.')
}

export async function deleteDraftAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const auth = await authorize('DELETE_DRAFT')
  if (!auth.ok) return auth.state

  const updateId = requiredText(formData.get('updateId'))
  if (updateId === '') return actionError('That update could not be found.')

  const result = await deleteDraft({
    updateId,
    actor: { kind: 'user', id: auth.admin.id, label: auth.admin.email },
  })
  if (!result.ok) return actionError(result.message)

  revalidatePath(UPDATES_PATH)
  return actionOk('Draft discarded.')
}

// ---------------------------------------------------------------------------
// Publishing and withdrawing
// ---------------------------------------------------------------------------

export async function publishUpdateAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const auth = await authorize('PUBLISH')
  if (!auth.ok) return auth.state

  const updateId = requiredText(formData.get('updateId'))
  if (updateId === '') return actionError('That update could not be found.')

  const result = await publishUpdate({
    updateId,
    actor: { kind: 'user', id: auth.admin.id, label: auth.admin.email },
  })
  if (!result.ok) return actionError(result.message)

  revalidatePath(UPDATES_PATH)
  revalidatePath(PORTAL_PATH)

  return actionOk(
    `Published. It is now on ${result.recipients} ${
      result.recipients === 1 ? 'portal' : 'portals'
    } and cannot be changed — a correction is a new update. No email has gone out: notifications ` +
      'are sent one recipient at a time, from the list below.',
  )
}

const withdrawSchema = z.object({
  updateId: z.string().min(1),
  reason: z
    .string()
    .trim()
    .min(10, 'Record why it is being withdrawn. It goes in the audit log.')
    .max(2000),
})

export async function withdrawUpdateAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const auth = await authorize('WITHDRAW')
  if (!auth.ok) return auth.state

  const parsed = withdrawSchema.safeParse({
    updateId: requiredText(formData.get('updateId')),
    reason: requiredText(formData.get('reason')),
  })
  if (!parsed.success) {
    return actionError('It was not withdrawn.', zodFieldErrors(parsed.error))
  }

  const result = await withdrawUpdate({
    updateId: parsed.data.updateId,
    reason: parsed.data.reason,
    actor: { kind: 'user', id: auth.admin.id, label: auth.admin.email },
  })
  if (!result.ok) return actionError(result.message)

  revalidatePath(UPDATES_PATH)
  revalidatePath(PORTAL_PATH)

  return actionOk(
    'Withdrawn. It has gone from every portal. It does not un-send it — anyone who has already ' +
      'read it has already read it. The withdrawal and its reason are in the audit log.',
  )
}

// ---------------------------------------------------------------------------
// Notifying — one recipient, one press (§6, §14)
// ---------------------------------------------------------------------------

export async function notifyRecipientAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const auth = await authorize('NOTIFY')
  if (!auth.ok) return auth.state

  const updateId = requiredText(formData.get('updateId'))
  const accountId = requiredText(formData.get('accountId'))
  if (updateId === '' || accountId === '') {
    return actionError('That notification could not be sent.')
  }

  const result = await notifyOneRecipient({
    updateId,
    accountId,
    actor: { kind: 'user', id: auth.admin.id, label: auth.admin.email },
  })
  if (!result.ok) return actionError(result.message)

  revalidatePath(UPDATES_PATH)
  return actionOk(
    'Sent. It says only that an update is available and links to the portal — no amounts, no ' +
      'percentages, nothing personal.',
  )
}

/** Read-marking, from the investor's own page. */
export async function markUpdateReadAction(updateId: string): Promise<void> {
  const { readInvestorAccount } = await import('@/lib/portal/session')
  const { markRead } = await import('@/lib/updates/service')

  const account = await readInvestorAccount()
  if (!account) return

  // Bound to the session's own account. There is no parameter naming whose
  // delivery row to mark, and a guessed update id marks nothing.
  await markRead({ updateId, accountId: account.id })
}
