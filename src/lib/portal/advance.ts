/**
 * Moving an offer along the eight-step timeline. BUILD_SPEC §5.
 *
 * *"Statuses advance forward. Any reversal or correction requires a reason and
 * is written to the audit log as a correction, never a silent overwrite."*
 *
 * *"**Funds received requires two-step confirmation** in the operator UI, with
 * the amount re-typed to confirm. It is a financial assertion the investor will
 * rely on — treat it accordingly."*
 *
 * Both rules live here rather than in the form, because a rule enforced only by
 * a form is a rule a future caller routes around. `recordFundsReceived` takes
 * the amount twice and refuses if they differ; there is no parameter that
 * skips the comparison.
 *
 * Every change appends to `offer_status_events`, which is append-only. Nothing
 * in this file updates or deletes one.
 */

import { desc, eq } from 'drizzle-orm'
import { db } from '@/db'
import { commitments, fundsReceipts, offerStatusEvents, offers } from '@/db/schema'
import { audit, type Actor } from '@/lib/audit'
import { Dec, isoToday, parseMoney } from '@/lib/money'
import { OFFER_STAGES, type OfferStage } from './timeline'

export type StageResult = { ok: true } | { ok: false; message: string }

export const STAGE_LABEL: Readonly<Record<OfferStage, string>> = {
  INVITATION_SENT: 'Invitation sent',
  RESPONSE_RECORDED: 'Response recorded',
  DOCUMENTS_ISSUED: 'Documents issued',
  COMMITMENT_AGREED: 'Commitment agreed',
  ALLOCATION_ACCEPTED: 'Allocation accepted',
  PAYMENT_INSTRUCTIONS_ISSUED: 'Payment instructions issued',
  FUNDS_RECEIVED: 'Funds received',
  COMPLETED: 'Completed',
}

export function stageIndex(stage: OfferStage): number {
  return OFFER_STAGES.indexOf(stage)
}

/**
 * The next stage, or null at the end.
 *
 * Advancing is deliberately one step at a time. Jumping from "documents
 * issued" straight to "funds received" would leave an investor's timeline
 * claiming things happened that nobody recorded, and the timeline is the thing
 * they read to know where they stand.
 */
export function nextStage(stage: OfferStage): OfferStage | null {
  return OFFER_STAGES[stageIndex(stage) + 1] ?? null
}

/** The minimum length of a correction's reason. §5 requires one; this is teeth. */
export const MIN_CORRECTION_REASON = 10

// ---------------------------------------------------------------------------
// Advancing
// ---------------------------------------------------------------------------

export interface AdvanceInput {
  offerId: string
  toStage: OfferStage
  /** Shown to the investor beside the step. Optional. */
  investorNote?: string | null
  internalNote?: string | null
  actor: Actor
  actorUserId: string | null
  now?: Date
}

/**
 * Advance one step forward.
 *
 * Refuses a skip, refuses a reversal (that is `correctStage`), and refuses to
 * move into `FUNDS_RECEIVED` at all — that step is a financial assertion and
 * has its own function with the two-step confirmation §5 requires.
 */
export async function advanceStage(input: AdvanceInput): Promise<StageResult> {
  const now = input.now ?? new Date()

  const offer = await db.query.offers.findFirst({ where: eq(offers.id, input.offerId) })
  if (!offer) return { ok: false, message: 'That offer could not be found.' }

  const from = offer.stage as OfferStage
  const expected = nextStage(from)

  if (input.toStage === 'FUNDS_RECEIVED') {
    return {
      ok: false,
      message:
        'Funds received is recorded with its own form, because it asserts that money arrived ' +
        'and the investor will rely on it. Use "Record funds received" and re-type the amount.',
    }
  }

  if (expected === null) {
    return { ok: false, message: 'This offer is already at the final step.' }
  }

  if (input.toStage !== expected) {
    return {
      ok: false,
      message:
        `The next step for this offer is “${STAGE_LABEL[expected]}”. Steps advance one at a ` +
        'time so the investor’s timeline never claims something happened that nobody recorded. ' +
        'To go back, record a correction with a reason.',
    }
  }

  await db
    .update(offers)
    .set({ stage: input.toStage })
    .where(eq(offers.id, input.offerId))

  await db.insert(offerStatusEvents).values({
    offerId: input.offerId,
    fromStage: from,
    toStage: input.toStage,
    isCorrection: false,
    investorNote: input.investorNote?.trim() || null,
    internalNote: input.internalNote?.trim() || null,
    actorUserId: input.actorUserId,
  })

  await audit({
    actor: input.actor,
    entityType: 'offer',
    entityId: input.offerId,
    action: 'offer.stage_advanced',
    metadata: { from, to: input.toStage, at: now.toISOString() },
  })

  return { ok: true }
}

