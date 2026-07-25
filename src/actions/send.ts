'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { actionError, actionOk, type ActionState } from '@/components/admin/action-state'
import { audit } from '@/lib/audit'
import { requireOnboardedAdmin } from '@/lib/auth/guards'
import {
  loadBatchContext,
  PREFLIGHT_ATTESTATION_ACTION,
  PREFLIGHT_RESET_ACTION,
} from '@/lib/sending/data'
import { isAttestedItemId } from '@/lib/sending/preflight'
import { sendInvitation } from '@/lib/sending/send-invitation'

/**
 * Sending, one recipient at a time. BUILD_SPEC §12, §14, §19.
 *
 * There is deliberately no action in this file that takes a list. §14 is
 * explicit that sending is one recipient at a time by design, and the way to
 * keep that true is for the shape of the code to make a bulk send something
 * somebody would have to sit down and write, rather than something they reach
 * by passing an array to a function that already exists.
 *
 * Every action re-establishes the caller. The page having hidden a button is
 * not a reason to trust the request.
 */

// A 'use server' module may only export async functions, so this is a plain
// module-level constant rather than an export.
const RECIPIENTS_PATH = '/recipients'

const attestSchema = z.object({
  item: z.string().min(1),
})

/**
 * Records one pre-flight attestation. Only the four judgement items are
 * accepted — an attempt to "confirm" an enforced item is refused and logged,
 * because a request naming `SERVICE_MODE_ACTIVE` is either a bug or somebody
 * probing for an override.
 */
export async function confirmPreflightItemAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const admin = await requireOnboardedAdmin()

  const parsed = attestSchema.safeParse({ item: formData.get('item') })
  if (!parsed.success) return actionError('That checklist item could not be identified.')

  const { roundId } = await loadBatchContext()
  if (!roundId) {
    return actionError('There is no open round to run a pre-flight against.')
  }

  if (!isAttestedItemId(parsed.data.item)) {
    await audit({
      actor: { kind: 'user', id: admin.id, label: admin.email },
      entityType: 'round',
      entityId: roundId,
      action: 'preflight.confirmation_refused',
      metadata: { item: parsed.data.item, reason: 'NOT_AN_ATTESTED_ITEM' },
    })
    return actionError(
      'That item is enforced by the application, not confirmed by a person. It passes when ' +
        'the underlying condition is actually true, and there is no way to tick it.',
    )
  }

  await audit({
    actor: { kind: 'user', id: admin.id, label: admin.email },
    entityType: 'round',
    entityId: roundId,
    action: PREFLIGHT_ATTESTATION_ACTION,
    metadata: { item: parsed.data.item },
  })

  revalidatePath(RECIPIENTS_PATH)
  return actionOk('Recorded, against your name and the current time.')
}

/** Clears every attestation for the round, so the checklist is walked again. */
export async function resetPreflightAction(
  _previous: ActionState,
  _formData: FormData,
): Promise<ActionState> {
  const admin = await requireOnboardedAdmin()

  const { roundId } = await loadBatchContext()
  if (!roundId) return actionError('There is no open round.')

  await audit({
    actor: { kind: 'user', id: admin.id, label: admin.email },
    entityType: 'round',
    entityId: roundId,
    action: PREFLIGHT_RESET_ACTION,
  })

  revalidatePath(RECIPIENTS_PATH)
  return actionOk('Pre-flight cleared. Every confirmation has to be given again.')
}

const sendSchema = z.object({
  offerId: z.string().min(1),
  /** Typed by the operator, so a send is never one stray click. */
  confirmation: z.string().min(1),
})

/**
 * Send one invitation to one recipient.
 *
 * Refuses unless the batch pre-flight is complete, then applies the compliance
 * gate and the transport gate to this recipient specifically. A refusal for one
 * recipient says so in that recipient's own words and changes nothing about
 * anybody else.
 */
export async function sendInvitationAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const admin = await requireOnboardedAdmin()

  const parsed = sendSchema.safeParse({
    offerId: formData.get('offerId'),
    confirmation: formData.get('confirmation'),
  })
  if (!parsed.success) {
    return actionError('That recipient could not be identified, so nothing was sent.')
  }

  const context = await loadBatchContext()
  const target = context.targets.find((row) => row.offerId === parsed.data.offerId)
  if (!target) {
    return actionError('That recipient is not in the current round. Nothing was sent.')
  }

  // The confirmation is the recipient's own address, typed out. It is the one
  // thing that cannot be got right by clicking the wrong row.
  if (
    parsed.data.confirmation.trim().toLowerCase() !== target.recipientEmail.toLowerCase()
  ) {
    return actionError(
      'The address you typed does not match this recipient, so nothing was sent. ' +
        'Type the address exactly as it appears in the row.',
    )
  }

  if (!context.preflight.ready) {
    const outstanding = [
      ...context.preflight.blocking.map((item) => item.label),
      ...context.preflight.awaiting.map((item) => item.label),
    ]
    return actionError(
      `Pre-flight is not complete, so nothing was sent. Outstanding: ${outstanding.join('; ')}.`,
    )
  }

  const result = await sendInvitation({
    target,
    defaults: context.defaults,
    approval: context.approval,
    drift: context.drift,
    actor: { kind: 'user', id: admin.id, label: admin.email },
    actorUserId: admin.id,
  })

  revalidatePath(RECIPIENTS_PATH)

  if (result.outcome === 'SENT') {
    return actionOk(
      `Sent to ${target.recipientName} <${target.recipientEmail}>. The exact email has been ` +
        'stored as an immutable snapshot, and their portal link works from now until it is used or expires.',
    )
  }

  if (result.outcome === 'BLOCKED') {
    // Verbatim from the gate — specific, and about this one recipient.
    return actionError(result.message)
  }

  return actionError(
    `${result.message}${
      result.permanent
        ? ' This is a permanent failure, so retrying unchanged will fail the same way.'
        : ' This looks temporary. The recipient can be retried.'
    }`,
  )
}
