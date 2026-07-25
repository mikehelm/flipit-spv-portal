/**
 * The per-recipient compliance gate. BUILD_SPEC §8.2, §8.3.
 *
 * §8.2 item 3: "Any recipient whose jurisdiction is not in the approved list
 * is blocked from sending and flagged in the review table with the reason.
 * **This must be per-recipient, not per-batch.**"
 *
 * That emphasis is the shape of this file. `evaluateOfferCompliance` takes one
 * offer and returns one decision. `gateBatch` is a `map` over it and nothing
 * more — there is deliberately no code path in which one recipient's refusal
 * can reach another recipient's decision, because the only way to guarantee
 * that is to make it structurally impossible rather than carefully avoided.
 *
 * Everything here is pure. The database-touching wrapper is at the bottom and
 * does nothing but load the approval and the drift state before calling in.
 */

import type { blockReasonEnum } from '@/db/schema'
import type { EmailTemplateKind } from '@/lib/email/templates'
import { checkTemplateDrift, type DriftEvaluation } from './drift'
import { explainJurisdictionBlock, shortBlockReason, type BlockExplanation } from './explain'
import type { ComplianceApprovalRecord } from './approvals'
import { hasRecordedOverride, isJurisdictionApproved } from './jurisdictions'

export type OfferBlockReason = (typeof blockReasonEnum.enumValues)[number]

/** The fields of an offer this gate reads. Nothing else, and no money. */
export interface GateableOffer {
  id: string
  /** ISO 3166-1 alpha-2, from the recipient row. Null when none was recorded. */
  jurisdiction: string | null
  blocked: boolean
  blockReason: OfferBlockReason | null
  blockDetail?: string | null
  /** §8.3 — the only thing that clears an uncleared jurisdiction, one person at a time. */
  jurisdictionApprovalRef: string | null
  recipientName?: string | null
}

export type ComplianceRefusalReason =
  /** No approval has ever been recorded for this template. */
  | 'NO_APPROVAL'
  /** An approval was supplied but it has been voided. */
  | 'APPROVAL_VOIDED'
  /** The live template no longer matches the approved hash. */
  | 'TEMPLATE_DRIFT'
  /** The recipient has no usable ISO country code. */
  | 'JURISDICTION_MISSING'
  /** A real country code, simply not on the approved list. */
  | 'JURISDICTION_NOT_APPROVED'
  /** Blocked for a reason that is not the compliance gate's — held anyway. */
  | 'OFFER_HELD'

export type ComplianceDecision =
  | {
      allowed: true
      offerId: string
      approvalId: string
      /** Why this one is sendable — the list, or a reference recorded for them alone. */
      clearedBy: 'APPROVED_JURISDICTION' | 'INDIVIDUAL_REFERENCE'
      jurisdiction: string | null
    }
  | {
      allowed: false
      offerId: string
      reason: ComplianceRefusalReason
      /** Specific and actionable. Never "sending is unavailable". */
      message: string
      /** The value to write to `offers.block_reason`, or null to leave it alone. */
      blockReason: OfferBlockReason | null
      /** The full §8.3 wording, when the refusal is about where the person is. */
      explanation: BlockExplanation | null
    }

export interface OfferComplianceInput {
  offer: GateableOffer
  approval: ComplianceApprovalRecord | null
  /** From `evaluateDrift` / `checkTemplateDrift`. Required — see below. */
  drift: Pick<DriftEvaluation, 'state' | 'message'>
}

/**
 * One offer, one decision.
 *
 * The order of the checks is the order in which the problems have to be
 * solved, and the first one that applies is the one reported. There is no
 * combined "several things are wrong" state here, because the operator can
 * only act on one of them at a time and a refusal that lists four causes reads
 * as a generic failure.
 *
 * `drift` is not optional. An absent drift check would have to be treated as
 * either "fine" or "not fine"; "fine" is a way for the gate to be skipped by
 * forgetting an argument, so the type simply does not allow it.
 */
