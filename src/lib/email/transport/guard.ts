import { env } from '@/lib/env'
import { parseVerifyResult } from './verify-result'

/**
 * The gate. Nothing sends without passing through here.
 *
 * BUILD_SPEC §8.1: "Block sending when the credential is missing, rejected, or
 * has failed its most recent check — **with a specific message naming the
 * problem, not a generic failure**."
 *
 * That emphasis is the whole design of this file. There is no `false`, no
 * `null`, no thrown `Error('cannot send')`. Every refusal carries a machine
 * code AND a sentence that names the actual problem and says what to do about
 * it, because the person reading it is trying to send a securities offer and
 * "sending is unavailable" tells him nothing he can act on.
 *
 * The gates enforced here:
 *
 *   §8.1  credential missing · never verified · last verification failed ·
 *         verification gone stale (§19: "mail connection verified within the
 *         session") · a transport selected that cannot send
 *   §7    service mode must be ACTIVE
 *   §18.1 the deployment must be the production one, because portal links
 *         embed the domain and every link issued elsewhere dies on migration
 *
 * What is NOT enforced here, deliberately: the compliance approval and the
 * per-recipient jurisdiction gate (§8.2). Those are WP6's and they are a
 * separate authority — an approval is about whether this offer may lawfully be
 * communicated, not about whether the mail server will take it. Both gates
 * apply; neither substitutes for the other.
 */

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

/**
 * Three intents, and the difference between them is exactly what the spec
 * carves out for test sends:
 *
 *   §7   "Test sends to the operator remain available."
 *   §8.2 "Test sends to the operator's own address remain available so the
 *        template can be prepared while approval is pending."
 *   §18.1 "Test sends to David's own address only."
 *
 * So TEST is exempt from the service-mode and production-deployment gates —
 * and pays for that exemption by having to prove the recipient is the
 * operator's own address. It is never exempt from needing a working
 * credential: there is nothing to test with.
 */
export type SendIntent = 'INVITATION' | 'REMINDER' | 'NOTIFICATION' | 'REPLY' | 'TEST'

/** The subset of `service_config` this gate reads, plus one thing beside it. */
export interface SendGuardConfig {
  serviceMode: 'ACTIVE' | 'READ_ONLY' | 'SUNSET' | 'DISABLED'
  emailTransport: 'SMTP' | 'GMAIL_API'
  smtpUserEncrypted: string | null
  smtpPasswordEncrypted: string | null
  smtpLastVerifiedAt: Date | null
  smtpLastVerifyResult: string | null
  /**
   * Whether the operator's account has TOTP two-factor switched on.
   * BUILD_SPEC §2.2: *"mandatory before the production deployment sends
   * anything real."*
   *
   * It is on `users`, not on `service_config`, and it is here anyway because
   * this is the gate and a gate that has to be told separately is a gate
   * somebody forgets to tell. **Required, not optional** — so a new call site
   * has to state it rather than inherit a default that might be the wrong one.
   *
   * The operator's account rather than the acting user's, because the
   * scheduled sends — reminders, notifications — have no acting user, and
   * because §2.2 names the stake as *"the ability to send mail as the
   * operator"*. It is the operator's mailbox every one of these leaves from.
   */
  operatorTwoFactorEnrolled: boolean
}

export interface SendGuardInput {
  intent: SendIntent
  config: SendGuardConfig
  /** TEST only: where the test is going, and the operator's own address. */
  recipient?: string | null
  operatorEmail?: string | null
  now?: Date
  /** Defaults to `env().isProductionDeployment`. Overridable for tests. */
  isProductionDeployment?: boolean
}

// ---------------------------------------------------------------------------
// Reasons
// ---------------------------------------------------------------------------

export type SendBlockReason =
  | 'CREDENTIAL_MISSING'
  | 'TRANSPORT_UNAVAILABLE'
  | 'NEVER_VERIFIED'
  | 'VERIFICATION_FAILED'
  | 'VERIFICATION_STALE'
  | 'SERVICE_MODE_NOT_ACTIVE'
  | 'NOT_PRODUCTION_DEPLOYMENT'
  | 'SECOND_FACTOR_NOT_ENROLLED'
  | 'TEST_SEND_TO_OTHER_ADDRESS'

/**
 * Which refusal to show first when several apply. Ordered by what the operator
 * has to fix first: there is no point telling him the service mode is wrong if
 * there is no credential to send with.
 */
const REASON_PRIORITY: readonly SendBlockReason[] = [
  'CREDENTIAL_MISSING',
  'TRANSPORT_UNAVAILABLE',
  'NEVER_VERIFIED',
  'VERIFICATION_FAILED',
  'VERIFICATION_STALE',
  'SERVICE_MODE_NOT_ACTIVE',
  'NOT_PRODUCTION_DEPLOYMENT',
  'SECOND_FACTOR_NOT_ENROLLED',
  'TEST_SEND_TO_OTHER_ADDRESS',
]

