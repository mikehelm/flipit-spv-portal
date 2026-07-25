import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { applyFilters, jurisdictionsIn, summarise, type ReviewRow } from './review'

const row = (overrides: Partial<ReviewRow> = {}): ReviewRow => ({
  offerId: 'offer_1',
  accountId: 'acct_1',
  name: 'Alex Fournier',
  email: 'alex@example.com',
  jurisdiction: 'AU',
  proposedAmountUsd: '5000.00',
  committedAmountUsd: null,
  acceptedAmountUsd: null,
  receivedAmountUsd: null,
  spvPercentage: '16.666667',
  indirectPercentage: '5.000000',
  responseDeadline: '2026-08-10',
  emailStatus: 'DRAFT',
  accountStatus: 'INVITED',
  stage: 'INVITATION_SENT',
  responseChoice: 'NO_RESPONSE',
  blocked: false,
  blockReason: null,
  portalOpenedAt: null,
  lastActivityAt: null,
  ...overrides,
})

describe('the four money totals — §12, §5', () => {
  it('sums exactly, where binary floating point would not', () => {
    // 0.10 + 0.20 + 0.30 + 0.40 + 0.50 + 0.60 + 0.70 is 2.80 exactly. As
    // doubles it is 2.8000000000000003.
    const rows = ['0.10', '0.20', '0.30', '0.40', '0.50', '0.60', '0.70'].map(
      (amount, index) => row({ offerId: `offer_${index}`, proposedAmountUsd: amount }),
    )
    expect(summarise(rows).totalProposedUsd).toBe('2.80')
  })

  it('carries an amount larger than a double can represent', () => {
    const rows = [
      row({ offerId: 'a', proposedAmountUsd: '123456789012345678.99' }),
      row({ offerId: 'b', proposedAmountUsd: '0.01' }),
    ]
    expect(summarise(rows).totalProposedUsd).toBe('123456789012345679.00')
  })

  it('treats an absent amount as absent, not as zero', () => {
    const rows = [
      row({ offerId: 'a', committedAmountUsd: null }),
      row({ offerId: 'b', committedAmountUsd: '1000.00' }),
    ]
    expect(summarise(rows).totalCommittedUsd).toBe('1000.00')
  })

  it('returns 0.00 for a total with nothing in it', () => {
    expect(summarise([row()]).totalReceivedUsd).toBe('0.00')
  })

  it('keeps the four amounts separate — there is no fifth', () => {
    const rows = [
      row({
        proposedAmountUsd: '5000.00',
        committedAmountUsd: '4000.00',
        acceptedAmountUsd: '3000.00',
        receivedAmountUsd: '2000.00',
      }),
    ]
    const summary = summarise(rows)
    expect(summary.totalProposedUsd).toBe('5000.00')
    expect(summary.totalCommittedUsd).toBe('4000.00')
    expect(summary.totalAcceptedUsd).toBe('3000.00')
    expect(summary.totalReceivedUsd).toBe('2000.00')

    const moneyKeys = Object.keys(summary).filter((key) => key.startsWith('total') && key.endsWith('Usd'))
    expect(moneyKeys).toHaveLength(4)
  })

  it('returns every total as a string, never a number', () => {
    const summary = summarise([row()])
    for (const key of ['totalProposedUsd', 'totalCommittedUsd', 'totalAcceptedUsd', 'totalReceivedUsd'] as const) {
      expect(typeof summary[key]).toBe('string')
    }
  })
})

/**
 * Comments are stripped before scanning. Without that, the module's own
 * documentation — which says in prose that it never calls `Number()` — trips
 * the test that checks it never calls `Number()`, and the obvious way to make
 * that pass is to delete the explanation. The check is about the code.
 */
