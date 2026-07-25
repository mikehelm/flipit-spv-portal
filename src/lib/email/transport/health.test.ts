import { describe, expect, it } from 'vitest'
import { encrypt } from '@/lib/crypto'
import { describeMailConnection, type MailConnectionConfig } from './health'
import { VERIFICATION_MAX_AGE_MS } from './guard'

/**
 * §8.1 / §12: connection health lives on the main dashboard, because it is one
 * of the two things that silently break a send.
 *
 * The property under test is that every state says something different and
 * specific — a health panel that reads "Not available" in five distinct
 * situations is worse than no panel, because it looks like information.
 */

const NOW = new Date('2026-07-25T12:00:00.000Z')
const USER = 'serenedavid@gmail.com'

function config(overrides: Partial<MailConnectionConfig> = {}): MailConnectionConfig {
  return {
    emailTransport: 'SMTP',
    smtpUserEncrypted: encrypt(USER),
    smtpPasswordEncrypted: encrypt('abcdefghijklmnop'),
    smtpLastVerifiedAt: new Date(NOW.getTime() - 60_000),
    smtpLastVerifyResult: 'OK: Authenticated.',
    ...overrides,
  }
}

describe('describeMailConnection', () => {
  it('reports a healthy connection with the authenticated address — §8.1', () => {
    const health = describeMailConnection(config(), NOW)
    expect(health.state).toBe('HEALTHY')
    expect(health.authenticatedAddress).toBe(USER)
    expect(health.host).toBe('smtp.gmail.com')
    expect(health.port).toBe(587)
    expect(health.summary).toContain(USER)
  })

  it('reports nothing connected', () => {
    const health = describeMailConnection(
      config({ smtpUserEncrypted: null, smtpPasswordEncrypted: null }),
      NOW,
    )
    expect(health.state).toBe('NOT_CONFIGURED')
    expect(health.authenticatedAddress).toBeNull()
    expect(health.summary).toMatch(/no sending account is connected/i)
  })

  it('separates never-tested from failed', () => {
    const never = describeMailConnection(
      config({ smtpLastVerifiedAt: null, smtpLastVerifyResult: null }),
      NOW,
    )
    const failed = describeMailConnection(
      config({ smtpLastVerifyResult: 'FAILED_PERMANENT: Password not accepted.' }),
      NOW,
    )

    expect(never.state).toBe('NEVER_VERIFIED')
    expect(failed.state).toBe('FAILED')
    expect(never.summary).not.toBe(failed.summary)
    expect(failed.summary).toContain('Password not accepted.')
  })

  it('reports a verification that has aged out', () => {
    const health = describeMailConnection(
      config({
        smtpLastVerifiedAt: new Date(NOW.getTime() - VERIFICATION_MAX_AGE_MS - 1000),
      }),
      NOW,
    )
    expect(health.state).toBe('STALE')
    expect(health.summary).toMatch(/test the connection again/i)
  })

  it('reports the unavailable Gmail API transport', () => {
    const health = describeMailConnection(config({ emailTransport: 'GMAIL_API' }), NOW)
    expect(health.state).toBe('TRANSPORT_UNAVAILABLE')
    expect(health.authenticatedAddress).toBeNull()
  })

  it('explains an unreadable credential rather than throwing on the dashboard', () => {
    const health = describeMailConnection(
      config({ smtpUserEncrypted: 'v1.aa.bb.cc', smtpPasswordEncrypted: 'v1.dd.ee.ff' }),
      NOW,
    )
    expect(health.state).toBe('FAILED')
    expect(health.summary).toMatch(/could not be decrypted/i)
  })

  it('never returns the app password in any state', () => {
    const password = 'abcdefghijklmnop'
    const states = [
      config(),
      config({ smtpLastVerifyResult: 'FAILED_PERMANENT: nope' }),
      config({ emailTransport: 'GMAIL_API' }),
      config({ smtpUserEncrypted: null, smtpPasswordEncrypted: null }),
    ].map((c) => describeMailConnection(c, NOW))

    for (const health of states) {
      expect(JSON.stringify(health)).not.toContain(password)
    }
  })

  it('gives every state its own summary', () => {
    const summaries = [
      describeMailConnection(config(), NOW),
      describeMailConnection(config({ smtpUserEncrypted: null, smtpPasswordEncrypted: null }), NOW),
      describeMailConnection(
        config({ smtpLastVerifiedAt: null, smtpLastVerifyResult: null }),
        NOW,
      ),
      describeMailConnection(config({ smtpLastVerifyResult: 'FAILED_TRANSIENT: timeout' }), NOW),
      describeMailConnection(
        config({ smtpLastVerifiedAt: new Date(NOW.getTime() - VERIFICATION_MAX_AGE_MS - 1) }),
        NOW,
      ),
      describeMailConnection(config({ emailTransport: 'GMAIL_API' }), NOW),
    ].map((health) => health.summary)

    expect(new Set(summaries).size).toBe(summaries.length)
  })
})
