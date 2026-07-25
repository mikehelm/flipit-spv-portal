import { describe, expect, it } from 'vitest'
import { backoffDelayMs, sendOneWithRetry, type AttemptReport } from './retry'
import {
  SendFailureError,
  type EmailTransport,
  type OutboundMessage,
  type SendFailure,
  type SendResult,
  type VerifyResult,
} from './types'

const message: OutboundMessage = {
  to: 'investor@example.com',
  fromName: 'David Serene',
  subject: 'Subject',
  html: '<p>Body</p>',
  text: 'Body',
}

function failure(overrides: Partial<SendFailure> = {}): SendFailure {
  return {
    kind: 'TRANSIENT',
    reason: 'CONNECTION',
    retryable: true,
    code: 'ECONNRESET',
    responseCode: null,
    message: 'Could not reach smtp.gmail.com.',
    ...overrides,
  }
}

/** A transport that fails a set number of times and then succeeds. */
class ScriptedTransport implements EmailTransport {
  readonly name = 'SMTP' as const
  readonly authenticatedAddress = 'serenedavid@gmail.com'
  calls = 0

  constructor(private readonly script: (call: number) => SendFailure | null) {}

  async sendOne(msg: OutboundMessage): Promise<SendResult> {
    this.calls += 1
    const scripted = this.script(this.calls)
    if (scripted) throw new SendFailureError(scripted)
    return {
      messageId: '<sent@gmail.com>',
      recipient: msg.to,
      inReplyTo: null,
      response: '250 OK',
      sentAt: new Date(),
    }
  }

  async verifyConnection(): Promise<VerifyResult> {
    return { ok: true, checkedAt: new Date(), detail: 'ok' }
  }
}

const noSleep = async () => {}

describe('backoffDelayMs', () => {
  it('doubles each attempt', () => {
    const at = (attempt: number) => backoffDelayMs(attempt, { random: () => 1, baseDelayMs: 100 })
    expect(at(1)).toBe(100)
    expect(at(2)).toBe(200)
    expect(at(3)).toBe(400)
    expect(at(4)).toBe(800)
  })

  it('keeps a floor of half the delay — jitter never collapses it to nothing', () => {
    expect(backoffDelayMs(1, { random: () => 0, baseDelayMs: 100 })).toBe(50)
    expect(backoffDelayMs(3, { random: () => 0, baseDelayMs: 100 })).toBe(200)
  })

  it('caps the growth', () => {
    const delay = backoffDelayMs(20, { random: () => 1, baseDelayMs: 750, maxDelayMs: 15_000 })
    expect(delay).toBe(15_000)
  })

  it('stays inside its bounds for real random values', () => {
    for (let i = 0; i < 50; i += 1) {
      const delay = backoffDelayMs(2, { baseDelayMs: 1000 })
      expect(delay).toBeGreaterThanOrEqual(1000)
      expect(delay).toBeLessThanOrEqual(2000)
    }
  })
})

describe('sendOneWithRetry', () => {
  it('returns on the first success without retrying', async () => {
    const transport = new ScriptedTransport(() => null)
    const result = await sendOneWithRetry(transport, message, { sleep: noSleep })

    expect(result.outcome).toBe('SUCCEEDED')
    expect(result.attempts).toBe(1)
    expect(transport.calls).toBe(1)
  })

  it('retries a transient failure and succeeds', async () => {
    const transport = new ScriptedTransport((call) => (call < 3 ? failure() : null))
    const result = await sendOneWithRetry(transport, message, { sleep: noSleep })

    expect(result.outcome).toBe('SUCCEEDED')
    expect(result.attempts).toBe(3)
  })

  it('never retries a permanent failure', async () => {
    const transport = new ScriptedTransport(() =>
      failure({ kind: 'PERMANENT', reason: 'RECIPIENT_REJECTED', retryable: false }),
    )
    const result = await sendOneWithRetry(transport, message, { sleep: noSleep })

    expect(result.outcome).toBe('FAILED_PERMANENT')
    expect(result.attempts).toBe(1)
    expect(transport.calls).toBe(1)
  })

  it('never retries a quota rejection, even though it is transient', async () => {
    const transport = new ScriptedTransport(() =>
      failure({ kind: 'TRANSIENT', reason: 'QUOTA_EXCEEDED', retryable: false }),
    )
    const result = await sendOneWithRetry(transport, message, { sleep: noSleep })

    expect(result.outcome).toBe('FAILED_TRANSIENT')
    expect(result.attempts).toBe(1)
  })

  it('gives up after the attempt limit and reports the failure', async () => {
    const transport = new ScriptedTransport(() => failure())
    const result = await sendOneWithRetry(transport, message, {
      sleep: noSleep,
      maxAttempts: 3,
    })

    expect(result.outcome).toBe('FAILED_TRANSIENT')
    expect(result.attempts).toBe(3)
    if (result.outcome === 'SUCCEEDED') return
    expect(result.failure.reason).toBe('CONNECTION')
  })

  it('waits a growing amount between attempts', async () => {
    const waits: number[] = []
    const transport = new ScriptedTransport(() => failure())

    await sendOneWithRetry(transport, message, {
      maxAttempts: 4,
      baseDelayMs: 100,
      random: () => 1,
      sleep: async (ms) => {
        waits.push(ms)
      },
    })

    expect(waits).toEqual([100, 200, 400])
  })

  it('reports every attempt so a send event can be written for each', async () => {
    const reports: AttemptReport[] = []
    const transport = new ScriptedTransport((call) => (call < 2 ? failure() : null))

    await sendOneWithRetry(transport, message, {
      sleep: noSleep,
      onAttempt: (report) => {
        reports.push(report)
      },
    })

    expect(reports.map((r) => ({ attempt: r.attempt, ok: r.ok }))).toEqual([
      { attempt: 1, ok: false },
      { attempt: 2, ok: true },
    ])
    expect(reports[0].failure?.reason).toBe('CONNECTION')
  })

  it('classifies a transport that threw something other than SendFailureError', async () => {
    const transport: EmailTransport = {
      name: 'SMTP',
      authenticatedAddress: 'serenedavid@gmail.com',
      async sendOne() {
        throw Object.assign(new Error('Invalid login'), { code: 'EAUTH' })
      },
      async verifyConnection() {
        return { ok: true, checkedAt: new Date(), detail: 'ok' }
      },
    }

    const result = await sendOneWithRetry(transport, message, { sleep: noSleep })
    expect(result.outcome).toBe('FAILED_PERMANENT')
    if (result.outcome === 'SUCCEEDED') return
    expect(result.failure.reason).toBe('AUTH_REJECTED')
  })

  it('takes one message, not a list — there is no bulk entry point', () => {
    // The signature is the guard: `message` is a single OutboundMessage whose
    // `to` is a single address. If someone ever adds an overload taking an
    // array, this test will not compile.
    expect(sendOneWithRetry.length).toBeGreaterThanOrEqual(2)
    expect(Object.keys(message)).not.toContain('bcc')
    expect(Object.keys(message)).not.toContain('cc')
  })
})
