import { describe, expect, it } from 'vitest'
import { attemptPasswordSignIn, type SignInDeps } from './credentials'
import {
  CredentialStorageUnavailableError,
  InMemoryCredentialStore,
  drizzleCredentialStore,
} from './credential-store'
import { hashPassword } from './password'
import { InMemoryRateLimitStore, LOCK_AFTER_FAILURES } from './rate-limit'

/**
 * BUILD_SPEC §2.2, §22 AC18 — "an unknown address cannot sign in and no record
 * is created for it. Sign-in is enumeration-resistant: an unknown address and a
 * wrong password fail identically."
 *
 * These are the tests that matter most in this package. If someone later adds a
 * helpful "no account with that address" message, they break here.
 */

const OWNER_PASSWORD = 'rusty gate marmalade'
const OPERATOR_PASSWORD = 'bicycle lantern quiet'

async function deps(overrides: Partial<SignInDeps> = {}): Promise<SignInDeps> {
  const store = new InMemoryCredentialStore([
    {
      userId: 'user-owner',
      email: 'mike@flipit.com',
      passwordHash: await hashPassword(OWNER_PASSWORD),
      passwordSetAt: new Date(),
    },
    {
      userId: 'user-operator',
      email: 'serenedavid@gmail.com',
      passwordHash: await hashPassword(OPERATOR_PASSWORD),
      passwordSetAt: new Date(),
    },
    {
      // Allowlisted, seeded, but has never chosen a password.
      userId: 'user-owner-2',
      email: 'mike@flipthepage.com',
      passwordHash: null,
      passwordSetAt: null,
    },
  ])

  return {
    store,
    rateLimit: new InMemoryRateLimitStore(),
    // Delays are asserted separately; sleeping for real would make the suite crawl.
    sleep: async () => {},
    ...overrides,
  }
}

describe('attemptPasswordSignIn — success', () => {
  it('admits the owner', async () => {
    const result = await attemptPasswordSignIn(
      { email: 'mike@flipit.com', password: OWNER_PASSWORD, ip: '203.0.113.1' },
      await deps(),
    )
    expect(result).toEqual({
      ok: true,
      userId: 'user-owner',
      email: 'mike@flipit.com',
      role: 'OWNER',
    })
  })

  it('admits the operator, case and whitespace insensitively', async () => {
    const result = await attemptPasswordSignIn(
      { email: '  SereneDavid@Gmail.com ', password: OPERATOR_PASSWORD, ip: '203.0.113.1' },
      await deps(),
    )
    expect(result).toMatchObject({ ok: true, role: 'OPERATOR' })
  })
})

describe('attemptPasswordSignIn — enumeration resistance', () => {
  it('fails identically for an unknown address and a wrong password', async () => {
    const unknown = await attemptPasswordSignIn(
      { email: 'stranger@example.com', password: 'anything at all', ip: '203.0.113.2' },
      await deps(),
    )
    const wrongPassword = await attemptPasswordSignIn(
      { email: 'mike@flipit.com', password: 'anything at all', ip: '203.0.113.3' },
      await deps(),
    )

    expect(unknown.ok).toBe(false)
    expect(wrongPassword.ok).toBe(false)
    if (!unknown.ok && !wrongPassword.ok) {
      // The visible outcome is identical. Only the internal detail differs, and
      // that never leaves the server.
      expect(unknown.reason).toBe(wrongPassword.reason)
      expect(unknown.reason).toBe('INVALID_CREDENTIALS')
      expect(unknown.detail).toBe('NOT_ALLOWLISTED')
      expect(wrongPassword.detail).toBe('WRONG_PASSWORD')
    }
  })

  it('fails identically for an allowlisted account with no password set', async () => {
    const result = await attemptPasswordSignIn(
      { email: 'mike@flipthepage.com', password: 'anything at all', ip: '203.0.113.4' },
      await deps(),
    )
    expect(result).toMatchObject({
      ok: false,
      reason: 'INVALID_CREDENTIALS',
      detail: 'NO_PASSWORD_SET',
    })
  })

  it('never accepts an empty password against an account with no password set', async () => {
    const result = await attemptPasswordSignIn(
      { email: 'mike@flipthepage.com', password: '', ip: '203.0.113.5' },
      await deps(),
    )
    expect(result.ok).toBe(false)
  })

  it('spends real hashing work on an unknown address', async () => {
    // The dummy hash is what makes the timing match. If the unknown-address
    // branch ever short-circuits before verification, this gets much faster and
    // the timing oracle is back.
    const shared = await deps()
    const started = process.hrtime.bigint()
    await attemptPasswordSignIn(
      { email: 'stranger@example.com', password: 'anything at all', ip: '203.0.113.6' },
      shared,
    )
    const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6
    expect(elapsedMs).toBeGreaterThan(1)
  })

  it('creates nothing for an unknown address', async () => {
    const shared = await deps()
    await attemptPasswordSignIn(
      { email: 'stranger@example.com', password: 'anything at all', ip: '203.0.113.7' },
      shared,
    )
    expect(await shared.store.findByEmail('stranger@example.com')).toBeNull()
  })
})

