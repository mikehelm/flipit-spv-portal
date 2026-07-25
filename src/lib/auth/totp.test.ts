import { describe, expect, it } from 'vitest'
import { hashToken } from '@/lib/crypto'
import {
  ACCEPTED_STEPS,
  codeAt,
  consumeRecoveryCode,
  createTotpEnrolment,
  generateRecoveryCodes,
  ISSUER,
  normaliseCode,
  normaliseRecoveryCode,
  PERIOD_SECONDS,
  RECOVERY_CODE_COUNT,
  SECOND_FACTOR_FAILED_MESSAGE,
  verifyTotp,
} from './totp'

/**
 * BUILD_SPEC §2.2 — TOTP two-factor and its recovery codes.
 *
 * The clock is a parameter throughout, which is the point: drift, replay and
 * the width of the acceptance window are the whole security argument here, and
 * none of them is checkable against a function that reads `Date.now()` itself.
 */

const EPOCH = 1_800_000_000

describe('enrolment', () => {
  it('produces a base32 secret and a URI an authenticator app will read', () => {
    const { secret, uri } = createTotpEnrolment('mike@flipit.com')

    expect(secret).toMatch(/^[A-Z2-7]{16,}$/)
    expect(uri.startsWith('otpauth://totp/')).toBe(true)
    expect(uri).toContain(`secret=${secret}`)
    expect(uri).toContain(encodeURIComponent(ISSUER))
    // The account label is what distinguishes the owner's entry from the
    // operator's in an app that holds both.
    expect(decodeURIComponent(uri)).toContain('mike@flipit.com')
  })

  it('never issues the same secret twice', () => {
    const secrets = new Set(
      Array.from({ length: 25 }, () => createTotpEnrolment('a@b.com').secret),
    )
    expect(secrets.size).toBe(25)
  })
})

describe('verification', () => {
  const { secret } = createTotpEnrolment('mike@flipit.com')

  it('accepts the code an app is showing right now', () => {
    expect(verifyTotp(secret, codeAt(secret, EPOCH), EPOCH)).toBe('OK')
  })

  it('accepts one period either side, for a phone clock that is slightly out', () => {
    expect(verifyTotp(secret, codeAt(secret, EPOCH - PERIOD_SECONDS), EPOCH)).toBe('OK')
    expect(verifyTotp(secret, codeAt(secret, EPOCH + PERIOD_SECONDS), EPOCH)).toBe('OK')
  })

  it('refuses two periods out, in both directions', () => {
    // The window is a security parameter. Every extra period is another minute
    // in which a code read off somebody's screen is still worth something.
    expect(verifyTotp(secret, codeAt(secret, EPOCH - 2 * PERIOD_SECONDS), EPOCH)).toBe('WRONG')
    expect(verifyTotp(secret, codeAt(secret, EPOCH + 2 * PERIOD_SECONDS), EPOCH)).toBe('WRONG')
  })

  it('is exactly three periods wide, and says so in one place', () => {
    expect([...ACCEPTED_STEPS]).toEqual([-1, 0, 1])
  })

  it('refuses a code for another secret', () => {
    const other = createTotpEnrolment('someone@else.com').secret
    expect(verifyTotp(secret, codeAt(other, EPOCH), EPOCH)).toBe('WRONG')
  })

  it('reads a code with a space in the middle, as apps display it', () => {
    const code = codeAt(secret, EPOCH)
    expect(verifyTotp(secret, `${code.slice(0, 3)} ${code.slice(3)}`, EPOCH)).toBe('OK')
    expect(normaliseCode(' 123 456 ')).toBe('123456')
  })

  it('reports anything that is not six digits as malformed rather than wrong', () => {
    for (const bad of ['', '12345', '1234567', 'abcdef', '   ']) {
      expect(verifyTotp(secret, bad, EPOCH)).toBe('MALFORMED')
    }
  })

  it('refuses rather than throwing on a secret it cannot decode', () => {
    // A corrupted or wrongly-decrypted secret must fail closed. A throw here
    // would be a 500 that distinguishes one account from another.
    expect(verifyTotp('not-a-base32-secret!!', '123456', EPOCH)).toBe('WRONG')
  })

  it('shows one sentence whichever way it failed', () => {
    // §2.2's sign-in has one sentence for every failure; so does this. A
    // message distinguishing "expired" from "wrong" would tell somebody
    // holding a stolen password which factor they had got past.
    expect(SECOND_FACTOR_FAILED_MESSAGE).not.toMatch(/expired|unknown|no such|not enrolled/i)
    expect(SECOND_FACTOR_FAILED_MESSAGE).toContain('recovery codes')
  })
})

