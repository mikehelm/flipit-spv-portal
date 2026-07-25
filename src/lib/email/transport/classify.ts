import { scrubSecrets, type Secret } from './secret'
import type { SendFailure, SendFailureReason } from './types'

/**
 * Turning whatever the SMTP library threw into something the operator can act
 * on. BUILD_SPEC §14:
 *
 *   "Distinguish permanent failures (invalid address) from transient ones and
 *   surface them differently."
 *
 * Two axes, and they are not the same axis:
 *
 *   `kind`      PERMANENT — this message will never be accepted as it stands.
 *               TRANSIENT — the failure is about conditions, not the message.
 *
 *   `retryable` whether trying again in a few seconds could plausibly work.
 *
 * A Gmail daily-quota rejection is TRANSIENT and NOT retryable: it clears
 * tomorrow, and hammering it now achieves nothing except more rejections.
 *
 * An error we cannot classify is TRANSIENT and NOT retryable, which is the
 * conservative reading. Calling it permanent would tell the operator a message
 * definitely did not arrive when it might have; retrying it might send the
 * same investor the same securities offer twice. Neither is acceptable, so an
 * unrecognised failure stops and asks for a human.
 */

interface SmtpErrorShape {
  message?: unknown
  code?: unknown
  command?: unknown
  responseCode?: unknown
  response?: unknown
  errno?: unknown
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null
}

function readNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/** Everything the server said, lower-cased, for pattern matching only. */
function haystack(error: SmtpErrorShape): string {
  return [readString(error.response), readString(error.message)]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
}

const AUTH_CODES = new Set(['EAUTH'])
const CONNECTION_CODES = new Set([
  'ECONNECTION',
  'ECONNREFUSED',
  'ECONNRESET',
  'EPIPE',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'EDNS',
  'ENOTFOUND',
  'EAI_AGAIN',
  'ESOCKET',
  'ESTREAM',
])
const TIMEOUT_CODES = new Set(['ETIMEDOUT', 'ETIME', 'ETIMEOUT'])
const TLS_CODES = new Set(['ETLS', 'ESECURITY'])

/** 530/534/535 are all "we did not accept who you say you are". */
const AUTH_RESPONSE_CODES = new Set([530, 534, 535])

/** Quota, as opposed to a genuinely permanent rejection, despite the 5xx. */
const QUOTA_PATTERNS = [
  /daily user sending (limit|quota) exceeded/,
  /5\.4\.5/,
  /quota exceeded/,
  /message rate exceeded/,
]

const RATE_PATTERNS = [
  /try again later/,
  /too many (messages|recipients|connections)/,
  /rate limit/,
  /4\.7\.0/,
  /unusual (rate|amount) of/,
]

const AUTH_PATTERNS = [
  /username and password not accepted/,
  /invalid credentials/,
  /authentication (failed|required|unsuccessful)/,
  /application-specific password required/,
  /5\.7\.(8|9|14)/,
]

function matches(text: string, patterns: readonly RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text))
}

interface Classified {
  reason: SendFailureReason
  kind: SendFailure['kind']
  retryable: boolean
  message: string
}

/**
 * Operator-facing text. Every branch names the actual problem and what to do
 * about it — CODEX_TASKS conventions: "a generic 'something went wrong' on a
 * blocked send is a bug".
 */
function describe(reason: SendFailureReason, detail: string | null): string {
  const tail = detail ? ` The server said: ${detail}` : ''
  switch (reason) {
    case 'AUTH_REJECTED':
      return (
        'The sending account rejected the app password. It is wrong, it has been revoked, ' +
        'or 2-Step Verification is no longer on for that Google account. Generate a fresh ' +
        'app password and reconnect the sending account — nothing will send until you do.' +
        tail
      )
    case 'RECIPIENT_REJECTED':
      return (
        'The recipient address was rejected by the mail server. It does not exist, it is ' +
        'mistyped, or that mailbox will not accept mail. Correct the address on the record ' +
        'before trying again — resending as it stands will fail identically.' + tail
      )
    case 'SENDER_REJECTED':
      return (
        'The sending address was rejected. Mail can only go out as the account the app ' +
        'password belongs to. Check the sending account in operator onboarding.' + tail
      )
    case 'MESSAGE_REJECTED':
      return (
        'The message itself was rejected — its size or content was refused, not the ' +
        'address. This will not resolve by retrying.' + tail
      )
    case 'QUOTA_EXCEEDED':
      return (
        "The sending account's daily limit has been reached. Personal Gmail allows roughly " +
        '500 recipients a day. Nothing further will send until the limit resets; this is not ' +
        'retried automatically because retrying now cannot help.' + tail
      )
    case 'RATE_LIMITED':
      return (
        'The mail server asked us to slow down. This is temporary and the send will be ' +
        'retried with a delay.' + tail
      )
    case 'SERVER_BUSY':
      return (
        'The mail server was not ready to take the message. This is temporary and the send ' +
        'will be retried with a delay.' + tail
      )
    case 'CONNECTION':
      return (
        'Could not reach smtp.gmail.com. This is a network problem, not a problem with the ' +
        'message, and the send will be retried with a delay.' + tail
      )
    case 'TIMEOUT':
      return (
        'The mail server did not respond in time. The send will be retried with a delay.' + tail
      )
    case 'TLS':
      return (
        'The encrypted connection to smtp.gmail.com could not be established. Nothing was ' +
        'sent in clear text — the connection was abandoned instead.' + tail
      )
    case 'UNCLASSIFIED':
      return (
        'The send failed for a reason this application does not recognise, so it has stopped ' +
        'rather than guessed. Check the sending account\'s Sent folder before resending — ' +
        'the message may have gone out even though the failure was reported.' + tail
      )
  }
}