/**
 * Move a stage backwards, or re-assert one. §5: "Any reversal or correction
 * requires a reason and is written to the audit log as a correction, never a
 * silent overwrite."
 *
 * The reason is required by the signature. The previous stage is not erased —
 * `offer_status_events` keeps both entries and the second is flagged.
 */
export async function correctStage(input: {
  offerId: string
  toStage: OfferStage
  reason: string
  actor: Actor
  actorUserId: string | null
}): Promise<StageResult> {
  const reason = input.reason.trim()
  if (reason.length < MIN_CORRECTION_REASON) {
    return {
      ok: false,
      message:
        `A correction needs a recorded reason of at least ${MIN_CORRECTION_REASON} characters. ` +
        'The investor has already been shown the step being corrected.',
    }
  }

  const offer = await db.query.offers.findFirst({ where: eq(offers.id, input.offerId) })
  if (!offer) return { ok: false, message: 'That offer could not be found.' }

  const from = offer.stage as OfferStage

  await db.update(offers).set({ stage: input.toStage }).where(eq(offers.id, input.offerId))

  await db.insert(offerStatusEvents).values({
    offerId: input.offerId,
    fromStage: from,
    toStage: input.toStage,
    isCorrection: true,
    reason,
    actorUserId: input.actorUserId,
  })

  await audit({
    actor: input.actor,
    entityType: 'offer',
    entityId: input.offerId,
    action: 'offer.stage_corrected',
    metadata: { from, to: input.toStage, reason },
  })

  return { ok: true }
}

// ---------------------------------------------------------------------------
// The amounts — §5, four separate columns
// ---------------------------------------------------------------------------

export async function recordCommitment(input: {
  offerId: string
  amount: string
  agreedOn: string
  note?: string | null
  actor: Actor
  actorUserId: string | null
}): Promise<StageResult> {
  const parsed = parseMoney(input.amount)
  if (!parsed.ok) return { ok: false, message: 'That amount could not be read as a figure.' }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.agreedOn)) {
    return { ok: false, message: 'Use the date picker for the date it was agreed.' }
  }

  const offer = await db.query.offers.findFirst({ where: eq(offers.id, input.offerId) })
  if (!offer) return { ok: false, message: 'That offer could not be found.' }

  const amountUsd = parsed.value.toFixed(2)

  await db
    .update(offers)
    .set({ committedAmountUsd: amountUsd })
    .where(eq(offers.id, input.offerId))

  const existing = await db.query.commitments.findFirst({
    where: eq(commitments.offerId, input.offerId),
  })

  if (existing) {
    await db
      .update(commitments)
      .set({
        amountUsd,
        agreedAt: new Date(`${input.agreedOn}T00:00:00.000Z`),
        note: input.note?.trim() || null,
        recordedById: input.actorUserId,
      })
      .where(eq(commitments.id, existing.id))
  } else {
    await db.insert(commitments).values({
      offerId: input.offerId,
      amountUsd,
      spvPercentage: offer.spvPercentage,
      agreedAt: new Date(`${input.agreedOn}T00:00:00.000Z`),
      note: input.note?.trim() || null,
      recordedById: input.actorUserId,
    })
  }

  await audit({
    actor: input.actor,
    entityType: 'offer',
    entityId: input.offerId,
    action: 'offer.commitment_recorded',
    metadata: { agreedOn: input.agreedOn, amended: existing !== undefined },
  })

  return { ok: true }
}

export async function recordAcceptedAmount(input: {
  offerId: string
  amount: string
  actor: Actor
}): Promise<StageResult> {
  const parsed = parseMoney(input.amount)
  if (!parsed.ok) return { ok: false, message: 'That amount could not be read as a figure.' }

  await db
    .update(offers)
    .set({ acceptedAmountUsd: parsed.value.toFixed(2) })
    .where(eq(offers.id, input.offerId))

  await audit({
    actor: input.actor,
    entityType: 'offer',
    entityId: input.offerId,
    action: 'offer.allocation_accepted',
  })

  return { ok: true }
}

// ---------------------------------------------------------------------------
// Funds received — two-step, with the amount re-typed (§5)
// ---------------------------------------------------------------------------

export interface FundsReceivedInput {
  offerId: string
  /** As typed. */
  amount: string
  /** Typed a second time. Must match to the cent, or nothing is recorded. */
  amountConfirmation: string
  currency: string
  valueDate: string
  reference: string
  /** The operator's explicit second step. False refuses. */
  confirmed: boolean
  actor: Actor
  actorUserId: string | null
  now?: Date
}

