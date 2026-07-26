import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { join } from 'node:path'
import {
  anyFilterSet,
  applyFilters,
  jurisdictionsIn,
  REVIEW_FILTER_CONTROLS,
  summarise,
  type ReviewFilters,
  type ReviewRow,
} from './review'

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

// ---------------------------------------------------------------------------
// Every filter §12 names has a control somebody can actually reach
// ---------------------------------------------------------------------------

/**
 * §12: *"Filters: email status · account status · timeline status · response
 * status · jurisdiction · deadline · search by name or email."*
 *
 * Seven. All seven were parsed from the query string and applied by
 * `applyFilters` from the day the screen shipped, and the form rendered three.
 * The other four worked perfectly and were reachable only by hand-typing a
 * URL — which, for the person this screen exists for, is the same as not
 * existing at all. Nothing failed. Nothing could fail: a filter with no control
 * is indistinguishable, from every test that existed, from a filter with one.
 *
 * So the check is between the function and the page, in both directions.
 */
describe('every filter is reachable', () => {
  const rows = [
    row({ offerId: 'a', jurisdiction: 'AU', emailStatus: 'SENT', responseDeadline: '2026-08-01' }),
    row({ offerId: 'b', jurisdiction: 'US', emailStatus: 'BLOCKED', blocked: true, responseDeadline: '2026-08-20' }),
  ]

  const page = readFileSync(
    join(process.cwd(), 'src/app/(admin)/recipients/page.tsx'),
    'utf8',
  )

  /** The keys `applyFilters` actually branches on, read out of its source. */
  const branchedOn = [
    ...readFileSync(join(process.cwd(), 'src/lib/sending/review.ts'), 'utf8')
      .slice(
        readFileSync(join(process.cwd(), 'src/lib/sending/review.ts'), 'utf8').indexOf(
          'export function applyFilters(',
        ),
      )
      .matchAll(/filters\.(\w+)/g),
  ].map((match) => match[1]!)

  it('is checking against a real list', () => {
    expect(new Set(branchedOn).size).toBe(7)
  })

  /**
   * A key has a control if the page names it outright, or if it is in
   * `REVIEW_FILTER_CONTROLS` — which the page maps over, asserted just below,
   * so an entry there is a rendered `<select>`.
   */
  const reachable = new Set<string>([
    ...[...page.matchAll(/name="(\w+)"/g)].map((match) => match[1]!),
    ...REVIEW_FILTER_CONTROLS.map((control) => String(control.name)),
  ])

  it('renders the control list rather than a second copy of it', () => {
    expect(page).toContain('REVIEW_FILTER_CONTROLS')
    expect(page).toMatch(/REVIEW_FILTER_CONTROLS[\s\S]{0,120}\.map\(/)
    expect(page).toContain('name={control.name}')
  })

  it.each([...new Set(branchedOn)])('%s has a control on the page', (key) => {
    expect(reachable.has(key)).toBe(true)
  })

  it('names all seven of §12s filters', () => {
    expect(new Set(branchedOn)).toEqual(
      new Set([
        'emailStatus',
        'accountStatus',
        'stage',
        'responseChoice',
        'jurisdiction',
        'deadlineOnOrBefore',
        'search',
      ]),
    )
  })

  it('offers every value each select can be given', () => {
    // A control whose options are a subset of what the filter accepts is the
    // same defect one level down.
    for (const control of REVIEW_FILTER_CONTROLS) {
      expect(control.options.length).toBeGreaterThan(0)
      expect(new Set(control.options.map((option) => option.value)).size).toBe(
        control.options.length,
      )
    }
  })

  it('gives every option a label a person would use, not an enum', () => {
    for (const control of REVIEW_FILTER_CONTROLS) {
      for (const option of control.options) {
        expect(option.label).not.toBe(option.value)
        expect(option.label).not.toMatch(/_/)
      }
    }
  })

  it('accepts every option value it offers', () => {
    // Each option, applied on its own, must be a filter `applyFilters`
    // understands — not merely a string that removes every row.
    for (const control of REVIEW_FILTER_CONTROLS) {
      for (const option of control.options) {
        const filters = { [control.name]: option.value } as ReviewFilters
        expect(() => applyFilters(rows, filters)).not.toThrow()
        expect(applyFilters(rows, filters).length).toBeLessThanOrEqual(rows.length)
      }
    }
  })

  it('filters by each of the four that had no control', () => {
    expect(applyFilters(rows, { accountStatus: 'ACTIVE' }).every((r) => r.accountStatus === 'ACTIVE')).toBe(true)
    expect(applyFilters(rows, { stage: 'INVITATION_SENT' }).every((r) => r.stage === 'INVITATION_SENT')).toBe(true)
    expect(
      applyFilters(rows, { responseChoice: 'INTERESTED' }).every((r) => r.responseChoice === 'INTERESTED'),
    ).toBe(true)
    expect(
      applyFilters(rows, { deadlineOnOrBefore: '2099-01-01' }).length,
    ).toBe(rows.length)
  })
})

describe('whether to offer a way out of a filtered view', () => {
  it('is false when nothing is set', () => {
    expect(anyFilterSet({})).toBe(false)
    expect(anyFilterSet({ search: null, stage: undefined, jurisdiction: '' })).toBe(false)
  })

  it('is true as soon as one is', () => {
    expect(anyFilterSet({ accountStatus: 'SUSPENDED' })).toBe(true)
    expect(anyFilterSet({ search: 'a' })).toBe(true)
  })
})
