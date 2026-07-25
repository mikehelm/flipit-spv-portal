import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { serviceConfig } from '@/db/schema'
import { audit, type Actor } from '@/lib/audit'
import { readServiceConfig, SERVICE_CONFIG_ID } from '@/lib/auth/service-config'
import { readSmtpCredential } from './credentials'
import { GmailApiTransport } from './gmail-api'
import { assertCanSend, type SendGuardConfig, type SendIntent } from './guard'
import { sendOneWithRetry, type RetryOptions, type SendAttemptResult } from './retry'
import { SmtpTransport, type SmtpTransportDeps } from './smtp'
import {
  TransportNotConfiguredError,
  type EmailTransport,
  type OutboundMessage,
} from './types'
import { encodeVerifyResult } from './verify-result'

/**
 * The single way into sending. BUILD_SPEC §8.1: "Do not scatter transport calls
 * through the codebase."
 *
 * Nothing outside this directory constructs a transport, and nothing outside
 * this directory decides whether a send is allowed. There is one send function
 * and it takes one recipient (§14).
 */

export interface TransportSelectionConfig {
  emailTransport: 'SMTP' | 'GMAIL_API'
  smtpUserEncrypted: string | null
  smtpPasswordEncrypted: string | null
}

/**
 * Select the transport by configuration. §8.1: "Store the active transport in
 * configuration so the state is never ambiguous."
 *
 * Throws rather than falling back. A silent fallback from a transport someone
 * deliberately selected to a different one is exactly the ambiguity the spec
 * is asking to avoid.
 */
export function getTransport(
  config: TransportSelectionConfig,
  deps: SmtpTransportDeps = {},
): EmailTransport {
  if (config.emailTransport === 'GMAIL_API') {
    return new GmailApiTransport()
  }

  const credential = readSmtpCredential(config)
  if (!credential) {
    throw new TransportNotConfiguredError(
      'No sending credential is stored, so no transport can be built. Connect the sending ' +
        'Gmail account with a Google app password in operator onboarding step 3.',
    )
  }

  return new SmtpTransport(credential, deps)
}

/** The same, reading the configuration singleton. */
export async function getConfiguredTransport(
  deps: SmtpTransportDeps = {},
): Promise<EmailTransport> {
  return getTransport(await readServiceConfig(), deps)
}

// ---------------------------------------------------------------------------
// Verification — §8.1, recorded to service_config
// ---------------------------------------------------------------------------

export interface VerifyOutcome {
  ok: boolean
  checkedAt: Date
  /** Operator-facing. Specific. Never contains a credential. */
  detail: string
  authenticatedAddress: string | null
}

/**
 * Authenticate without sending, and record the result and the timestamp to
 * `service_config.smtp_last_verified_at` / `smtp_last_verify_result` (§8.1).
 *
 * The result is written whether it passed or failed. A failed check that is not
 * recorded is worse than no check: the guard would go on trusting a stale pass.
 */
export async function verifyMailConnection(options: {
  actor: Actor
}): Promise<VerifyOutcome> {
  const config = await readServiceConfig()
  const checkedAt = new Date()

  let transport: EmailTransport
  try {
    transport = getTransport(config)
  } catch (error) {
    const detail =
      error instanceof TransportNotConfiguredError
        ? error.message
        : 'The sending account could not be read. Reconnect it with a fresh app password.'

    await recordVerification(checkedAt, `FAILED_PERMANENT: ${detail}`)
    await audit({
      actor: options.actor,
      entityType: 'mail_connection',
      entityId: SERVICE_CONFIG_ID,
      action: 'mail_connection.verify_failed',
      metadata: { transport: config.emailTransport, reason: 'NOT_CONFIGURED' },
    })
    return { ok: false, checkedAt, detail, authenticatedAddress: null }
  }

  const result = await transport.verifyConnection()
  await recordVerification(result.checkedAt, encodeVerifyResult(result))

  await audit({
    actor: options.actor,
    entityType: 'mail_connection',
    entityId: SERVICE_CONFIG_ID,
    action: result.ok ? 'mail_connection.verified' : 'mail_connection.verify_failed',
    // The address and the app password are the credential and neither goes in
    // the log (§15). The failure REASON does, because that is the point of it.
    metadata: {
      transport: transport.name,
      ok: result.ok,
      reason: result.failure?.reason ?? null,
      responseCode: result.failure?.responseCode ?? null,
    },
  })

  return {
    ok: result.ok,
    checkedAt: result.checkedAt,
    detail: result.detail,
    authenticatedAddress: transport.authenticatedAddress,
  }
}

