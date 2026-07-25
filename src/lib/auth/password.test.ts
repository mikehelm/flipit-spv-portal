import { describe, expect, it } from 'vitest'
import {
  SCRYPT_PARAMS,
  MIN_PASSWORD_LENGTH,
  checkPassword,
  dummyPasswordHash,
  hashPassword,
  verifyPassword,
} from './password'

/**
 * BUILD_SPEC §2.2 — minimum 12, a common-password list, no composition rules.
 *
 * §2.2 names Argon2id. This uses scrypt from Node's own crypto module, for
 * deployment reasons recorded in PROGRESS.md and agreed with the owner. The
 * property the spec is really asserting — "never a fast hash" — is what these
 * tests hold the implementation to.
 */

describe('checkPassword', () => {
  it('accepts a long ordinary phrase', () => {
    expect(checkPassword('rusty gate marmalade')).toEqual({ ok: true })
  })

  it('rejects anything under the minimum', () => {
    const result = checkPassword('short1234')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.problems).toContain('TOO_SHORT')
  })

  it('has no composition rules — length beats symbols', () => {
    // All lowercase, no digits, no punctuation. Long enough, so it passes.
    expect(checkPassword('bicyclelanternquiet')).toEqual({ ok: true })
    expect(MIN_PASSWORD_LENGTH).toBeGreaterThanOrEqual(12)
  })

  it('rejects well-known passwords even when they are long enough', () => {
    for (const common of ['password1234', 'correct horse battery staple', 'Qwerty123456']) {
      const result = checkPassword(common)
      expect(result.ok, common).toBe(false)
      if (!result.ok) expect(result.problems).toContain('COMMON')
    }
  })

  it('rejects a password built out of the account it protects', () => {
    const result = checkPassword('serenedavid-2026', { email: 'serenedavid@gmail.com' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.problems).toContain('CONTAINS_IDENTITY')
  })

  it('explains what to do rather than just refusing', () => {
    const result = checkPassword('abc')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message.length).toBeGreaterThan(30)
  })
})

describe('hashing', () => {
  it('is scrypt, not a fast hash', async () => {
    const hash = await hashPassword('rusty gate marmalade')
    expect(hash.startsWith('scrypt$')).toBe(true)
    // Memory cost in bytes is roughly 128 * N * r. OWASP's scrypt baseline is
    // N = 2^17, r = 8 — about 128 MiB per hash. A "fast hash" would be orders
    // of magnitude below this, so the assertion is on the real cost, not on the
    // name of the algorithm.
    const memoryBytes = 128 * SCRYPT_PARAMS.N * SCRYPT_PARAMS.r
    expect(memoryBytes).toBeGreaterThanOrEqual(128 * 1024 * 1024)
    expect(SCRYPT_PARAMS.maxmem).toBeGreaterThanOrEqual(memoryBytes)
  })

  it('salts per hash — the same password hashes differently every time', async () => {
    const a = await hashPassword('rusty gate marmalade')
    const b = await hashPassword('rusty gate marmalade')
    expect(a).not.toBe(b)
    expect(await verifyPassword(a, 'rusty gate marmalade')).toBe(true)
    expect(await verifyPassword(b, 'rusty gate marmalade')).toBe(true)
  })

  it('rejects the wrong password', async () => {
    const hash = await hashPassword('rusty gate marmalade')
    expect(await verifyPassword(hash, 'rusty gate marmalada')).toBe(false)
    expect(await verifyPassword(hash, '')).toBe(false)
  })

  it('never throws on a malformed stored hash', async () => {
    await expect(verifyPassword('not-a-hash', 'anything')).resolves.toBe(false)
    await expect(verifyPassword('', 'anything')).resolves.toBe(false)
  })
})

describe('dummyPasswordHash', () => {
  it('is a real scrypt hash that nothing verifies against', async () => {
    const hash = await dummyPasswordHash()
    expect(hash.startsWith('scrypt$')).toBe(true)
    expect(await verifyPassword(hash, 'password')).toBe(false)
    expect(await verifyPassword(hash, '')).toBe(false)
  })

  it('is memoised, so the unknown-address path does not pay to build one each time', async () => {
    expect(await dummyPasswordHash()).toBe(await dummyPasswordHash())
  })
})
