import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  assertCanSend,
  evaluateSendGuard,
  isVerificationStale,
  SendBlockedError,
  VERIFICATION_MAX_AGE_MS,
  type SendGuardConfig,
} from './guard'

/**
 * The four conditions in §8.1 / §7 / §18.1, each proved to block ON ITS OWN and
 * with a message that names that specific problem.
 *
 * The test that matters most is not that they block — it is that no two of them
 * produce the same sentence. "Sending is unavailable" four times over would
 * satisfy a blocking test and be useless to the person reading it.
 */

const NOW = new Date('2026-07-25T12:00:00.000Z')
const RECENT = new Date('2026-07-25T09:00:00.000Z')

function healthyConfig(overrides: Partial<SendGuardConfig> = {}): SendGuardConfig {
  return {
    serviceMode: 'ACTIVE',
    emailTransport: 'SMTP',
    smtpUserEncrypted: 'v1.aaa.bbb.ccc',
    smtpPasswordEncrypted: 'v1.ddd.eee.fff',
    smtpLastVerifiedAt: RECENT,
    smtpLastVerifyResult: 'OK: Authenticated to smtp.gmail.com:587 over STARTTLS.',
    // WP-2FA. Enrolled by default here so the existing cases keep testing what
    // they were written to test; the gate itself has its own describe block.
    operatorTwoFactorEnrolled: true,
    ...overrides,
  }
}

function evaluate(config: SendGuardConfig, isProduction = true) {
  return evaluateSendGuard({
    intent: 'INVITATION',
    config,
    now: NOW,
    isProductionDeployment: isProduction,
  })
}

describe('evaluateSendGuard — the happy path', () => {
  it('allows a real invitation when every gate passes', () => {
    const decision = evaluate(healthyConfig())
    expect(decision.allowed).toBe(true)
  })
})

describe('the four blocking conditions, each on its own', () => {
  it('1. blocks when the credential is missing, and says so', () => {
    const decision = evaluate(
      healthyConfig({ smtpUserEncrypted: null, smtpPasswordEncrypted: null }),
    )
    expect(decision.allowed).toBe(false)
    if (decision.allowed) return

    expect(decision.blocks.map((b) => b.reason)).toEqual(['CREDENTIAL_MISSING'])
    expect(decision.primary.message).toMatch(/no sending credential is stored/i)
    expect(decision.primary.message).toMatch(/app password/i)
    // It must not be a generic failure.
    expect(decision.primary.message).not.toMatch(/something went wrong/i)
  })

  it('blocks when only the password half is missing', () => {
    const decision = evaluate(healthyConfig({ smtpPasswordEncrypted: null }))
    expect(decision.allowed).toBe(false)
    if (decision.allowed) return
    expect(decision.blocks.map((b) => b.reason)).toContain('CREDENTIAL_MISSING')
  })

  it('2. blocks when the last verification failed, and quotes the recorded detail', () => {
    const decision = evaluate(
      healthyConfig({
        smtpLastVerifyResult: 'FAILED_PERMANENT: Username and Password not accepted.',
      }),
    )
    expect(decision.allowed).toBe(false)
    if (decision.allowed) return

    expect(decision.blocks.map((b) => b.reason)).toEqual(['VERIFICATION_FAILED'])
    expect(decision.primary.message).toMatch(/the last connection test failed/i)
    expect(decision.primary.message).toContain('Username and Password not accepted.')
    expect(decision.primary.message).toMatch(/2-step verification/i)
  })

  it('3. blocks when the service mode is not ACTIVE, naming the mode', () => {
    for (const mode of ['READ_ONLY', 'SUNSET', 'DISABLED'] as const) {
      const decision = evaluate(healthyConfig({ serviceMode: mode }))
      expect(decision.allowed).toBe(false)
      if (decision.allowed) continue

      expect(decision.blocks.map((b) => b.reason)).toEqual(['SERVICE_MODE_NOT_ACTIVE'])
      expect(decision.primary.message).toContain(mode)
      expect(decision.primary.message).toMatch(/not ACTIVE/)
    }
  })

  it('4. blocks when this is not the production deployment', () => {
    const decision = evaluate(healthyConfig(), false)
    expect(decision.allowed).toBe(false)
    if (decision.allowed) return

    expect(decision.blocks.map((b) => b.reason)).toEqual(['NOT_PRODUCTION_DEPLOYMENT'])
    expect(decision.primary.message).toMatch(/not the production deployment/i)
    expect(decision.primary.message).toMatch(/portal links embed this domain/i)
  })

  it('gives each of the four a DIFFERENT message', () => {
    const messages = [
      evaluate(healthyConfig({ smtpUserEncrypted: null, smtpPasswordEncrypted: null })),
      evaluate(healthyConfig({ smtpLastVerifyResult: 'FAILED_PERMANENT: rejected' })),
      evaluate(healthyConfig({ serviceMode: 'READ_ONLY' })),
      evaluate(healthyConfig(), false),
    ].map((decision) => (decision.allowed ? 'ALLOWED' : decision.primary.message))

    expect(new Set(messages).size).toBe(4)
    expect(messages).not.toContain('ALLOWED')
  })
})

