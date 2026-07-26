/**
 * The review table. BUILD_SPEC §12.
 *
 * Filtering and the summary cards, as pure functions over rows the caller has
 * already loaded. Pure because these are the numbers the operator reconciles
 * against the spreadsheet, and a total that can only be checked by standing up
 * a database and a browser is a total nobody checks.
 *
 * **The four money totals are computed with decimal.js and returned as
 * strings.** They correspond exactly to the four amounts in §5 — proposed,
 * committed, accepted, received — and there is no fifth. Nothing here calls
 * `Number()`, and a test asserts as much.
 *
 * **"Portal opened" is not email open tracking.** §12 is explicit: it counts
 * accounts that have claimed and opened their portal at least once. There is no
 * tracking pixel and no link wrapping anywhere in this application, and this
 * count is derived from the account's own sign-in record.
 */

import { Dec, sumDecimals } from '@/lib/money'

export type EmailStatus = 'DRAFT' | 'SENT' | 'FAILED' | 'BLOCKED'
export type AccountStatus = 'INVITED' | 'ACTIVE' | 'SUSPENDED' | 'CLOSED' | 'ARCHIVED'
export type ResponseChoice = 'NO_RESPONSE' | 'INTERESTED' | 'NOT_INTERESTED' | 'QUESTION'

export interface ReviewRow {
  offerId: string
  accountId: string
  name: string
  email: string
  jurisdiction: string | null
  /** Decimal strings from the driver. Never coerced to a number. */
  proposedAmountUsd: string
  committedAmountUsd: string | null
  acceptedAmountUsd: string | null
  receivedAmountUsd: string | null
  spvPercentage: string
  indirectPercentage: string
  responseDeadline: string
  emailStatus: EmailStatus
  accountStatus: AccountStatus
  /** §5 timeline stage. */
  stage: string
  responseChoice: ResponseChoice
  blocked: boolean
  blockReason: string | null
  /** Null until the investor has actually opened their portal. */
  portalOpenedAt: Date | null
  lastActivityAt: Date | null
}

export interface ReviewFilters {
  emailStatus?: EmailStatus | null
  accountStatus?: AccountStatus | null
  stage?: string | null
  responseChoice?: ResponseChoice | null
  jurisdiction?: string | null
  /** ISO date. Matches recipients whose deadline is on or before this day. */
  deadlineOnOrBefore?: string | null
  /** Case-insensitive substring of the name or the address. */
  search?: string | null
}

export interface ReviewSummary {
  totalRecipients: number
  sent: number
  /** Claimed and opened at least once. NOT an email open. */
  portalOpened: number
  interested: number
  notInterested: number
  questions: number
  noResponse: number
  /** Decimal strings, two places. Rounded once, at the edge. */
  totalProposedUsd: string
  totalCommittedUsd: string
  totalAcceptedUsd: string
  totalReceivedUsd: string
}

function matchesSearch(row: ReviewRow, search: string): boolean {
  const needle = search.trim().toLowerCase()
  if (needle === '') return true
  return (
    row.name.toLowerCase().includes(needle) || row.email.toLowerCase().includes(needle)
  )
}

export function applyFilters(
  rows: readonly ReviewRow[],
  filters: ReviewFilters,
): ReviewRow[] {
  return rows.filter((row) => {
    if (filters.emailStatus && row.emailStatus !== filters.emailStatus) return false
    if (filters.accountStatus && row.accountStatus !== filters.accountStatus) return false
    if (filters.stage && row.stage !== filters.stage) return false
    if (filters.responseChoice && row.responseChoice !== filters.responseChoice) return false
    if (
      filters.jurisdiction &&
      (row.jurisdiction ?? '').toUpperCase() !== filters.jurisdiction.toUpperCase()
    ) {
      return false
    }
    if (filters.deadlineOnOrBefore && row.responseDeadline > filters.deadlineOnOrBefore) {
      return false
    }
    if (filters.search && !matchesSearch(row, filters.search)) return false
    return true
  })
}

/**
 * A null amount is absent, not zero, and contributes nothing to its total. That
 * distinction is why the four amounts are four columns: a committed total of
 * zero across ten recipients who have not yet committed is a different fact
 * from a committed total of zero across ten who each committed nothing.
 */
function total(values: Array<string | null>): string {
  const present = values.filter((value): value is string => value !== null && value !== '')
  if (present.length === 0) return new Dec(0).toFixed(2)
  return sumDecimals(present).toFixed(2)
}

