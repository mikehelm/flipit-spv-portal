import { inspect } from 'node:util'
import nodemailer from 'nodemailer'
import { classifySendError } from './classify'
import type { SmtpCredential } from './credentials'
import { buildReferences, createMessageId, normaliseMessageId } from './message-id'
import { scrubSecrets } from './secret'
import {
  SendFailureError,
  outboundMessageSchema,
  type EmailTransport,
  type OutboundMessage,
  type SendResult,
  type TransportName,
  type VerifyResult,
} from './types'

/**
 * Gmail SMTP with an app password. BUILD_SPEC §8.1.
 *
 *   "Host `smtp.gmail.com`, port 587 with STARTTLS. Username is the full Gmail
 *   address; password is the 16-character app password."
 *
 * Port 587 with `secure: false` plus `requireTLS: true` is STARTTLS and only
 * STARTTLS: the connection opens in the clear, upgrades, and — because
 * `requireTLS` is set — is abandoned rather than continued if the upgrade
 * fails. There is no path through this file that puts a credential or a
 * message on an unencrypted socket.
 *
 * One recipient per call. There is no `sendMany` here and `to` is typed as a
 * single address (§14).
 */

export const SMTP_HOST = 'smtp.gmail.com'
export const SMTP_PORT = 587

/** Deliberately short. A send the operator is watching should fail fast. */
const CONNECTION_TIMEOUT_MS = 15_000
const GREETING_TIMEOUT_MS = 15_000
const SOCKET_TIMEOUT_MS = 30_000

// ---------------------------------------------------------------------------
// The minimum of nodemailer this file depends on
// ---------------------------------------------------------------------------

export interface SmtpClientOptions {
  host: string
  port: number
  secure: boolean
  requireTLS: boolean
  auth: { user: string; pass: string }
  connectionTimeout: number
  greetingTimeout: number
  socketTimeout: number
  pool: boolean
  tls: { minVersion: string; servername: string }
}

export interface SmtpSendOptions {
  from: string
  to: string
  replyTo?: string
  subject: string
  text: string
  html: string
  messageId: string
  inReplyTo?: string
  references?: string[]
  disableFileAccess: boolean
  disableUrlAccess: boolean
}

export interface SmtpSendInfo {
  messageId?: string
  response?: string
  accepted?: unknown[]
  rejected?: unknown[]
}

/** Structural, so a test can substitute a fake without a live server. */
export interface SmtpClient {
  verify(): Promise<unknown>
  sendMail(options: SmtpSendOptions): Promise<SmtpSendInfo>
  close?(): void
}

export type SmtpClientFactory = (options: SmtpClientOptions) => SmtpClient

/**
 * The one place nodemailer is touched. `SmtpClientOptions` is a deliberately
 * narrow, readable description of the connection this application makes, and
 * the cast is what keeps that description from being widened to whatever
 * nodemailer's option type happens to allow.
 */
const defaultFactory: SmtpClientFactory = (options) =>
  nodemailer.createTransport(
    options as unknown as Parameters<typeof nodemailer.createTransport>[0],
  ) as unknown as SmtpClient

export interface SmtpTransportDeps {
  createClient?: SmtpClientFactory
  now?: () => Date
  /** Injected so a Message-ID can be made deterministic in a test. */
  randomHex?: () => string
}

// ---------------------------------------------------------------------------

export class SmtpTransport implements EmailTransport {
  readonly name: TransportName = 'SMTP'

  readonly #credential: SmtpCredential
  readonly #createClient: SmtpClientFactory
  readonly #now: () => Date
  readonly #randomHex: (() => string) | undefined
  #client: SmtpClient | undefined

  constructor(credential: SmtpCredential, deps: SmtpTransportDeps = {}) {
    this.#credential = credential
    this.#createClient = deps.createClient ?? defaultFactory
    this.#now = deps.now ?? (() => new Date())
    this.#randomHex = deps.randomHex
  }

  /** §8.1 — the dashboard shows this. It is not written to any log. */
  get authenticatedAddress(): string {
    return this.#credential.user
  }

  /**
   * Nothing about this object may end up in a log line or a server-action
   * return value. The credential lives in a `#private` field, so this is the
   * second line of defence rather than the only one.
   */
  toJSON(): Record<string, unknown> {
    return { transport: 'SMTP', host: SMTP_HOST, port: SMTP_PORT, credential: '[redacted]' }
  }

  toString(): string {
    return 'SmtpTransport(smtp.gmail.com:587)'
  }

  [inspect.custom](): string {
    return this.toString()
  }

  #secrets(): readonly string[] {
    return [this.#credential.password.expose(), this.#credential.user]
  }

