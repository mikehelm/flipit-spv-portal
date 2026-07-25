import { describe, expect, it } from 'vitest'
import { classifySendError } from './classify'

/**
 * §14: "Distinguish permanent failures (invalid address) from transient ones
 * and surface them differently."
 *
 * The cases that matter are the ones where the obvious rule gets it wrong: a
 * Gmail quota rejection arrives with a 5xx and is not permanent, and an error
 * nobody recognises must not be guessed at in either direction.
 */

function smtpError(fields: Record<string, unknown>): unknown {
  return Object.assign(new Error(String(fields.message ?? 'failed')), fields)
}

describe('permanent failures', () => {
  it('treats a rejected app password as permanent and never retryable', () => {
    const failure = classifySendError(
      smtpError({
        code: 'EAUTH',
        responseCode: 535,
        response: '535-5.7.8 Username and Password not accepted.',
      }),
    )
    expect(failure.kind).toBe('PERMANENT')
    expect(failure.reason).toBe('AUTH_REJECTED')
    expect(failure.retryable).toBe(false)
    expect(failure.message).toMatch(/app password/i)
  })

  it('recognises an auth rejection from the response text alone', () => {
    const failure = classifySendError(
      smtpError({ response: '534-5.7.9 Application-specific password required' }),
    )
    expect(failure.reason).toBe('AUTH_REJECTED')
  })

  it('treats a non-existent recipient as permanent', () => {
    const failure = classifySendError(
      smtpError({
        code: 'EENVELOPE',
        responseCode: 550,
        response: '550 5.1.1 The email account that you tried to reach does not exist.',
      }),
    )
    expect(failure.kind).toBe('PERMANENT')
    expect(failure.reason).toBe('RECIPIENT_REJECTED')
    expect(failure.message).toMatch(/correct the address/i)
  })

  it('separates a rejected sender from a rejected recipient', () => {
    const failure = classifySendError(
      smtpError({ responseCode: 553, command: 'MAIL FROM', response: '553 5.7.1 Sender denied' }),
    )
    expect(failure.reason).toBe('SENDER_REJECTED')
  })

  it('separates a rejected message from a rejected address', () => {
    const failure = classifySendError(
      smtpError({ responseCode: 552, command: 'DATA', response: '552 5.2.3 Message too large' }),
    )
    expect(failure.reason).toBe('MESSAGE_REJECTED')
    expect(failure.message).toMatch(/not resolve by retrying/i)
  })
})

describe('transient failures', () => {
  it.each([
    ['ECONNECTION', 'CONNECTION'],
    ['ECONNRESET', 'CONNECTION'],
    ['ESOCKET', 'CONNECTION'],
    ['EDNS', 'CONNECTION'],
    ['ETIMEDOUT', 'TIMEOUT'],
  ])('treats %s as transient and retryable', (code, reason) => {
    const failure = classifySendError(smtpError({ code }))
    expect(failure.kind).toBe('TRANSIENT')
    expect(failure.reason).toBe(reason)
    expect(failure.retryable).toBe(true)
  })

  it('treats a 421 as the server asking us to come back', () => {
    const failure = classifySendError(
      smtpError({ responseCode: 421, response: '421 4.7.0 Try again later' }),
    )
    expect(failure.kind).toBe('TRANSIENT')
    expect(failure.retryable).toBe(true)
  })

  it('treats any other 4xx as transient', () => {
    const failure = classifySendError(smtpError({ responseCode: 451 }))
    expect(failure.kind).toBe('TRANSIENT')
    expect(failure.retryable).toBe(true)
  })
})

describe('the awkward cases', () => {
  it('reads a Gmail daily quota rejection as transient despite the 5xx, and does not retry it', () => {
    const failure = classifySendError(
      smtpError({
        responseCode: 550,
        response: '550 5.4.5 Daily user sending limit exceeded.',
      }),
    )
    expect(failure.kind).toBe('TRANSIENT')
    expect(failure.reason).toBe('QUOTA_EXCEEDED')
    // Retrying in four seconds cannot help. It clears tomorrow.
    expect(failure.retryable).toBe(false)
    expect(failure.message).toMatch(/daily limit/i)
  })

  it('refuses to guess at an unrecognised failure', () => {
    const failure = classifySendError(smtpError({ message: 'something odd happened' }))
    expect(failure.reason).toBe('UNCLASSIFIED')
    // Not permanent: we will not tell the operator a message definitely did not
    // arrive. Not retryable: we will not risk sending the same offer twice.
    expect(failure.kind).toBe('TRANSIENT')
    expect(failure.retryable).toBe(false)
    expect(failure.message).toMatch(/sent folder/i)
  })

  it('handles a thrown non-object without falling over', () => {
    const failure = classifySendError('a string, for some reason')
    expect(failure.reason).toBe('UNCLASSIFIED')
    expect(failure.code).toBeNull()
    expect(failure.responseCode).toBeNull()
  })
})

describe('every classification says something specific', () => {
  const samples: unknown[] = [
    smtpError({ code: 'EAUTH' }),
    smtpError({ responseCode: 550 }),
    smtpError({ responseCode: 421 }),
    smtpError({ code: 'ETIMEDOUT' }),
    smtpError({ response: '550 5.4.5 daily user sending limit exceeded' }),
    smtpError({ message: 'unknown' }),
  ]

  it('never returns a generic message, and gives every reason its own wording', () => {
    const failures = samples.map((sample) => classifySendError(sample))

    for (const failure of failures) {
      expect(failure.message).not.toMatch(/something went wrong|unknown error|failed to send$/i)
      expect(failure.message.length).toBeGreaterThan(40)
    }

    expect(new Set(failures.map((f) => f.reason)).size).toBe(samples.length)
    expect(new Set(failures.map((f) => f.message)).size).toBe(samples.length)
  })
})

describe('secrets never survive classification', () => {
  it('scrubs the app password out of a response the server echoed', () => {
    const password = 'abcdefghijklmnop'
    const failure = classifySendError(
      smtpError({ responseCode: 535, response: `535 rejected: ${password}` }),
      { secrets: [password] },
    )
    expect(failure.message).not.toContain(password)
    expect(failure.message).toContain('[redacted]')
  })
})