function codeWithoutComments(url: URL): string {
  return readFileSync(url, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
}

describe('no floating point anywhere in this module', () => {
  it('never calls Number, parseFloat, parseInt or toNumber', () => {
    const code = codeWithoutComments(new URL('./review.ts', import.meta.url))
    expect(code).not.toMatch(/\bNumber\(/)
    expect(code).not.toMatch(/\bparseFloat\(/)
    expect(code).not.toMatch(/\bparseInt\(/)
    expect(code).not.toMatch(/\.toNumber\(/)
  })

  it('is a test that would actually catch one', () => {
    // Guards the comment-stripper: if it ever removed everything, the checks
    // above would pass vacuously.
    const code = codeWithoutComments(new URL('./review.ts', import.meta.url))
    expect(code).toMatch(/export function summarise/)
    expect(code).toMatch(/sumDecimals/)
  })
})

describe('portal opened is not email open tracking — §12', () => {
  it('counts accounts that have opened their portal, and nothing else', () => {
    const rows = [
      row({ offerId: 'a', emailStatus: 'SENT', portalOpenedAt: null }),
      row({ offerId: 'b', emailStatus: 'SENT', portalOpenedAt: new Date('2026-07-20') }),
    ]
    const summary = summarise(rows)
    expect(summary.sent).toBe(2)
    expect(summary.portalOpened).toBe(1)
  })

  it('has no notion of an email being opened', () => {
    const code = codeWithoutComments(new URL('./review.ts', import.meta.url))
    expect(code).not.toMatch(/tracking.?pixel/i)
    expect(code).not.toMatch(/emailOpen/i)
    // The only "opened" concept in the summary is the portal one.
    expect(Object.keys(summarise([row()])).filter((key) => /open/i.test(key))).toEqual([
      'portalOpened',
    ])
  })
})

describe('the response counts', () => {
  it('partitions every recipient into exactly one response bucket', () => {
    const rows = [
      row({ offerId: 'a', responseChoice: 'INTERESTED' }),
      row({ offerId: 'b', responseChoice: 'NOT_INTERESTED' }),
      row({ offerId: 'c', responseChoice: 'QUESTION' }),
      row({ offerId: 'd', responseChoice: 'NO_RESPONSE' }),
      row({ offerId: 'e', responseChoice: 'NO_RESPONSE' }),
    ]
    const summary = summarise(rows)
    expect(summary.interested + summary.notInterested + summary.questions + summary.noResponse).toBe(
      summary.totalRecipients,
    )
    expect(summary.noResponse).toBe(2)
  })
})

describe('filters', () => {
  const rows = [
    row({ offerId: 'a', name: 'Ann Ito', email: 'ann@example.com', jurisdiction: 'AU', emailStatus: 'SENT', responseDeadline: '2026-08-01' }),
    row({ offerId: 'b', name: 'Ben Ohara', email: 'ben@example.org', jurisdiction: 'US', emailStatus: 'BLOCKED', blocked: true, responseDeadline: '2026-08-20' }),
    row({ offerId: 'c', name: 'Cara Lund', email: 'cara@example.com', jurisdiction: 'au', emailStatus: 'DRAFT', responseDeadline: '2026-09-01' }),
  ]

  it('returns everything when nothing is set', () => {
    expect(applyFilters(rows, {})).toHaveLength(3)
  })

  it('filters by email status', () => {
    expect(applyFilters(rows, { emailStatus: 'SENT' }).map((r) => r.offerId)).toEqual(['a'])
  })

  it('filters by jurisdiction regardless of case', () => {
    expect(applyFilters(rows, { jurisdiction: 'au' }).map((r) => r.offerId)).toEqual(['a', 'c'])
  })

  it('filters by deadline on or before a date, inclusive of the day itself', () => {
    expect(applyFilters(rows, { deadlineOnOrBefore: '2026-08-20' }).map((r) => r.offerId)).toEqual([
      'a',
      'b',
    ])
  })

  it('searches name and address, case-insensitively', () => {
    expect(applyFilters(rows, { search: 'OHARA' }).map((r) => r.offerId)).toEqual(['b'])
    expect(applyFilters(rows, { search: 'example.com' }).map((r) => r.offerId)).toEqual(['a', 'c'])
  })

  it('combines filters', () => {
    expect(
      applyFilters(rows, { jurisdiction: 'AU', search: 'cara' }).map((r) => r.offerId),
    ).toEqual(['c'])
  })

  it('never removes a blocked recipient from the table — it is shown, not hidden', () => {
    // §8.2: a block stops a send, it does not erase the person from the review.
    expect(applyFilters(rows, {}).some((r) => r.blocked)).toBe(true)
  })

  it('lists the distinct jurisdictions present, normalised and sorted', () => {
    expect(jurisdictionsIn(rows)).toEqual(['AU', 'US'])
  })
})
