/**
 * Reading offers for the gate, and working out which block flags need to
 * change. BUILD_SPEC §8.2 item 3, §8.3.
 *
 * The read is here. The write is in `src/actions/compliance.ts`, together with
 * the owner check and the audit entry, so that nothing can change a block flag
 * by importing this module.
 *
 * `planBlockUpdates` is pure, which matters more than it looks: deciding what
 * to change and then changing it are separate steps, so the decision can be
 * tested exhaustively and shown to the owner before anything is written.
 */

import { desc, eq } from 'drizzle-orm'
import { db } from '@/db'
import { investorAccounts, offers, recipients } from '@/db/schema'
import type { ComplianceApprovalRecord } from './approvals'
import { shortBlockReason } from './explain'
import type { GateableOffer, OfferBlockReason } from './gate'
import { hasRecordedOverride, isJurisdictionApproved } from './jurisdictions'

export interface OfferGateRow extends GateableOffer {
  recipientName: string
  recipientEmail: string
  emailStatus: string
  stage: string
  roundId: string
}

/**
 * Every offer, with the jurisdiction that governs it.
 *
 * The jurisdiction lives on the recipient row, not the offer, so an offer with
 * no recipient row comes back with `null` — and a null jurisdiction is a block,
 * never a pass. The join is a `leftJoin` precisely so that case surfaces rather
 * than the row silently disappearing from the list.
 */
export async function loadGateableOffers(): Promise<OfferGateRow[]> {
  const rows = await db
    .select({
      id: offers.id,
      roundId: offers.roundId,
      blocked: offers.blocked,
      blockReason: offers.blockReason,
      blockDetail: offers.blockDetail,
      jurisdictionApprovalRef: offers.jurisdictionApprovalRef,
      emailStatus: offers.emailStatus,
      stage: offers.stage,
      recipientName: investorAccounts.name,
      recipientEmail: investorAccounts.email,
      jurisdiction: recipients.jurisdiction,
    })
    .from(offers)
    .innerJoin(investorAccounts, eq(offers.accountId, investorAccounts.id))
    .leftJoin(recipients, eq(offers.recipientId, recipients.id))
    .orderBy(desc(offers.createdAt))

  return rows.map((row) => ({
    ...row,
    jurisdiction: row.jurisdiction ?? null,
  }))
}

export async function loadGateableOffer(offerId: string): Promise<OfferGateRow | null> {
  const all = await loadGateableOffers()
  return all.find((row) => row.id === offerId) ?? null
}

// ---------------------------------------------------------------------------
// Planning the block flags
// ---------------------------------------------------------------------------

export interface BlockUpdate {
  offerId: string
  blocked: boolean
  blockReason: OfferBlockReason | null
  blockDetail: string | null
  /**
   * The `offers.email_status` this row should carry, or `null` to leave the
   * column alone.
   *
   * The import (WP3) writes `email_status = BLOCKED` at the same time as
   * `blocked = true`, so anything reading one column and not the other has to
   * see them agree. `null` is returned for a row that has already been SENT or
   * has FAILED: those are facts about what happened, and the compliance gate
   * does not get to rewrite history — it only decides what may happen next.
   */
  emailStatus: 'DRAFT' | 'BLOCKED' | null
  /** What changed, for the audit metadata. Never contains an email body. */
  change: 'BLOCKED' | 'UNBLOCKED'
}

export interface BlockPlan {
  updates: BlockUpdate[]
  /** Offers already in the right state. Counted, not written. */
  unchanged: number
}

/**
 * Work out which offers need their jurisdiction block set or cleared.
 *
 * Three rules, and the third is the one that stops this function from being
 * dangerous:
 *
 *   1. An uncleared jurisdiction with no recorded reference gets
 *      `blocked = true`, `blockReason = JURISDICTION_NOT_APPROVED`.
 *   2. A cleared jurisdiction — or an individually referenced one — has that
 *      block lifted, but only if JURISDICTION_NOT_APPROVED is the reason it
 *      carries.
 *   3. A block placed for any other reason is never touched. This function has
 *      no authority over a validation failure, an unresolved variable or a
 *      manual hold, and silently lifting one while "re-checking compliance"
 *      would be the worst kind of side effect.
 *
 * A missing or unusable jurisdiction is recorded as VALIDATION_FAILED rather
 * than JURISDICTION_NOT_APPROVED. The country is not disapproved; the required
 * field is absent, and the review table should say so.
 */
export function planBlockUpdates(
  rows: readonly OfferGateRow[],
  approval: ComplianceApprovalRecord | null,
): BlockPlan {
  const updates: BlockUpdate[] = []
  let unchanged = 0

  // `email_status` is only ever moved between DRAFT and BLOCKED. SENT and
  // FAILED record what actually happened to a message and are never rewritten.
  const pendingStatus = (row: OfferGateRow): boolean =>
    row.emailStatus === 'DRAFT' || row.emailStatus === 'BLOCKED'

  for (const row of rows) {
    const overridden = hasRecordedOverride(row.jurisdictionApprovalRef)
    const cleared = isJurisdictionApproved(row.jurisdiction, approval)
    const missing = (row.jurisdiction ?? '').trim() === ''

    const isComplianceBlock =
      row.blockReason === 'JURISDICTION_NOT_APPROVED' ||
      (row.blockReason === 'VALIDATION_FAILED' && missing)

    if (cleared || overridden) {
      // Rule 3: leave anything held for another reason exactly as it is.
      if (row.blocked && row.blockReason === 'JURISDICTION_NOT_APPROVED') {
        updates.push({
          offerId: row.id,
          blocked: false,
          blockReason: null,
          blockDetail: null,
          // Lifting the block returns the message to DRAFT so it is a candidate
          // for sending again. Leaving it at BLOCKED would clear the flag the
          // gate reads while leaving the one a send list reads, and the
          // recipient would be cleared on screen and unsendable in practice.
          emailStatus: row.emailStatus === 'BLOCKED' ? 'DRAFT' : null,
          change: 'UNBLOCKED',
        })
        continue
      }
      unchanged += 1
      continue
    }

    const nextReason: OfferBlockReason = missing
      ? 'VALIDATION_FAILED'
      : 'JURISDICTION_NOT_APPROVED'

    const nextDetail = missing
      ? 'No jurisdiction is recorded for this recipient, so the compliance gate has nothing ' +
        'to check. The required field must be filled in before this recipient can be sent to.'
      : shortBlockReason(row.jurisdiction ?? '', approval?.approvedJurisdictions ?? [])

    const nextStatus = pendingStatus(row) ? 'BLOCKED' : null

    if (
      row.blocked &&
      row.blockReason === nextReason &&
      row.blockDetail === nextDetail &&
      (nextStatus === null || row.emailStatus === nextStatus)
    ) {
      unchanged += 1
      continue
    }

    // Something else already holds this row — do not overwrite its reason.
    if (row.blocked && row.blockReason !== null && !isComplianceBlock) {
      unchanged += 1
      continue
    }

    updates.push({
      offerId: row.id,
      blocked: true,
      blockReason: nextReason,
      blockDetail: nextDetail,
      emailStatus: nextStatus,
      change: 'BLOCKED',
    })
  }

  return { updates, unchanged }
}
