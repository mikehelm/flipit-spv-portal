/**
 * Flipit SPV Investor Portal — data model.
 *
 * BUILD_SPEC §17. Every entity listed there exists here.
 *
 * Two structural rules everything else depends on:
 *
 *   1. An investor account is DURABLE and holds many offers across many rounds
 *      (§4.3). A later follow-on round attaches a new offer to the existing
 *      account. Getting this wrong is expensive to undo.
 *
 *   2. Proposed, committed, accepted and received are FOUR SEPARATE amounts
 *      (§5). They are never collapsed into one column.
 *
 * All money and percentages are `numeric`. Drizzle returns numeric as a string,
 * which is exactly what we want — it goes into decimal.js and never becomes a
 * JavaScript number anywhere between the spreadsheet and the screen.
 */

import {
  boolean,
  char,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core'
import { createId } from '@/lib/id'

// ---------------------------------------------------------------------------
// Enums — one per state machine
// ---------------------------------------------------------------------------

/**
 * BUILD_SPEC §2 names two. `VIEWER` is an addition: read-only oversight, no
 * capability to act. See `lib/roles.ts` — it is deliberately absent from
 * `PrivilegedRole`, which is the type every mutation guard consults.
 */
export const roleEnum = pgEnum('role', ['OWNER', 'OPERATOR', 'VIEWER'])

/** BUILD_SPEC §4.2 */
export const accountStatusEnum = pgEnum('account_status', [
  'INVITED',
  'ACTIVE',
  'SUSPENDED',
  'CLOSED',
  'ARCHIVED',
])

/**
 * Whether a closed account may still sign in. BUILD_SPEC §4.2.
 * Default READ_ONLY — an investor who has sent money should not lose the
 * record of it.
 */
export const closedAccountAccessEnum = pgEnum('closed_account_access', [
  'READ_ONLY',
  'NONE',
])

/** The eight-step investor timeline. BUILD_SPEC §5. */
export const offerStageEnum = pgEnum('offer_stage', [
  'INVITATION_SENT',
  'RESPONSE_RECORDED',
  'DOCUMENTS_ISSUED',
  'COMMITMENT_AGREED',
  'ALLOCATION_ACCEPTED',
  'PAYMENT_INSTRUCTIONS_ISSUED',
  'FUNDS_RECEIVED',
  'COMPLETED',
])

export const emailStatusEnum = pgEnum('email_status', [
  'DRAFT',
  'SENT',
  'FAILED',
  'BLOCKED',
])

export const responseChoiceEnum = pgEnum('response_choice', [
  'NO_RESPONSE',
  'INTERESTED',
  'NOT_INTERESTED',
  'QUESTION',
])

/** BUILD_SPEC §7 */
export const serviceModeEnum = pgEnum('service_mode', [
  'ACTIVE',
  'READ_ONLY',
  'SUNSET',
  'DISABLED',
])

/** Why a recipient cannot be sent to. BUILD_SPEC §8.2, §9. */
export const blockReasonEnum = pgEnum('block_reason', [
  'JURISDICTION_NOT_APPROVED',
  'VALIDATION_FAILED',
  'UNRESOLVED_TEMPLATE_VARIABLE',
  'MANUALLY_HELD',
])

export const tokenPurposeEnum = pgEnum('token_purpose', [
  'CLAIM',
  'SIGN_IN',
  'OPERATOR_INVITE',
])

export const templateKindEnum = pgEnum('template_kind', [
  'INVITATION',
  'REMINDER',
])

export const emailReviewProposalStatusEnum = pgEnum(
  'email_review_proposal_status',
  [
    'SUBMITTED',
    'CHANGES_REQUESTED',
    'REJECTED',
    'PROMOTED',
    'WITHDRAWN',
  ],
)

export const messageDirectionEnum = pgEnum('message_direction', [
  'FROM_INVESTOR',
  'FROM_OPERATOR',
])

export const sendOutcomeEnum = pgEnum('send_outcome', [
  'SUCCEEDED',
  'FAILED_TRANSIENT',
  'FAILED_PERMANENT',
  'BLOCKED',
])

export const emailTransportEnum = pgEnum('email_transport', [
  'SMTP',
  'GMAIL_API',
])

/**
 * How investors reach the operator. BUILD_SPEC §2.1 step 2.
 * EMAIL_ONLY removes the phone line from the template entirely rather than
 * rendering it blank.
 */
export const contactMethodEnum = pgEnum('contact_method', [
  'PHONE',
  'WHATSAPP',
  'EMAIL_ONLY',
])

/**
 * A public request never becomes access by itself. `VERIFIED` means an owner
 * or operator recorded that they completed the phone check; creating an
 * account and issuing a setup link remain separate, deliberate actions.
 */
export const accessRequestStatusEnum = pgEnum('access_request_status', [
  'PENDING',
  'VERIFIED',
  'CLOSED',
])

// ---------------------------------------------------------------------------
// Column helpers
// ---------------------------------------------------------------------------

const id = () => text('id').primaryKey().$defaultFn(createId)
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
const updatedAt = () =>
  timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date())

/** Money. Two decimal places, stored exactly. */
const money = (name: string) => numeric(name, { precision: 18, scale: 2 })
/** A percentage such as 5.000000 meaning five percent. */
const percentage = (name: string) => numeric(name, { precision: 9, scale: 6 })

// ---------------------------------------------------------------------------
// Privileged users
// ---------------------------------------------------------------------------

/**
 * Owner, operator and read-only viewer accounts. Investors are
 * `investorAccounts`, not users — they are deliberately a different kind of
 * thing with different rules.
 */