describe('attemptPasswordSignIn — rate limiting', () => {
  it('locks after enough failures, and the lock applies to the right person too', async () => {
    const shared = await deps()

    for (let attempt = 0; attempt < LOCK_AFTER_FAILURES; attempt += 1) {
      await attemptPasswordSignIn(
        { email: 'mike@flipit.com', password: 'wrong wrong wrong', ip: '203.0.113.8' },
        shared,
      )
    }

    const locked = await attemptPasswordSignIn(
      { email: 'mike@flipit.com', password: OWNER_PASSWORD, ip: '203.0.113.8' },
      shared,
    )

    expect(locked).toMatchObject({ ok: false, reason: 'LOCKED' })
  })

  it('clears the count once someone gets in', async () => {
    const shared = await deps()

    await attemptPasswordSignIn(
      { email: 'mike@flipit.com', password: 'wrong', ip: '203.0.113.9' },
      shared,
    )
    await attemptPasswordSignIn(
      { email: 'mike@flipit.com', password: 'wrong', ip: '203.0.113.9' },
      shared,
    )
    await attemptPasswordSignIn(
      { email: 'mike@flipit.com', password: OWNER_PASSWORD, ip: '203.0.113.9' },
      shared,
    )

    expect(
      await shared.rateLimit.get('signin:email:mike@flipit.com'),
    ).toBeUndefined()
  })

  it('applies the progressive delay it computed', async () => {
    const slept: number[] = []
    const shared = await deps({
      sleep: async (ms) => {
        slept.push(ms)
      },
    })

    for (let attempt = 0; attempt < 4; attempt += 1) {
      await attemptPasswordSignIn(
        { email: 'mike@flipit.com', password: 'wrong', ip: '203.0.113.10' },
        shared,
      )
    }

    expect(slept).toEqual([0, 0, 250, 500])
  })
})

describe('attemptPasswordSignIn — storage unavailable', () => {
  it('says so plainly instead of pretending the password was wrong', async () => {
    const result = await attemptPasswordSignIn(
      { email: 'mike@flipit.com', password: OWNER_PASSWORD, ip: '203.0.113.11' },
      { ...(await deps()), store: drizzleCredentialStore() },
    )
    expect(result).toMatchObject({ ok: false, reason: 'UNAVAILABLE' })
  })
})

describe('drizzleCredentialStore', () => {
  it('refuses rather than inventing a hiding place for a password verifier', async () => {
    await expect(drizzleCredentialStore().findByEmail('mike@flipit.com')).rejects.toBeInstanceOf(
      CredentialStorageUnavailableError,
    )
    await expect(
      drizzleCredentialStore().setPasswordHash('user-owner', 'hash', new Date()),
    ).rejects.toBeInstanceOf(CredentialStorageUnavailableError)
  })
})