describe('the further conditions the spec implies', () => {
  it('separates "never verified" from "verification failed"', () => {
    const decision = evaluate(
      healthyConfig({ smtpLastVerifiedAt: null, smtpLastVerifyResult: null }),
    )
    expect(decision.allowed).toBe(false)
    if (decision.allowed) return

    expect(decision.blocks.map((b) => b.reason)).toEqual(['NEVER_VERIFIED'])
    expect(decision.primary.message).toMatch(/never been tested/i)
    expect(decision.primary.message).not.toMatch(/failed/i)
  })

  it('treats an unrecognised stored result as a failure, never as a pass', () => {
    const decision = evaluate(healthyConfig({ smtpLastVerifyResult: 'probably fine?' }))
    expect(decision.allowed).toBe(false)
    if (decision.allowed) return
    expect(decision.blocks.map((b) => b.reason)).toEqual(['VERIFICATION_FAILED'])
  })

  it('blocks a verification that has gone stale (§19)', () => {
    const decision = evaluate(
      healthyConfig({ smtpLastVerifiedAt: new Date(NOW.getTime() - 2 * VERIFICATION_MAX_AGE_MS) }),
    )
    expect(decision.allowed).toBe(false)
    if (decision.allowed) return
    expect(decision.blocks.map((b) => b.reason)).toEqual(['VERIFICATION_STALE'])
    expect(decision.primary.message).toMatch(/verified in this session/i)
  })

  it('blocks the Gmail API transport with its own reason', () => {
    const decision = evaluate(healthyConfig({ emailTransport: 'GMAIL_API' }))
    expect(decision.allowed).toBe(false)
    if (decision.allowed) return
    expect(decision.blocks.map((b) => b.reason)).toContain('TRANSPORT_UNAVAILABLE')
    expect(decision.primary.message).toMatch(/not configured in this build/i)
  })
})

describe('several problems at once', () => {
  it('reports every applicable reason, not just the first', () => {
    const decision = evaluate(
      healthyConfig({ serviceMode: 'SUNSET', smtpLastVerifyResult: 'FAILED_TRANSIENT: timeout' }),
      false,
    )
    expect(decision.allowed).toBe(false)
    if (decision.allowed) return

    expect(decision.blocks.map((b) => b.reason).sort()).toEqual([
      'NOT_PRODUCTION_DEPLOYMENT',
      'SERVICE_MODE_NOT_ACTIVE',
      'VERIFICATION_FAILED',
    ])
    expect(decision.message).toContain(decision.blocks[0].message)
    expect(decision.message).toContain(decision.blocks[2].message)
  })

  it('leads with what has to be fixed first', () => {
    const decision = evaluate(
      healthyConfig({
        serviceMode: 'DISABLED',
        smtpUserEncrypted: null,
        smtpPasswordEncrypted: null,
      }),
      false,
    )
    expect(decision.allowed).toBe(false)
    if (decision.allowed) return
    expect(decision.primary.reason).toBe('CREDENTIAL_MISSING')
  })

  it('does not raise a verification reason when there is nothing to verify', () => {
    const decision = evaluate(
      healthyConfig({
        smtpUserEncrypted: null,
        smtpPasswordEncrypted: null,
        smtpLastVerifiedAt: null,
        smtpLastVerifyResult: null,
      }),
    )
    expect(decision.allowed).toBe(false)
    if (decision.allowed) return
    expect(decision.blocks.map((b) => b.reason)).toEqual(['CREDENTIAL_MISSING'])
  })
})