export const users = pgTable('users', {
  id: id(),
  email: text('email').notNull().unique(),
  name: text('name'),
  role: roleEnum('role').notNull(),
  image: text('image'),

  // Sign-in — BUILD_SPEC §2.2.
  //
  // §2.2 arrived after WP1 froze the data model, so these are added in a second
  // migration rather than the first. A null password_hash is the normal state
  // of a freshly seeded account: the seed creates the allowlisted users with no
  // password and prints a one-time setup link. A password is never read from an
  // environment variable or a configuration file, so there is no other way for
  // one to arrive.
  /** A scrypt verifier. Null until the account holder chooses a password. */
  passwordHash: text('password_hash'),
  passwordSetAt: timestamp('password_set_at', { withTimezone: true }),
  /**
   * Every session created before this instant is dead. "A password change ends
   * every other session" has to survive the other session being held on a
   * machine we cannot reach, so it is enforced by comparison at read time as
   * well as by deleting rows at write time.
   */
  passwordChangedAt: timestamp('password_changed_at', { withTimezone: true }),
  /** Optional plaintext reminder. It must never contain the password itself. */
  passwordHint: text('password_hint'),

  // Two-factor — optional in v1 (§2.2).
  /** encrypt() from lib/crypto. Never returned to any client. */
  totpSecretEncrypted: text('totp_secret_encrypted'),
  totpConfirmedAt: timestamp('totp_confirmed_at', { withTimezone: true }),
  /** hashToken() of each code. Single use — a spent code is removed. */
  recoveryCodesHashed: text('recovery_codes_hashed').array().notNull().default([]),

  // Operator onboarding — BUILD_SPEC §2.1
  onboardingCompletedAt: timestamp('onboarding_completed_at', { withTimezone: true }),
  displayName: text('display_name'),
  contactMethod: contactMethodEnum('contact_method'),
  contactValue: text('contact_value'),

  createdAt: createdAt(),
  updatedAt: updatedAt(),
})