export interface SendBlock {
  reason: SendBlockReason
  /** Specific. Names the problem and what to do. Never generic. */
  message: string
}

export type SendGuardDecision =
  | { allowed: true; intent: SendIntent }
  | {
      allowed: false
      intent: SendIntent
      /** Every reason that applies, so the dashboard can show all of them. */
      blocks: SendBlock[]
      primary: SendBlock
      /** All blocking messages, joined. What a caller shows if it shows one thing. */
      message: string
    }

/**
 * §19 pre-flight: "Mail connection verified within the session." A session is
 * not a thing this layer can see, so it is expressed as an age. Twelve hours
 * is long enough that the operator is not re-testing between two sends and
 * short enough that a credential revoked this morning cannot still be trusted
 * this evening.
 */
export const VERIFICATION_MAX_AGE_MS = 12 * 60 * 60 * 1000

export function isVerificationStale(
  verifiedAt: Date | null,
  now: Date,
  maxAgeMs: number = VERIFICATION_MAX_AGE_MS,
): boolean {
  if (!verifiedAt) return true
  return now.getTime() - verifiedAt.getTime() > maxAgeMs
}

function hoursSince(from: Date, now: Date): number {
  return Math.max(0, Math.round((now.getTime() - from.getTime()) / (60 * 60 * 1000)))
}

// ---------------------------------------------------------------------------
// The evaluation — pure, no database, no side effects
// ---------------------------------------------------------------------------

