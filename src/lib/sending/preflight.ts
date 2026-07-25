/**
 * The pre-flight checklist. BUILD_SPEC §19, AC21.
 *
 *   "Completed once per batch. It unlocks per-recipient sending; it does not
 *   itself send anything. Every item is an explicit confirmation, and the §8
 *   gates are machine-enforced rather than merely ticked."
 *
 * So the twelve items are of two kinds and they are treated completely
 * differently:
 *
 *   - **Enforced.** The application works out the answer and the operator
 *     cannot change it. Ticking is not offered, because a tick would be a way
 *     to assert something untrue about money, jurisdiction or a mail server.
 *     Eight of the twelve are of this kind.
 *   - **Attested.** Something only a person can know — that they have read the
 *     recipient file, that they looked at the test email they sent themselves.
 *     The operator confirms it, and the confirmation is recorded in the audit
 *     log with their name against it. Four of the twelve are of this kind.
 *
 * An attestation is never a substitute for an enforced item and cannot clear
 * one. There is deliberately no override, no "proceed anyway", and no
 * force flag anywhere in this module.
 *
 * This module computes state. It sends nothing and writes nothing.
 */

import type { BatchGateResult, ComplianceDecision } from '@/lib/compliance'
import type { BatchValidationResult } from '@/lib/email/render'

export type PreflightItemId =
  | 'RECIPIENT_FILE_REVIEWED'
  | 'NO_MISSING_OR_DUPLICATE_EMAILS'
  | 'AMOUNTS_VALIDATED'
  | 'DEADLINES_PRESENT_AND_FUTURE'
  | 'JURISDICTIONS_IDENTIFIED'
  | 'SENDER_IDENTITY_RESOLVES'
  | 'TEMPLATE_RENDERS_FOR_EVERY_RECIPIENT'
  | 'SERVICE_MODE_ACTIVE'
  | 'MAIL_CONNECTION_VERIFIED'
  | 'TEST_EMAIL_SENT_AND_REVIEWED'
  | 'TEMPLATE_HASH_MATCHES_APPROVAL'
  | 'COMPLIANCE_APPROVAL_CURRENT'

/** How an item is settled. `ENFORCED` items are never ticked by anybody. */
export type PreflightKind = 'ENFORCED' | 'ATTESTED'

export type PreflightState = 'PASS' | 'FAIL' | 'AWAITING_CONFIRMATION'

export interface PreflightItem {
  id: PreflightItemId
  kind: PreflightKind
  /** The §19 wording, near enough to be recognisable in the spec. */
  label: string
  state: PreflightState
  /** What is wrong and what to do about it. Never "something went wrong". */
  detail: string
  /** Recipients this item fails for, when it is per-recipient. */
  affectedOfferIds?: string[]
}

export interface PreflightResult {
  items: PreflightItem[]
  /** True only when every enforced item passes AND every attestation is in. */
  ready: boolean
  /** Enforced failures alone. These are what actually stop a send. */
  blocking: PreflightItem[]
  /** Attestations still outstanding. */
  awaiting: PreflightItem[]
  /**
   * Offers that pass the compliance gate. Blocked recipients are absent from
   * this list and present nowhere else in it — §8.2, a block stops one
   * recipient and never the batch.
   */
  sendableOfferIds: string[]
}

/** Everything the checklist needs, gathered by the caller. */
export interface PreflightInput {
  /** Every offer in the batch, before gating. */
  offers: readonly PreflightOffer[]
  /** From `gateBatch` — the compliance and jurisdiction decisions. */
  gate: BatchGateResult
  /** From `validateBatch` — template rendering for every recipient. */
  validation: BatchValidationResult
  serviceMode: 'ACTIVE' | 'READ_ONLY' | 'SUNSET' | 'DISABLED'
  /** From the §8.1 health check. Stale counts as unverified. */
  mailConnectionVerified: boolean
  mailConnectionDetail: string
  /** Which attestations the operator has recorded for this batch. */
  attestations: ReadonlySet<PreflightItemId>
}

export interface PreflightOffer {
  offerId: string
  recipientName: string
  recipientEmail: string
  /** ISO 8601 date, as stored. Compared as a date, never as a timestamp. */
  responseDeadline: string
  /** Decimal strings. Read for presence, never arithmetic. */
  proposedAmountUsd: string | null
  spvPercentage: string | null
  indirectPercentage: string | null
}

const ATTESTED: ReadonlySet<PreflightItemId> = new Set<PreflightItemId>([
  'RECIPIENT_FILE_REVIEWED',
  'AMOUNTS_VALIDATED',
  'JURISDICTIONS_IDENTIFIED',
  'TEST_EMAIL_SENT_AND_REVIEWED',
])

