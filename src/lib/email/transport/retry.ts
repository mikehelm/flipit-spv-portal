import { classifySendError } from './classify'
import {
  SendFailureError,
  type EmailTransport,
  type OutboundMessage,
  type SendFailure,
  type SendResult,
} from './types'

/**
 * Retry with exponential backoff. BUILD_SPEC §14:
 *
 *   "Rate-limit sends and retry transient failures with backoff. Distinguish
 *   permanent failures (invalid address) from transient ones and surface them
 *   differently."
 *
 * The loop in this file is over ATTEMPTS AT ONE MESSAGE. It is not, and must
 * not become, a loop over recipients — §14 again: "Do not build a Send All /
 * bulk send." `sendOneWithRetry` takes a single `OutboundMessage` and there is
 * nothing here that takes a list.
 *
 * A permanent failure is never retried. Retrying a rejected address produces
 * an identical rejection and delays the moment the operator finds out.
 */

export interface BackoffOptions {
  baseDelayMs?: number
  maxDelayMs?: number
  factor?: number
  /** Injectable for tests. Returns 0..1. */
  random?: () => number
}

export const DEFAULT_BACKOFF: Required<Omit<BackoffOptions, 'random'>> = {
  baseDelayMs: 750,
  maxDelayMs: 15_000,
  factor: 2,
}

/**
 * Equal jitter: half the delay is fixed, half is random.
 *
 * Full jitter can return almost zero, which defeats the point of backing off
 * at all when the server has just told us to slow down. Equal jitter keeps a
 * guaranteed floor while still spreading retries out.
 *
 * attempt 1 → 375–750ms · 2 → 750–1500ms · 3 → 1500–3000ms · capped at 15s.
 */
export function backoffDelayMs(attempt: number, options: BackoffOptions = {}): number {
  const base = options.baseDelayMs ?? DEFAULT_BACKOFF.baseDelayMs
  const max = options.maxDelayMs ?? DEFAULT_BACKOFF.maxDelayMs
  const factor = options.factor ?? DEFAULT_BACKOFF.factor
  const random = options.random ?? Math.random

  const uncapped = base * factor ** Math.max(0, attempt - 1)
  const capped = Math.min(uncapped, max)
  return Math.round(capped / 2 + random() * (capped / 2))
}

export interface AttemptReport {
  attempt: number
  ok: boolean
  failure?: SendFailure
  /** How long we are about to wait before the next attempt. */
  nextDelayMs?: number
}

export interface RetryOptions extends BackoffOptions {
  /** Total attempts, not retries. 3 means one send and two retries. */
  maxAttempts?: number
  sleep?: (ms: number) => Promise<void>
  /**
   * Called after every attempt, before any wait. WP7 writes one `send_events`
   * row per attempt from here — the schema has an `attempt` column for exactly
   * this. Never given anything secret.
   */
  onAttempt?: (report: AttemptReport) => void | Promise<void>
}

export const DEFAULT_MAX_ATTEMPTS = 3

export type SendAttemptResult =
  | { outcome: 'SUCCEEDED'; result: SendResult; attempts: number }
  | {
      outcome: 'FAILED_TRANSIENT' | 'FAILED_PERMANENT'
      failure: SendFailure
      attempts: number
    }

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function asFailure(error: unknown): SendFailure {
  if (error instanceof SendFailureError) return error.failure
  // A transport that threw something other than SendFailureError still has to
  // be classified rather than swallowed.
  return classifySendError(error)
}

/**
 * Send one message, retrying only what is worth retrying.
 *
 * Returns rather than throws, because the caller has to record the outcome
 * against the offer either way and `outcome` maps straight onto the
 * `send_events.outcome` enum.
 */
export async function sendOneWithRetry(
  transport: EmailTransport,
  message: OutboundMessage,
  options: RetryOptions = {},
): Promise<SendAttemptResult> {
  const maxAttempts = Math.max(1, options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS)
  const sleep = options.sleep ?? defaultSleep

  let attempt = 0
  let lastFailure: SendFailure | null = null

  while (attempt < maxAttempts) {
    attempt += 1
    try {
      const result = await transport.sendOne(message)
      await options.onAttempt?.({ attempt, ok: true })
      return { outcome: 'SUCCEEDED', result, attempts: attempt }
    } catch (error) {
      const failure = asFailure(error)
      lastFailure = failure

      const moreAttempts = attempt < maxAttempts
      const willRetry = failure.retryable && moreAttempts
      const nextDelayMs = willRetry ? backoffDelayMs(attempt, options) : undefined

      await options.onAttempt?.({ attempt, ok: false, failure, nextDelayMs })

      if (!willRetry) break
      await sleep(nextDelayMs ?? 0)
    }
  }

  // `lastFailure` cannot be null here: the loop runs at least once and only
  // leaves this way after a catch.
  const failure = lastFailure as SendFailure
  return {
    outcome: failure.kind === 'PERMANENT' ? 'FAILED_PERMANENT' : 'FAILED_TRANSIENT',
    failure,
    attempts: attempt,
  }
}
