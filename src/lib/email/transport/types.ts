import { z } from 'zod'

/**
 * The transport boundary. BUILD_SPEC §8.1, §14.
 *
 * "Implement sending behind an `EmailTransport` interface. Ship `SmtpTransport`
 * as the working implementation and `GmailApiTransport` as a substitutable
 * alternative selected by configuration. Do not scatter transport calls through
 * the codebase."
 *
 * There is exactly one send method and it takes exactly one recipient. That is
 * not an oversight and it is not a starting point for a `sendMany`:
 *
 *   §14 — "Do not build a Send All / bulk send. Sending is deliberately one
 *   recipient at a time so the operator reads each email before it goes; this
 *   is a decision, not an omission."
 *
 * `to` is a single string, never an array, and there are no `cc` or `bcc`
 * fields anywhere in this file. Making bulk send impossible at the type level
 * is cheaper than remembering not to write it.
 */

// ---------------------------------------------------------------------------
// The message
// ---------------------------------------------------------------------------

/**
 * Both parts are mandatory. §11.5: "Plain-text multipart alternative is
 * mandatory, and must carry the same information."
 */
export const outboundMessageSchema = z.object({
  /** One address. One. */
  to: z.email('The recipient address is not a valid email address.'),
  /** Display name on the From header. §14 — the address is fixed, the name is editable. */
  fromName: z.string().trim().min(1, 'A sender display name is required.').max(120),
  /**
   * Optional, and if supplied it must equal the authenticated account. Gmail
   * will not send as anyone else and silently rewriting the header would be a
   * lie in the investor's copy of the email.
   */
  fromAddress: z.email().optional(),
  replyTo: z.email().optional(),
  subject: z.string().trim().min(1, 'A subject line is required.').max(255),
  html: z.string().min(1, 'The HTML part is required.'),
  text: z.string().min(1, 'The plain-text part is required — see §11.5.'),
  /** §14: honoured so replies thread. */
  inReplyTo: z.string().trim().min(1).optional(),
  references: z.array(z.string().trim().min(1)).optional(),
})

export type OutboundMessage = z.infer<typeof outboundMessageSchema>

export interface SendResult {
  /** The Message-ID this application set and must record. §14. */
  messageId: string
  /** The address the message went to. One address. */
  recipient: string
  /** What the transport was asked to thread onto, if anything. */
  inReplyTo: string | null
  /** Non-secret server response line, scrubbed. Useful in a send event. */
  response: string | null
  sentAt: Date
}

// ---------------------------------------------------------------------------
// Verification
// ---------------------------------------------------------------------------

export interface VerifyResult {
  ok: boolean
  checkedAt: Date
  /** Operator-facing, specific, never containing a credential. */
  detail: string
  /** Present when the check failed. */
  failure?: SendFailure
}

// ---------------------------------------------------------------------------
// Failure classification — §14
// ---------------------------------------------------------------------------

export type FailureKind = 'PERMANENT' | 'TRANSIENT'

export type SendFailureReason =
  | 'AUTH_REJECTED'
  | 'RECIPIENT_REJECTED'
  | 'SENDER_REJECTED'
  | 'MESSAGE_REJECTED'
  | 'QUOTA_EXCEEDED'
  | 'RATE_LIMITED'
  | 'SERVER_BUSY'
  | 'CONNECTION'
  | 'TIMEOUT'
  | 'TLS'
  | 'UNCLASSIFIED'

export interface SendFailure {
  kind: FailureKind
  reason: SendFailureReason
  /**
   * Whether trying the same message again, shortly, could plausibly work.
   * Not the same as `kind`: a Gmail daily quota rejection is transient in the
   * sense that it will clear, and not retryable in the sense that retrying in
   * four seconds cannot possibly help.
   */
  retryable: boolean
  /** Transport library code, e.g. `EAUTH`. Null when there was none. */
  code: string | null
  /** SMTP response code, e.g. 535. Null when there was none. */
  responseCode: number | null
  /** What to tell the operator. Specific, never generic, never a credential. */
  message: string
}

/** The `send_events.outcome` enum values, so callers map straight across. */
export type SendOutcome = 'SUCCEEDED' | 'FAILED_TRANSIENT' | 'FAILED_PERMANENT'

export function outcomeFor(failure: SendFailure): Extract<SendOutcome, 'FAILED_TRANSIENT' | 'FAILED_PERMANENT'> {
  return failure.kind === 'PERMANENT' ? 'FAILED_PERMANENT' : 'FAILED_TRANSIENT'
}

/** Thrown by a transport's `sendOne` when the send did not succeed. */
export class SendFailureError extends Error {
  readonly failure: SendFailure

  constructor(failure: SendFailure) {
    super(failure.message)
    this.name = 'SendFailureError'
    this.failure = failure
  }

  /** Belt and braces: an error is the thing most likely to be logged whole. */
  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      kind: this.failure.kind,
      reason: this.failure.reason,
      code: this.failure.code,
      responseCode: this.failure.responseCode,
      message: this.failure.message,
    }
  }
}

/** Thrown when the selected transport cannot be used at all. */
export class TransportNotConfiguredError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TransportNotConfiguredError'
  }
}

// ---------------------------------------------------------------------------
// The interface
// ---------------------------------------------------------------------------

export type TransportName = 'SMTP' | 'GMAIL_API'

export interface EmailTransport {
  readonly name: TransportName
  /**
   * The address mail actually goes out as. §14 — shown before sending, and on
   * the dashboard as part of connection health (§8.1).
   */
  readonly authenticatedAddress: string | null

  /**
   * Send to ONE recipient. Throws `SendFailureError` on failure.
   *
   * There is no counterpart that takes a list. See the file header.
   */
  sendOne(message: OutboundMessage): Promise<SendResult>

  /**
   * Authenticate WITHOUT sending. §8.1: "Provide a 'test connection' action
   * that authenticates against SMTP without sending."
   *
   * Never throws — a failed check is a result, not an exception.
   */
  verifyConnection(): Promise<VerifyResult>
}