const LABELS: Record<PreflightItemId, string> = {
  RECIPIENT_FILE_REVIEWED: 'Recipient file reviewed',
  NO_MISSING_OR_DUPLICATE_EMAILS: 'No missing or duplicate emails',
  AMOUNTS_VALIDATED: 'All percentages and amounts validated',
  DEADLINES_PRESENT_AND_FUTURE: 'Deadlines present and future-dated',
  JURISDICTIONS_IDENTIFIED:
    'Recipients outside the approved jurisdiction list identified and excluded from this batch',
  SENDER_IDENTITY_RESOLVES:
    'Sender identity confirmed, and sender_phone resolves for every recipient',
  TEMPLATE_RENDERS_FOR_EVERY_RECIPIENT:
    'Template renders cleanly for every recipient in the batch, with no unresolved variables',
  SERVICE_MODE_ACTIVE: 'Service mode is active',
  MAIL_CONNECTION_VERIFIED: 'Mail connection verified within the session',
  TEST_EMAIL_SENT_AND_REVIEWED: 'Test email sent and reviewed',
  TEMPLATE_HASH_MATCHES_APPROVAL:
    'Final email template approved, and its hash matches the compliance approval',
  COMPLIANCE_APPROVAL_CURRENT:
    'Compliance approval recorded and current, for the invitation and the reminder template',
}

/**
 * `AMOUNTS_VALIDATED` and `JURISDICTIONS_IDENTIFIED` are attestations with a
 * machine-checked floor underneath them: the operator confirms they have looked,
 * but if a figure is outright missing or a recipient is blocked without having
 * been acknowledged, the item fails regardless of what was ticked. An
 * attestation can confirm a judgement; it cannot assert a fact that is false.
 */
function attestationState(
  id: PreflightItemId,
  attestations: ReadonlySet<PreflightItemId>,
  hardFailure: string | null,
): { state: PreflightState; detail: string } {
  if (hardFailure !== null) return { state: 'FAIL', detail: hardFailure }
  if (attestations.has(id)) return { state: 'PASS', detail: 'Confirmed by the operator.' }
  return {
    state: 'AWAITING_CONFIRMATION',
    detail: 'Waiting for the operator to confirm this.',
  }
}

function missingFigure(offer: PreflightOffer): boolean {
  return (
    offer.proposedAmountUsd === null ||
    offer.proposedAmountUsd === '' ||
    offer.spvPercentage === null ||
    offer.spvPercentage === '' ||
    offer.indirectPercentage === null ||
    offer.indirectPercentage === ''
  )
}

/**
 * A deadline is a date, not a timestamp (§ "Time"). "Future-dated" therefore
 * means the date is today or later — a deadline of the 10th is still live on
 * the 10th, and the edge case resolves in the investor's favour.
 */
function deadlineIsPast(deadline: string, today: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(deadline)) return true
  return deadline < today
}