describe('test sends — §7, §8.2 and §18.1 carve-outs', () => {
  const test = (config: SendGuardConfig, recipient: string, operator: string, prod = true) =>
    evaluateSendGuard({
      intent: 'TEST',
      config,
      recipient,
      operatorEmail: operator,
      now: NOW,
      isProductionDeployment: prod,
    })

  it('remains available outside ACTIVE and off the production deployment', () => {
    const decision = test(
      healthyConfig({ serviceMode: 'DISABLED' }),
      'serenedavid@gmail.com',
      'serenedavid@gmail.com',
      false,
    )
    expect(decision.allowed).toBe(true)
  })

  it('still requires a working credential — there is nothing to test with', () => {
    const decision = test(
      healthyConfig({ smtpPasswordEncrypted: null }),
      'serenedavid@gmail.com',
      'serenedavid@gmail.com',
    )
    expect(decision.allowed).toBe(false)
    if (decision.allowed) return
    expect(decision.blocks.map((b) => b.reason)).toContain('CREDENTIAL_MISSING')
  })

  it('still requires the last check to have passed', () => {
    const decision = test(
      healthyConfig({ smtpLastVerifyResult: 'FAILED_PERMANENT: auth rejected' }),
      'serenedavid@gmail.com',
      'serenedavid@gmail.com',
    )
    expect(decision.allowed).toBe(false)
    if (decision.allowed) return
    expect(decision.blocks.map((b) => b.reason)).toContain('VERIFICATION_FAILED')
  })

  it('refuses a test send addressed to anyone but the operator', () => {
    const decision = test(healthyConfig(), 'investor@example.com', 'serenedavid@gmail.com')
    expect(decision.allowed).toBe(false)
    if (decision.allowed) return
    expect(decision.blocks.map((b) => b.reason)).toEqual(['TEST_SEND_TO_OTHER_ADDRESS'])
    expect(decision.primary.message).toMatch(/operator's own address/i)
  })

  it('ignores case and surrounding space when comparing the two addresses', () => {
    const decision = test(healthyConfig(), '  SereneDavid@Gmail.com ', 'serenedavid@gmail.com')
    expect(decision.allowed).toBe(true)
  })

  it('refuses when the operator address was not supplied at all', () => {
    const decision = evaluateSendGuard({
      intent: 'TEST',
      config: healthyConfig(),
      recipient: 'serenedavid@gmail.com',
      now: NOW,
      isProductionDeployment: true,
    })
    expect(decision.allowed).toBe(false)
    if (decision.allowed) return
    expect(decision.blocks.map((b) => b.reason)).toEqual(['TEST_SEND_TO_OTHER_ADDRESS'])
  })
})

describe('reminders and other real sends are not test sends', () => {
  it('holds a reminder to the same gates as an invitation (§6.5)', () => {
    const decision = evaluateSendGuard({
      intent: 'REMINDER',
      config: healthyConfig({ serviceMode: 'READ_ONLY' }),
      now: NOW,
      isProductionDeployment: true,
    })
    expect(decision.allowed).toBe(false)
    if (decision.allowed) return
    expect(decision.blocks.map((b) => b.reason)).toEqual(['SERVICE_MODE_NOT_ACTIVE'])
  })
})

describe('assertCanSend', () => {
  it('returns quietly when allowed', () => {
    expect(() =>
      assertCanSend({
        intent: 'INVITATION',
        config: healthyConfig(),
        now: NOW,
        isProductionDeployment: true,
      }),
    ).not.toThrow()
  })

  it('throws a SendBlockedError carrying the reason codes', () => {
    try {
      assertCanSend({
        intent: 'INVITATION',
        config: healthyConfig({ serviceMode: 'SUNSET' }),
        now: NOW,
        isProductionDeployment: true,
      })
      expect.unreachable('assertCanSend should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(SendBlockedError)
      const blocked = error as SendBlockedError
      expect(blocked.reason).toBe('SERVICE_MODE_NOT_ACTIVE')
      expect(blocked.reasonCodes).toEqual(['SERVICE_MODE_NOT_ACTIVE'])
      expect(blocked.message.length).toBeGreaterThan(40)
    }
  })
})

describe('isVerificationStale', () => {
  it('treats never-verified as stale', () => {
    expect(isVerificationStale(null, NOW)).toBe(true)
  })

  it('is false inside the window and true outside it', () => {
    expect(isVerificationStale(new Date(NOW.getTime() - 1000), NOW)).toBe(false)
    expect(
      isVerificationStale(new Date(NOW.getTime() - VERIFICATION_MAX_AGE_MS - 1000), NOW),
    ).toBe(true)
  })
})

describe('two-factor is a release gate, not a preference — §2.2', () => {
  /**
   * §2.2: TOTP is *"optional in v1 and strongly recommended, **mandatory
   * before the production deployment sends anything real**."*
   *
   * So it binds exactly where that sentence says: a real send, on the
   * production deployment. Everything else stays rehearsable, which is what
   * lets §19's pre-flight be walked before the last gate closes.
   */
  const withoutTwoFactor = healthyConfig({ operatorTwoFactorEnrolled: false })

  it('refuses a real invitation from production when it is not switched on', () => {
    const decision = evaluate(withoutTwoFactor, true)
    expect(decision.allowed).toBe(false)
    if (decision.allowed) return
    expect(decision.blocks.map((b) => b.reason)).toContain('SECOND_FACTOR_NOT_ENROLLED')
  })

  it('names it, and says where to switch it on', () => {
    const decision = evaluate(withoutTwoFactor, true)
    if (decision.allowed) throw new Error('expected a refusal')
    const block = decision.blocks.find((b) => b.reason === 'SECOND_FACTOR_NOT_ENROLLED')!
    expect(block.message).toMatch(/two-factor/i)
    expect(block.message).toMatch(/mandatory/i)
    expect(block.message).toMatch(/authenticator app/i)
  })

  it('applies to every real intent, not only invitations', () => {
    for (const intent of ['INVITATION', 'REMINDER', 'NOTIFICATION', 'REPLY'] as const) {
      const decision = evaluateSendGuard({
        intent,
        config: withoutTwoFactor,
        now: NOW,
        isProductionDeployment: true,
      })
      expect(decision.allowed, `${intent} was allowed`).toBe(false)
    }
  })

  it('leaves the testing deployment alone, so the whole flow stays rehearsable', () => {
    const decision = evaluate(withoutTwoFactor, false)
    if (decision.allowed) throw new Error('expected a refusal for the deployment')
    // Refused, but for the deployment — not for two-factor. Adding a second
    // reason here would make the testing deployment harder to use for no gain.
    expect(decision.blocks.map((b) => b.reason)).not.toContain('SECOND_FACTOR_NOT_ENROLLED')
  })

  it('leaves a test send to the operator alone, even on production', () => {
    // §7, §8.2 and §18.1 all carve out the test send. A message to the
    // operator's own address is not "anything real".
    const decision = evaluateSendGuard({
      intent: 'TEST',
      config: withoutTwoFactor,
      now: NOW,
      isProductionDeployment: true,
      operatorEmail: 'david@flipit.com',
      recipient: 'david@flipit.com',
    })
    expect(decision.allowed).toBe(true)
  })

  it('allows the real send once it is switched on', () => {
    expect(evaluate(healthyConfig({ operatorTwoFactorEnrolled: true }), true).allowed).toBe(true)
  })

  it('has no override anywhere — §2.2 offers none', () => {
    // If a way to skip this ever appears it will be a parameter, and it will
    // be visible here.
    const source = readFileSync('src/lib/email/transport/guard.ts', 'utf8')
    expect(source).not.toMatch(/skipTwoFactor|allowWithoutTwoFactor|TWO_FACTOR_OVERRIDE/i)
  })
})
