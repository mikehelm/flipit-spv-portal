import { describe, expect, it } from 'vitest'
import {
  ARGON2_OPTIONS,
  MIN_PASSWORD_LENGTH,
  checkPassword,
  dummyPasswordHash,
  hashPassword,
  verifyPassword,
} from './password'

/** BUILD_SPEC §2.2 — Argon2id, minimum 12, common-password list, no composition rules. */

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
  it('is Argon2id, not a fast hash', async () => {
    const hash = await hashPassword('rusty gate marmalade')
    expect(hash.startsWith('$argon2id$')).toBe(true)
    expect(ARGON2_OPTIONS.memoryCost).toBeGreaterThanOrEqual(19456)
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
  it('is a real Argon2id hash that nothing verifies against', async () => {
    const hash = await dummyPasswordHash()
    expect(hash.startsWith('$argon2id$')).toBe(true)
    expect(await verifyPassword(hash, 'password')).toBe(false)
    expect(await verifyPassword(hash, '')).toBe(false)
  })

  it('is memoised, so the unknown-address path does not pay to build one each time', async () => {
    expect(await dummyPasswordHash()).toBe(await dummyPasswordHash())
  })
})