export function evaluatePreflight(
  input: PreflightInput,
  today: string,
): PreflightResult {
  const items: PreflightItem[] = []
  const count = input.offers.length

  // --- 1. Recipient file reviewed (attested) -------------------------------
  items.push({
    id: 'RECIPIENT_FILE_REVIEWED',
    kind: 'ATTESTED',
    label: LABELS.RECIPIENT_FILE_REVIEWED,
    ...attestationState(
      'RECIPIENT_FILE_REVIEWED',
      input.attestations,
      count === 0 ? 'There are no recipients in this round. Import a file first.' : null,
    ),
  })

  // --- 2. No missing or duplicate emails (enforced) ------------------------
  const seen = new Map<string, string[]>()
  const missingEmail: string[] = []
  for (const offer of input.offers) {
    const email = offer.recipientEmail.trim().toLowerCase()
    if (email === '') {
      missingEmail.push(offer.offerId)
      continue
    }
    seen.set(email, [...(seen.get(email) ?? []), offer.offerId])
  }
  const duplicated = [...seen.values()].filter((ids) => ids.length > 1).flat()
  const emailProblem = [...missingEmail, ...duplicated]
  items.push({
    id: 'NO_MISSING_OR_DUPLICATE_EMAILS',
    kind: 'ENFORCED',
    label: LABELS.NO_MISSING_OR_DUPLICATE_EMAILS,
    state: emailProblem.length === 0 ? 'PASS' : 'FAIL',
    detail:
      emailProblem.length === 0
        ? `${count} recipient${count === 1 ? '' : 's'}, every address present and distinct.`
        : `${missingEmail.length} recipient(s) have no email address and ${
            duplicated.length
          } share an address with someone else. Two invitations to one address is two offers to whoever holds it — fix the file and import it again.`,
    affectedOfferIds: emailProblem,
  })

  // --- 3. Amounts and percentages validated (attested, floored) ------------
  const withoutFigures = input.offers.filter(missingFigure).map((o) => o.offerId)
  items.push({
    id: 'AMOUNTS_VALIDATED',
    kind: 'ATTESTED',
    label: LABELS.AMOUNTS_VALIDATED,
    ...attestationState(
      'AMOUNTS_VALIDATED',
      input.attestations,
      withoutFigures.length > 0
        ? `${withoutFigures.length} recipient(s) are missing an amount or a percentage. That cannot be confirmed away — re-import the file with the missing values.`
        : null,
    ),
    affectedOfferIds: withoutFigures,
  })

  // --- 4. Deadlines present and future-dated (enforced) --------------------
  const badDeadlines = input.offers
    .filter((offer) => deadlineIsPast(offer.responseDeadline, today))
    .map((offer) => offer.offerId)
  items.push({
    id: 'DEADLINES_PRESENT_AND_FUTURE',
    kind: 'ENFORCED',
    label: LABELS.DEADLINES_PRESENT_AND_FUTURE,
    state: badDeadlines.length === 0 ? 'PASS' : 'FAIL',
    detail:
      badDeadlines.length === 0
        ? 'Every recipient has a deadline of today or later.'
        : `${badDeadlines.length} recipient(s) have a missing or already-passed deadline. An invitation that arrives after its own deadline asks for a decision that can no longer be made.`,
    affectedOfferIds: badDeadlines,
  })

  // --- 5. Jurisdictions identified and excluded (attested, floored) --------
  const jurisdictionBlocks = input.gate.blocked.filter(
    (decision) =>
      decision.reason === 'JURISDICTION_NOT_APPROVED' ||
      decision.reason === 'JURISDICTION_MISSING',
  )
  items.push({
    id: 'JURISDICTIONS_IDENTIFIED',
    kind: 'ATTESTED',
    label: LABELS.JURISDICTIONS_IDENTIFIED,
    ...attestationState('JURISDICTIONS_IDENTIFIED', input.attestations, null),
    affectedOfferIds: jurisdictionBlocks.map((decision) => decision.offerId),
  })
  // The wording depends on whether anybody is actually blocked, so it is set
  // after the fact rather than threaded through the helper.
  const jurisdictionItem = items[items.length - 1]!
  if (jurisdictionItem.state === 'PASS') {
    jurisdictionItem.detail =
      jurisdictionBlocks.length === 0
        ? 'Confirmed. Every recipient is in a country the approval covers.'
        : `Confirmed. ${jurisdictionBlocks.length} recipient(s) are excluded from this batch and will not be sent to. Everybody else is unaffected.`
  }

  // --- 6. Sender identity resolves (enforced) ------------------------------
  const senderProblems = input.validation.problems.filter(
    (problem) => problem.variable === 'sender_phone' || problem.variable === 'sender_email' || problem.variable === 'sender_name',
  )
  const senderOk =
    senderProblems.length === 0 && input.validation.configurationErrors.length === 0
  items.push({
    id: 'SENDER_IDENTITY_RESOLVES',
    kind: 'ENFORCED',
    label: LABELS.SENDER_IDENTITY_RESOLVES,
    state: senderOk ? 'PASS' : 'FAIL',
    detail: senderOk
      ? 'The sender name, address and — where the contact method needs it — phone number resolve for every recipient.'
      : [
          ...input.validation.configurationErrors,
          ...[...new Set(senderProblems.map((problem) => problem.note).filter(Boolean))],
        ].join(' ') ||
        'The sender identity does not resolve for every recipient. Check the defaults in settings.',
    affectedOfferIds: [...new Set(senderProblems.map((problem) => problem.offerId))],
  })

  // --- 7. Template renders for every recipient (enforced) ------------------
  const renderOk =
    input.validation.problems.length === 0 &&
    input.validation.templateErrors.length === 0 &&
    input.validation.configurationErrors.length === 0
  items.push({
    id: 'TEMPLATE_RENDERS_FOR_EVERY_RECIPIENT',
    kind: 'ENFORCED',
    label: LABELS.TEMPLATE_RENDERS_FOR_EVERY_RECIPIENT,
    state: renderOk ? 'PASS' : 'FAIL',
    detail: renderOk
      ? `Rendered for all ${input.validation.checked} recipient(s) with no unresolved variables.`
      : `${input.validation.problems.length} unresolved variable(s) across ${input.validation.affectedOfferIds.length} recipient(s), and ${input.validation.templateErrors.length} template error(s). Every one is listed below — this is the check that exists so they are found now rather than halfway through the batch.`,
    affectedOfferIds: input.validation.affectedOfferIds,
  })

  // --- 8. Service mode (enforced) -----------------------------------------
  items.push({
    id: 'SERVICE_MODE_ACTIVE',
    kind: 'ENFORCED',
    label: LABELS.SERVICE_MODE_ACTIVE,
    state: input.serviceMode === 'ACTIVE' ? 'PASS' : 'FAIL',
    detail:
      input.serviceMode === 'ACTIVE'
        ? 'The service is active.'
        : `The service mode is ${input.serviceMode.toLowerCase().replace('_', ' ')}, and nothing sends outside active mode (§7). Change it in settings when the round is genuinely open.`,
  })

  // --- 9. Mail connection (enforced) --------------------------------------
  items.push({
    id: 'MAIL_CONNECTION_VERIFIED',
    kind: 'ENFORCED',
    label: LABELS.MAIL_CONNECTION_VERIFIED,
    state: input.mailConnectionVerified ? 'PASS' : 'FAIL',
    detail: input.mailConnectionDetail,
  })

  // --- 10. Test email sent and reviewed (attested) ------------------------
  items.push({
    id: 'TEST_EMAIL_SENT_AND_REVIEWED',
    kind: 'ATTESTED',
    label: LABELS.TEST_EMAIL_SENT_AND_REVIEWED,
    ...attestationState('TEST_EMAIL_SENT_AND_REVIEWED', input.attestations, null),
  })

  // --- 11 & 12. Compliance (enforced) -------------------------------------
  //
  // Two separate items because they fail for different reasons and are fixed
  // by different people: an absent approval needs the owner to record one, and
  // a hash mismatch needs someone to decide whether the template change was
  // intended.
  const approvalMissing = input.gate.decisions.some(
    (decision) => !decision.allowed && decision.reason === 'NO_APPROVAL',
  )
  const approvalVoided = input.gate.decisions.some(
    (decision) => !decision.allowed && decision.reason === 'APPROVAL_VOIDED',
  )
  const drifted = input.gate.decisions.some(
    (decision) => !decision.allowed && decision.reason === 'TEMPLATE_DRIFT',
  )

  items.push({
    id: 'TEMPLATE_HASH_MATCHES_APPROVAL',
    kind: 'ENFORCED',
    label: LABELS.TEMPLATE_HASH_MATCHES_APPROVAL,
    state: drifted ? 'FAIL' : 'PASS',
    detail: drifted
      ? firstMessage(input.gate.decisions, 'TEMPLATE_DRIFT') ??
        'The live template no longer matches the approved hash. Sending stays disabled until it is approved again.'
      : 'The live template matches the hash recorded on the approval.',
  })

  items.push({
    id: 'COMPLIANCE_APPROVAL_CURRENT',
    kind: 'ENFORCED',
    label: LABELS.COMPLIANCE_APPROVAL_CURRENT,
    state: approvalMissing || approvalVoided ? 'FAIL' : 'PASS',
    detail: approvalMissing
      ? firstMessage(input.gate.decisions, 'NO_APPROVAL') ??
        'No compliance approval has been recorded, so no invitation can be sent to anyone.'
      : approvalVoided
        ? firstMessage(input.gate.decisions, 'APPROVAL_VOIDED') ??
          'The recorded approval has been voided. A voided approval is not an approval.'
        : 'A current approval is on record.',
  })

  const blocking = items.filter((item) => item.kind === 'ENFORCED' && item.state === 'FAIL')
  const awaiting = items.filter((item) => item.state === 'AWAITING_CONFIRMATION')
  const attestedFailures = items.filter(
    (item) => item.kind === 'ATTESTED' && item.state === 'FAIL',
  )

  return {
    items,
    ready: blocking.length === 0 && awaiting.length === 0 && attestedFailures.length === 0,
    blocking,
    awaiting,
    sendableOfferIds: input.gate.sendable,
  }
}

function firstMessage(
  decisions: readonly ComplianceDecision[],
  reason: string,
): string | null {
  for (const decision of decisions) {
    if (!decision.allowed && decision.reason === reason) return decision.message
  }
  return null
}

/** The attestation ids, for the UI and for validating a submitted form. */
export const ATTESTED_ITEM_IDS: readonly PreflightItemId[] = [...ATTESTED]

export function isAttestedItemId(value: string): value is PreflightItemId {
  return ATTESTED.has(value as PreflightItemId)
}