describe('recovery codes', () => {
  it('issues ten, formatted to be read off paper', () => {
    const { plain, hashed } = generateRecoveryCodes()

    expect(plain).toHaveLength(RECOVERY_CODE_COUNT)
    expect(hashed).toHaveLength(RECOVERY_CODE_COUNT)
    for (const code of plain) {
      expect(code).toMatch(/^[A-Z2-9]{5}-[A-Z2-9]{5}$/)
    }
  })

  it('excludes the characters people misread off paper', () => {
    const { plain } = generateRecoveryCodes()
    // 0/O, 1/I/L. The only day anybody types one of these is a bad day.
    expect(plain.join('')).not.toMatch(/[01ILOU]/)
  })

  it('stores only hashes, and the hash does not contain the code', () => {
    const { plain, hashed } = generateRecoveryCodes()
    for (let i = 0; i < plain.length; i += 1) {
      expect(hashed[i]).not.toContain(plain[i]!.replace('-', ''))
      expect(hashed[i]).toBe(hashToken(normaliseRecoveryCode(plain[i]!)))
    }
  })

  it('issues ten distinct codes', () => {
    const { plain } = generateRecoveryCodes()
    expect(new Set(plain).size).toBe(RECOVERY_CODE_COUNT)
  })

  it('accepts a code however it is typed', () => {
    const { plain, hashed } = generateRecoveryCodes()
    const code = plain[3]!

    for (const variant of [code, code.toLowerCase(), code.replace('-', ''), ` ${code} `]) {
      expect(consumeRecoveryCode(hashed, variant).ok).toBe(true)
    }
  })

  it('is single use — the code is removed, not marked', () => {
    const { plain, hashed } = generateRecoveryCodes()
    const code = plain[0]!

    const first = consumeRecoveryCode(hashed, code)
    expect(first.ok).toBe(true)
    expect(first.remaining).toHaveLength(RECOVERY_CODE_COUNT - 1)

    // Against what would actually be written back.
    const second = consumeRecoveryCode(first.remaining, code)
    expect(second.ok).toBe(false)
    expect(second.remaining).toHaveLength(RECOVERY_CODE_COUNT - 1)
  })

  it('spends exactly one code, leaving the other nine usable', () => {
    const { plain, hashed } = generateRecoveryCodes()
    let remaining = hashed

    for (const code of plain) {
      const result = consumeRecoveryCode(remaining, code)
      expect(result.ok).toBe(true)
      remaining = result.remaining
    }

    expect(remaining).toEqual([])
  })

  it('refuses an unknown code, an empty one, and punctuation alone', () => {
    const { hashed } = generateRecoveryCodes()
    for (const bad of ['', '   ', '-----', 'ZZZZZ-ZZZZZ']) {
      expect(consumeRecoveryCode(hashed, bad).ok).toBe(false)
    }
  })

  it('refuses everything once the list is empty', () => {
    const { plain } = generateRecoveryCodes()
    expect(consumeRecoveryCode([], plain[0]!).ok).toBe(false)
  })

  it('is deterministic when the randomness is', () => {
    const fixed = (length: number) => new Uint8Array(length).fill(7)
    const a = generateRecoveryCodes(fixed)
    const b = generateRecoveryCodes(fixed)
    expect(a.plain).toEqual(b.plain)
    // And the fixed byte maps into the alphabet rather than off the end of it.
    expect(a.plain[0]).toMatch(/^[A-Z2-9]{5}-[A-Z2-9]{5}$/)
  })
})
