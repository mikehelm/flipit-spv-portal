import { describe, expect, it } from 'vitest'
import type { BatchGateResult, ComplianceDecision } from '@/lib/compliance'
import type { BatchValidationResult } from '@/lib/email/render'
import {
  ATTESTED_ITEM_IDS,
  evaluatePreflight,
  isAttestedItemId,
  type PreflightInput,
  type PreflightItemId,
  type PreflightOffer,
} from './preflight'

/**
 * BUILD_SPEC §19, AC21.
 *
 * The tests that matter here are the ones asserting that an operator cannot
 * tick their way past an enforced item, and that a blocked recipient does not
 * stop the batch. If someone later adds a "proceed anyway" path, several of
 * these fail.
 */

const TODAY = '2026-07-25'

const offer = (overrides: Partial<PreflightOffer> = {}): PreflightOffer => ({
  offerId: 'offer_1',
  recipientName: 'Alex Fournier',
  recipientEmail: 'alex@example.com',
  responseDeadline: '2026-08-10',
  proposedAmountUsd: '5000.00',
  spvPercentage: '16.666667',
  indirectPercentage: '5.000000',
  ...overrides,
})

const allowed = (offerId: string): ComplianceDecision => ({
  allowed: true,
  offerId,
  approvalId: 'approval_1',
  clearedBy: 'APPROVED_JURISDICTION',
  jurisdiction: 'AU',
})

const refused = (
  offerId: string,
  reason: Extract<ComplianceDecision, { allowed: false }>['reason'],
): ComplianceDecision => ({
  allowed: false,
  offerId,
  reason,
  message: `refused because ${reason}`,
  blockReason: null,
  explanation: null,
})

function gateOf(decisions: ComplianceDecision[]): BatchGateResult {
  return {
    decisions,
    sendable: decisions.filter((d) => d.allowed).map((d) => d.offerId),
    blocked: decisions.filter(
      (d): d is Extract<ComplianceDecision, { allowed: false }> => !d.allowed,
    ),
  }
}

const cleanValidation = (checked: number): BatchValidationResult => ({
  ok: true,
  checked,
  problems: [],
  affectedOfferIds: [],
  templateErrors: [],
  configurationErrors: [],
})

const everyAttestation = new Set<PreflightItemId>(ATTESTED_ITEM_IDS)

function input(overrides: Partial<PreflightInput> = {}): PreflightInput {
  const offers = overrides.offers ?? [offer()]
  return {
    offers,
    gate: gateOf(offers.map((o) => allowed(o.offerId))),
    validation: cleanValidation(offers.length),
    serviceMode: 'ACTIVE',
    mailConnectionVerified: true,
    mailConnectionDetail: 'Verified 2 minutes ago.',
    attestations: everyAttestation,
    ...overrides,
  }
}

const itemOf = (result: ReturnType<typeof evaluatePreflight>, id: PreflightItemId) =>
  result.items.find((item) => item.id === id)!

describe('the shape of the checklist', () => {
  it('has all twelve §19 items', () => {
    const result = evaluatePreflight(input(), TODAY)
    expect(result.items).toHaveLength(12)
  })

  it('marks exactly the four judgement items as attested and the rest as enforced', () => {
    const result = evaluatePreflight(input(), TODAY)
    const attested = result.items.filter((item) => item.kind === 'ATTESTED').map((i) => i.id)
    expect(attested.sort()).toEqual(
      [
        'AMOUNTS_VALIDATED',
        'JURISDICTIONS_IDENTIFIED',
        'RECIPIENT_FILE_REVIEWED',
        'TEST_EMAIL_SENT_AND_REVIEWED',
      ].sort(),
    )
    expect(result.items.filter((item) => item.kind === 'ENFORCED')).toHaveLength(8)
  })

  it('is ready when everything passes and every attestation is in', () => {
    const result = evaluatePreflight(input(), TODAY)
    expect(result.ready).toBe(true)
    expect(result.blocking).toEqual([])
    expect(result.awaiting).toEqual([])
  })

  it('is not ready while an attestation is outstanding', () => {
    const result = evaluatePreflight(
      input({ attestations: new Set(['RECIPIENT_FILE_REVIEWED']) }),
      TODAY,
    )
    expect(result.ready).toBe(false)
    expect(result.awaiting.length).toBe(3)
    // Nothing is *blocking* — the enforced items are all fine.
    expect(result.blocking).toEqual([])
  })
})

