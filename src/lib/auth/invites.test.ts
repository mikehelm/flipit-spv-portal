import { describe, expect, it } from 'vitest'
import { hashToken, issueToken, tokensMatch } from '@/lib/crypto'
import {
  OPERATOR_INVITE_TTL_HOURS,
  assessInvite,
  inviteExpiryFrom,
  inviteStatus,
  type InviteSnapshot,
} from './invites'

/** BUILD_SPEC §15 — single-use, expiring, hashed admin invite tokens. */

const now = new Date('2026-07-25T12:00:00Z')

function invite(overrides: Partial<InviteSnapshot> = {}): InviteSnapshot {
  return {
    email: 'serenedavid@gmail.com',
    expiresAt: new Date('2026-07-26T12:00:00Z'),
    usedAt: null,
    revokedAt: null,
    ...overrides,
  }
}

describe('assessInvite', () => {
  const signedInEmail = 'serenedavid@gmail.com'

  it('accepts a live invite presented by the person it names', () => {
    expect(assessInvite({ invite: invite(), signedInEmail, now })).toEqual({ ok: true })
  })

  it('matches the address case-insensitively', () => {
    expect(
      assessInvite({
        invite: invite({ email: 'SereneDavid@Gmail.com' }),
        signedInEmail: '  serenedavid@gmail.com ',
        now,
      }),
    ).toEqual({ ok: true })
  })

  it('refuses an unknown token', () => {
    expect(assessInvite({ invite: null, signedInEmail, now })).toEqual({
      ok: false,
      reason: 'NOT_FOUND',
    })
  })

  it('refuses a used invite — single use means once', () => {
    expect(
      assessInvite({ invite: invite({ usedAt: new Date() }), signedInEmail, now }),
    ).toEqual({ ok: false, reason: 'ALREADY_USED' })
  })

  it('refuses a revoked invite', () => {
    expect(
      assessInvite({ invite: invite({ revokedAt: new Date() }), signedInEmail, now }),
    ).toEqual({ ok: false, reason: 'REVOKED' })
  })

  it('refuses an expired invite', () => {
    expect(
      assessInvite({
        invite: invite({ expiresAt: new Date('2026-07-25T11:59:59Z') }),
        signedInEmail,
        now,
      }),
    ).toEqual({ ok: false, reason: 'EXPIRED' })
  })

  it('treats the expiry instant itself as expired', () => {
    expect(
      assessInvite({ invite: invite({ expiresAt: now }), signedInEmail, now }),
    ).toEqual({ ok: false, reason: 'EXPIRED' })
  })

  it('refuses a token presented by someone else, and says nothing about its state', () => {
    // A stolen-but-expired token and a stolen-but-live token must be
    // indistinguishable to the thief.
    const stolenLive = assessInvite({
      invite: invite(),
      signedInEmail: 'mike@flipit.com',
      now,
    })
    const stolenExpired = assessInvite({
      invite: invite({ expiresAt: new Date('2020-01-01T00:00:00Z') }),
      signedInEmail: 'mike@flipit.com',
      now,
    })
    const stolenUsed = assessInvite({
      invite: invite({ usedAt: new Date() }),
      signedInEmail: 'mike@flipit.com',
      now,
    })

    expect(stolenLive).toEqual({ ok: false, reason: 'WRONG_ACCOUNT' })
    expect(stolenExpired).toEqual(stolenLive)
    expect(stolenUsed).toEqual(stolenLive)
  })
})

describe('expiry', () => {
  it('is short and bounded', () => {
    expect(OPERATOR_INVITE_TTL_HOURS).toBeLessThanOrEqual(72)
    expect(inviteExpiryFrom(now).toISOString()).toBe('2026-07-28T12:00:00.000Z')
  })
})

describe('inviteStatus', () => {
  it('reports accepted, revoked, expired and pending in that precedence', () => {
    expect(inviteStatus(invite({ usedAt: now, revokedAt: now }), now)).toBe('ACCEPTED')
    expect(inviteStatus(invite({ revokedAt: now }), now)).toBe('REVOKED')
    expect(inviteStatus(invite({ expiresAt: new Date(0) }), now)).toBe('EXPIRED')
    expect(inviteStatus(invite(), now)).toBe('PENDING')
  })
})

describe('the token itself', () => {
  it('is high entropy and never stored in the clear', () => {
    const { token, hash } = issueToken()
    // 32 random bytes, base64url encoded — comfortably above the 128 bits §15 requires.
    expect(Buffer.from(token, 'base64url').length).toBe(32)
    expect(hash).not.toContain(token)
    expect(hash).toBe(hashToken(token))
  })

  it('only matches its own hash', () => {
    const a = issueToken()
    const b = issueToken()
    expect(tokensMatch(a.token, a.hash)).toBe(true)
    expect(tokensMatch(b.token, a.hash)).toBe(false)
    expect(tokensMatch(`${a.token}x`, a.hash)).toBe(false)
  })
})
