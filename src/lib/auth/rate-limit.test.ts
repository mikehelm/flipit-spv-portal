import { describe, expect, it } from 'vitest'
import {
  FAILURE_WINDOW_MS,
  InMemoryRateLimitStore,
  LOCK_AFTER_FAILURES,
  LOCK_DURATION_MS,
  MAX_DELAY_MS,
  afterFailure,
  checkRateLimit,
  clearFailures,
  delayForFailures,
  recordFailure,
  signInKeys,
  verdictFor,
} from './rate-limit'

/** BUILD_SPEC §2.2 — progressive delay by address and by IP, then a temporary lock. */

describe('delayForFailures', () => {
  it('is free for the first mistyped password', () => {
    expect(delayForFailures(0)).toBe(0)
    expect(delayForFailures(1)).toBe(0)
  })

  it('doubles, then stops growing', () => {
    expect(delayForFailures(2)).toBe(250)
    expect(delayForFailures(3)).toBe(500)
    expect(delayForFailures(4)).toBe(1000)
    expect(delayForFailures(5)).toBe(2000)
    expect(delayForFailures(6)).toBe(4000)
    expect(delayForFailures(7)).toBe(8000)
    expect(delayForFailures(40)).toBe(MAX_DELAY_MS)
  })
})

describe('afterFailure', () => {
  const now = 1_000_000

  it('starts a fresh count', () => {
    expect(afterFailure(undefined, now)).toEqual({
      failures: 1,
      firstFailureAt: now,
      lockedUntil: null,
    })
  })

  it('locks once the threshold is reached', () => {
    let record = afterFailure(undefined, now)
    for (let i = 1; i < LOCK_AFTER_FAILURES; i += 1) {
      record = afterFailure(record, now)
    }
    expect(record.failures).toBe(LOCK_AFTER_FAILURES)
    expect(record.lockedUntil).toBe(now + LOCK_DURATION_MS)
  })

  it('forgets failures once the window has passed', () => {
    const stale = { failures: 9, firstFailureAt: now, lockedUntil: null }
    const next = afterFailure(stale, now + FAILURE_WINDOW_MS + 1)
    expect(next.failures).toBe(1)
  })
})

describe('verdictFor', () => {
  const now = 2_000_000

  it('takes the worst of the address and IP counters', () => {
    const byEmail = { failures: 2, firstFailureAt: now, lockedUntil: null }
    const byIp = { failures: 6, firstFailureAt: now, lockedUntil: null }
    expect(verdictFor([byEmail, byIp], now).delayMs).toBe(delayForFailures(6))
  })

  it('reports a live lock and ignores an expired one', () => {
    expect(verdictFor([{ failures: 10, firstFailureAt: now, lockedUntil: now + 1 }], now)).toMatchObject(
      { locked: true },
    )
    expect(verdictFor([{ failures: 10, firstFailureAt: now, lockedUntil: now - 1 }], now)).toMatchObject(
      { locked: false },
    )
  })

  it('is quiet when nothing has failed', () => {
    expect(verdictFor([undefined, undefined], now)).toEqual({
      locked: false,
      delayMs: 0,
      lockedUntil: null,
    })
  })
})

describe('signInKeys', () => {
  it('counts by address and by IP separately, and normalises the address', () => {
    expect(signInKeys('  Mike@FlipIt.com ', '203.0.113.4')).toEqual([
      'signin:email:mike@flipit.com',
      'signin:ip:203.0.113.4',
    ])
  })
})

describe('the store, end to end', () => {
  const now = 3_000_000

  it('throttles an address across changing IPs', async () => {
    const store = new InMemoryRateLimitStore()

    for (let attempt = 0; attempt < 4; attempt += 1) {
      await recordFailure(store, signInKeys('mike@flipit.com', `198.51.100.${attempt}`), now)
    }

    // Fresh IP, but the address has four failures against it.
    const verdict = await checkRateLimit(
      store,
      signInKeys('mike@flipit.com', '198.51.100.99'),
      now,
    )
    expect(verdict.delayMs).toBe(delayForFailures(4))
  })

  it('throttles an IP spraying many addresses', async () => {
    const store = new InMemoryRateLimitStore()

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await recordFailure(store, signInKeys(`victim${attempt}@example.com`, '203.0.113.9'), now)
    }

    const verdict = await checkRateLimit(
      store,
      signInKeys('never-tried@example.com', '203.0.113.9'),
      now,
    )
    expect(verdict.delayMs).toBe(delayForFailures(5))
  })

  it('counts an address that does not exist exactly like one that does', async () => {
    const store = new InMemoryRateLimitStore()
    const now2 = now

    await recordFailure(store, signInKeys('stranger@example.com', '1.1.1.1'), now2)
    await recordFailure(store, signInKeys('mike@flipit.com', '2.2.2.2'), now2)

    const strangerVerdict = await checkRateLimit(
      store,
      signInKeys('stranger@example.com', '1.1.1.1'),
      now2,
    )
    const ownerVerdict = await checkRateLimit(
      store,
      signInKeys('mike@flipit.com', '2.2.2.2'),
      now2,
    )
    expect(strangerVerdict).toEqual(ownerVerdict)
  })

  it('clears the count on a successful sign-in', async () => {
    const store = new InMemoryRateLimitStore()
    const keys = signInKeys('mike@flipit.com', '203.0.113.1')

    await recordFailure(store, keys, now)
    await recordFailure(store, keys, now)
    expect((await checkRateLimit(store, keys, now)).delayMs).toBeGreaterThan(0)

    await clearFailures(store, keys)
    expect((await checkRateLimit(store, keys, now)).delayMs).toBe(0)
  })
})