describe('an attestation cannot clear an enforced item', () => {
  const enforcedFailures: Array<[string, Partial<PreflightInput>, PreflightItemId]> = [
    [
      'service mode',
      { serviceMode: 'READ_ONLY' },
      'SERVICE_MODE_ACTIVE',
    ],
    [
      'mail connection',
      { mailConnectionVerified: false, mailConnectionDetail: 'Never verified.' },
      'MAIL_CONNECTION_VERIFIED',
    ],
    [
      'a past deadline',
      { offers: [offer({ responseDeadline: '2026-07-24' })] },
      'DEADLINES_PRESENT_AND_FUTURE',
    ],
    [
      'a duplicated address',
      {
        offers: [
          offer({ offerId: 'a' }),
          offer({ offerId: 'b', recipientName: 'Someone else' }),
        ],
      },
      'NO_MISSING_OR_DUPLICATE_EMAILS',
    ],
  ]

  for (const [name, overrides, itemId] of enforcedFailures) {
    it(`fails on ${name} with every box ticked`, () => {
      const built = input(overrides)
      const result = evaluatePreflight(
        { ...built, gate: gateOf(built.offers.map((o) => allowed(o.offerId))) },
        TODAY,
      )

      expect(itemOf(result, itemId).state).toBe('FAIL')
      expect(result.ready).toBe(false)
      expect(result.blocking.map((item) => item.id)).toContain(itemId)
    })
  }

  it('fails on a missing amount even though the item is an attestation', () => {
    const result = evaluatePreflight(
      input({ offers: [offer({ proposedAmountUsd: null })] }),
      TODAY,
    )
    const item = itemOf(result, 'AMOUNTS_VALIDATED')
    expect(item.kind).toBe('ATTESTED')
    expect(item.state).toBe('FAIL')
    expect(item.detail).toMatch(/cannot be confirmed away/i)
    expect(result.ready).toBe(false)
  })

  it('fails on a missing percentage the same way', () => {
    const result = evaluatePreflight(
      input({ offers: [offer({ indirectPercentage: null })] }),
      TODAY,
    )
    expect(itemOf(result, 'AMOUNTS_VALIDATED').state).toBe('FAIL')
  })
})

describe('deadlines are dates, and the edge resolves in the investor’s favour', () => {
  it('accepts a deadline of today', () => {
    const result = evaluatePreflight(
      input({ offers: [offer({ responseDeadline: TODAY })] }),
      TODAY,
    )
    expect(itemOf(result, 'DEADLINES_PRESENT_AND_FUTURE').state).toBe('PASS')
  })

  it('rejects yesterday', () => {
    const result = evaluatePreflight(
      input({ offers: [offer({ responseDeadline: '2026-07-24' })] }),
      TODAY,
    )
    expect(itemOf(result, 'DEADLINES_PRESENT_AND_FUTURE').state).toBe('FAIL')
  })

  it('rejects a deadline that is not a date at all', () => {
    const result = evaluatePreflight(
      input({ offers: [offer({ responseDeadline: 'next Tuesday' })] }),
      TODAY,
    )
    expect(itemOf(result, 'DEADLINES_PRESENT_AND_FUTURE').state).toBe('FAIL')
  })
})

describe('a jurisdiction block stops one recipient, never the batch — §8.2, AC22', () => {
  it('leaves everybody else sendable and the checklist ready', () => {
    const offers = [
      offer({ offerId: 'a', recipientEmail: 'a@example.com' }),
      offer({ offerId: 'b', recipientEmail: 'b@example.com' }),
      offer({ offerId: 'c', recipientEmail: 'c@example.com' }),
    ]
    const gate = gateOf([
      allowed('a'),
      refused('b', 'JURISDICTION_NOT_APPROVED'),
      allowed('c'),
    ])

    const result = evaluatePreflight(
      input({ offers, gate, validation: cleanValidation(3) }),
      TODAY,
    )

    expect(result.ready).toBe(true)
    expect(result.sendableOfferIds.sort()).toEqual(['a', 'c'])
    expect(result.sendableOfferIds).not.toContain('b')
    expect(itemOf(result, 'JURISDICTIONS_IDENTIFIED').affectedOfferIds).toEqual(['b'])
    expect(itemOf(result, 'JURISDICTIONS_IDENTIFIED').detail).toMatch(
      /excluded from this batch/i,
    )
  })

  it('does not report a jurisdiction block as a compliance-approval failure', () => {
    const gate = gateOf([refused('offer_1', 'JURISDICTION_NOT_APPROVED')])
    const result = evaluatePreflight(input({ gate }), TODAY)

    expect(itemOf(result, 'COMPLIANCE_APPROVAL_CURRENT').state).toBe('PASS')
    expect(itemOf(result, 'TEMPLATE_HASH_MATCHES_APPROVAL').state).toBe('PASS')
    expect(result.blocking).toEqual([])
  })
})

describe('the compliance items', () => {
  it('fails the approval item when no approval exists, for the whole batch', () => {
    const gate = gateOf([refused('offer_1', 'NO_APPROVAL')])
    const result = evaluatePreflight(input({ gate }), TODAY)

    expect(itemOf(result, 'COMPLIANCE_APPROVAL_CURRENT').state).toBe('FAIL')
    expect(result.ready).toBe(false)
    expect(result.sendableOfferIds).toEqual([])
  })

  it('fails the approval item when the approval has been voided', () => {
    const gate = gateOf([refused('offer_1', 'APPROVAL_VOIDED')])
    const result = evaluatePreflight(input({ gate }), TODAY)
    expect(itemOf(result, 'COMPLIANCE_APPROVAL_CURRENT').state).toBe('FAIL')
  })

  it('fails the hash item, and only that item, on template drift', () => {
    const gate = gateOf([refused('offer_1', 'TEMPLATE_DRIFT')])
    const result = evaluatePreflight(input({ gate }), TODAY)

    expect(itemOf(result, 'TEMPLATE_HASH_MATCHES_APPROVAL').state).toBe('FAIL')
    expect(itemOf(result, 'COMPLIANCE_APPROVAL_CURRENT').state).toBe('PASS')
  })

  it('carries the gate’s own wording through rather than inventing a generic one', () => {
    const gate = gateOf([refused('offer_1', 'NO_APPROVAL')])
    const result = evaluatePreflight(input({ gate }), TODAY)
    expect(itemOf(result, 'COMPLIANCE_APPROVAL_CURRENT').detail).toBe(
      'refused because NO_APPROVAL',
    )
  })
})