function classifyCore(error: SmtpErrorShape): Omit<Classified, 'message'> {
  const code = readString(error.code)?.toUpperCase() ?? null
  const responseCode = readNumber(error.responseCode)
  const text = haystack(error)
  const command = readString(error.command)?.toUpperCase() ?? null

  // Quota first: Gmail reports it with a 5xx, which any generic rule would
  // read as permanent. It is not — it clears.
  if (matches(text, QUOTA_PATTERNS)) {
    return { reason: 'QUOTA_EXCEEDED', kind: 'TRANSIENT', retryable: false }
  }

  if (code && AUTH_CODES.has(code)) {
    return { reason: 'AUTH_REJECTED', kind: 'PERMANENT', retryable: false }
  }
  if (responseCode !== null && AUTH_RESPONSE_CODES.has(responseCode)) {
    return { reason: 'AUTH_REJECTED', kind: 'PERMANENT', retryable: false }
  }
  if (matches(text, AUTH_PATTERNS)) {
    return { reason: 'AUTH_REJECTED', kind: 'PERMANENT', retryable: false }
  }

  if (code && TIMEOUT_CODES.has(code)) {
    return { reason: 'TIMEOUT', kind: 'TRANSIENT', retryable: true }
  }
  if (code && CONNECTION_CODES.has(code)) {
    return { reason: 'CONNECTION', kind: 'TRANSIENT', retryable: true }
  }
  if (code && TLS_CODES.has(code)) {
    return { reason: 'TLS', kind: 'TRANSIENT', retryable: true }
  }

  if (responseCode === 421) {
    return { reason: 'SERVER_BUSY', kind: 'TRANSIENT', retryable: true }
  }

  if (matches(text, RATE_PATTERNS)) {
    return { reason: 'RATE_LIMITED', kind: 'TRANSIENT', retryable: true }
  }

  if (responseCode !== null && responseCode >= 400 && responseCode < 500) {
    return { reason: 'RATE_LIMITED', kind: 'TRANSIENT', retryable: true }
  }

  if (responseCode !== null && responseCode >= 500 && responseCode < 600) {
    // Which 5xx? The command tells us whose fault it is.
    if (command === 'MAIL FROM' || command === 'MAIL') {
      return { reason: 'SENDER_REJECTED', kind: 'PERMANENT', retryable: false }
    }
    if (command === 'DATA' || command === 'DATA_END' || command === '.') {
      return { reason: 'MESSAGE_REJECTED', kind: 'PERMANENT', retryable: false }
    }
    return { reason: 'RECIPIENT_REJECTED', kind: 'PERMANENT', retryable: false }
  }

  // `EENVELOPE` with no usable response code still means an address was
  // refused; nodemailer raises it when no recipient survived.
  if (code === 'EENVELOPE') {
    return { reason: 'RECIPIENT_REJECTED', kind: 'PERMANENT', retryable: false }
  }
  if (code === 'EMESSAGE') {
    return { reason: 'MESSAGE_REJECTED', kind: 'PERMANENT', retryable: false }
  }

  return { reason: 'UNCLASSIFIED', kind: 'TRANSIENT', retryable: false }
}

export interface ClassifyOptions {
  /** Scrubbed out of any text kept from the error. */
  secrets?: readonly (string | Secret | null | undefined)[]
}

export function classifySendError(error: unknown, options: ClassifyOptions = {}): SendFailure {
  const shape: SmtpErrorShape =
    typeof error === 'object' && error !== null ? (error as SmtpErrorShape) : {}

  const core = classifyCore(shape)
  const secrets = options.secrets ?? []

  const rawDetail = readString(shape.response) ?? readString(shape.message)
  const detail = rawDetail ? scrubSecrets(rawDetail, secrets).slice(0, 300) : null

  return {
    kind: core.kind,
    reason: core.reason,
    retryable: core.retryable,
    code: readString(shape.code)?.toUpperCase() ?? null,
    responseCode: readNumber(shape.responseCode),
    message: scrubSecrets(describe(core.reason, detail), secrets),
  }
}