export function summarise(rows: readonly ReviewRow[]): ReviewSummary {
  return {
    totalRecipients: rows.length,
    sent: rows.filter((row) => row.emailStatus === 'SENT').length,
    portalOpened: rows.filter((row) => row.portalOpenedAt !== null).length,
    interested: rows.filter((row) => row.responseChoice === 'INTERESTED').length,
    notInterested: rows.filter((row) => row.responseChoice === 'NOT_INTERESTED').length,
    questions: rows.filter((row) => row.responseChoice === 'QUESTION').length,
    noResponse: rows.filter((row) => row.responseChoice === 'NO_RESPONSE').length,
    totalProposedUsd: total(rows.map((row) => row.proposedAmountUsd)),
    totalCommittedUsd: total(rows.map((row) => row.committedAmountUsd)),
    totalAcceptedUsd: total(rows.map((row) => row.acceptedAmountUsd)),
    totalReceivedUsd: total(rows.map((row) => row.receivedAmountUsd)),
  }
}

/** Distinct jurisdictions present, for the filter control. */
export function jurisdictionsIn(rows: readonly ReviewRow[]): string[] {
  const seen = new Set<string>()
  for (const row of rows) {
    if (row.jurisdiction) seen.add(row.jurisdiction.toUpperCase())
  }
  return [...seen].sort()
}

// ---------------------------------------------------------------------------
// The controls §12 asks for
// ---------------------------------------------------------------------------

/**
 * Every filter, with the values it can take and what to call them.
 *
 * §12: *"Filters: email status · account status · timeline status · response
 * status · jurisdiction · deadline · search by name or email."* Seven. All
 * seven were parsed from the query string and applied by `applyFilters`; the
 * form rendered three. The other four worked perfectly and were reachable only
 * by hand-typing a URL, which is the same as not existing.
 *
 * The list lives here, beside `applyFilters`, so the two are read together —
 * and `review.test.ts` asserts that every key `applyFilters` branches on has an
 * entry, which is the check that would have caught the gap. A filter added to
 * the function and not to this list fails a test rather than shipping invisible.
 *
 * Jurisdiction is deliberately absent: its options come from the rows on the
 * screen rather than from a fixed list, and the page builds it with
 * `jurisdictionsIn`.
 */
export interface ReviewFilterControl {
  /** The query-string key, which is also the form field name. */
  name: keyof ReviewFilters
  /** For the visible label and the `aria-label`. */
  label: string
  /** The empty option — what "no filter" is called. */
  anyLabel: string
  options: Array<{ value: string; label: string }>
}

const STAGE_LABELS: Array<[string, string]> = [
  ['INVITATION_SENT', 'Invitation sent'],
  ['RESPONSE_RECORDED', 'Response recorded'],
  ['DOCUMENTS_ISSUED', 'Documents issued'],
  ['COMMITMENT_AGREED', 'Commitment agreed'],
  ['ALLOCATION_ACCEPTED', 'Allocation accepted'],
  ['PAYMENT_INSTRUCTIONS_ISSUED', 'Payment instructions issued'],
  ['FUNDS_RECEIVED', 'Funds received'],
  ['COMPLETED', 'Completed'],
]

export const REVIEW_FILTER_CONTROLS: ReviewFilterControl[] = [
  {
    name: 'emailStatus',
    label: 'Email status',
    anyLabel: 'Any email status',
    options: [
      { value: 'DRAFT', label: 'Not sent' },
      { value: 'SENT', label: 'Sent' },
      { value: 'FAILED', label: 'Failed' },
      { value: 'BLOCKED', label: 'Blocked' },
    ],
  },
  {
    name: 'accountStatus',
    label: 'Account status',
    anyLabel: 'Any account status',
    options: [
      { value: 'INVITED', label: 'Invited' },
      { value: 'ACTIVE', label: 'Active' },
      { value: 'SUSPENDED', label: 'Suspended' },
      { value: 'CLOSED', label: 'Closed' },
      { value: 'ARCHIVED', label: 'Archived' },
    ],
  },
  {
    name: 'stage',
    label: 'Timeline status',
    anyLabel: 'Any timeline status',
    options: STAGE_LABELS.map(([value, label]) => ({ value, label })),
  },
  {
    name: 'responseChoice',
    label: 'Response',
    anyLabel: 'Any response',
    options: [
      { value: 'NO_RESPONSE', label: 'Not yet answered' },
      { value: 'INTERESTED', label: 'Interested' },
      { value: 'NOT_INTERESTED', label: 'Not interested' },
      { value: 'QUESTION', label: 'Has a question' },
    ],
  },
]

/** Is any filter set? Decides whether a "clear" link is worth showing. */
export function anyFilterSet(filters: ReviewFilters): boolean {
  return Object.values(filters).some((value) => value !== null && value !== undefined && value !== '')
}
