'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { actionError, actionOk, type ActionState } from '@/components/admin/action-state'
import { audit } from '@/lib/audit'
import { currentAdmin } from '@/lib/auth/guards'
import { issueCertificate } from '@/lib/certificate/issue'
import { checkbox, optionalText, requiredText, zodFieldErrors } from '@/lib/form-values'
import { canManageQa } from '@/lib/qa/authority'
import {
  advanceStage,
  correctStage,
  recordAcceptedAmount,
  recordCommitment,
  recordFundsReceived,
} from '@/lib/portal/advance'
import { OFFER_STAGES } from '@/lib/portal/timeline'

/**
 * Operator-side status advancement. BUILD_SPEC §5.
 *
 * The one to read is `recordFundsReceivedAction`. §5: "**Funds received
 * requires two-step confirmation** in the operator UI, with the amount re-typed
 * to confirm. It is a financial assertion the investor will rely on — treat it
 * accordingly."
 *
 * The two steps are the re-typed amount and an explicit tick, and both are
 * checked in `recordFundsReceived` rather than in the form. On success the
 * certificate is issued in the same request, because §5.1 says it is generated
 * once the investor reaches funds received and an investor who is told their
 * money arrived should not have to wait for somebody to press a second button.
 */

const OFFERS_PATH = '/recipients'

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
    entityType: 'offer',
    entityId: null,
    action: 'offer.refused',
    metadata: { attemptedAction: action },
  })

  return {
    ok: false,
    state: actionError(
      'You are not signed in as an administrator, so you cannot change an investor’s status. ' +
        'Sign in first. Nothing has been changed.',
    ),
  }
}

const stageSchema = z.object({
  offerId: z.string().min(1),
  toStage: z.enum(OFFER_STAGES),
})

export async function advanceStageAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const auth = await authorize('ADVANCE')
  if (!auth.ok) return auth.state

  const parsed = stageSchema.safeParse({
    offerId: requiredText(formData.get('offerId')),
    toStage: requiredText(formData.get('toStage')),
  })
  if (!parsed.success) return actionError('That step could not be recorded.')

  const result = await advanceStage({
    offerId: parsed.data.offerId,
    toStage: parsed.data.toStage,
    investorNote: optionalText(formData.get('investorNote')),
    internalNote: optionalText(formData.get('internalNote')),
    actor: { kind: 'user', id: auth.admin.id, label: auth.admin.email },
    actorUserId: auth.admin.id,
  })
  if (!result.ok) return actionError(result.message)

  revalidatePath(OFFERS_PATH)
  revalidatePath('/portal')

  return actionOk('Recorded. Their timeline now shows this step.')
}

const correctionSchema = stageSchema.extend({
  reason: z.string().trim().min(10, 'Record why. The investor has already seen the old step.'),
})

export async function correctStageAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const auth = await authorize('CORRECT')
  if (!auth.ok) return auth.state

  const parsed = correctionSchema.safeParse({
    offerId: requiredText(formData.get('offerId')),
    toStage: requiredText(formData.get('toStage')),
    reason: requiredText(formData.get('reason')),
  })
  if (!parsed.success) {
    return actionError('The correction was not recorded.', zodFieldErrors(parsed.error))
  }

  const result = await correctStage({
    offerId: parsed.data.offerId,
    toStage: parsed.data.toStage,
    reason: parsed.data.reason,
    actor: { kind: 'user', id: auth.admin.id, label: auth.admin.email },
    actorUserId: auth.admin.id,
  })
  if (!result.ok) return actionError(result.message)

  revalidatePath(OFFERS_PATH)
  revalidatePath('/portal')

  return actionOk('Correction recorded. The original step is kept on the record.')
}

const commitmentSchema = z.object({
  offerId: z.string().min(1),
  amount: z.string().trim().min(1, 'An amount is needed.'),
  agreedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the date picker.'),
})

