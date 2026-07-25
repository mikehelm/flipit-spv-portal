import { inspect } from 'node:util'
import { describe, expect, it } from 'vitest'
import { SmtpCredential } from './credentials'
import {
  SMTP_HOST,
  SMTP_PORT,
  SmtpTransport,
  type SmtpClient,
  type SmtpClientOptions,
  type SmtpSendInfo,
  type SmtpSendOptions,
} from './smtp'
import { SendFailureError, type OutboundMessage } from './types'

const APP_PASSWORD = 'abcdefghijklmnop'
const USER = 'serenedavid@gmail.com'

class FakeClient implements SmtpClient {
  readonly sent: SmtpSendOptions[] = []
  verifyCalls = 0
  verifyError: unknown = null
  sendError: unknown = null
  info: SmtpSendInfo = { response: '250 2.0.0 OK  1721908800 abc.12 - gsmtp' }

  async verify(): Promise<boolean> {
    this.verifyCalls += 1
    if (this.verifyError) throw this.verifyError
    return true
  }

  async sendMail(options: SmtpSendOptions): Promise<SmtpSendInfo> {
    if (this.sendError) throw this.sendError
    this.sent.push(options)
    return this.info
  }
}

function build(configure?: (client: FakeClient) => void) {
  const client = new FakeClient()
  configure?.(client)
  let seen: SmtpClientOptions | undefined

  const transport = new SmtpTransport(new SmtpCredential(USER, APP_PASSWORD), {
    createClient: (options) => {
      seen = options
      return client
    },
    now: () => new Date('2026-07-25T12:00:00.000Z'),
    randomHex: () => 'deadbeef',
  })

  return { transport, client, options: () => seen }
}

/** Runs `fn`, asserts it failed, and hands back the classified failure. */
async function captureFailure(fn: () => Promise<unknown>): Promise<SendFailureError> {
  try {
    await fn()
  } catch (error) {
    if (error instanceof SendFailureError) return error
    throw error
  }
  throw new Error('Expected the send to fail, but it succeeded.')
}

const message: OutboundMessage = {
  to: 'investor@example.com',
  fromName: 'David Serene',
  subject: 'An opportunity to participate',
  html: '<p>Hello</p>',
  text: 'Hello',
}

describe('connection settings — §8.1', () => {
  it('uses smtp.gmail.com on 587 with STARTTLS, never implicit TLS', async () => {
    const { transport, options } = build()
    await transport.verifyConnection()

    const used = options()
    expect(used?.host).toBe(SMTP_HOST)
    expect(used?.host).toBe('smtp.gmail.com')
    expect(used?.port).toBe(SMTP_PORT)
    expect(used?.port).toBe(587)
    // secure:false + requireTLS:true is STARTTLS. secure:true would be 465.
    expect(used?.secure).toBe(false)
    expect(used?.requireTLS).toBe(true)
    expect(used?.tls.minVersion).toBe('TLSv1.2')
  })

  it('does not pool connections — sending is one message at a time', async () => {
    const { transport, options } = build()
    await transport.verifyConnection()
    expect(options()?.pool).toBe(false)
  })

  it('reports the authenticated address for the dashboard', () => {
    const { transport } = build()
    expect(transport.authenticatedAddress).toBe(USER)
  })
})

describe('verifyConnection — authenticates without sending', () => {
  it('calls verify and sends nothing', async () => {
    const { transport, client } = build()
    const result = await transport.verifyConnection()

    expect(result.ok).toBe(true)
    expect(client.verifyCalls).toBe(1)
    expect(client.sent).toHaveLength(0)
    expect(result.detail).toMatch(/nothing was sent/i)
  })

  it('returns a failure rather than throwing when authentication is rejected', async () => {
    const { transport } = build((client) => {
      client.verifyError = Object.assign(new Error('Invalid login'), {
        code: 'EAUTH',
        responseCode: 535,
        response: '535-5.7.8 Username and Password not accepted.',
      })
    })

    const result = await transport.verifyConnection()
    expect(result.ok).toBe(false)
    expect(result.failure?.reason).toBe('AUTH_REJECTED')
    expect(result.failure?.kind).toBe('PERMANENT')
    expect(result.detail).toMatch(/rejected the app password/i)
  })
})

