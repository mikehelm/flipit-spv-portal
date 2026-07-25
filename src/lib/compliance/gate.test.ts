import { describe, expect, it } from 'vitest'
import type { ComplianceApprovalRecord } from './approvals'
import { evaluateOfferCompliance, gateBatch, type GateableOffer } from './gate'

/**
 * The gate. BUILD_SPEC §8.2 items 1–3 and §8.3.
 *
 * These are the tests that must fail loudly if someone later weakens the rule.
 */

const APPROVED_HASH = 'a'.repeat(64)

function approval(overrides: Partial<ComplianceApprovalRecord> = {}): ComplianceApprovalRecord {
  return {
    id: 'approval-1',
    approverName: 'A. Lawyer',
    approverRole: 'Partner',
    approverFirm: 'Baker & Co',
    approvedAt: new Date('2026-07-20T00:00:00Z'),
    evidenceReference: 'Letter 2026-07-20',
    approvedJurisdictions: ['AU', 'FR', 'GB', 'TH'],
    approvedTemplateHash: APPROVED_HASH,
    templateKind: 'INVITATION',
    conditions: null,
    recordedById: 'user-owner',
    voidedAt: null,
    voidedReason: null,
    createdAt: new Date('2026-07-21T09:00:00Z'),
    ...overrides,
  }
}

function offer(overrides: Partial<GateableOffer> = {}): GateableOffer {
  return {
    id: 'offer-1',
    jurisdiction: 'GB',
    blocked: false,
    blockReason: null,
    blockDetail: null,
    jurisdictionApprovalRef: null,
    recipientName: 'Jane Example',
    ...overrides,
  }
}

const APPROVED_DRIFT = { state: 'APPROVED' as const, message: 'Matches.' }
const NO_APPROVAL_DRIFT = { state: 'NO_APPROVAL' as const, message: 'None recorded.' }
const DRIFTED = {
  state: 'DRIFTED' as const,
  message: 'The invitation template has changed since it was approved.',
}

// ---------------------------------------------------------------------------

describe('no approval means no send (§8.2 item 1)', () => {
  it('refuses a perfectly good recipient when no approval exists', () => {
    const decision = evaluateOfferCompliance({
      offer: offer(),
      approval: null,
      drift: NO_APPROVAL_DRIFT,
    })

    expect(decision.allowed).toBe(false)
    if (decision.allowed) return
    expect(decision.reason).toBe('NO_APPROVAL')
    expect(decision.message).toMatch(/No compliance approval has been recorded/)
    // A refusal that says nothing is a bug — see CODEX_TASKS "Errors".
    expect(decision.message).not.toMatch(/something went wrong/i)
  })

  it('refuses everyone, not just some', () => {
    const result = gateBatch(
      [offer({ id: 'a' }), offer({ id: 'b', jurisdiction: 'AU' })],
      null,
      NO_APPROVAL_DRIFT,
    )
    expect(result.sendable).toEqual([])
    expect(result.blocked).toHaveLength(2)
  })

  it('refuses when the approval has been voided, and says the approval is the problem', () => {
    const decision = evaluateOfferCompliance({
      offer: offer(),
      approval: approval({ voidedAt: new Date(), voidedReason: 'Superseded' }),
      drift: APPROVED_DRIFT,
    })

    expect(decision.allowed).toBe(false)
    if (decision.allowed) return
    expect(decision.reason).toBe('APPROVAL_VOIDED')
    expect(decision.message).toMatch(/Superseded/)
  })
})

describe('template drift disables sending (§8.2 item 2)', () => {
  it('refuses a cleared recipient when the template has drifted', () => {
    const decision = evaluateOfferCompliance({
      offer: offer({ jurisdiction: 'GB' }),
      approval: approval(),
      drift: DRIFTED,
    })

    expect(decision.allowed).toBe(false)
    if (decision.allowed) return
    expect(decision.reason).toBe('TEMPLATE_DRIFT')
  })

  it('an individual clearance does not survive template drift', () => {
    // §8.3 clears a PERSON against a jurisdiction. It says nothing about the
    // wording of the offer, and must not be usable to route around §8.2.
    const decision = evaluateOfferCompliance({
      offer: offer({
        jurisdiction: 'US',
        jurisdictionApprovalRef: 'Baker & Co letter 2026-07-22',
      }),
      approval: approval(),
      drift: DRIFTED,
    })

    expect(decision.allowed).toBe(false)
    if (decision.allowed) return
    expect(decision.reason).toBe('TEMPLATE_DRIFT')
  })
})

