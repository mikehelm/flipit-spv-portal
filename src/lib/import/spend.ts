/**
 * What the AI mapping has cost this month. BUILD_SPEC §9.1.
 *
 *   "A spend cap, and usage shown on the settings page."
 *
 * **The cap warns; it does not refuse.** Decided by the owner on 25 July 2026:
 * the amounts involved are small, and an import that refuses because a
 * twenty-dollar ceiling was reached would block the operator from doing their
 * job over a rounding error. Going over is surfaced loudly on the settings page
 * and on the import screen, and it is recorded — it is never silent, and it is
 * never fatal.
 *
 * There is deliberately no code path anywhere that stops an import because of
 * this figure. If that ever needs to change it should be a decision taken
 * again, not one that arrives by accident.
 *
 * **Money is decimal.js throughout, and never a JavaScript number.** Token
 * counts *are* plain integers, because they are counts of things rather than
 * amounts of money — the API returns them as integers and they are summed as
 * integers. The moment they become a cost they become a Decimal.
 */

import { Dec, sumDecimals } from '@/lib/money'

/** What one call to the model consumed. Counts, not money. */
export interface TokenUsage {
  promptTokens: number
  completionTokens: number
}

/**
 * Price per million tokens, in USD, as decimal strings.
 *
 * These are a published price list, which means they go out of date. They are
 * therefore treated as an **estimate** everywhere they are shown, and the
 * settings page says so rather than presenting a figure that looks like a bill.
 * Checked against OpenAI's published pricing on 25 July 2026.
 *
 * An unknown model is priced at zero rather than guessed at. A guessed price on
 * an unknown model produces a confident wrong number, which is worse than an
 * obvious gap — and the gap is reported, not hidden (see `unpricedModels`).
 */
export const PRICE_PER_MILLION_TOKENS: Record<string, { input: string; output: string }> = {
  'gpt-4o-mini': { input: '0.15', output: '0.60' },
  'gpt-4o': { input: '2.50', output: '10.00' },
  'gpt-4.1-mini': { input: '0.40', output: '1.60' },
  'gpt-4.1': { input: '2.00', output: '8.00' },
}

export function isPricedModel(model: string): boolean {
  return model in PRICE_PER_MILLION_TOKENS
}

/**
 * The estimated cost of one call, as a decimal string with six places.
 *
 * Six rather than two, because a single mapping call costs a fraction of a
 * cent. Rounded to two at the point of accumulation, every call would cost
 * either nothing or a whole cent, and a month of "nothing" would sum to zero.
 */
export function estimateCallCostUsd(model: string, usage: TokenUsage): string {
  const price = PRICE_PER_MILLION_TOKENS[model]
  if (!price) return new Dec(0).toFixed(6)

  const million = new Dec(1_000_000)
  const input = new Dec(price.input).times(usage.promptTokens).dividedBy(million)
  const output = new Dec(price.output).times(usage.completionTokens).dividedBy(million)

  return input.plus(output).toFixed(6)
}

export type SpendState = 'WITHIN_CAP' | 'APPROACHING_CAP' | 'OVER_CAP' | 'NO_CAP'

export interface SpendSummary {
  /** Month-to-date, as a decimal string. Never a number. */
  spentUsd: string
  capUsd: string
  /** What remains, floored at zero. Zero when over. */
  remainingUsd: string
  state: SpendState
  callCount: number
  /** Models seen this month that have no published price in the table above. */
  unpricedModels: string[]
  /** One sentence for the settings page and the import screen. */
  message: string
}

/** Warn from here, so the first anybody hears of it is not the overrun itself. */
const APPROACHING_FRACTION = '0.8'

export interface SpendInput {
  /** One entry per call this month. Decimal strings. */
  costs: readonly string[]
  capUsd: string
  /** Distinct models seen this month, for the unpriced-model report. */
  models?: readonly string[]
}

export function summariseSpend(input: SpendInput): SpendSummary {
  const spent = input.costs.length === 0 ? new Dec(0) : sumDecimals([...input.costs])
  const cap = new Dec(input.capUsd)

  const unpricedModels = [...new Set(input.models ?? [])]
    .filter((model) => !isPricedModel(model))
    .sort()

  const spentUsd = spent.toFixed(2)
  const capUsd = cap.toFixed(2)
  const callCount = input.costs.length

  const unpricedNote =
    unpricedModels.length > 0
      ? ` Calls to ${unpricedModels.join(', ')} are not in the price list, so they are counted but not costed — the real figure is higher than this.`
      : ''

  // A cap of zero means no cap rather than a cap of nothing. Refusing every
  // call because a field was left at its zero default would be a surprising way
  // to break an import.
  if (cap.lessThanOrEqualTo(0)) {
    return {
      spentUsd,
      capUsd,
      remainingUsd: new Dec(0).toFixed(2),
      state: 'NO_CAP',
      callCount,
      unpricedModels,
      message:
        `No monthly cap is set. Estimated spend so far this month is $${spentUsd} across ` +
        `${callCount} call${callCount === 1 ? '' : 's'}.${unpricedNote}`,
    }
  }

  const remaining = cap.minus(spent)
  const remainingUsd = (remaining.lessThan(0) ? new Dec(0) : remaining).toFixed(2)

  if (spent.greaterThanOrEqualTo(cap)) {
    return {
      spentUsd,
      capUsd,
      remainingUsd,
      state: 'OVER_CAP',
      callCount,
      unpricedModels,
      message:
        `Over the monthly cap: about $${spentUsd} spent against a $${capUsd} limit. ` +
        'Imports carry on working — the cap warns rather than blocks — but this is worth ' +
        `a look. Raise the cap in settings, or switch the import to manual mapping.${unpricedNote}`,
    }
  }

  if (spent.greaterThanOrEqualTo(cap.times(APPROACHING_FRACTION))) {
    return {
      spentUsd,
      capUsd,
      remainingUsd,
      state: 'APPROACHING_CAP',
      callCount,
      unpricedModels,
      message:
        `Approaching the monthly cap: about $${spentUsd} of $${capUsd}, with $${remainingUsd} left.${unpricedNote}`,
    }
  }

  return {
    spentUsd,
    capUsd,
    remainingUsd,
    state: 'WITHIN_CAP',
    callCount,
    unpricedModels,
    message:
      `About $${spentUsd} of the $${capUsd} monthly cap, across ${callCount} ` +
      `call${callCount === 1 ? '' : 's'}. $${remainingUsd} left.${unpricedNote}`,
  }
}

/**
 * First instant of the current UTC month.
 *
 * "Monthly" is a billing period, and billing periods are not in the viewer's
 * timezone. UTC, so the figure does not change depending on who is looking.
 */
export function startOfMonthUtc(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0))
}