export function evaluateSendGuard(input: SendGuardInput): SendGuardDecision {
  const { intent, config } = input
  const now = input.now ?? new Date()
  const blocks: SendBlock[] = []

  const isTest = intent === 'TEST'

  // --- 1. The credential -----------------------------------------------------
  const credentialPresent =
    Boolean(config.smtpUserEncrypted) && Boolean(config.smtpPasswordEncrypted)

  if (!credentialPresent) {
    blocks.push({
      reason: 'CREDENTIAL_MISSING',
      message:
        'No sending credential is stored, so nothing can be sent. The operator has not yet ' +
        'connected the sending Gmail account, or it has been disconnected. Connect it in ' +
        'operator onboarding step 3 with a Google app password — app passwords require ' +
        '2-Step Verification to be switched on for that account first.',
    })
  }

  // --- 2. The transport ------------------------------------------------------
  if (config.emailTransport === 'GMAIL_API') {
    blocks.push({
      reason: 'TRANSPORT_UNAVAILABLE',
      message:
        'The configured transport is the Gmail API, which is not configured in this build. ' +
        'It exists as a substitutable alternative for the upgrade path in §8.1, not as a ' +
        'working sender. Set the email transport back to SMTP in service configuration.',
    })
  }

  // --- 3. Verification -------------------------------------------------------
  // Only meaningful once there is a credential to have verified.
  if (credentialPresent) {
    const parsed = parseVerifyResult(config.smtpLastVerifyResult)

    if (parsed === null || config.smtpLastVerifiedAt === null) {
      blocks.push({
        reason: 'NEVER_VERIFIED',
        message:
          'The sending connection has never been tested, so the app is not willing to assume ' +
          'it works. Run "Test connection" — it authenticates against smtp.gmail.com and ' +
          'sends nothing to anyone.',
      })
    } else if (!parsed.ok) {
      blocks.push({
        reason: 'VERIFICATION_FAILED',
        message:
          'The last connection test failed, so sending is blocked. ' +
          (parsed.detail ?? 'No detail was recorded.') +
          ' The usual cause is an app password that is wrong or has been revoked, or ' +
          '2-Step Verification being switched off on the sending account. Generate a new ' +
          'app password, reconnect the account, and test again.',
      })
    } else if (isVerificationStale(config.smtpLastVerifiedAt, now)) {
      blocks.push({
        reason: 'VERIFICATION_STALE',
        message:
          `The connection last verified successfully ${hoursSince(config.smtpLastVerifiedAt, now)} hours ago. ` +
          'The pre-flight checklist requires it to have been verified in this session (§19), ' +
          'because an app password revoked since then would fail halfway through a send. ' +
          'Run "Test connection" again.',
      })
    }
  }

  // --- 4. Service mode (§7) --------------------------------------------------
  if (!isTest && config.serviceMode !== 'ACTIVE') {
    blocks.push({
      reason: 'SERVICE_MODE_NOT_ACTIVE',
      message:
        `The service mode is ${config.serviceMode}, not ACTIVE, and sending is disabled ` +
        'outside ACTIVE. Inviting someone into a portal that will not accept their response ' +
        'is a contradiction the app refuses to allow. Set the service mode to ACTIVE in ' +
        'service configuration. Test sends to the operator remain available meanwhile.',
    })
  }

  // --- 5. The deployment (§18.1, AC44) ---------------------------------------
  const isProduction = input.isProductionDeployment ?? env().isProductionDeployment
  if (!isTest && !isProduction) {
    blocks.push({
      reason: 'NOT_PRODUCTION_DEPLOYMENT',
      message:
        `This is not the production deployment — APP_URL is ${env().APP_URL} and real ` +
        `invitations may only be sent from ${env().PRODUCTION_APP_URL}. Portal links embed ` +
        'this domain, so every link issued from here would be dead the moment the app moves, ' +
        'leaving investors holding broken links to a securities offer. Test sends to the ' +
        'operator remain available meanwhile.',
    })
  }

  // --- 5b. Two-factor on the operator's account (§2.2) -----------------------
  //
  // §2.2: TOTP is "optional in v1 and strongly recommended, **mandatory before
  // the production deployment sends anything real**". So it binds exactly
  // where that sentence says it does: a real send, on the production
  // deployment. A test send to the operator's own address is not "anything
  // real", and neither is anything on the testing deployment — which is what
  // keeps the whole of §19's pre-flight rehearsable before the last gate
  // closes.
  //
  // This gate ADDS a condition and removes none. There is no override, no
  // setting and no environment variable that turns it off, because §2.2 does
  // not offer one.
  if (!isTest && isProduction && !config.operatorTwoFactorEnrolled) {
    blocks.push({
      reason: 'SECOND_FACTOR_NOT_ENROLLED',
      message:
        'Two-factor authentication is not switched on for the operator account, and the ' +
        'specification makes it mandatory before the production deployment sends anything ' +
        'real. Dropping Google sign-in made the password the only thing between an attacker ' +
        'and the ability to send mail as the operator; this is the other half of that trade. ' +
        'Switch it on under Two-factor in the admin area — it takes a minute with any ' +
        'authenticator app. Test sends to the operator remain available meanwhile.',
    })
  }

  // --- 6. Test sends go to the operator, and nowhere else (§18.1) ------------
  if (isTest) {
    const recipient = input.recipient?.trim().toLowerCase() ?? ''
    const operator = input.operatorEmail?.trim().toLowerCase() ?? ''

    if (recipient === '' || operator === '') {
      blocks.push({
        reason: 'TEST_SEND_TO_OTHER_ADDRESS',
        message:
          'A test send has to name both its recipient and the operator whose address it is ' +
          'going to, and one of them is missing. A test send is only exempt from the service ' +
          'mode and deployment gates because it goes to the operator himself; without both ' +
          'addresses that cannot be checked, so it is refused.',
      })
    } else if (recipient !== operator) {
      blocks.push({
        reason: 'TEST_SEND_TO_OTHER_ADDRESS',
        message:
          'A test send may only go to the operator\'s own address. This one is addressed ' +
          'elsewhere, and a test send skips the service mode and production-deployment gates ' +
          'that protect real recipients. Send it to the operator, or send it as a real ' +
          'invitation and let it pass those gates properly.',
      })
    }
  }

  if (blocks.length === 0) {
    return { allowed: true, intent }
  }

  const primary =
    REASON_PRIORITY.map((reason) => blocks.find((block) => block.reason === reason)).find(
      (block): block is SendBlock => block !== undefined,
    ) ?? blocks[0]

  return {
    allowed: false,
    intent,
    blocks,
    primary,
    message: blocks.map((block) => block.message).join(' '),
  }
}

// ---------------------------------------------------------------------------
// The throwing form
// ---------------------------------------------------------------------------

export class SendBlockedError extends Error {
  readonly reason: SendBlockReason
  readonly blocks: SendBlock[]
  readonly intent: SendIntent

  constructor(decision: Extract<SendGuardDecision, { allowed: false }>) {
    super(decision.message)
    this.name = 'SendBlockedError'
    this.reason = decision.primary.reason
    this.blocks = decision.blocks
    this.intent = decision.intent
  }

  /** Reasons only, for `send_events.block_reason`. */
  get reasonCodes(): SendBlockReason[] {
    return this.blocks.map((block) => block.reason)
  }
}

/**
 * Refuse, loudly and specifically, or return.
 *
 * Callers that want to render the state rather than act on it should use
 * `evaluateSendGuard` and show every block; this form is for the moment
 * something is about to be sent.
 */
export function assertCanSend(input: SendGuardInput): Extract<SendGuardDecision, { allowed: true }> {
  const decision = evaluateSendGuard(input)
  if (!decision.allowed) throw new SendBlockedError(decision)
  return decision
}