describe('sendOne', () => {
  it('sets a Message-ID and returns it', async () => {
    const { transport, client } = build()
    const result = await transport.sendOne(message)

    expect(client.sent[0].messageId).toBe(result.messageId)
    expect(result.messageId).toBe(
      `<deadbeef.${new Date('2026-07-25T12:00:00.000Z').getTime()}@gmail.com>`,
    )
    expect(result.messageId).toMatch(/^<[a-f0-9]+\.\d+@gmail\.com>$/)
    expect(result.recipient).toBe('investor@example.com')
  })

  it('prefers the id the server acknowledged when it differs', async () => {
    const { transport } = build((client) => {
      client.info = { messageId: 'server-chosen@mail.gmail.com', response: '250 OK' }
    })
    const result = await transport.sendOne(message)
    expect(result.messageId).toBe('<server-chosen@mail.gmail.com>')
  })

  it('sends both the HTML and the plain-text part — §11.5', async () => {
    const { transport, client } = build()
    await transport.sendOne(message)
    expect(client.sent[0].html).toBe('<p>Hello</p>')
    expect(client.sent[0].text).toBe('Hello')
  })

  it('honours In-Reply-To and builds the References chain so replies thread', async () => {
    const { transport, client } = build()
    const result = await transport.sendOne({
      ...message,
      inReplyTo: 'parent@gmail.com',
      references: ['<grandparent@gmail.com>'],
    })

    expect(client.sent[0].inReplyTo).toBe('<parent@gmail.com>')
    expect(client.sent[0].references).toEqual(['<grandparent@gmail.com>', '<parent@gmail.com>'])
    expect(result.inReplyTo).toBe('<parent@gmail.com>')
  })

  it('sends as the authenticated address with an editable display name — §14', async () => {
    const { transport, client } = build()
    await transport.sendOne({ ...message, fromName: 'David Serene' })
    expect(client.sent[0].from).toBe(`"David Serene" <${USER}>`)
  })

  it('refuses a From address that is not the authenticated account', async () => {
    const { transport } = build()
    await expect(
      transport.sendOne({ ...message, fromAddress: 'someone.else@gmail.com' }),
    ).rejects.toThrow(/does not match the authenticated sending account/i)
  })

  it('accepts a From address that matches, ignoring case', async () => {
    const { transport } = build()
    await expect(
      transport.sendOne({ ...message, fromAddress: 'SereneDavid@Gmail.com' }),
    ).resolves.toBeDefined()
  })

  it('rejects a malformed recipient at the boundary', async () => {
    const { transport } = build()
    await expect(transport.sendOne({ ...message, to: 'not-an-address' })).rejects.toThrow(
      /not a valid email address/i,
    )
  })

  it('rejects a message with no plain-text part', async () => {
    const { transport } = build()
    await expect(transport.sendOne({ ...message, text: '' })).rejects.toThrow(
      /plain-text part is required/i,
    )
  })

  it('has no bulk path: a comma-separated recipient list is not an address', async () => {
    const { transport } = build()
    await expect(
      transport.sendOne({ ...message, to: 'a@example.com, b@example.com' }),
    ).rejects.toThrow(/not a valid email address/i)
  })

  it('exposes no method that takes more than one recipient', () => {
    const { transport } = build()
    const surface = new Set([
      ...Object.getOwnPropertyNames(Object.getPrototypeOf(transport)),
      ...Object.keys(transport),
    ])
    for (const name of surface) {
      expect(name).not.toMatch(/send(All|Many|Bulk|Batch)/i)
    }
  })

  it('blocks file and URL access when composing, so a template cannot read the disk', async () => {
    const { transport, client } = build()
    await transport.sendOne(message)
    expect(client.sent[0].disableFileAccess).toBe(true)
    expect(client.sent[0].disableUrlAccess).toBe(true)
  })
})

describe('failures are classified, not swallowed', () => {
  it('throws SendFailureError with a permanent classification for a rejected address', async () => {
    const { transport } = build((client) => {
      client.sendError = Object.assign(new Error('Recipient rejected'), {
        code: 'EENVELOPE',
        responseCode: 550,
        response: "550 5.1.1 The email account that you tried to reach does not exist.",
      })
    })

    const error = await captureFailure(() => transport.sendOne(message))
    expect(error).toBeInstanceOf(SendFailureError)
    expect(error.failure.kind).toBe('PERMANENT')
    expect(error.failure.reason).toBe('RECIPIENT_REJECTED')
    expect(error.failure.retryable).toBe(false)
  })

  it('classifies a connection drop as transient and retryable', async () => {
    const { transport } = build((client) => {
      client.sendError = Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' })
    })

    const error = await captureFailure(() => transport.sendOne(message))
    expect(error.failure.kind).toBe('TRANSIENT')
    expect(error.failure.retryable).toBe(true)
  })
})

describe('the credential never escapes', () => {
  it('is not reachable through JSON.stringify of the transport', () => {
    const { transport } = build()
    const serialised = JSON.stringify(transport)
    expect(serialised).not.toContain(APP_PASSWORD)
    expect(serialised).not.toContain(USER)
    expect(serialised).toContain('[redacted]')
  })

  it('is not reachable through console.log / util.inspect', () => {
    const { transport } = build()
    const inspected = inspect(transport, { depth: 10 })
    expect(inspected).not.toContain(APP_PASSWORD)
  })

  it('is not reachable through string interpolation', () => {
    const { transport } = build()
    expect(`${transport}`).not.toContain(APP_PASSWORD)
  })

  it('is not reachable through a serialised send result', async () => {
    const { transport } = build()
    const result = await transport.sendOne(message)
    expect(JSON.stringify(result)).not.toContain(APP_PASSWORD)
  })

  it('is scrubbed out of an error the server somehow echoed back', async () => {
    const { transport } = build((client) => {
      client.sendError = Object.assign(new Error('boom'), {
        responseCode: 535,
        response: `535 rejected credential ${APP_PASSWORD}`,
      })
    })

    const error = await captureFailure(() => transport.sendOne(message))
    expect(error.failure.message).not.toContain(APP_PASSWORD)
    expect(error.message).not.toContain(APP_PASSWORD)
    expect(JSON.stringify(error)).not.toContain(APP_PASSWORD)
  })

  it('is scrubbed out of a verification failure detail', async () => {
    const { transport } = build((client) => {
      client.verifyError = Object.assign(new Error(`auth failed for ${APP_PASSWORD}`), {
        code: 'EAUTH',
      })
    })

    const result = await transport.verifyConnection()
    expect(result.detail).not.toContain(APP_PASSWORD)
    expect(JSON.stringify(result)).not.toContain(APP_PASSWORD)
  })
})
