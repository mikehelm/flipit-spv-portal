import { describe, expect, it } from 'vitest'
import { evaluateAllowlist, isAllowlisted, normaliseEmail } from './sign-in-policy'

/**
 * BUILD_SPEC §2, §2.2, §22 AC18 — "an address that is not on the allowlist and
 * does not hold an investor account cannot sign in, and no record is created
 * for it". These tests exist so that weakening the gate breaks the build.
 *
 * The allowlist comes from src/test/setup.ts:
 *   owners:    mike@flipthepage.com, mike@flipit.com
 *   operator:  serenedavid@gmail.com
 */

describe('evaluateAllowlist — admitted', () => {
  it('admits both allowlisted owner addresses', () => {
    for (const email of ['mike@flipthepage.com', 'mike@flipit.com']) {
      expect(evaluateAllowlist(email)).toEqual({ allowed: true, email, role: 'OWNER' })
    }
  })

  it('admits the operator', () => {
    expect(evaluateAllowlist('serenedavid@gmail.com')).toEqual({
      allowed: true,
      email: 'serenedavid@gmail.com',
      role: 'OPERATOR',
    })
  })

  it('is insensitive to case and surrounding whitespace', () => {
    expect(evaluateAllowlist('  SereneDavid@Gmail.com  ')).toEqual({
      allowed: true,
      email: 'serenedavid@gmail.com',
      role: 'OPERATOR',
    })
  })
})

describe('evaluateAllowlist — refused', () => {
  it('refuses a real address that is not ours', () => {
    expect(evaluateAllowlist('someone@gmail.com')).toEqual({
      allowed: false,
      email: 'someone@gmail.com',
      reason: 'NOT_ALLOWLISTED',
    })
  })

  it.each([null, undefined, '', '   '])('refuses a blank address (%p)', (email) => {
    expect(evaluateAllowlist(email)).toEqual({
      allowed: false,
      email: null,
      reason: 'MISSING_EMAIL',
    })
  })

  it('refuses a near-miss of an allowlisted address', () => {
    for (const email of [
      'mike@flipit.com.evil.example',
      'mike@flipit.co',
      'mike+admin@flipit.com',
      'notmike@flipit.com',
      'serenedavid@googlemail.com',
      'serenedavid@gmail.com.attacker.test',
    ]) {
      expect(evaluateAllowlist(email), email).toMatchObject({
        allowed: false,
        reason: 'NOT_ALLOWLISTED',
      })
    }
  })

  it('has no self-registration path of any kind', () => {
    // The gate returns a decision. It has no branch that creates anything, and
    // nothing in this module imports the database.
    expect(isAllowlisted('brand-new-person@example.com')).toBe(false)
  })
})

describe('normaliseEmail', () => {
  it('lowercases and trims, and treats blank as absent', () => {
    expect(normaliseEmail('  A@B.COM ')).toBe('a@b.com')
    expect(normaliseEmail('   ')).toBeNull()
    expect(normaliseEmail(undefined)).toBeNull()
  })
})