describe('rendering and sender identity — AC21', () => {
  it('fails both items when sender_phone does not resolve, and names the recipients', () => {
    const validation: BatchValidationResult = {
      ok: false,
      checked: 2,
      problems: [
        {
          offerId: 'a',
          recipientName: 'Ann',
          recipientEmail: 'a@example.com',
          kind: 'INVITATION',
          variable: 'sender_phone',
          part: 'html',
          note: 'Set "Default sender phone" in settings.',
        },
      ],
      affectedOfferIds: ['a'],
      templateErrors: [],
      configurationErrors: [],
    }

    const result = evaluatePreflight(input({ validation }), TODAY)

    expect(itemOf(result, 'SENDER_IDENTITY_RESOLVES').state).toBe('FAIL')
    expect(itemOf(result, 'SENDER_IDENTITY_RESOLVES').detail).toMatch(/Default sender phone/)
    expect(itemOf(result, 'TEMPLATE_RENDERS_FOR_EVERY_RECIPIENT').state).toBe('FAIL')
    expect(itemOf(result, 'TEMPLATE_RENDERS_FOR_EVERY_RECIPIENT').affectedOfferIds).toEqual(['a'])
    expect(result.ready).toBe(false)
  })

  it('fails on a configuration error even with no per-recipient problems', () => {
    const validation: BatchValidationResult = {
      ...cleanValidation(1),
      ok: false,
      configurationErrors: ['The operator has not chosen a contact method.'],
    }
    const result = evaluatePreflight(input({ validation }), TODAY)
    expect(itemOf(result, 'SENDER_IDENTITY_RESOLVES').state).toBe('FAIL')
    expect(itemOf(result, 'TEMPLATE_RENDERS_FOR_EVERY_RECIPIENT').state).toBe('FAIL')
  })

  it('fails the render item on a template that will not parse', () => {
    const validation: BatchValidationResult = {
      ...cleanValidation(1),
      ok: false,
      templateErrors: [{ kind: 'INVITATION', message: 'unclosed block' }],
    }
    const result = evaluatePreflight(input({ validation }), TODAY)
    expect(itemOf(result, 'TEMPLATE_RENDERS_FOR_EVERY_RECIPIENT').state).toBe('FAIL')
  })
})

describe('an empty round', () => {
  it('is not ready, and says so on the file-review item', () => {
    const result = evaluatePreflight(
      input({ offers: [], gate: gateOf([]), validation: cleanValidation(0) }),
      TODAY,
    )
    expect(result.ready).toBe(false)
    expect(itemOf(result, 'RECIPIENT_FILE_REVIEWED').state).toBe('FAIL')
    expect(itemOf(result, 'RECIPIENT_FILE_REVIEWED').detail).toMatch(/no recipients/i)
  })
})

describe('duplicate detection', () => {
  it('treats addresses differing only by case or whitespace as the same person', () => {
    const offers = [
      offer({ offerId: 'a', recipientEmail: 'Alex@Example.com' }),
      offer({ offerId: 'b', recipientEmail: '  alex@example.com ' }),
    ]
    const result = evaluatePreflight(
      input({ offers, gate: gateOf(offers.map((o) => allowed(o.offerId))) }),
      TODAY,
    )
    const item = itemOf(result, 'NO_MISSING_OR_DUPLICATE_EMAILS')
    expect(item.state).toBe('FAIL')
    expect(item.affectedOfferIds?.sort()).toEqual(['a', 'b'])
  })

  it('reports a missing address', () => {
    const offers = [offer({ offerId: 'a', recipientEmail: '' })]
    const result = evaluatePreflight(
      input({ offers, gate: gateOf([allowed('a')]) }),
      TODAY,
    )
    expect(itemOf(result, 'NO_MISSING_OR_DUPLICATE_EMAILS').state).toBe('FAIL')
  })
})

describe('the attested-item allowlist', () => {
  it('accepts only the four judgement items', () => {
    expect(isAttestedItemId('RECIPIENT_FILE_REVIEWED')).toBe(true)
    expect(isAttestedItemId('SERVICE_MODE_ACTIVE')).toBe(false)
    expect(isAttestedItemId('MAIL_CONNECTION_VERIFIED')).toBe(false)
    expect(isAttestedItemId('COMPLIANCE_APPROVAL_CURRENT')).toBe(false)
    expect(isAttestedItemId('anything else')).toBe(false)
  })
})