  #connect(): SmtpClient {
    if (!this.#client) {
      this.#client = this.#createClient({
        host: SMTP_HOST,
        port: SMTP_PORT,
        // false + requireTLS = STARTTLS on 587. `true` here would mean implicit
        // TLS on 465, which is a different port and not what §8.1 specifies.
        secure: false,
        requireTLS: true,
        auth: { user: this.#credential.user, pass: this.#credential.password.expose() },
        connectionTimeout: CONNECTION_TIMEOUT_MS,
        greetingTimeout: GREETING_TIMEOUT_MS,
        socketTimeout: SOCKET_TIMEOUT_MS,
        // No pooling. Sending is one message at a time by a human pressing a
        // button (§14); a connection pool exists to serve a firehose.
        pool: false,
        tls: { minVersion: 'TLSv1.2', servername: SMTP_HOST },
      })
    }
    return this.#client
  }

  /**
   * Authenticate without sending. §8.1: "a 'test connection' action that
   * authenticates against SMTP without sending".
   *
   * `verify()` opens the connection, does STARTTLS and AUTH, and stops. No
   * message is composed and no recipient is contacted.
   *
   * Never throws — the caller records a result either way.
   */
  async verifyConnection(): Promise<VerifyResult> {
    const checkedAt = this.#now()
    try {
      await this.#connect().verify()
      return {
        ok: true,
        checkedAt,
        detail: `Authenticated to ${SMTP_HOST}:${SMTP_PORT} over STARTTLS. Nothing was sent.`,
      }
    } catch (error) {
      const failure = classifySendError(error, { secrets: this.#secrets() })
      return { ok: false, checkedAt, detail: failure.message, failure }
    }
  }

  /**
   * Send to one recipient.
   *
   * Throws `SendFailureError` carrying a classified failure. Use
   * `sendOneWithRetry` if backoff is wanted.
   */
  async sendOne(rawMessage: OutboundMessage): Promise<SendResult> {
    // Zod at the boundary. A malformed message is a programming error here, not
    // a transport failure, so it throws rather than returning a send failure.
    const parsed = outboundMessageSchema.safeParse(rawMessage)
    if (!parsed.success) {
      throw new Error(
        'The message could not be sent because it is not a valid outbound message: ' +
          parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; '),
      )
    }
    const message = parsed.data

    // §14: "Show the authenticated sender address and an editable display
    // name." The address is not editable — Gmail sends as the authenticated
    // account whatever header we set, so accepting a different one would put a
    // false From address in the immutable snapshot the investor is shown.
    if (
      message.fromAddress &&
      message.fromAddress.trim().toLowerCase() !== this.#credential.user.toLowerCase()
    ) {
      throw new Error(
        'The From address does not match the authenticated sending account. Mail goes out as ' +
          'the account the app password belongs to; only the display name is editable. ' +
          'Change the sending account, or leave the From address unset.',
      )
    }

    const messageId = createMessageId(this.#credential.user, {
      now: () => this.#now().getTime(),
      ...(this.#randomHex ? { randomHex: this.#randomHex } : {}),
    })

    const inReplyTo = message.inReplyTo ? normaliseMessageId(message.inReplyTo) : undefined
    const references = buildReferences(inReplyTo, message.references)

    const options: SmtpSendOptions = {
      from: `"${message.fromName.replace(/"/g, "'")}" <${this.#credential.user}>`,
      to: message.to,
      subject: message.subject,
      // Both parts, always. §11.5 makes the text alternative mandatory, and
      // the schema will not let a message through without it.
      text: message.text,
      html: message.html,
      messageId,
      disableFileAccess: true,
      disableUrlAccess: true,
      ...(message.replyTo ? { replyTo: message.replyTo } : {}),
      ...(inReplyTo ? { inReplyTo } : {}),
      ...(references.length > 0 ? { references } : {}),
    }

    let info: SmtpSendInfo
    try {
      info = await this.#connect().sendMail(options)
    } catch (error) {
      throw new SendFailureError(classifySendError(error, { secrets: this.#secrets() }))
    }

    // Gmail can echo back a different id than the one we set. Record what the
    // server acknowledged if it gave us one, because that is what has to match
    // when a reply comes back in.
    const acknowledged =
      typeof info.messageId === 'string' && info.messageId.trim() !== ''
        ? normaliseMessageId(info.messageId)
        : messageId

    return {
      messageId: acknowledged,
      recipient: message.to,
      inReplyTo: inReplyTo ?? null,
      response:
        typeof info.response === 'string'
          ? scrubSecrets(info.response, this.#secrets()).slice(0, 300)
          : null,
      sentAt: this.#now(),
    }
  }

  /** Release the socket. Safe to call more than once. */
  close(): void {
    this.#client?.close?.()
    this.#client = undefined
  }
}
