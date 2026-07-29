import { describe, expect, it } from 'vitest'
import {
  EDIT_CAPABILITY_LIFETIME_MS,
  editCapabilityRequestId,
  issueEditCapability,
  verifiesEditCapability,
} from './edit-capability'

describe('access-request edit capability', () => {
  const secret = 'a-test-secret-long-enough-for-an-hmac'
  const now = Date.UTC(2026, 6, 27, 3, 0)

  it('admits only the request and address it was issued for', () => {
    const token = issueEditCapability('request-1', 'person@example.com', secret, now)

    expect(
      verifiesEditCapability(token, 'request-1', 'person@example.com', secret, now),
    ).toBe(true)
    expect(editCapabilityRequestId(token)).toBe('request-1')
    expect(
      verifiesEditCapability(token, 'request-2', 'person@example.com', secret, now),
    ).toBe(false)
    expect(
      verifiesEditCapability(token, 'request-1', 'other@example.com', secret, now),
    ).toBe(false)
  })

  it('refuses missing and modified values', () => {
    const token = issueEditCapability('request-1', 'person@example.com', secret, now)

    expect(
      verifiesEditCapability(null, 'request-1', 'person@example.com', secret, now),
    ).toBe(false)
    expect(
      verifiesEditCapability(`${token}x`, 'request-1', 'person@example.com', secret, now),
    ).toBe(false)
    expect(editCapabilityRequestId('not-a-capability')).toBeNull()
  })

  it('expires after thirty minutes and refuses a future-issued value', () => {
    const token = issueEditCapability('request-1', 'person@example.com', secret, now)

    expect(
      verifiesEditCapability(
        token,
        'request-1',
        'person@example.com',
        secret,
        now + EDIT_CAPABILITY_LIFETIME_MS,
      ),
    ).toBe(true)
    expect(
      verifiesEditCapability(
        token,
        'request-1',
        'person@example.com',
        secret,
        now + EDIT_CAPABILITY_LIFETIME_MS + 1,
      ),
    ).toBe(false)

    const future = issueEditCapability(
      'request-1',
      'person@example.com',
      secret,
      now + 2 * 60 * 1_000,
    )
    expect(
      verifiesEditCapability(future, 'request-1', 'person@example.com', secret, now),
    ).toBe(false)
  })
})