describe('the jurisdiction gate blocks one recipient, never the batch (§8.2 item 3)', () => {
  it('blocks the US recipient alone while everyone else stays sendable', () => {
    const result = gateBatch(
      [
        offer({ id: 'gb', jurisdiction: 'GB', recipientName: 'Jane' }),
        offer({ id: 'au', jurisdiction: 'AU', recipientName: 'Bruce' }),
        offer({ id: 'us', jurisdiction: 'US', recipientName: 'Hank' }),
        offer({ id: 'fr', jurisdiction: 'FR', recipientName: 'Claire' }),
        offer({ id: 'th', jurisdiction: 'TH', recipientName: 'Somchai' }),
      ],
      approval(),
      APPROVED_DRIFT,
    )

    expect(result.sendable).toEqual(['gb', 'au', 'fr', 'th'])
    expect(result.blocked).toHaveLength(1)
    expect(result.blocked[0].offerId).toBe('us')
    expect(result.blocked[0].reason).toBe('JURISDICTION_NOT_APPROVED')
    expect(result.blocked[0].blockReason).toBe('JURISDICTION_NOT_APPROVED')
  })

  it('the block carries the §8.3 explanation, naming what unblocking requires', () => {
    const decision = evaluateOfferCompliance({
      offer: offer({ jurisdiction: 'US', recipientName: 'Hank' }),
      approval: approval(),
      drift: APPROVED_DRIFT,
    })

    expect(decision.allowed).toBe(false)
    if (decision.allowed) return
    expect(decision.explanation).not.toBeNull()
    expect(decision.explanation!.unblockingRequires.join(' ')).toMatch(/record/i)
    expect(decision.explanation!.notLegalAdvice).toMatch(/does not give legal advice/)
  })

  it('a missing jurisdiction is a validation failure, not a jurisdiction refusal', () => {
    const decision = evaluateOfferCompliance({
      offer: offer({ jurisdiction: null }),
      approval: approval(),
      drift: APPROVED_DRIFT,
    })

    expect(decision.allowed).toBe(false)
    if (decision.allowed) return
    expect(decision.reason).toBe('JURISDICTION_MISSING')
    expect(decision.blockReason).toBe('VALIDATION_FAILED')
  })

  it('an unassigned code is refused rather than treated as approved', () => {
    const decision = evaluateOfferCompliance({
      offer: offer({ jurisdiction: 'XX' }),
      approval: approval({ approvedJurisdictions: ['XX'] }),
      drift: APPROVED_DRIFT,
    })
    expect(decision.allowed).toBe(false)
  })

  it('an empty approved list clears nobody', () => {
    const result = gateBatch(
      [offer({ id: 'gb', jurisdiction: 'GB' })],
      approval({ approvedJurisdictions: [] }),
      APPROVED_DRIFT,
    )
    expect(result.sendable).toEqual([])
  })
})

describe('individual override (§8.3)', () => {
  it('unblocks one recipient when a reference is recorded', () => {
    const decision = evaluateOfferCompliance({
      offer: offer({
        id: 'us',
        jurisdiction: 'US',
        blocked: true,
        blockReason: 'JURISDICTION_NOT_APPROVED',
        jurisdictionApprovalRef: 'Baker & Co advice 2026-07-22',
      }),
      approval: approval(),
      drift: APPROVED_DRIFT,
    })

    expect(decision.allowed).toBe(true)
    if (!decision.allowed) return
    expect(decision.clearedBy).toBe('INDIVIDUAL_REFERENCE')
  })

  it('does not unblock without a reference — there is no blanket unblock', () => {
    for (const reference of [null, '', '   ', 'ok']) {
      const decision = evaluateOfferCompliance({
        offer: offer({
          jurisdiction: 'US',
          blocked: true,
          blockReason: 'JURISDICTION_NOT_APPROVED',
          jurisdictionApprovalRef: reference,
        }),
        approval: approval(),
        drift: APPROVED_DRIFT,
      })
      expect(decision.allowed).toBe(false)
    }
  })

  it('clearing one US recipient does not clear another US recipient', () => {
    const result = gateBatch(
      [
        offer({
          id: 'cleared',
          jurisdiction: 'US',
          jurisdictionApprovalRef: 'Baker & Co advice 2026-07-22',
        }),
        offer({ id: 'not-cleared', jurisdiction: 'US' }),
      ],
      approval(),
      APPROVED_DRIFT,
    )

    expect(result.sendable).toEqual(['cleared'])
    expect(result.blocked.map((block) => block.offerId)).toEqual(['not-cleared'])
  })

  it('a reference does not clear a hold placed for another reason', () => {
    const decision = evaluateOfferCompliance({
      offer: offer({
        jurisdiction: 'US',
        blocked: true,
        blockReason: 'UNRESOLVED_TEMPLATE_VARIABLE',
        blockDetail: 'sender_phone did not resolve.',
        jurisdictionApprovalRef: 'Baker & Co advice 2026-07-22',
      }),
      approval: approval(),
      drift: APPROVED_DRIFT,
    })

    expect(decision.allowed).toBe(false)
    if (decision.allowed) return
    expect(decision.reason).toBe('OFFER_HELD')
    expect(decision.message).toMatch(/sender_phone/)
  })
})

describe('holds that are not the compliance gate’s', () => {
  it('a cleared recipient held by validation stays held, and the gate says why', () => {
    const decision = evaluateOfferCompliance({
      offer: offer({
        jurisdiction: 'GB',
        blocked: true,
        blockReason: 'MANUALLY_HELD',
        blockDetail: 'David asked to hold this one.',
      }),
      approval: approval(),
      drift: APPROVED_DRIFT,
    })

    expect(decision.allowed).toBe(false)
    if (decision.allowed) return
    expect(decision.reason).toBe('OFFER_HELD')
    expect(decision.blockReason).toBe('MANUALLY_HELD')
  })

  it('a stale JURISDICTION_NOT_APPROVED flag does not survive a widened approval', () => {
    // The approval now covers US; the row still carries yesterday's flag. The
    // gate answers from the approval, not from the flag.
    const decision = evaluateOfferCompliance({
      offer: offer({
        jurisdiction: 'US',
        blocked: true,
        blockReason: 'JURISDICTION_NOT_APPROVED',
      }),
      approval: approval({ approvedJurisdictions: ['GB', 'US'] }),
      drift: APPROVED_DRIFT,
    })
    expect(decision.allowed).toBe(true)
  })
})