export async function recordCommitmentAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const auth = await authorize('COMMITMENT')
  if (!auth.ok) return auth.state

  const parsed = commitmentSchema.safeParse({
    offerId: requiredText(formData.get('offerId')),
    amount: requiredText(formData.get('amount')),
    agreedOn: requiredText(formData.get('agreedOn')),
  })
  if (!parsed.success) {
    return actionError('The commitment was not recorded.', zodFieldErrors(parsed.error))
  }

  const result = await recordCommitment({
    offerId: parsed.data.offerId,
    amount: parsed.data.amount,
    agreedOn: parsed.data.agreedOn,
    note: optionalText(formData.get('note')),
    actor: { kind: 'user', id: auth.admin.id, label: auth.admin.email },
    actorUserId: auth.admin.id,
  })
  if (!result.ok) return actionError(result.message)

  revalidatePath(OFFERS_PATH)
  revalidatePath('/portal')

  return actionOk('Committed amount recorded, separately from the proposed one.')
}

export async function recordAcceptedAmountAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const auth = await authorize('ACCEPTED')
  if (!auth.ok) return auth.state

  const offerId = requiredText(formData.get('offerId'))
  const amount = requiredText(formData.get('amount'))
  if (offerId === '' || amount === '') return actionError('An amount is needed.')

  const result = await recordAcceptedAmount({
    offerId,
    amount,
    actor: { kind: 'user', id: auth.admin.id, label: auth.admin.email },
  })
  if (!result.ok) return actionError(result.message)

  revalidatePath(OFFERS_PATH)
  revalidatePath('/portal')

  return actionOk('Accepted amount recorded.')
}

// ---------------------------------------------------------------------------
// Funds received — the two-step one (§5), and the certificate (§5.1)
// ---------------------------------------------------------------------------

const fundsSchema = z.object({
  offerId: z.string().min(1),
  amount: z.string().trim().min(1, 'Type the amount.'),
  amountConfirmation: z.string().trim().min(1, 'Type the amount a second time.'),
  currency: z.string().trim().length(3, 'A three-letter currency code.'),
  valueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the date picker.'),
  reference: z.string().trim().min(1, 'The payment reference is required.'),
})

export async function recordFundsReceivedAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const auth = await authorize('FUNDS_RECEIVED')
  if (!auth.ok) return auth.state

  const parsed = fundsSchema.safeParse({
    offerId: requiredText(formData.get('offerId')),
    amount: requiredText(formData.get('amount')),
    amountConfirmation: requiredText(formData.get('amountConfirmation')),
    currency: requiredText(formData.get('currency')),
    valueDate: requiredText(formData.get('valueDate')),
    reference: requiredText(formData.get('reference')),
  })
  if (!parsed.success) {
    return actionError('Nothing was recorded.', zodFieldErrors(parsed.error))
  }

  const actor = { kind: 'user' as const, id: auth.admin.id, label: auth.admin.email }

  const result = await recordFundsReceived({
    ...parsed.data,
    confirmed: checkbox(formData.get('confirmed')),
    actor,
    actorUserId: auth.admin.id,
  })
  if (!result.ok) return actionError(result.message)

  // §5.1: the certificate is generated once the investor reaches funds
  // received. A correction reissues it and the superseded version is retained.
  const certificate = await issueCertificate({ offerId: parsed.data.offerId, actor })

  revalidatePath(OFFERS_PATH)
  revalidatePath('/portal')

  if (!certificate.ok) {
    return actionOk(
      `Funds recorded${result.corrected ? ' as a correction' : ''}. The certificate was not ` +
        `reissued: ${certificate.message}`,
    )
  }

  return actionOk(
    result.corrected
      ? `Correction recorded. Certificate version ${certificate.version} has been issued and ` +
          `the previous ${certificate.superseded === 1 ? 'version is' : 'versions are'} kept on ` +
          'their record, marked as superseded.'
      : 'Funds recorded and their participation certificate has been issued. It is on their ' +
          'portal now — nothing was emailed.',
  )
}

/** Reissue by hand, when a figure was corrected elsewhere. */
export async function reissueCertificateAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const auth = await authorize('REISSUE_CERTIFICATE')
  if (!auth.ok) return auth.state

  const offerId = requiredText(formData.get('offerId'))
  if (offerId === '') return actionError('That offer could not be found.')

  const result = await issueCertificate({
    offerId,
    actor: { kind: 'user', id: auth.admin.id, label: auth.admin.email },
  })
  if (!result.ok) return actionError(result.message)

  revalidatePath(OFFERS_PATH)
  revalidatePath('/portal')

  return actionOk(
    `Version ${result.version} issued. ${result.superseded} earlier ` +
      `${result.superseded === 1 ? 'version is' : 'versions are'} retained and marked superseded.`,
  )
}