async function recordVerification(checkedAt: Date, encoded: string): Promise<void> {
  await db
    .update(serviceConfig)
    .set({ smtpLastVerifiedAt: checkedAt, smtpLastVerifyResult: encoded })
    .where(eq(serviceConfig.id, SERVICE_CONFIG_ID))
}

// ---------------------------------------------------------------------------
// Sending — one recipient, gated
// ---------------------------------------------------------------------------

export interface SendOneEmailInput {
  intent: SendIntent
  /** One message to one recipient. There is no list-shaped counterpart. */
  message: OutboundMessage
  /** Required for a TEST intent: the address a test is permitted to reach. */
  operatorEmail?: string | null
  /** When provided, the attempt is audited here as well as by the caller. */
  actor?: Actor
  retry?: RetryOptions
  transportDeps?: SmtpTransportDeps
  /** Pre-read configuration, to save a query when the caller already has it. */
  config?: SendGuardConfig & TransportSelectionConfig
  now?: Date
}

/**
 * Send one email, after the §8.1/§7/§18.1 gates.
 *
 * Throws `SendBlockedError` when a gate refuses — the reason is specific and
 * the caller should show it verbatim. Returns a result rather than throwing
 * for delivery failures, because the caller has to record the outcome against
 * the offer either way and `outcome` maps onto `send_events.outcome`.
 *
 * This does NOT check the compliance approval or the recipient's jurisdiction.
 * Those are a separate authority (§8.2) and a separate gate, and a caller that
 * skips them is not made safe by this one.
 */
export async function sendOneEmail(input: SendOneEmailInput): Promise<SendAttemptResult> {
  const config = input.config ?? (await readServiceConfig())

  try {
    assertCanSend({
      intent: input.intent,
      config,
      recipient: input.message.to,
      operatorEmail: input.operatorEmail ?? null,
      ...(input.now ? { now: input.now } : {}),
    })
  } catch (error) {
    if (input.actor) {
      await audit({
        actor: input.actor,
        entityType: 'email',
        action: 'email.blocked',
        metadata: {
          intent: input.intent,
          // §16: blocked attempts are logged WITH the blocking reason.
          reasons: hasReasonCodes(error) ? error.reasonCodes : ['UNKNOWN'],
        },
      })
    }
    throw error
  }

  const transport = getTransport(config, input.transportDeps ?? {})
  const result = await sendOneWithRetry(transport, input.message, input.retry ?? {})

  if (input.actor) {
    await audit({
      actor: input.actor,
      entityType: 'email',
      entityId: result.outcome === 'SUCCEEDED' ? result.result.messageId : null,
      action: result.outcome === 'SUCCEEDED' ? 'email.sent' : 'email.send_failed',
      // No subject, no HTML part, no text part. §15: never log an email body.
      metadata: {
        intent: input.intent,
        transport: transport.name,
        attempts: result.attempts,
        outcome: result.outcome,
        reason: result.outcome === 'SUCCEEDED' ? null : result.failure.reason,
      },
    })
  }

  return result
}

function hasReasonCodes(error: unknown): error is { reasonCodes: string[] } {
  return (
    typeof error === 'object' &&
    error !== null &&
    Array.isArray((error as { reasonCodes?: unknown }).reasonCodes)
  )
}

// ---------------------------------------------------------------------------

export { GmailApiTransport } from './gmail-api'
export { SmtpTransport, SMTP_HOST, SMTP_PORT } from './smtp'
export { SmtpCredential, readSmtpCredential } from './credentials'
export { Secret, scrubSecrets } from './secret'
export { classifySendError } from './classify'
export {
  assertCanSend,
  evaluateSendGuard,
  isVerificationStale,
  SendBlockedError,
  VERIFICATION_MAX_AGE_MS,
} from './guard'
export type {
  SendBlock,
  SendBlockReason,
  SendGuardConfig,
  SendGuardDecision,
  SendIntent,
} from './guard'
export {
  backoffDelayMs,
  sendOneWithRetry,
  DEFAULT_MAX_ATTEMPTS,
  type RetryOptions,
  type SendAttemptResult,
} from './retry'
export {
  describeMailConnection,
  readMailConnectionHealth,
  type MailConnectionHealth,
  type MailConnectionState,
} from './health'
export { encodeVerifyResult, parseVerifyResult } from './verify-result'
export { createMessageId, normaliseMessageId, buildReferences } from './message-id'
export {
  outboundMessageSchema,
  outcomeFor,
  SendFailureError,
  TransportNotConfiguredError,
} from './types'
export type {
  EmailTransport,
  OutboundMessage,
  SendFailure,
  SendOutcome,
  SendResult,
  TransportName,
  VerifyResult,
} from './types'