export const FUNDS_CONFIRMATION_NOTICE =
  'Recording funds received tells the investor their money has arrived and generates their ' +
  'participation certificate. Re-type the amount and tick the confirmation — it is a financial ' +
  'assertion they will rely on.'

/**
 * Record that money arrived.
 *
 * Four things have to be true before anything is written: the amounts match to
 * the cent, the confirmation was ticked, the value date is a real date and not
 * in the future, and the reference is present. Any one of them missing writes
 * nothing at all.
 *
 * A correction — re-recording with a different amount — is allowed and is
 * recorded as one. The certificate is reissued by the caller; the superseded
 * version is retained (§5.1).
 */
export async function recordFundsReceived(
  input: FundsReceivedInput,
): Promise<{ ok: true; corrected: boolean } | { ok: false; message: string }> {
  const now = input.now ?? new Date()

  if (!input.confirmed) {
    return {
      ok: false,
      message:
        'Nothing was recorded. Tick the confirmation as well as re-typing the amount — this is ' +
        'the second step, and it is deliberate.',
    }
  }

  const first = parseMoney(input.amount)
  const second = parseMoney(input.amountConfirmation)

  if (!first.ok || !second.ok) {
    return { ok: false, message: 'That amount could not be read as a figure. Nothing was recorded.' }
  }

  // Compared as decimals, so "5,000" and "5000.00" are the same amount and
  // "5000.01" is not. A string comparison would reject the first pair.
  if (!new Dec(first.value.toFixed(2)).equals(new Dec(second.value.toFixed(2)))) {
    return {
      ok: false,
      message:
        'The two amounts do not match, so nothing was recorded. Re-type both and check them ' +
        'against the bank statement rather than against each other.',
    }
  }

  const currency = input.currency.trim().toUpperCase()
  if (!/^[A-Z]{3}$/.test(currency)) {
    return { ok: false, message: 'Use a three-letter currency code, for example USD.' }
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.valueDate)) {
    return { ok: false, message: 'Use the date picker for the value date.' }
  }
  if (input.valueDate > isoToday(now)) {
    return {
      ok: false,
      message:
        'The value date is in the future. Record it when the funds have actually settled, not ' +
        'before.',
    }
  }

  const reference = input.reference.trim()
  if (reference === '') {
    return {
      ok: false,
      message:
        'A payment reference is required. It goes on the certificate and it is how the investor ' +
        'reconciles this against their own records.',
    }
  }

  const offer = await db.query.offers.findFirst({ where: eq(offers.id, input.offerId) })
  if (!offer) return { ok: false, message: 'That offer could not be found.' }

  const amountUsd = first.value.toFixed(2)
  const existing = await db.query.fundsReceipts.findFirst({
    where: eq(fundsReceipts.offerId, input.offerId),
  })
  const corrected = existing !== undefined

  if (existing) {
    await db
      .update(fundsReceipts)
      .set({
        amount: amountUsd,
        currency,
        valueDate: input.valueDate,
        reference,
        recordedById: input.actorUserId,
      })
      .where(eq(fundsReceipts.id, existing.id))
  } else {
    await db.insert(fundsReceipts).values({
      offerId: input.offerId,
      amount: amountUsd,
      currency,
      valueDate: input.valueDate,
      reference,
      recordedById: input.actorUserId,
    })
  }

  const from = offer.stage as OfferStage

  await db
    .update(offers)
    .set({ receivedAmountUsd: amountUsd, stage: 'FUNDS_RECEIVED' })
    .where(eq(offers.id, input.offerId))

  await db.insert(offerStatusEvents).values({
    offerId: input.offerId,
    fromStage: from,
    toStage: 'FUNDS_RECEIVED',
    isCorrection: corrected,
    reason: corrected ? 'The recorded receipt was amended.' : null,
    actorUserId: input.actorUserId,
  })

  await audit({
    actor: input.actor,
    entityType: 'offer',
    entityId: input.offerId,
    action: corrected ? 'offer.funds_corrected' : 'offer.funds_received',
    // The value date, the currency and whether it was a correction. Never a
    // bank reference in the log — it is on the record and on the certificate.
    metadata: { from, valueDate: input.valueDate, currency, corrected },
  })

  return { ok: true, corrected }
}

/** The stage history for one offer, newest first. Operator-facing. */
export async function loadStageHistory(offerId: string) {
  return db
    .select()
    .from(offerStatusEvents)
    .where(eq(offerStatusEvents.offerId, offerId))
    .orderBy(desc(offerStatusEvents.createdAt))
    .limit(50)
}