export const sessions = pgTable(
  'sessions',
  {
    id: id(),
    sessionToken: text('session_token').notNull().unique(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    expires: timestamp('expires', { withTimezone: true }).notNull(),
    /**
     * When the second factor was satisfied — BUILD_SPEC §2.2.
     *
     * Null means one of two things and the difference does not matter to a
     * caller: either the account has no TOTP enrolled, in which case the
     * session is complete, or it has and this session has not yet passed it,
     * in which case the session reaches the second-factor form and nothing
     * else. `currentAdmin()` resolves which, and returns null for the second —
     * so a guard that forgets to ask fails closed rather than open.
     */
    secondFactorAt: timestamp('second_factor_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index('sessions_user_idx').on(t.userId)],
)

/**
 * Sign-in throttling counters — BUILD_SPEC §2.2.
 *
 * In a table rather than in process memory because an in-memory lock lifts
 * itself the moment anything restarts, and "restart the process" is not a
 * difficulty an attacker has to overcome — a deploy, a crash loop or a
 * scale-out does it for them. One row per key; the key is either the attempted
 * address or the source IP, and it is recorded whether or not the address
 * exists so that a stranger and the owner are throttled identically.
 *
 * The key holds an email address, so this table is not exportable and is never
 * included in the §20 export.
 */
export const signInAttempts = pgTable('sign_in_attempts', {
  key: text('key').primaryKey(),
  failures: integer('failures').notNull().default(0),
  firstFailureAt: timestamp('first_failure_at', { withTimezone: true }).notNull(),
  lockedUntil: timestamp('locked_until', { withTimezone: true }),
})

export const oauthAccounts = pgTable(
  'oauth_accounts',
  {
    id: id(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    provider: text('provider').notNull(),
    providerAccountId: text('provider_account_id').notNull(),
    refreshToken: text('refresh_token'),
    accessToken: text('access_token'),
    expiresAt: integer('expires_at'),
    tokenType: text('token_type'),
    scope: text('scope'),
    idToken: text('id_token'),
    sessionState: text('session_state'),
  },
  (t) => [
    uniqueIndex('oauth_provider_account_idx').on(t.provider, t.providerAccountId),
  ],
)

/** Single-use, expiring. BUILD_SPEC §15. */
export const operatorInvites = pgTable(
  'operator_invites',
  {
    id: id(),
    email: text('email').notNull(),
    tokenHash: text('token_hash').notNull().unique(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdById: text('created_by_id')
      .notNull()
      .references(() => users.id),
    acceptedById: text('accepted_by_id').references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [index('operator_invites_email_idx').on(t.email)],
)

/**
 * Requests made at the deliberately non-identifying public front door.
 *
 * One row per normalised address keeps repeated submissions from filling the
 * queue. The source address is held only as a keyed hash, solely to enforce a
 * durable public rate limit; the raw address is never stored here.
 */
export const accessRequests = pgTable(
  'access_requests',
  {
    id: id(),
    firstName: text('first_name').notNull(),
    lastName: text('last_name').notNull(),
    email: text('email').notNull().unique(),
    phone: text('phone').notNull(),
    status: accessRequestStatusEnum('status').notNull().default('PENDING'),
    sourceHash: text('source_hash').notNull(),
    lastSubmittedAt: timestamp('last_submitted_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    verifiedById: text('verified_by_id').references(() => users.id),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    closedById: text('closed_by_id').references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('access_requests_status_created_idx').on(t.status, t.createdAt),
    index('access_requests_source_created_idx').on(t.sourceHash, t.createdAt),
  ],
)

/**
 * Atomic, privacy-preserving abuse counters for the public access-request form.
 *
 * This is intentionally separate from `accessRequests`: duplicate addresses
 * still count as attempts even though they do not create duplicate queue rows.
 * A keyed source hash is the only identifier retained.
 */
export const accessRequestAttempts = pgTable('access_request_attempts', {
  sourceHash: text('source_hash').primaryKey(),
  windowStartedAt: timestamp('window_started_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  attemptCount: integer('attempt_count').notNull().default(1),
  updatedAt: updatedAt(),
})

// ---------------------------------------------------------------------------
// Rounds, recipients, accounts, offers
// ---------------------------------------------------------------------------

/** The current SPV raise is simply the first round. BUILD_SPEC §4.3. */
export const rounds = pgTable('rounds', {
  id: id(),
  name: text('name').notNull(),
  /** Total the SPV may raise, e.g. 30000.00 */
  aggregateTargetUsd: money('aggregate_target_usd').notNull(),
  /** Share of Flipit Global Limited the SPV may acquire, e.g. 0.300000 */
  flipitShare: percentage('flipit_share').notNull(),
  openedAt: timestamp('opened_at', { withTimezone: true }).notNull().defaultNow(),
  closedAt: timestamp('closed_at', { withTimezone: true }),
  closedById: text('closed_by_id').references(() => users.id),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
})

/** Created on upload. No account exists at this point. BUILD_SPEC §4.1. */
export const recipients = pgTable(
  'recipients',
  {
    id: id(),
    roundId: text('round_id')
      .notNull()
      .references(() => rounds.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    email: text('email').notNull(),
    /**
     * ISO 3166-1 alpha-2. Null while the operator is still preparing the list.
     * A null value is a hard send blocker, never an approved jurisdiction.
     */
    jurisdiction: char('jurisdiction', { length: 2 }),
    internalNotes: text('internal_notes'),

    senderName: text('sender_name'),
    senderEmail: text('sender_email'),
    senderPhone: text('sender_phone'),

    importJobId: text('import_job_id'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('recipients_round_email_idx').on(t.roundId, t.email),
    index('recipients_jurisdiction_idx').on(t.jurisdiction),
  ],
)

/** Durable. Survives the round. Holds many offers. BUILD_SPEC §4.2, §4.3. */
export const investorAccounts = pgTable(
  'investor_accounts',
  {
    id: id(),
    email: text('email').notNull().unique(),
    name: text('name').notNull(),
    status: accountStatusEnum('status').notNull().default('INVITED'),
    emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),
    lastSignInAt: timestamp('last_sign_in_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('investor_accounts_status_idx').on(t.status)],
)

export const investorSessions = pgTable(
  'investor_sessions',
  {
    id: id(),
    sessionToken: text('session_token').notNull().unique(),
    accountId: text('account_id')
      .notNull()
      .references(() => investorAccounts.id, { onDelete: 'cascade' }),
    expires: timestamp('expires', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index('investor_sessions_account_idx').on(t.accountId)],
)

/**
 * Every state change recorded with who, when, why, and whether the investor
 * was told. BUILD_SPEC §4.2.
 */
export const accountStatusEvents = pgTable(
  'account_status_events',
  {
    id: id(),
    accountId: text('account_id')
      .notNull()
      .references(() => investorAccounts.id, { onDelete: 'cascade' }),
    fromStatus: accountStatusEnum('from_status'),
    toStatus: accountStatusEnum('to_status').notNull(),
    reason: text('reason').notNull(),
    actorUserId: text('actor_user_id').references(() => users.id),
    investorNotified: boolean('investor_notified').notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [index('account_status_events_account_idx').on(t.accountId)],
)

/**
 * One offer, in one round, to one account.
 *
 * The four amounts are separate and all four are exported (§5, §20):
 *   proposed  — what we offered
 *   committed — what they said they would put in
 *   accepted  — what the company accepted
 *   received  — what actually arrived
 */
export const offers = pgTable(
  'offers',
  {
    id: id(),
    roundId: text('round_id')
      .notNull()
      .references(() => rounds.id),
    accountId: text('account_id')
      .notNull()
      .references(() => investorAccounts.id, { onDelete: 'cascade' }),
    recipientId: text('recipient_id').references(() => recipients.id),

    proposedAmountUsd: money('proposed_amount_usd').notNull(),
    committedAmountUsd: money('committed_amount_usd'),
    acceptedAmountUsd: money('accepted_amount_usd'),
    receivedAmountUsd: money('received_amount_usd'),

    spvPercentage: percentage('spv_percentage').notNull(),
    /**
     * Stored, not derived at read time, so the figure sent can never drift
     * from the figure shown. Computed as spvPercentage × round.flipitShare
     * unless an override was supplied on import.
     */
    indirectPercentage: percentage('indirect_percentage').notNull(),
    indirectOverridden: boolean('indirect_overridden').notNull().default(false),

    /**
     * Null while the round is being prepared. Pre-flight refuses sending until
     * a real present-or-future date has been recorded.
     */
    responseDeadline: date('response_deadline'),
    originalDeadline: date('original_deadline'),

    stage: offerStageEnum('stage').notNull().default('INVITATION_SENT'),
    emailStatus: emailStatusEnum('email_status').notNull().default('DRAFT'),
    responseChoice: responseChoiceEnum('response_choice')
      .notNull()
      .default('NO_RESPONSE'),
    responseAt: timestamp('response_at', { withTimezone: true }),
    responseNote: text('response_note'),

    blocked: boolean('blocked').notNull().default(false),
    blockReason: blockReasonEnum('block_reason'),
    blockDetail: text('block_detail'),
    /** Set only when a qualified approval clears this specific person. §8.3. */
    jurisdictionApprovalRef: text('jurisdiction_approval_ref'),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('offers_recipient_idx').on(t.recipientId),
    index('offers_round_stage_idx').on(t.roundId, t.stage),
    index('offers_account_idx').on(t.accountId),
    index('offers_blocked_idx').on(t.blocked),
  ],
)

/**
 * Stage advances are append-only. A reversal is recorded as a correction,
 * never a silent overwrite. BUILD_SPEC §5.
 */
export const offerStatusEvents = pgTable(
  'offer_status_events',
  {
    id: id(),
    offerId: text('offer_id')
      .notNull()
      .references(() => offers.id, { onDelete: 'cascade' }),
    fromStage: offerStageEnum('from_stage'),
    toStage: offerStageEnum('to_stage').notNull(),
    isCorrection: boolean('is_correction').notNull().default(false),
    reason: text('reason'),
    investorNote: text('investor_note'),
    internalNote: text('internal_note'),
    actorUserId: text('actor_user_id').references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [index('offer_status_events_offer_idx').on(t.offerId)],
)

// ---------------------------------------------------------------------------
// Email
// ---------------------------------------------------------------------------

/**
 * The editable source of an email. Hashing covers the SOURCE including its
 * conditional blocks, not the rendered output, so the operator's contact
 * method choice does not silently void an approval. BUILD_SPEC §2.1, §8.2.
 */
export const emailTemplates = pgTable(
  'email_templates',
  {
    id: id(),
    kind: templateKindEnum('kind').notNull(),
    subject: text('subject').notNull(),
    htmlSource: text('html_source').notNull(),
    textSource: text('text_source').notNull(),
    version: integer('version').notNull().default(1),
    hash: text('hash').notNull(),
    isCurrent: boolean('is_current').notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [index('email_templates_kind_current_idx').on(t.kind, t.isCurrent)],
)

/**
 * One bounded wording change proposed from the private review studio.
 *
 * The complete candidate source is stored here because a proposal must remain
 * reviewable even after the live template moves. It is private operational
 * data and is never copied into the audit log or any investor-facing surface.
 */
export const emailReviewProposals = pgTable(
  'email_review_proposals',
  {
    id: id(),
    createdById: text('created_by_id')
      .notNull()
      .references(() => users.id),
    sectionId: text('section_id').notNull(),
    sectionLabel: text('section_label').notNull(),
    beforeText: text('before_text').notNull(),
    proposedText: text('proposed_text').notNull(),
    reason: text('reason').notNull(),
    status: emailReviewProposalStatusEnum('status').notNull().default('SUBMITTED'),
    baseTemplateHash: text('base_template_hash').notNull(),
    candidateTemplateHash: text('candidate_template_hash').notNull(),
    candidateSubject: text('candidate_subject').notNull(),
    candidateHtmlSource: text('candidate_html_source').notNull(),
    candidateTextSource: text('candidate_text_source').notNull(),
    policyResults: jsonb('policy_results').notNull().default([]),
    aiReview: text('ai_review'),
    aiModel: text('ai_model'),
    submittedAt: timestamp('submitted_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    reviewedById: text('reviewed_by_id').references(() => users.id),
    reviewNote: text('review_note'),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    promotedTemplateId: text('promoted_template_id').references(
      (): AnyPgColumn => emailTemplates.id,
    ),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('email_review_proposals_status_idx').on(t.status, t.createdAt),
    index('email_review_proposals_creator_idx').on(t.createdById, t.createdAt),
  ],
)

/**
 * The exact email as sent, immutable. The investor sees this, and it is what
 * the preview must match. BUILD_SPEC §13, AC3.
 */
export const emailSnapshots = pgTable(
  'email_snapshots',
  {
    id: id(),
    offerId: text('offer_id')
      .notNull()
      .references(() => offers.id, { onDelete: 'cascade' }),
    kind: templateKindEnum('kind').notNull(),
    subject: text('subject').notNull(),
    htmlBody: text('html_body').notNull(),
    textBody: text('text_body').notNull(),
    fromAddress: text('from_address').notNull(),
    fromName: text('from_name').notNull(),
    toAddress: text('to_address').notNull(),
    templateHash: text('template_hash').notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('email_snapshots_offer_idx').on(t.offerId)],
)

export const sendEvents = pgTable(
  'send_events',
  {
    id: id(),
    offerId: text('offer_id')
      .notNull()
      .references(() => offers.id, { onDelete: 'cascade' }),
    snapshotId: text('snapshot_id').references(() => emailSnapshots.id),
    kind: templateKindEnum('kind').notNull(),
    outcome: sendOutcomeEnum('outcome').notNull(),
    messageId: text('message_id'),
    errorDetail: text('error_detail'),
    blockReason: text('block_reason'),
    attempt: integer('attempt').notNull().default(1),
    actorUserId: text('actor_user_id').references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [index('send_events_offer_idx').on(t.offerId)],
)

// ---------------------------------------------------------------------------
// Tokens
// ---------------------------------------------------------------------------

/** Only a hash is stored. Single use, expiring, revocable. BUILD_SPEC §15. */
export const portalTokens = pgTable(
  'portal_tokens',
  {
    id: id(),
    accountId: text('account_id')
      .notNull()
      .references(() => investorAccounts.id, { onDelete: 'cascade' }),
    offerId: text('offer_id').references(() => offers.id),
    purpose: tokenPurposeEnum('purpose').notNull(),
    tokenHash: text('token_hash').notNull().unique(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index('portal_tokens_account_purpose_idx').on(t.accountId, t.purpose)],
)

/**
 * A change of contact address only takes effect once the NEW address is
 * verified. BUILD_SPEC §13.
 *
 * `previousEmail` is the address the record carried when the change was asked
 * for, and it is here for two reasons rather than as a convenience. It is the
 * address the "your contact address has changed" notice goes to, and holding it
 * on the row means that function can take a request id and look the recipient
 * up — the same invariant as `send-sign-in-link.ts`, where no argument anywhere
 * can be pointed at somebody else's mailbox. And it is checked at confirmation:
 * if the record no longer carries it, the world moved under the request and the
 * confirmation is refused rather than applied to a state nobody asked about.
 *
 * `revokedAt` supersedes an outstanding request when a second one is made, so
 * asking twice never leaves two live ways to move the address. Revoked rather
 * than deleted: what somebody asked for is part of the record.
 */
export const emailChangeRequests = pgTable(
  'email_change_requests',
  {
    id: id(),
    accountId: text('account_id')
      .notNull()
      .references(() => investorAccounts.id, { onDelete: 'cascade' }),
    newEmail: text('new_email').notNull(),
    previousEmail: text('previous_email'),
    tokenHash: text('token_hash').notNull().unique(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index('email_change_requests_account_idx').on(t.accountId)],
)

// ---------------------------------------------------------------------------
// Responses, conversation, commitments, money in
// ---------------------------------------------------------------------------

export const investorResponses = pgTable(
  'investor_responses',
  {
    id: id(),
    offerId: text('offer_id')
      .notNull()
      .references(() => offers.id, { onDelete: 'cascade' }),
    choice: responseChoiceEnum('choice').notNull(),
    message: text('message'),
    supersededById: text('superseded_by_id'),
    createdAt: createdAt(),
  },
  (t) => [index('investor_responses_offer_idx').on(t.offerId)],
)

export const conversationMessages = pgTable(
  'conversation_messages',
  {
    id: id(),
    accountId: text('account_id')
      .notNull()
      .references(() => investorAccounts.id, { onDelete: 'cascade' }),
    offerId: text('offer_id').references(() => offers.id),
    direction: messageDirectionEnum('direction').notNull(),
    body: text('body').notNull(),
    emailMessageId: text('email_message_id'),
    inReplyTo: text('in_reply_to'),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    actorUserId: text('actor_user_id').references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [index('conversation_messages_account_idx').on(t.accountId)],
)

export const commitments = pgTable('commitments', {
  id: id(),
  offerId: text('offer_id')
    .notNull()
    .unique()
    .references(() => offers.id, { onDelete: 'cascade' }),
  amountUsd: money('amount_usd').notNull(),
  spvPercentage: percentage('spv_percentage').notNull(),
  agreedAt: timestamp('agreed_at', { withTimezone: true }).notNull(),
  recordedById: text('recorded_by_id').references(() => users.id),
  note: text('note'),
  createdAt: createdAt(),
})

export const paymentInstructions = pgTable('payment_instructions', {
  id: id(),
  offerId: text('offer_id')
    .notNull()
    .unique()
    .references(() => offers.id, { onDelete: 'cascade' }),
  issuedAt: timestamp('issued_at', { withTimezone: true }).notNull(),
  deliveryNote: text('delivery_note'),
  recordedById: text('recorded_by_id').references(() => users.id),
  createdAt: createdAt(),
})

/**
 * The one entry an investor genuinely relies on. Requires two-step
 * confirmation in the UI with the amount re-typed. BUILD_SPEC §5.
 */
export const fundsReceipts = pgTable('funds_receipts', {
  id: id(),
  offerId: text('offer_id')
    .notNull()
    .unique()
    .references(() => offers.id, { onDelete: 'cascade' }),
  amount: money('amount').notNull(),
  currency: char('currency', { length: 3 }).notNull().default('USD'),
  valueDate: date('value_date').notNull(),
  reference: text('reference').notNull(),
  recordedById: text('recorded_by_id').references(() => users.id),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
})

export const documentPackages = pgTable(
  'document_packages',
  {
    id: id(),
    offerId: text('offer_id')
      .notNull()
      .references(() => offers.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    description: text('description'),
    storageKey: text('storage_key').notNull(),
    contentType: text('content_type').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    issuedAt: timestamp('issued_at', { withTimezone: true }),
    /**
     * Version history, in the same shape as `participationCertificates`.
     * BUILD_SPEC §5: a correction is *"never a silent overwrite"*.
     *
     * `supersedesId` points at the document this one replaces, so the chain is
     * the record and there is no denormalised lineage column to disagree with
     * it. `supersededAt` is set on the OLD row at the moment the new one is
     * issued — not when it is uploaded — so an investor keeps the document
     * they were given until there is a replacement actually issued to them.
     *
     * A superseded document stays downloadable, exactly as a superseded
     * certificate does (§5.1, "the superseded version retained"). Hiding it
     * would not unsend it, and an investor who has a copy should be able to see
     * what it was and that it was replaced.
     */
    version: integer('version').notNull().default(1),
    supersededAt: timestamp('superseded_at', { withTimezone: true }),
    supersedesId: text('supersedes_id').references((): AnyPgColumn => documentPackages.id, {
      onDelete: 'set null',
    }),
    uploadedById: text('uploaded_by_id').references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [
    index('document_packages_offer_idx').on(t.offerId),
    index('document_packages_supersedes_idx').on(t.supersedesId),
  ],
)

/**
 * Confirms receipt of funds and a recorded position. NOT a share certificate
 * — the footer says so. BUILD_SPEC §5.1.
 */
export const participationCertificates = pgTable(
  'participation_certificates',
  {
    id: id(),
    offerId: text('offer_id')
      .notNull()
      .references(() => offers.id, { onDelete: 'cascade' }),
    version: integer('version').notNull().default(1),
    supersededAt: timestamp('superseded_at', { withTimezone: true }),
    /**
     * Nullable, and normally null. Nothing is stored as a file.
     *
     * The certificate is regenerated from `data` on every download, which is
     * byte-identical every time because the figures on it are a frozen
     * snapshot rather than a live read. That removes the need for a blob store
     * this deployment does not have, and it means a superseded version still
     * renders exactly what it said rather than what is true now. The column
     * stays for a future deployment that does keep files.
     */
    storageKey: text('storage_key'),
    /**
     * The frozen facts this version asserts, validated by
     * `participationCertificateDataSchema`. Money and percentages are decimal
     * strings in here, never numbers.
     */
    data: jsonb('data').$type<Record<string, unknown>>(),
    issuedAt: timestamp('issued_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('participation_certificates_offer_idx').on(t.offerId)],
)

// ---------------------------------------------------------------------------
// Updates
// ---------------------------------------------------------------------------

/**
 * Immutable once published. Corrections are new entries; withdrawal leaves a
 * tombstone. BUILD_SPEC §6.
 */
export const portalUpdates = pgTable('portal_updates', {
  id: id(),
  title: text('title').notNull(),
  body: text('body').notNull(),
  publishedAt: timestamp('published_at', { withTimezone: true }),
  withdrawnAt: timestamp('withdrawn_at', { withTimezone: true }),
  withdrawnReason: text('withdrawn_reason'),
  notifyByEmail: boolean('notify_by_email').notNull().default(true),
  audienceFilter: text('audience_filter'),
  authorId: text('author_id')
    .notNull()
    .references(() => users.id),
  createdAt: createdAt(),
})

export const updateDeliveries = pgTable(
  'update_deliveries',
  {
    id: id(),
    updateId: text('update_id')
      .notNull()
      .references(() => portalUpdates.id, { onDelete: 'cascade' }),
    accountId: text('account_id')
      .notNull()
      .references(() => investorAccounts.id, { onDelete: 'cascade' }),
    notifiedAt: timestamp('notified_at', { withTimezone: true }),
    readAt: timestamp('read_at', { withTimezone: true }),
  },
  (t) => [uniqueIndex('update_deliveries_unique_idx').on(t.updateId, t.accountId)],
)

// ---------------------------------------------------------------------------
// Questions and answers — BUILD_SPEC §6.7
// ---------------------------------------------------------------------------

/**
 * `questionOriginal` is preserved unchanged on the private record.
 * `questionPublic` is the operator's rewritten, de-identified version and is
 * the ONLY text that may ever appear on the shared page.
 */
export const qaEntries = pgTable(
  'qa_entries',
  {
    id: id(),
    askedByAccountId: text('asked_by_account_id').references(
      () => investorAccounts.id,
      { onDelete: 'cascade' },
    ),
    offerId: text('offer_id').references(() => offers.id),
    questionOriginal: text('question_original').notNull(),
    questionPublic: text('question_public'),
    answer: text('answer'),
    answeredById: text('answered_by_id').references(() => users.id),
    answeredAt: timestamp('answered_at', { withTimezone: true }),
    isPublished: boolean('is_published').notNull().default(false),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    unpublishedAt: timestamp('unpublished_at', { withTimezone: true }),
    answerEmailSentAt: timestamp('answer_email_sent_at', { withTimezone: true }),
    /**
     * §6.7.1 — "a new question emails David immediately". A question is
     * recorded whether or not that email got out, so the outcome is stored on
     * the entry rather than being allowed to fail the investor's submission.
     * `notifyFailure` holds the send gate's own operator-facing sentence; it
     * never holds a credential, and the queue shows it so an unnoticed
     * notification failure cannot look like an empty queue.
     */
    notifiedAt: timestamp('notified_at', { withTimezone: true }),
    notifyFailure: text('notify_failure'),
    pinned: boolean('pinned').notNull().default(false),
    sortOrder: integer('sort_order').notNull().default(0),
    updatedAtLabel: timestamp('updated_at_label', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('qa_entries_published_idx').on(t.isPublished, t.pinned, t.sortOrder)],
)

export const qaThreadMessages = pgTable(
  'qa_thread_messages',
  {
    id: id(),
    entryId: text('entry_id')
      .notNull()
      .references(() => qaEntries.id, { onDelete: 'cascade' }),
    direction: messageDirectionEnum('direction').notNull(),
    body: text('body').notNull(),
    actorUserId: text('actor_user_id').references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [index('qa_thread_messages_entry_idx').on(t.entryId)],
)

// ---------------------------------------------------------------------------
// Register of interest — BUILD_SPEC §5.2
// ---------------------------------------------------------------------------

/**
 * Records interest. Creates no entitlement. Order is COMPUTED, never stored as
 * a rank, and is never shown to any investor.
 */
export const interestRegisterEntries = pgTable('interest_register_entries', {
  id: id(),
  accountId: text('account_id')
    .notNull()
    .unique()
    .references(() => investorAccounts.id, { onDelete: 'cascade' }),
  joinedAt: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow(),
  leftAt: timestamp('left_at', { withTimezone: true }),
  indicativeAmountUsd: money('indicative_amount_usd'),
  operatorOrderOverride: integer('operator_order_override'),
  overrideReason: text('override_reason'),
  overrideById: text('override_by_id').references(() => users.id),
  addedByOperator: boolean('added_by_operator').notNull().default(false),
})

// ---------------------------------------------------------------------------
// Compliance — BUILD_SPEC §8.2
// ---------------------------------------------------------------------------

/**
 * Owner-only to create, amend or void. Sending is impossible without a current
 * one, and template drift voids it.
 */
export const complianceApprovals = pgTable(
  'compliance_approvals',
  {
    id: id(),
    approverName: text('approver_name').notNull(),
    approverRole: text('approver_role').notNull(),
    approverFirm: text('approver_firm'),
    approvedAt: timestamp('approved_at', { withTimezone: true }).notNull(),
    evidenceReference: text('evidence_reference').notNull(),
    /** ISO 3166-1 alpha-2 codes. Blocs expanded to member codes on record. */
    approvedJurisdictions: text('approved_jurisdictions').array().notNull(),
    /** SHA-256 of the approved template source — subject and both bodies. */
    approvedTemplateHash: text('approved_template_hash').notNull(),
    templateKind: templateKindEnum('template_kind').notNull(),
    conditions: text('conditions'),
    recordedById: text('recorded_by_id')
      .notNull()
      .references(() => users.id),
    voidedAt: timestamp('voided_at', { withTimezone: true }),
    voidedReason: text('voided_reason'),
    createdAt: createdAt(),
  },
  (t) => [index('compliance_approvals_kind_idx').on(t.templateKind, t.voidedAt)],
)

// ---------------------------------------------------------------------------
// Reminders — BUILD_SPEC §6.5
// ---------------------------------------------------------------------------

export const reminderSchedules = pgTable('reminder_schedules', {
  id: id(),
  roundId: text('round_id')
    .notNull()
    .references(() => rounds.id, { onDelete: 'cascade' }),
  /** Days before the deadline, e.g. [7, 2] */
  daysBefore: integer('days_before').array().notNull(),
  maxPerRecipient: integer('max_per_recipient').notNull().default(2),
  enabled: boolean('enabled').notNull().default(true),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
})

export const reminderEvents = pgTable(
  'reminder_events',
  {
    id: id(),
    offerId: text('offer_id')
      .notNull()
      .references(() => offers.id, { onDelete: 'cascade' }),
    scheduledFor: timestamp('scheduled_for', { withTimezone: true }).notNull(),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    cancelledById: text('cancelled_by_id').references(() => users.id),
    skippedReason: text('skipped_reason'),
    /**
     * When a run took this row in order to send it. BUILD_SPEC §6.5, §14.
     *
     * Reminders are the one unattended sender, and the moment the job goes on a
     * schedule it becomes possible for two runs to overlap — an hourly cron and
     * a run that takes longer than an hour is all it needs. Without this column
     * both runs read the same due row, both pass the same gates, and the
     * investor receives the same message twice.
     *
     * It is set by an UPDATE that names the row and requires the column to still
     * be null, so exactly one of two racing runs can set it. The run that does
     * not set it sends nothing.
     *
     * It does not expire. A claim that timed out would reopen the window it was
     * added to close, and the two failures are not equal: a reminder that never
     * goes out is visible on the queue and the operator can release it by
     * rescheduling, while a securities email delivered twice cannot be taken
     * back.
     */
    claimedAt: timestamp('claimed_at', { withTimezone: true }),
    sequence: integer('sequence').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index('reminder_events_offer_idx').on(t.offerId),
    index('reminder_events_due_idx').on(t.scheduledFor, t.sentAt),
  ],
)

// ---------------------------------------------------------------------------
// Import — BUILD_SPEC §9.1
// ---------------------------------------------------------------------------

export const importJobs = pgTable('import_jobs', {
  id: id(),
  roundId: text('round_id')
    .notNull()
    .references(() => rounds.id, { onDelete: 'cascade' }),
  filename: text('filename').notNull(),
  sourceHeaders: text('source_headers').array().notNull(),
  rowCount: integer('row_count').notNull().default(0),
  usedAi: boolean('used_ai').notNull().default(false),
  confirmedById: text('confirmed_by_id').references(() => users.id),
  confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
  createdAt: createdAt(),
})

export const columnMappings = pgTable(
  'column_mappings',
  {
    id: id(),
    importJobId: text('import_job_id')
      .notNull()
      .references(() => importJobs.id, { onDelete: 'cascade' }),
    sourceColumn: text('source_column').notNull(),
    targetField: text('target_field').notNull(),
    transform: text('transform'),
    wasProposed: boolean('was_proposed').notNull().default(false),
    wasCorrected: boolean('was_corrected').notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [index('column_mappings_job_idx').on(t.importJobId)],
)

/**
 * What the model proposed, so a mis-import can be traced afterwards.
 * The model reads; it never computes. BUILD_SPEC §9.1.
 */
export const aiProposals = pgTable(
  'ai_proposals',
  {
    id: id(),
    importJobId: text('import_job_id')
      .notNull()
      .references(() => importJobs.id, { onDelete: 'cascade' }),
    model: text('model').notNull(),
    promptSummary: text('prompt_summary').notNull(),
    rawProposal: text('raw_proposal').notNull(),
    acceptedById: text('accepted_by_id').references(() => users.id),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index('ai_proposals_job_idx').on(t.importJobId)],
)

/**
 * What each call to the model consumed. BUILD_SPEC §9.1 — the spend cap, and
 * usage shown on the settings page.
 *
 * Separate from `ai_proposals` because a call that fails, times out or returns
 * unusable JSON still costs money and still has to be counted. Tying the record
 * of spending to the record of a *successful* proposal would under-report by
 * exactly the calls most worth knowing about.
 *
 * Token counts are integers because they are counts. The estimated cost is
 * `numeric` at six decimal places, because a single mapping call costs a
 * fraction of a cent and two places would round every one of them to zero.
 */
export const aiUsageEvents = pgTable(
  'ai_usage_events',
  {
    id: id(),
    /** Null when the call failed before a job existed to attach it to. */
    importJobId: text('import_job_id').references(() => importJobs.id, {
      onDelete: 'set null',
    }),
    model: text('model').notNull(),
    promptTokens: integer('prompt_tokens').notNull().default(0),
    completionTokens: integer('completion_tokens').notNull().default(0),
    /** An estimate from a published price list, not a bill. */
    estimatedCostUsd: numeric('estimated_cost_usd', { precision: 12, scale: 6 })
      .notNull()
      .default('0'),
    /** False when the model was called but returned nothing usable. */
    succeeded: boolean('succeeded').notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [index('ai_usage_events_created_idx').on(t.createdAt)],
)

// ---------------------------------------------------------------------------
// Media, video, roadmap — BUILD_SPEC §13.1, §13.2, §13.3
// ---------------------------------------------------------------------------

export const mediaAssets = pgTable('media_assets', {
  id: id(),
  name: text('name').notNull(),
  description: text('description'),
  storageKey: text('storage_key').notNull(),
  contentType: text('content_type').notNull(),
  sizeBytes: integer('size_bytes').notNull(),
  width: integer('width'),
  height: integer('height'),
  uploadedById: text('uploaded_by_id').references(() => users.id),
  createdAt: createdAt(),
})

export const operatorVideos = pgTable('operator_videos', {
  id: id(),
  ownerId: text('owner_id')
    .notNull()
    .references(() => users.id),
  storageKey: text('storage_key').notNull(),
  contentType: text('content_type').notNull(),
  sizeBytes: integer('size_bytes').notNull(),
  caption: text('caption'),
  transcript: text('transcript'),
  publishedAt: timestamp('published_at', { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
})

/** Names only. No dates, no promises. BUILD_SPEC §13.1. */
export const roadmapTiles = pgTable('roadmap_tiles', {
  id: id(),
  label: text('label').notNull(),
  sortOrder: integer('sort_order').notNull().default(0),
  isLive: boolean('is_live').notNull().default(false),
  hidden: boolean('hidden').notNull().default(false),
  createdAt: createdAt(),
})

/**
 * The portal's acknowledgement checkboxes. BUILD_SPEC §13, §8.2.
 *
 * §8.2: *"the portal's acknowledgement checkboxes are configurable so that
 * approved wording can be applied without a code change."* That sentence is the
 * whole reason this is a table and not a constant — the wording is a compliance
 * artefact and it belongs to the approver, not to a deployment.
 *
 * `revision` increments whenever the wording changes. It is not decoration: an
 * acknowledgement is evidence of what a person agreed to, so it is the pair
 * (item, revision) that identifies the words, and the words themselves are
 * copied onto the acknowledgement anyway.
 *
 * Archived rather than deleted. A row somebody has ticked is part of the
 * record, and a table whose history can be removed is not evidence.
 */
export const acknowledgementItems = pgTable('acknowledgement_items', {
  id: id(),
  label: text('label').notNull(),
  /** A required item must be ticked before an interest can be recorded. */
  required: boolean('required').notNull().default(true),
  sortOrder: integer('sort_order').notNull().default(0),
  revision: integer('revision').notNull().default(1),
  archivedAt: timestamp('archived_at', { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
})

/**
 * What one investor ticked, and the exact words they were shown. §13, §8.2.
 *
 * **Append-only, and it stores the wording rather than pointing at it.** An
 * acknowledgement whose text is a foreign key is an acknowledgement that can be
 * rewritten after the fact by editing a row somewhere else — which is precisely
 * what §8.2 makes configurable. So the label and the revision are copied here
 * at the moment of ticking and never touched again.
 *
 * `itemId` survives the item being archived and is deliberately not cascaded:
 * evidence does not disappear because somebody tidied a settings screen.
 */
export const responseAcknowledgements = pgTable(
  'response_acknowledgements',
  {
    id: id(),
    offerId: text('offer_id')
      .notNull()
      .references(() => offers.id, { onDelete: 'cascade' }),
    itemId: text('item_id').references(() => acknowledgementItems.id, {
      onDelete: 'set null',
    }),
    /** The words as shown, at the moment they were agreed to. */
    label: text('label').notNull(),
    revision: integer('revision').notNull(),
    acknowledgedAt: timestamp('acknowledged_at', { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('response_acknowledgements_offer_idx').on(t.offerId, t.acknowledgedAt)],
)

// ---------------------------------------------------------------------------
// Configuration, audit, export
// ---------------------------------------------------------------------------

/** Single row, id fixed to 'singleton'. BUILD_SPEC §7. */
export const serviceConfig = pgTable('service_config', {
  id: text('id').primaryKey().default('singleton'),
  serviceMode: serviceModeEnum('service_mode').notNull().default('ACTIVE'),
  sunsetClosingDate: date('sunset_closing_date'),
  serviceContactEmail: text('service_contact_email'),
  closedAccountAccess: closedAccountAccessEnum('closed_account_access')
    .notNull()
    .default('READ_ONLY'),
  decimalPlaces: integer('decimal_places').notNull().default(3),
  approvedJurisdictions: text('approved_jurisdictions').array().notNull().default([]),
  aggregateRaiseUsd: money('aggregate_raise_usd').notNull().default('30000'),
  defaultSenderName: text('default_sender_name'),
  defaultSenderEmail: text('default_sender_email'),
  defaultSenderPhone: text('default_sender_phone'),
  qaVisibleDuringRaise: boolean('qa_visible_during_raise').notNull().default(true),
  emailTransport: emailTransportEnum('email_transport').notNull().default('SMTP'),
  /** Encrypted at rest. Write-only in the UI. Never logged or exported. */
  smtpUserEncrypted: text('smtp_user_encrypted'),
  smtpPasswordEncrypted: text('smtp_password_encrypted'),
  smtpLastVerifiedAt: timestamp('smtp_last_verified_at', { withTimezone: true }),
  smtpLastVerifyResult: text('smtp_last_verify_result'),
  openAiKeyEncrypted: text('open_ai_key_encrypted'),
  openAiModel: text('open_ai_model').notNull().default('gpt-4o-mini'),
  aiMonthlyCapUsd: numeric('ai_monthly_cap_usd', { precision: 10, scale: 2 })
    .notNull()
    .default('20'),
  aiHeadersOnly: boolean('ai_headers_only').notNull().default(false),
  /**
   * The "Made by Make with Mike" credit. BUILD_SPEC §13.2 asks for it to be
   * "configurable so it can be switched off per-surface if it ever feels wrong
   * beside the offer figures" — hence two columns rather than one.
   *
   * It never appears in an invitation or on a participation certificate, and
   * that is not configurable: §13.2 is explicit that "those are formal
   * instruments about someone's money", and `attribution.test.ts` holds it
   * shut with no column to open it.
   */
  attributionOnAdmin: boolean('attribution_on_admin').notNull().default(true),
  attributionOnPortal: boolean('attribution_on_portal').notNull().default(true),
  /** Optional. When absent the credit is plain text rather than a link. */
  attributionUrl: text('attribution_url'),
  lastExportAt: timestamp('last_export_at', { withTimezone: true }),
  updatedAt: updatedAt(),
})

export const featureFlags = pgTable('feature_flags', {
  key: text('key').primaryKey(),
  enabled: boolean('enabled').notNull().default(false),
  note: text('note'),
  updatedAt: updatedAt(),
})

/** Append-only. Never updated, never deleted. BUILD_SPEC §16. */
export const auditEvents = pgTable(
  'audit_events',
  {
    id: id(),
    actorUserId: text('actor_user_id').references(() => users.id),
    actorAccountId: text('actor_account_id'),
    actorLabel: text('actor_label').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id'),
    action: text('action').notNull(),
    metadata: jsonb('metadata'),
    createdAt: createdAt(),
  },
  (t) => [
    index('audit_events_entity_idx').on(t.entityType, t.entityId),
    index('audit_events_created_idx').on(t.createdAt),
    index('audit_events_action_idx').on(t.action),
  ],
)

export const exportJobs = pgTable('export_jobs', {
  id: id(),
  requestedById: text('requested_by_id')
    .notNull()
    .references(() => users.id),
  kind: text('kind').notNull(),
  format: text('format').notNull(),
  rowCount: integer('row_count'),
  storageKey: text('storage_key'),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  createdAt: createdAt(),
})
