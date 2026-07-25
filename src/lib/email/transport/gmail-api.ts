import {
  TransportNotConfiguredError,
  type EmailTransport,
  type OutboundMessage,
  type SendResult,
  type TransportName,
  type VerifyResult,
} from './types'

/**
 * The Gmail API transport — present, selectable, and deliberately not working.
 *
 * BUILD_SPEC §8.1: "Ship `SmtpTransport` as the working implementation and
 * `GmailApiTransport` as a substitutable alternative selected by
 * configuration."
 *
 * Why a stub rather than nothing: the decision recorded in §8.1 is that mail
 * goes over SMTP with an app password, and that Google "describes app passwords
 * as a transitional mechanism... This is why the transport stays swappable."
 * A swappable interface with exactly one implementation is not swappable; it
 * is an interface someone will collapse the first time it is inconvenient.
 * This class is what makes `service_config.email_transport` a real switch, and
 * the upgrade path in §8.1 a configuration change rather than a rewrite.
 *
 * It fails LOUDLY and specifically. Selecting it does not silently stop mail —
 * `assertCanSend` reports `TRANSPORT_UNAVAILABLE` before anything gets this
 * far, and if something does get here it says why in one sentence.
 *
 * Implementing it for real means: a Google Cloud project, an OAuth consent
 * screen, `https://www.googleapis.com/auth/gmail.send` and nothing broader
 * (any read scope moves the app into the restricted tier), and sensitive-scope
 * verification. §8.1 path B.
 */

const NOT_CONFIGURED =
  'The Gmail API transport is not configured. This build sends over Gmail SMTP with an app ' +
  'password (BUILD_SPEC §8.1); the Gmail API transport exists so the transport can be ' +
  'swapped by configuration later, and implementing it needs a Google Cloud project, the ' +
  'gmail.send scope and sensitive-scope verification. Set service_config.email_transport ' +
  'back to SMTP.'

export class GmailApiTransport implements EmailTransport {
  readonly name: TransportName = 'GMAIL_API'

  /** Nothing is authenticated, so there is no address to report. */
  readonly authenticatedAddress: string | null = null

  async sendOne(_message: OutboundMessage): Promise<SendResult> {
    throw new TransportNotConfiguredError(NOT_CONFIGURED)
  }

  /**
   * Does not throw — the contract is that a check reports a result. The result
   * is that this transport is not configured, which is exactly what the
   * dashboard should say.
   */
  async verifyConnection(): Promise<VerifyResult> {
    return {
      ok: false,
      checkedAt: new Date(),
      detail: NOT_CONFIGURED,
      failure: {
        kind: 'PERMANENT',
        reason: 'UNCLASSIFIED',
        retryable: false,
        code: 'ETRANSPORT',
        responseCode: null,
        message: NOT_CONFIGURED,
      },
    }
  }
}

export const GMAIL_API_NOT_CONFIGURED_MESSAGE = NOT_CONFIGURED
