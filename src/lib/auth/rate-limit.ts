/**
 * Sign-in rate limiting. BUILD_SPEC §2.2.
 *
 * "Progressive delay by address and by IP, then a temporary lock."
 *
 * Both keys are counted independently and the *worse* of the two applies, which
 * is what makes the two useful together: the address key stops someone grinding
 * one account from many places, and the IP key stops someone spraying many
 * addresses from one place.
 *
 * Counters are kept for an attempted address whether or not that address
 * exists, so the delay a stranger experiences is identical either way.
 */

export interface AttemptRecord {
  failures: number
  firstFailureAt: number
  lockedUntil: number | null
}

export interface RateLimitStore {
  get(key: string): Promise<AttemptRecord | undefined>
  set(key: string, record: AttemptRecord): Promise<void>
  delete(key: string): Promise<void>
}

/** Failures older than this stop counting. */
export const FAILURE_WINDOW_MS = 60 * 60 * 1000

/** Progressive delay stops growing here. */
export const MAX_DELAY_MS = 8_000

export const LOCK_AFTER_FAILURES = 10
export const LOCK_DURATION_MS = 15 * 60 * 1000

/**
 * 0, 0, 250ms, 500ms, 1s, 2s, 4s, 8s, 8s…
 *
 * The first two are free because a mistyped password is normal. After that the
 * cost doubles, which is unnoticeable to a person and ruinous to a script.
 */
export function delayForFailures(failures: number): number {
  if (failures <= 1) return 0
  const delay = 250 * 2 ** (failures - 2)
  return Math.min(delay, MAX_DELAY_MS)
}

function isFresh(record: AttemptRecord, now: number): boolean {
  return now - record.firstFailureAt < FAILURE_WINDOW_MS
}

/** Pure. What a record becomes after one more failure. */
export function afterFailure(
  current: AttemptRecord | undefined,
  now: number,
): AttemptRecord {
  const base =
    current && isFresh(current, now)
      ? current
      : { failures: 0, firstFailureAt: now, lockedUntil: null }

  const failures = base.failures + 1

  return {
    failures,
    firstFailureAt: base.firstFailureAt,
    lockedUntil:
      failures >= LOCK_AFTER_FAILURES ? now + LOCK_DURATION_MS : base.lockedUntil,
  }
}

export interface RateLimitVerdict {
  locked: boolean
  /** Milliseconds to wait before even attempting verification. */
  delayMs: number
  /** When the lock lifts, if locked. */
  lockedUntil: number | null
}

/** Pure. The verdict for a set of already-loaded records. */
export function verdictFor(
  records: Array<AttemptRecord | undefined>,
  now: number,
): RateLimitVerdict {
  let delayMs = 0
  let lockedUntil: number | null = null

  for (const record of records) {
    if (!record) continue

    if (record.lockedUntil !== null && record.lockedUntil > now) {
      lockedUntil = Math.max(lockedUntil ?? 0, record.lockedUntil)
    }

    if (isFresh(record, now)) {
      delayMs = Math.max(delayMs, delayForFailures(record.failures))
    }
  }

  return { locked: lockedUntil !== null, delayMs, lockedUntil }
}

export function signInKeys(email: string, ip: string): string[] {
  return [`signin:email:${email.trim().toLowerCase()}`, `signin:ip:${ip}`]
}

export async function checkRateLimit(
  store: RateLimitStore,
  keys: string[],
  now: number,
): Promise<RateLimitVerdict> {
  const records = await Promise.all(keys.map((key) => store.get(key)))
  return verdictFor(records, now)
}

export async function recordFailure(
  store: RateLimitStore,
  keys: string[],
  now: number,
): Promise<void> {
  for (const key of keys) {
    const current = await store.get(key)
    await store.set(key, afterFailure(current, now))
  }
}

export async function clearFailures(
  store: RateLimitStore,
  keys: string[],
): Promise<void> {
  for (const key of keys) {
    await store.delete(key)
  }
}

/**
 * In-process counters. Used by the tests, and as the fallback if the table is
 * ever unreachable.
 *
 * Honest about what this is: it resets when the process restarts and it is not
 * shared between instances. That is why it is not what sign-in uses — see
 * `drizzleRateLimitStore` below.
 */
export class InMemoryRateLimitStore implements RateLimitStore {
  private readonly records = new Map<string, AttemptRecord>()

  async get(key: string): Promise<AttemptRecord | undefined> {
    return this.records.get(key)
  }

  async set(key: string, record: AttemptRecord): Promise<void> {
    this.records.set(key, record)
  }

  async delete(key: string): Promise<void> {
    this.records.delete(key)
  }
}

/**
 * The counters sign-in actually uses: a row per key in `sign_in_attempts`.
 *
 * In the database rather than in memory because an in-memory lock lifts itself
 * the moment anything restarts, and restarting is not a difficulty an attacker
 * has to overcome — a deploy, a crash loop or a scale-out does it for them. A
 * fifteen-minute lock that a redeploy clears is not a fifteen-minute lock.
 *
 * Written with an upsert so two simultaneous failed attempts cannot lose one
 * another's increment.
 */
export function drizzleRateLimitStore(): RateLimitStore {
  return {
    async get(key: string): Promise<AttemptRecord | undefined> {
      const { db } = await import('@/db')
      const { signInAttempts } = await import('@/db/schema')
      const { eq } = await import('drizzle-orm')

      const row = await db.query.signInAttempts.findFirst({
        where: eq(signInAttempts.key, key),
      })
      if (!row) return undefined

      return {
        failures: row.failures,
        firstFailureAt: row.firstFailureAt.getTime(),
        lockedUntil: row.lockedUntil?.getTime() ?? null,
      }
    },

    async set(key: string, record: AttemptRecord): Promise<void> {
      const { db } = await import('@/db')
      const { signInAttempts } = await import('@/db/schema')

      const values = {
        key,
        failures: record.failures,
        firstFailureAt: new Date(record.firstFailureAt),
        lockedUntil: record.lockedUntil === null ? null : new Date(record.lockedUntil),
      }

      await db
        .insert(signInAttempts)
        .values(values)
        .onConflictDoUpdate({ target: signInAttempts.key, set: values })
    },

    async delete(key: string): Promise<void> {
      const { db } = await import('@/db')
      const { signInAttempts } = await import('@/db/schema')
      const { eq } = await import('drizzle-orm')

      await db.delete(signInAttempts).where(eq(signInAttempts.key, key))
    },
  }
}

export function signInRateLimitStore(): RateLimitStore {
  return drizzleRateLimitStore()
}
