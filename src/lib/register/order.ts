/**
 * The computed order of the register. BUILD_SPEC §5.2.2.
 *
 * *"Deterministic, and shown to David so he is never guessing."*
 *
 *   1. Investors whose **funds have been received**, by value date, earliest
 *      first.
 *   2. Then investors who have **agreed a commitment** but not yet settled, by
 *      commitment date.
 *   3. Then everyone else, by the date they joined the register.
 *
 * That is the honest version of "in order of accepting and investing": position
 * is earned by having finished your own participation, not by being quick to
 * raise your hand (§5.2.1).
 *
 * **The result of this file is never shown to an investor.** Not the rank, not
 * the band, not the length of the list. A displayed rank is a promise whatever
 * the surrounding text says. The investor-facing view type in `data.ts` has no
 * field this could be assigned to, and there is a test asserting it.
 *
 * Pure. No database, no formatting, no side effects.
 */

export type RegisterBand = 'FUNDS_RECEIVED' | 'COMMITMENT_AGREED' | 'ON_THE_REGISTER'

export const BAND_ORDER: readonly RegisterBand[] = [
  'FUNDS_RECEIVED',
  'COMMITMENT_AGREED',
  'ON_THE_REGISTER',
] as const

export const BAND_LABEL: Readonly<Record<RegisterBand, string>> = {
  FUNDS_RECEIVED: 'Funds received',
  COMMITMENT_AGREED: 'Commitment agreed, not yet settled',
  ON_THE_REGISTER: 'On the register',
}

export const BAND_EXPLANATION: Readonly<Record<RegisterBand, string>> = {
  FUNDS_RECEIVED:
    'Completed their own participation. Ordered by the value date of the funds, earliest first.',
  COMMITMENT_AGREED:
    'Agreed a commitment but has not settled yet. Ordered by the date the commitment was agreed.',
  ON_THE_REGISTER:
    'Has not yet completed a participation in this round. Ordered by the date they joined the register.',
}

export interface RegisterCandidate {
  accountId: string
  /** ISO instant. When they put their name down. */
  joinedAt: Date
  /** ISO date string, `YYYY-MM-DD`. Null when no funds have settled. */
  fundsValueDate: string | null
  /** ISO instant. Null when no commitment has been agreed. */
  commitmentAgreedAt: Date | null
  /**
   * An explicit position the operator has set, 1-based. §5.2.2 allows an
   * override "but only with a recorded reason", so an override with no reason
   * is ignored here rather than half-applied — the rule lives in the ordering,
   * not only in the form that sets it.
   */
  operatorOrderOverride: number | null
  overrideReason: string | null
}

export interface OrderedRegisterMember {
  accountId: string
  /** 1-based, for the operator's screen only. */
  position: number
  band: RegisterBand
  /** Whether this position came from an override rather than the computation. */
  overridden: boolean
  /** Only present when overridden. Recorded, and shown. */
  overrideReason: string | null
  /** Where the computation alone would have put them. */
  computedPosition: number
}

function bandOf(candidate: RegisterCandidate): RegisterBand {
  if (candidate.fundsValueDate !== null) return 'FUNDS_RECEIVED'
  if (candidate.commitmentAgreedAt !== null) return 'COMMITMENT_AGREED'
  return 'ON_THE_REGISTER'
}

/** Whether an override is usable: a position AND a recorded reason (§5.2.2). */
export function hasUsableOverride(candidate: {
  operatorOrderOverride: number | null
  overrideReason: string | null
}): boolean {
  return (
    typeof candidate.operatorOrderOverride === 'number' &&
    Number.isInteger(candidate.operatorOrderOverride) &&
    candidate.operatorOrderOverride >= 1 &&
    (candidate.overrideReason?.trim() ?? '') !== ''
  )
}

/**
 * The order the computation alone produces, ignoring every override.
 *
 * Kept separate so the operator's screen can show both — "the computation put
 * them fourth, you moved them to first, and here is the reason you gave". An
 * override that hides what it changed is not a trail.
 *
 * Ties break on `accountId` so the list is total and does not shuffle between
 * page loads.
 */
export function computeOrder(candidates: readonly RegisterCandidate[]): RegisterCandidate[] {
  return [...candidates].sort((a, b) => {
    const bandA = BAND_ORDER.indexOf(bandOf(a))
    const bandB = BAND_ORDER.indexOf(bandOf(b))
    if (bandA !== bandB) return bandA - bandB

    const keyA = sortKeyWithin(a)
    const keyB = sortKeyWithin(b)
    if (keyA !== keyB) return keyA < keyB ? -1 : 1

    return a.accountId < b.accountId ? -1 : a.accountId > b.accountId ? 1 : 0
  })
}

/** The date this candidate is ordered by within its own band. */
function sortKeyWithin(candidate: RegisterCandidate): string {
  const band = bandOf(candidate)
  if (band === 'FUNDS_RECEIVED') return candidate.fundsValueDate ?? ''
  if (band === 'COMMITMENT_AGREED') {
    return candidate.commitmentAgreedAt?.toISOString() ?? ''
  }
  return candidate.joinedAt.toISOString()
}

/**
 * The final order, with overrides applied.
 *
 * An override names an absolute position in the finished list, so it can move
 * somebody down as well as up. Overridden members are placed first, in
 * ascending order of the position they were given; everyone else fills the
 * remaining slots in computed order without changing their relative order.
 *
 * A position beyond the end of the list lands at the end rather than being
 * refused — the operator set an intent, and the list is a different length
 * every week.
 */
export function orderRegister(
  candidates: readonly RegisterCandidate[],
): OrderedRegisterMember[] {
  const computed = computeOrder(candidates)
  const computedPosition = new Map(computed.map((row, index) => [row.accountId, index + 1]))

  const overridden = computed
    .filter((row) => hasUsableOverride(row))
    .sort((a, b) => {
      const diff = a.operatorOrderOverride! - b.operatorOrderOverride!
      if (diff !== 0) return diff
      return computedPosition.get(a.accountId)! - computedPosition.get(b.accountId)!
    })

  const rest = computed.filter((row) => !hasUsableOverride(row))

  const slots: Array<RegisterCandidate | null> = new Array(computed.length).fill(null)

  for (const row of overridden) {
    // Clamp into range, then take the first free slot at or after it. Two
    // people both moved to first is an instruction the operator can give and
    // the list still has to be a list.
    let index = Math.min(Math.max(row.operatorOrderOverride! - 1, 0), computed.length - 1)
    while (index < slots.length && slots[index] !== null) index += 1
    if (index >= slots.length) {
      index = slots.findIndex((slot) => slot === null)
    }
    if (index >= 0) slots[index] = row
  }

  let cursor = 0
  for (const row of rest) {
    while (cursor < slots.length && slots[cursor] !== null) cursor += 1
    if (cursor >= slots.length) break
    slots[cursor] = row
  }

  return slots
    .filter((slot): slot is RegisterCandidate => slot !== null)
    .map((row, index) => ({
      accountId: row.accountId,
      position: index + 1,
      band: bandOf(row),
      overridden: hasUsableOverride(row),
      overrideReason: hasUsableOverride(row) ? (row.overrideReason?.trim() ?? null) : null,
      computedPosition: computedPosition.get(row.accountId) ?? index + 1,
    }))
}

/** §5.2.2: an override needs a reason worth reading, not a keystroke. */
export const MIN_OVERRIDE_REASON_LENGTH = 10

export const OVERRIDE_REASON_REQUIRED =
  'An override needs a recorded reason of at least ' +
  `${MIN_OVERRIDE_REASON_LENGTH} characters. There will be legitimate cases; there should be a trail.`
