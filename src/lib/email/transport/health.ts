import { readServiceConfig } from '@/lib/auth/service-config'
import { readSmtpCredential } from './credentials'
import { isVerificationStale, VERIFICATION_MAX_AGE_MS } from './guard'
import { parseVerifyResult } from './verify-result'

/**
 * Mail connection health for the dashboard. BUILD_SPEC §8.1:
 *
 *   "Show connection health on the admin dashboard: the authenticated address,
 *   when it was last verified, and the result of the most recent check."
 *
 * §12 puts it on the main screen rather than in settings, alongside the
 * compliance state, because "these are the two things that silently break a
 * send".
 *
 * The authenticated address is decrypted here and returned. That is a
 * deliberate exception to "never return a stored credential", made because the
 * spec asks for the address by name and an operator who cannot see which
 * account mail leaves from cannot tell that it is the wrong one. The app
 * PASSWORD is not decrypted, not returned, and has no code path to this
 * object. Callers must only render this to an authenticated administrator.
 */

export type MailConnectionState =
  | 'NOT_CONFIGURED'
  | 'NEVER_VERIFIED'
  | 'FAILED'
  | 'STALE'
  | 'HEALTHY'
  | 'TRANSPORT_UNAVAILABLE'

export interface MailConnectionHealth {
  transport: 'SMTP' | 'GMAIL_API'
  state: MailConnectionState
  /** The Gmail address mail goes out as. Null when nothing is connected. */
  authenticatedAddress: string | null
  host: string | null
  port: number | null
  lastVerifiedAt: Date | null
  lastVerifyOk: boolean | null
  lastVerifyDetail: string | null
  /** One line for the dashboard. Specific in every branch. */
  summary: string
}

export interface MailConnectionConfig {
  emailTransport: 'SMTP' | 'GMAIL_API'
  smtpUserEncrypted: string | null
  smtpPasswordEncrypted: string | null
  smtpLastVerifiedAt: Date | null
  smtpLastVerifyResult: string | null
}

export function describeMailConnection(
  config: MailConnectionConfig,
  now: Date = new Date(),
): MailConnectionHealth {
  const parsed = parseVerifyResult(config.smtpLastVerifyResult)

  const base = {
    transport: config.emailTransport,
    lastVerifiedAt: config.smtpLastVerifiedAt,
    lastVerifyOk: parsed?.ok ?? null,
    lastVerifyDetail: parsed?.detail ?? null,
  }

  if (config.emailTransport === 'GMAIL_API') {
    return {
      ...base,
      state: 'TRANSPORT_UNAVAILABLE',
      authenticatedAddress: null,
      host: null,
      port: null,
      summary:
        'The email transport is set to the Gmail API, which is not configured in this build. ' +
        'Nothing can send until it is set back to SMTP.',
    }
  }

  // A stored credential that will not decrypt throws, and this function is
  // called while rendering the dashboard. An unreadable credential must show
  // as a broken connection with a specific explanation, not as a 500 on the
  // page that exists to tell the operator what is broken.
  let credential: ReturnType<typeof readSmtpCredential> = null
  let decryptError: string | null = null
  try {
    credential =
      config.smtpUserEncrypted && config.smtpPasswordEncrypted
        ? readSmtpCredential(config)
        : null
  } catch (error) {
    decryptError = error instanceof Error ? error.message : 'The stored credential is unreadable.'
  }

  if (decryptError) {
    return {
      ...base,
      state: 'FAILED',
      authenticatedAddress: null,
      host: 'smtp.gmail.com',
      port: 587,
      summary: decryptError,
    }
  }

  const address = credential?.user ?? null

  if (!credential) {
    return {
      ...base,
      state: 'NOT_CONFIGURED',
      authenticatedAddress: null,
      host: 'smtp.gmail.com',
      port: 587,
      summary:
        'No sending account is connected. Connect one with a Google app password before any ' +
        'send is possible.',
    }
  }

  if (parsed === null || config.smtpLastVerifiedAt === null) {
    return {
      ...base,
      state: 'NEVER_VERIFIED',
      authenticatedAddress: address,
      host: 'smtp.gmail.com',
      port: 587,
      summary: `Connected as ${address}, never tested. Run "Test connection" — it authenticates without sending.`,
    }
  }

  if (!parsed.ok) {
    return {
      ...base,
      state: 'FAILED',
      authenticatedAddress: address,
      host: 'smtp.gmail.com',
      port: 587,
      summary: `The last connection test as ${address} failed. Sending is blocked. ${parsed.detail ?? ''}`.trim(),
    }
  }

  if (isVerificationStale(config.smtpLastVerifiedAt, now, VERIFICATION_MAX_AGE_MS)) {
    return {
      ...base,
      state: 'STALE',
      authenticatedAddress: address,
      host: 'smtp.gmail.com',
      port: 587,
      summary:
        `Connected as ${address}, last verified ${config.smtpLastVerifiedAt.toISOString()}. ` +
        'That is older than the pre-flight requires — test the connection again before sending.',
    }
  }

  return {
    ...base,
    state: 'HEALTHY',
    authenticatedAddress: address,
    host: 'smtp.gmail.com',
    port: 587,
    summary: `Connected and verified as ${address} over STARTTLS on smtp.gmail.com:587.`,
  }
}

export async function readMailConnectionHealth(now: Date = new Date()): Promise<MailConnectionHealth> {
  const config = await readServiceConfig()
  return describeMailConnection(config, now)
}
