'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { actionError, actionOk, type ActionState } from '@/components/admin/action-state'
import { audit } from '@/lib/audit'
import { currentAdmin, requireOwner } from '@/lib/auth/guards'
import { checkbox, optionalText, requiredText, zodFieldErrors } from '@/lib/form-values'
import { canManageQa } from '@/lib/qa/authority'
import {
  closeRound,
  extendDeadline,
  extendRoundDeadline,
  reopenRound,
} from '@/lib/rounds/close'
import { ROUND_PATH, sendRoundDigest } from '@/lib/rounds/digest'

/**
 * Closing a round and extending deadlines. BUILD_SPEC §6.6.
 *
 * Note what is not here: anything scheduled. §6.6 is explicit that a deadline
 * passing closes nothing, and the only automatic thing in the whole section is
 * an email to the operator saying it is his call. Every function below needs a
 * signed-in person to press something.
 *
 * Closing and reopening are **owner-only**. §6.6 says "David decides" about
 * *when*, and the operator can extend freely — but closing marks unfilled
 * allocations available and unlocks the post-close features in §21, which is a
 * decision about the raise rather than about running it. Where the spec is
 * silent on who, the conservative reading wins.
 */

interface Authorized {
  ok: true
  admin: { id: string; email: string }
}

async function authorizeAdmin(
  action: string,
): Promise<Authorized | { ok: false; state: ActionState }> {
  const admin = await currentAdmin()

  if (admin && canManageQa(admin.role)) {
    return { ok: true, admin: { id: admin.id, email: admin.email } }
  }

  await audit({
    actor: admin
      ? { kind: 'user', id: admin.id, label: admin.email }
      : { kind: 'system', label: 'unauthenticated' },
    entityType: 'round',
    entityId: null,
    action: 'round.refused',
    metadata: { attemptedAction: action },
  })

  return {
    ok: false,
    state: actionError(
      'You are not signed in as an administrator, so you cannot change the round. Sign in ' +
        'first. Nothing has been changed.',
    ),
  }
}

// ---------------------------------------------------------------------------
// Extending — the operator's, because giving somebody more time is process
// ---------------------------------------------------------------------------

const extendOneSchema = z.object({
  offerId: z.string().min(1),
  newDeadline: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the date picker.'),
})

export async function extendOneDeadlineAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const auth = await authorizeAdmin('EXTEND_ONE')
  if (!auth.ok) return auth.state

  const parsed = extendOneSchema.safeParse({
    offerId: requiredText(formData.get('offerId')),
    newDeadline: requiredText(formData.get('newDeadline')),
  })
  if (!parsed.success) {
    return actionError('Nothing was extended.', zodFieldErrors(parsed.error))
  }

  const result = await extendDeadline({
    offerId: parsed.data.offerId,
    newDeadline: parsed.data.newDeadline,
    reason: optionalText(formData.get('reason')),
    actor: { kind: 'user', id: auth.admin.id, label: auth.admin.email },
  })
  if (!result.ok) return actionError(result.message)

  revalidatePath(ROUND_PATH)
  revalidatePath('/recipients')
  revalidatePath('/portal')

  return actionOk(
    'Extended. Their portal shows the new date immediately. Nothing has been emailed to them — ' +
      'if you want them told, that is an update or a reminder.',
  )
}

const extendAllSchema = z.object({
  roundId: z.string().min(1),
  newDeadline: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the date picker.'),
})

export async function extendRoundDeadlineAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const auth = await authorizeAdmin('EXTEND_ALL')
  if (!auth.ok) return auth.state

  const parsed = extendAllSchema.safeParse({
    roundId: requiredText(formData.get('roundId')),
    newDeadline: requiredText(formData.get('newDeadline')),
  })
  if (!parsed.success) {
    return actionError('Nothing was extended.', zodFieldErrors(parsed.error))
  }

  const result = await extendRoundDeadline({
    roundId: parsed.data.roundId,
    newDeadline: parsed.data.newDeadline,
    reason: optionalText(formData.get('reason')),
    actor: { kind: 'user', id: auth.admin.id, label: auth.admin.email },
  })
  if (!result.ok) return actionError(result.message)

  revalidatePath(ROUND_PATH)
  revalidatePath('/recipients')
  revalidatePath('/portal')

  return actionOk(
    `${result.extended} ${result.extended === 1 ? 'deadline was' : 'deadlines were'} extended. ` +
      'Only people who have not responded — moving the date for somebody who already answered ' +
      'would make their portal disagree with the email they were sent.',
  )
}

// ---------------------------------------------------------------------------
// Closing — owner only
// ---------------------------------------------------------------------------

export async function closeRoundAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  // `requireOwner()` redirects an operator to the no-access page and audits the
  // attempt. The button is hidden from them too; the hiding is manners.
  const owner = await requireOwner()

  const roundId = requiredText(formData.get('roundId'))
  if (roundId === '') return actionError('That round could not be found.')

  const result = await closeRound({
    roundId,
    confirmed: checkbox(formData.get('confirmed')),
    closingEarlyAcknowledged: checkbox(formData.get('closingEarly')),
    actorUserId: owner.id,
    actor: { kind: 'user', id: owner.id, label: owner.email },
  })
  if (!result.ok) return actionError(result.message)

  revalidatePath(ROUND_PATH)
  revalidatePath('/recipients')
  revalidatePath('/portal')

  return actionOk(
    'The round is closed. Further responses are not accepted, and nobody has been emailed ' +
      'about it — telling them is an update, written by you.',
  )
}

const reopenSchema = z.object({
  roundId: z.string().min(1),
  reason: z.string().trim().min(10, 'Record why it is being reopened.'),
})

export async function reopenRoundAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const owner = await requireOwner()

  const parsed = reopenSchema.safeParse({
    roundId: requiredText(formData.get('roundId')),
    reason: requiredText(formData.get('reason')),
  })
  if (!parsed.success) {
    return actionError('It was not reopened.', zodFieldErrors(parsed.error))
  }

  const result = await reopenRound({
    roundId: parsed.data.roundId,
    reason: parsed.data.reason,
    actor: { kind: 'user', id: owner.id, label: owner.email },
  })
  if (!result.ok) return actionError(result.message)

  revalidatePath(ROUND_PATH)
  revalidatePath('/portal')

  return actionOk('Reopened, with your reason recorded.')
}

/** Send the §6.6 digest now, rather than waiting for the scheduled job. */
export async function sendRoundDigestAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const auth = await authorizeAdmin('SEND_DIGEST')
  if (!auth.ok) return auth.state

  const roundId = requiredText(formData.get('roundId'))
  if (roundId === '') return actionError('That round could not be found.')

  const outcome = await sendRoundDigest({
    roundId,
    actor: { kind: 'user', id: auth.admin.id, label: auth.admin.email },
    force: true,
  })

  revalidatePath(ROUND_PATH)

  return outcome.sent
    ? actionOk('Sent to the operator, and to nobody else.')
    : actionError(outcome.reason)
}