export function evaluateOfferCompliance(input: OfferComplianceInput): ComplianceDecision {
  const { offer, approval, drift } = input
  const offerId = offer.id

  // 1. No approval at all. §8.2 item 1 — "No approval, no send."
  if (!approval || drift.state === 'NO_APPROVAL') {
    return {
      allowed: false,
      offerId,
      reason: 'NO_APPROVAL',
      message:
        'No compliance approval has been recorded, so no invitation can be sent to anyone. ' +
        'This email is an offer of securities. The application will not send one until a ' +
        'qualified person has signed it off and the owner has recorded that sign-off, ' +
        'including which countries it covers. Test sends to the operator’s own address ' +
        'remain available so the template can be prepared meanwhile.',
      blockReason: null,
      explanation: null,
    }
  }

  // 2. An approval that has been withdrawn is not an approval.
  if (approval.voidedAt !== null) {
    return {
      allowed: false,
      offerId,
      reason: 'APPROVAL_VOIDED',
      message:
        'The compliance approval covering this template has been voided' +
        (approval.voidedReason ? `: ${approval.voidedReason}. ` : '. ') +
        'Sending is disabled until a new one is recorded. Nothing about this recipient is ' +
        'the problem — the approval itself is no longer in force.',
      blockReason: null,
      explanation: null,
    }
  }

  // 3. Drift. §8.2 item 2 — a changed word is a different offer document.
  if (drift.state === 'DRIFTED') {
    return {
      allowed: false,
      offerId,
      reason: 'TEMPLATE_DRIFT',
      message: drift.message,
      blockReason: null,
      explanation: null,
    }
  }

  // 4. Jurisdiction. This is the check that must isolate one recipient.
  const cleared = isJurisdictionApproved(offer.jurisdiction, approval)
  const overridden = hasRecordedOverride(offer.jurisdictionApprovalRef)

  if (!cleared && !overridden) {
    const missing = (offer.jurisdiction ?? '').trim() === ''
    const explanation = explainJurisdictionBlock({
      code: offer.jurisdiction ?? '',
      recipientName: offer.recipientName ?? null,
      approvedJurisdictions: approval.approvedJurisdictions,
    })

    return {
      allowed: false,
      offerId,
      reason: missing ? 'JURISDICTION_MISSING' : 'JURISDICTION_NOT_APPROVED',
      message: missing
        ? 'No jurisdiction is recorded for this recipient, so there is nothing to check ' +
          'against the approval. The application will not treat a missing country as an ' +
          'approved one. Every other recipient is unaffected.'
        : shortBlockReason(offer.jurisdiction ?? '', approval.approvedJurisdictions),
      // A missing required field is a validation failure, not a jurisdiction
      // refusal — writing JURISDICTION_NOT_APPROVED for it would misstate what
      // happened on the audit trail and in the review table.
      blockReason: missing ? 'VALIDATION_FAILED' : 'JURISDICTION_NOT_APPROVED',
      explanation,
    }
  }

  // 5. Held for a reason that belongs to someone else — validation, an
  //    unresolved variable, a manual hold. The compliance gate does not clear
  //    those and must not appear to.
  if (
    offer.blocked &&
    offer.blockReason !== null &&
    offer.blockReason !== 'JURISDICTION_NOT_APPROVED'
  ) {
    return {
      allowed: false,
      offerId,
      reason: 'OFFER_HELD',
      message:
        `This recipient is held for a reason outside the compliance gate (${offer.blockReason})` +
        (offer.blockDetail ? `: ${offer.blockDetail}` : '.') +
        ' The compliance approval covers them; something else does not. Clear that first.',
      blockReason: offer.blockReason,
      explanation: null,
    }
  }

  return {
    allowed: true,
    offerId,
    approvalId: approval.id,
    clearedBy: cleared ? 'APPROVED_JURISDICTION' : 'INDIVIDUAL_REFERENCE',
    jurisdiction: offer.jurisdiction,
  }
}

// ---------------------------------------------------------------------------
// The batch — which is a map, and nothing more
// ---------------------------------------------------------------------------

export interface BatchGateResult {
  decisions: ComplianceDecision[]
  sendable: string[]
  blocked: Array<Extract<ComplianceDecision, { allowed: false }>>
}

/**
 * Gate a list. One refusal never touches another decision.
 *
 * This exists so callers do not hand-roll the loop and accidentally write
 * `if (anyBlocked) return` — which is the per-batch behaviour §8.2 forbids,
 * and which is a very easy line to write by accident.
 */
export function gateBatch(
  offers: readonly GateableOffer[],
  approval: ComplianceApprovalRecord | null,
  drift: Pick<DriftEvaluation, 'state' | 'message'>,
): BatchGateResult {
  const decisions = offers.map((offer) =>
    evaluateOfferCompliance({ offer, approval, drift }),
  )

  return {
    decisions,
    sendable: decisions.filter((d) => d.allowed).map((d) => d.offerId),
    blocked: decisions.filter(
      (d): d is Extract<ComplianceDecision, { allowed: false }> => !d.allowed,
    ),
  }
}

// ---------------------------------------------------------------------------
// The database-backed forms
// ---------------------------------------------------------------------------

export class ComplianceBlockedError extends Error {
  readonly reason: ComplianceRefusalReason
  readonly offerId: string
  readonly explanation: BlockExplanation | null
  readonly blockReason: OfferBlockReason | null

  constructor(decision: Extract<ComplianceDecision, { allowed: false }>) {
    super(decision.message)
    this.name = 'ComplianceBlockedError'
    this.reason = decision.reason
    this.offerId = decision.offerId
    this.explanation = decision.explanation
    this.blockReason = decision.blockReason
  }
}

/** Load the approval and drift state for a kind, once, for a whole batch. */
export async function loadGateContext(kind: EmailTemplateKind = 'INVITATION'): Promise<{
  approval: ComplianceApprovalRecord | null
  drift: DriftEvaluation
}> {
  const drift = await checkTemplateDrift(kind)
  return { approval: drift.approval, drift }
}

/** The decision for one offer, without throwing. For rendering state. */
export async function checkOfferCompliance(
  offer: GateableOffer,
  kind: EmailTemplateKind = 'INVITATION',
): Promise<ComplianceDecision> {
  const { approval, drift } = await loadGateContext(kind)
  return evaluateOfferCompliance({ offer, approval, drift })
}

/**
 * Refuse, with a specific reason, or return the clearance.
 *
 * Throws rather than returning a falsy value on purpose: a caller that ignores
 * a returned decision sends the email anyway, and this is the one gate in the
 * application where failing open is unacceptable. The thrown error carries the
 * specific `reason` and, for a jurisdiction block, the full §8.3 explanation —
 * so the refusal that reaches the operator is never generic.
 *
 * Use `checkOfferCompliance` when you want to display the state rather than
 * act on it.
 */
export async function assertCompliant(
  offer: GateableOffer,
  kind: EmailTemplateKind = 'INVITATION',
): Promise<Extract<ComplianceDecision, { allowed: true }>> {
  const decision = await checkOfferCompliance(offer, kind)
  if (!decision.allowed) throw new ComplianceBlockedError(decision)
  return decision
}
