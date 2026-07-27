/**
 * What an erasure does, table by table, and what it deliberately keeps.
 *
 * OPEN_DECISIONS.md item 12: `/privacy` tells an investor they can "ask for it
 * to be deleted", and until now there was no way to do that — not owner-only,
 * none. The honest reading of that item is that the page does not lie (it
 * promises a *person*, not a button) but that nobody had written down how, so
 * the procedure was somebody improvising `DELETE` against a live Postgres
 * holding every investor's figures at the moment somebody had asked for
 * something they were entitled to.
 *
 * This module is the written-down part, in a form that cannot go stale: it is
 * a declaration, `plan.test.ts` checks it names **every** table in
 * `src/db/schema.ts` exactly once, and `scripts/verify-erasure.ts` runs it
 * against a real database with a second investor present and reads the rows
 * back.
 *
 * **It is pseudonymisation, not deletion, and the difference is stated rather
 * than blurred.** A `DELETE FROM investor_accounts` would cascade into
 * `offers`, which is then referenced with no `onDelete` by `portal_tokens`,
 * `conversation_messages`, `rounds` and `recipients` — the schema fights it,
 * and it should, because an offer is a securities record. So the rows stay and
 * every direct identifier and every free-text field a human typed is
 * overwritten. What is left is a transaction record with no person in it.
 *
 * ---
 *
 * **The line, and it is one line applied everywhere:**
 *
 *   *Free text a human typed goes. Structured fields — enums, figures,
 *   timestamps, hashes, foreign keys — stay.*
 *
 * Free text is where a name, an address, a circumstance or a mood ends up, and
 * no amount of reading it can prove it holds none of those. A stage enum, an
 * amount and a date are the record itself, and they are what "subject only to
 * anything that has to be retained to meet a legal or regulatory obligation"
 * on `/privacy` is about. Where the line was genuinely arguable — the country
 * on a recipient row, the answer half of a Q&A entry — the call is recorded on
 * the rule itself, in `why`, and repeated in `DEPLOYMENT.md`.
 *
 * **One thing here really is destroyed and cannot be got back:** the stored
 * bytes of a document package and of any certificate PDF. There is no
 * pseudonymising a signed subscription agreement.
 */

import { createHash } from 'node:crypto'

/**
 * Every table in `src/db/schema.ts`, by its export name.
 *
 * Written out rather than imported so that this file stays pure — no database
 * handle is created by reading it, which is what lets the plan be tested,
 * printed and reviewed without Postgres. `plan.test.ts` holds the two lists
 * together.
 */
export type SchemaTable =
  | 'users'
  | 'sessions'
  | 'signInAttempts'
  | 'oauthAccounts'
  | 'operatorInvites'
  | 'rounds'
  | 'recipients'
  | 'investorAccounts'
  | 'investorSessions'
  | 'accountStatusEvents'
  | 'offers'
  | 'offerStatusEvents'
  | 'emailTemplates'
  | 'emailSnapshots'
  | 'sendEvents'
  | 'portalTokens'
  | 'emailChangeRequests'
  | 'investorResponses'
  | 'conversationMessages'
  | 'commitments'
  | 'paymentInstructions'
  | 'fundsReceipts'
  | 'documentPackages'
  | 'participationCertificates'
  | 'portalUpdates'
  | 'updateDeliveries'
  | 'qaEntries'
  | 'qaThreadMessages'
  | 'interestRegisterEntries'
  | 'complianceApprovals'
  | 'reminderSchedules'
  | 'reminderEvents'
  | 'importJobs'
  | 'columnMappings'
  | 'aiProposals'
  | 'aiUsageEvents'
  | 'mediaAssets'
  | 'operatorVideos'
  | 'roadmapTiles'
  | 'acknowledgementItems'
  | 'responseAcknowledgements'
  | 'serviceConfig'
  | 'featureFlags'
  | 'auditEvents'
  | 'exportJobs'

/**
 * What happens to a column.
 *
 * `CLEAR` is only ever put against a nullable column and `REDACT` only against
 * a `notNull` one; `plan.test.ts` proves both against the schema text, because
 * getting that backwards is a not-null violation discovered during somebody's
 * erasure rather than during a test run.
 */
export type FieldTreatment =
  /** Replaced with `Erased investor <ref>`. */
  | 'PSEUDONYM_NAME'
  /** Replaced with `erased-<ref>@erased.invalid`. Never deliverable. */
  | 'PSEUDONYM_EMAIL'
  /** Replaced with the marker below. For `notNull` text. */
  | 'REDACT'
  /** Set to null. For nullable columns only. */
  | 'CLEAR'
  /** Replaced with a fixed jsonb marker object. */
  | 'REDACT_JSON'

/** What stands in for redacted free text. Deliberately a sentence. */
export const ERASED_MARKER = '[erased at the investor’s request]'

/** What stands in for a redacted jsonb document. */
export const ERASED_JSON: Readonly<Record<string, unknown>> = Object.freeze({
  erased: true,
  note: ERASED_MARKER,
})

/**
 * What stands in for a storage key whose object has been destroyed.
 *
 * Not null and not the old key. A null would make the row indistinguishable
 * from one that never had a file; the old key would send `pnpm media:check`
 * looking for an object that is gone on purpose and reporting it as a fault.
 */
export const ERASED_STORAGE_KEY = 'erased'

export interface FieldRule {
  table: SchemaTable
  column: string
  treatment: FieldTreatment
  /** Why this column, in one sentence. Read by a person under time pressure. */
  why: string
}

export interface RetentionRule {
  table: SchemaTable
  /** Why nothing here is touched. Every table needs one. */
  why: string
}

/**
 * Rows removed outright, because they are a counter rather than a record.
 *
 * There is exactly one, and it is deliberately not in the account's own graph:
 * `sign_in_attempts` is keyed by the email address itself and holds a failure
 * count and a lockout time. Keeping a pseudonymised row would keep the shape
 * of somebody's failed sign-ins against an address that no longer exists,
 * which is worse than useless — it is a record of a person for no reason.
 */
export interface PurgeRule {
  table: SchemaTable
  /** How the rows are found. Prose; the executor implements it. */
  matchedBy: string
  why: string
}

// ---------------------------------------------------------------------------
// The account's own row
// ---------------------------------------------------------------------------

const FIELD_RULES: readonly FieldRule[] = [
  {
    table: 'investorAccounts',
    column: 'name',
    treatment: 'PSEUDONYM_NAME',
    why: 'The investor’s name, and the one field every screen renders.',
  },
  {
    table: 'investorAccounts',
    column: 'email',
    treatment: 'PSEUDONYM_EMAIL',
    why:
      'The address is the account’s identity and its unique key, so it is replaced rather ' +
      'than emptied. The replacement is under .invalid (RFC 2606), which no mail server ' +
      'will ever deliver to — an erased account cannot be written to by accident.',
  },

  // -------------------------------------------------------------------------
  // The people the round was imported from
  // -------------------------------------------------------------------------
  {
    table: 'recipients',
    column: 'name',
    treatment: 'PSEUDONYM_NAME',
    why: 'The name as it arrived in the import file.',
  },
  {
    table: 'recipients',
    column: 'email',
    treatment: 'PSEUDONYM_EMAIL',
    why:
      'Unique per round, so the replacement is derived from the recipient id rather than ' +
      'the account id — one account can hold more than one recipient row.',
  },
  {
    table: 'recipients',
    column: 'internalNotes',
    treatment: 'CLEAR',
    why: 'Operator free text about a named person. The clearest case on the list.',
  },
  {
    table: 'recipients',
    column: 'senderName',
    treatment: 'CLEAR',
    why:
      'Per-recipient sender overrides. Not the investor’s own data, but they are free text ' +
      'attached to one person’s row and the defaults in service_config carry the same values.',
  },
  {
    table: 'recipients',
    column: 'senderEmail',
    treatment: 'CLEAR',
    why: 'The same override, and an address written beside one named person’s row.',
  },
  {
    table: 'recipients',
    column: 'senderPhone',
    treatment: 'CLEAR',
    why: 'The same override, and a telephone number written beside one named person’s row.',
  },

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------
  {
    table: 'accountStatusEvents',
    column: 'reason',
    treatment: 'REDACT',
    why:
      'notNull free text. `changeAccountStatus` deliberately keeps the reason off the audit ' +
      'log because it may name a person or a circumstance — which is exactly why it goes here.',
  },

  // -------------------------------------------------------------------------
  // The offer: figures stay, prose goes
  // -------------------------------------------------------------------------
  {
    table: 'offers',
    column: 'responseNote',
    treatment: 'CLEAR',
    why: 'What the investor typed when they responded. Their words.',
  },
  {
    table: 'offers',
    column: 'blockDetail',
    treatment: 'CLEAR',
    why:
      'Operator free text explaining one person’s block. `blockReason` is an enum and stays, ' +
      'so the compliance record still says a block happened and of what kind.',
  },
  {
    table: 'offerStatusEvents',
    column: 'reason',
    treatment: 'CLEAR',
    why: 'Free text on a stage change. The stages themselves stay.',
  },
  {
    table: 'offerStatusEvents',
    column: 'investorNote',
    treatment: 'CLEAR',
    why: 'Written by the operator, and it usually quotes the investor.',
  },
  {
    table: 'offerStatusEvents',
    column: 'internalNote',
    treatment: 'CLEAR',
    why:
      'The same shape as investorNote, and usually less guarded because nobody expected the ' +
      'investor to read it.',
  },

  // -------------------------------------------------------------------------
  // Mail
  // -------------------------------------------------------------------------
  {
    table: 'emailSnapshots',
    column: 'subject',
    treatment: 'REDACT',
    why: 'Carries the name in most templates.',
  },
  {
    table: 'emailSnapshots',
    column: 'htmlBody',
    treatment: 'REDACT',
    why:
      'The whole personalised email: name, address, four figures. `templateHash` stays, so ' +
      'which template was sent is still provable against email_templates.',
  },
  {
    table: 'emailSnapshots',
    column: 'textBody',
    treatment: 'REDACT',
    why: 'The plain-text half of the same email, and it carries exactly the same personalisation.',
  },
  {
    table: 'emailSnapshots',
    column: 'toAddress',
    treatment: 'PSEUDONYM_EMAIL',
    why: 'The address it went to. Replaced rather than redacted so it still reads as an address.',
  },
  {
    table: 'sendEvents',
    column: 'errorDetail',
    treatment: 'CLEAR',
    why:
      'An SMTP rejection quotes the recipient address back. The outcome enum stays, so a ' +
      'failed send is still a failed send.',
  },

  // -------------------------------------------------------------------------
  // Their own words
  // -------------------------------------------------------------------------
  {
    table: 'emailChangeRequests',
    column: 'newEmail',
    treatment: 'PSEUDONYM_EMAIL',
    why: 'An address they asked to move to.',
  },
  {
    table: 'emailChangeRequests',
    column: 'previousEmail',
    treatment: 'CLEAR',
    why: 'Nullable, and an address they used to hold.',
  },
  {
    table: 'investorResponses',
    column: 'message',
    treatment: 'CLEAR',
    why: 'The message attached to a response. Their words.',
  },
  {
    table: 'conversationMessages',
    column: 'body',
    treatment: 'REDACT',
    why: 'notNull. The entire thread, in both directions.',
  },
  {
    table: 'conversationMessages',
    column: 'emailMessageId',
    treatment: 'CLEAR',
    why:
      'A Message-ID threads back into a mailbox and is how a reply would be matched to them. ' +
      'Keeping it would keep a handle on the person after the words were gone.',
  },
  {
    table: 'conversationMessages',
    column: 'inReplyTo',
    treatment: 'CLEAR',
    why: 'The other half of the same thread handle, and it points at the same mailbox.',
  },

  // -------------------------------------------------------------------------
  // Money: the figures stay, the notes go
  // -------------------------------------------------------------------------
  {
    table: 'commitments',
    column: 'note',
    treatment: 'CLEAR',
    why: 'Free text beside the amount. The amount and the percentage stay untouched.',
  },
  {
    table: 'paymentInstructions',
    column: 'deliveryNote',
    treatment: 'CLEAR',
    why: 'How the instructions were delivered, in prose. Often "phoned him on the mobile".',
  },
  {
    table: 'fundsReceipts',
    column: 'reference',
    treatment: 'REDACT',
    why:
      'notNull, and a bank reference names the payer more often than not. The amount, the ' +
      'currency and the value date all stay — that is the receipt.',
  },

  // -------------------------------------------------------------------------
  // Documents
  // -------------------------------------------------------------------------
  {
    table: 'documentPackages',
    column: 'title',
    treatment: 'REDACT',
    why: 'notNull, and titles are written as "Subscription agreement — <name>".',
  },
  {
    table: 'documentPackages',
    column: 'description',
    treatment: 'CLEAR',
    why: 'Free text beside a document, written by whoever uploaded it and about one person.',
  },
  {
    table: 'documentPackages',
    column: 'storageKey',
    treatment: 'REDACT',
    why:
      'The stored object is destroyed first — there is no pseudonymising a signed agreement — ' +
      'and the key is then replaced so media:check does not report the absence as a fault. ' +
      'sizeBytes, version and issuedAt stay: a document existed, and that is part of the record.',
  },
  {
    table: 'participationCertificates',
    column: 'data',
    treatment: 'REDACT_JSON',
    why: 'The frozen snapshot: name and figures, in jsonb.',
  },
  {
    table: 'participationCertificates',
    column: 'storageKey',
    treatment: 'CLEAR',
    why:
      'Nullable and normally already null — a certificate is rendered on demand. Where one ' +
      'was stored, the object is destroyed first.',
  },

  // -------------------------------------------------------------------------
  // Q&A
  // -------------------------------------------------------------------------
  {
    table: 'qaEntries',
    column: 'questionOriginal',
    treatment: 'REDACT',
    why: 'notNull. The question exactly as they typed it, kept verbatim by design until now.',
  },
  {
    table: 'qaEntries',
    column: 'questionPublic',
    treatment: 'CLEAR',
    why:
      'The de-identified rewrite. Anonymised is not erased: it is still their question, and ' +
      'the entry is unpublished in the same statement so the shared page loses it too.',
  },
  {
    table: 'qaEntries',
    column: 'notifyFailure',
    treatment: 'CLEAR',
    why: 'A delivery error, which quotes the address.',
  },
  {
    table: 'qaThreadMessages',
    column: 'body',
    treatment: 'REDACT',
    why: 'notNull. The follow-up thread on a question.',
  },

  // -------------------------------------------------------------------------
  // Register of interest
  // -------------------------------------------------------------------------
  {
    table: 'interestRegisterEntries',
    column: 'overrideReason',
    treatment: 'CLEAR',
    why: 'Why the operator moved one named person up the order.',
  },

  // -------------------------------------------------------------------------
  // The audit log — the one place where this is a real trade
  // -------------------------------------------------------------------------
  {
    table: 'auditEvents',
    column: 'actorLabel',
    treatment: 'PSEUDONYM_EMAIL',
    why:
      'notNull, and for an investor actor it is their email address. Only rows whose ' +
      'actorAccountId is this account are touched, and only this one column: every action, ' +
      'entity, timestamp and metadata object survives intact. No audit row is removed and ' +
      'none is added by this pass. The events are the record; the address is not.',
  },
]

/**
 * The answer half of a Q&A entry is deliberately absent from the list above.
 *
 * It is David's writing, it was published to every investor, and other people
 * have read it. Erasing one person's data should not silently edit what
 * everybody else was told. Unpublishing the entry removes it from the shared
 * page; the answer stays in the internal record attached to a question that no
 * longer exists. Recorded here because a reader will look for it.
 */
export const ANSWER_IS_KEPT_BECAUSE =
  'A published answer is the operator’s writing and other investors have read it. The entry ' +
  'is unpublished so it leaves the shared page; the answer text itself is not one person’s ' +
  'to erase.'

const PURGE_RULES: readonly PurgeRule[] = [
  {
    table: 'signInAttempts',
    matchedBy: 'key = the erased email address',
    why:
      'A failure counter and a lockout time, keyed by the address itself. It is not a record ' +
      'of anything — §20 already excludes it from the export — and a pseudonymised row would ' +
      'preserve the shape of somebody’s failed sign-ins for no purpose at all.',
  },
]

const RETENTION_RULES: readonly RetentionRule[] = [
  {
    table: 'users',
    why: 'Owner and operator accounts. Not an investor, and out of this procedure’s scope.',
  },
  { table: 'sessions', why: 'Administrator sessions, belonging to the owner and the operator rather than investors.' },
  { table: 'oauthAccounts', why: 'Staff. Empty in this deployment — sign-in is email and password.' },
  { table: 'operatorInvites', why: 'Staff invitations to the admin side. No investor appears in this table at all.' },
  {
    table: 'rounds',
    why: 'The round, its target and its dates. Shared by every investor; names nobody.',
  },
  {
    table: 'investorSessions',
    why:
      'A session token and two timestamps. No identifying text. Every live one is revoked by ' +
      'the erasure, which is a state change rather than an erasure.',
  },
  {
    table: 'portalTokens',
    why:
      'A hash and its lifetime. Revoked rather than altered, for the same reason: a spent ' +
      'link is part of the record of what was issued.',
  },
  {
    table: 'emailTemplates',
    why: 'The templates themselves, with no recipient in them. Retaining them is what makes ' +
      'a redacted snapshot still provable — the hash on the snapshot points here.',
  },
  {
    table: 'updateDeliveries',
    why:
      'Two timestamps and two foreign keys. Whether a pseudonymous account was notified and ' +
      'read an update carries no identity once the account is pseudonymised.',
  },
  {
    table: 'complianceApprovals',
    why:
      'The approver is a third party at the formation agents, not the investor, and the ' +
      'approval is what made every send lawful. Nothing here is the investor’s to erase.',
  },
  { table: 'portalUpdates', why: 'Written by the operator and published to every investor. Nobody’s to erase alone.' },
  { table: 'reminderSchedules', why: 'Round-level configuration: which days a reminder falls on, and a per-recipient cap.' },
  {
    table: 'reminderEvents',
    why:
      'Timestamps, a sequence number and a skip reason drawn from a fixed set. No free text ' +
      'and no address.',
  },
  {
    table: 'importJobs',
    why:
      'A filename, the source column headers and a row count. The headers are column names, ' +
      'not cell values. If an operator ever names a file after a person, that is a fact about ' +
      'the file and is called out in the DEPLOYMENT.md runbook as the one thing to eyeball.',
  },
  { table: 'columnMappings', why: 'The mapping from spreadsheet column names to fields. Header names, never cell values.' },
  {
    table: 'aiProposals',
    why:
      'A model name, a prompt summary and the proposal. What reaches the model is governed by ' +
      'aiHeadersOnly; where that is off, the runbook says to check this table by hand, because ' +
      'this plan will not guess which rows saw a cell value.',
  },
  { table: 'aiUsageEvents', why: 'Token counts and an estimated cost against the AI spend cap. Figures, and nothing else.' },
  { table: 'mediaAssets', why: 'The brand image library, uploaded by an administrator. Not investor data in any sense.' },
  { table: 'operatorVideos', why: 'David’s own recording of himself, published by him. His personal data, not an investor’s.' },
  { table: 'roadmapTiles', why: 'The roadmap tiles shown on the portal. Product copy written by the owner.' },
  { table: 'acknowledgementItems', why: 'The catalogue of tick-boxes an investor is shown. Archived rather than deleted, and it names nobody.' },
  {
    table: 'responseAcknowledgements',
    why:
      'The label and revision are copied verbatim from the catalogue, not written by anyone. ' +
      'This is the evidence that a specific disclosure was shown and accepted before money ' +
      'moved, and it identifies nobody once the offer it hangs from is pseudonymised.',
  },
  { table: 'serviceConfig', why: 'One row of deployment settings and encrypted credentials.' },
  { table: 'featureFlags', why: 'Deployment feature flags: a key, a boolean and a note about why it is set that way.' },
  { table: 'exportJobs', why: 'What was exported, when, and how many rows. No names.' },
]

// ---------------------------------------------------------------------------
// The plan as a whole
// ---------------------------------------------------------------------------

export const ERASURE_FIELD_RULES = FIELD_RULES
export const ERASURE_PURGE_RULES = PURGE_RULES
export const ERASURE_RETENTION_RULES = RETENTION_RULES

/** Tables this procedure writes to, in the order the executor visits them. */
export function tablesTouched(): SchemaTable[] {
  const seen: SchemaTable[] = []
  for (const rule of FIELD_RULES) if (!seen.includes(rule.table)) seen.push(rule.table)
  for (const rule of PURGE_RULES) if (!seen.includes(rule.table)) seen.push(rule.table)
  return seen
}

/** Field rules for one table, in declaration order. */
export function rulesFor(table: SchemaTable): FieldRule[] {
  return FIELD_RULES.filter((rule) => rule.table === table)
}

/**
 * Every table named anywhere in the plan, once.
 *
 * `plan.test.ts` compares this against `src/db/schema.ts` and fails if a table
 * exists that this document has no opinion about. That is the property that
 * stops the plan going stale the way `OPEN_DECISIONS.md` did.
 */
export function tablesAccountedFor(): SchemaTable[] {
  const all = new Set<SchemaTable>()
  for (const rule of FIELD_RULES) all.add(rule.table)
  for (const rule of PURGE_RULES) all.add(rule.table)
  for (const rule of RETENTION_RULES) all.add(rule.table)
  return [...all].sort()
}

// ---------------------------------------------------------------------------
// The pseudonym
// ---------------------------------------------------------------------------

/**
 * The short reference that stands in for a person, derived from a row id.
 *
 * Twelve hex characters of SHA-256 over the id. Three properties are wanted
 * and one is explicitly not:
 *
 *   - **Stable.** Running the erasure twice produces the same pseudonym, so a
 *     retry after a half-finished run converges rather than making a second
 *     fictional person.
 *   - **Unique.** Derived from a primary key, so two accounts cannot collide
 *     on `investor_accounts.email`, which is `notNull().unique()`.
 *   - **Meaningless.** It says nothing about the person. It is a label for
 *     "the account formerly at this row", which is what the remaining record
 *     needs in order to still be readable.
 *
 * What it is *not* is a secret. The row id sits in the same row, so anybody
 * who can read the table can recompute it. That is fine — it is not protecting
 * anything. The protection is that the name, the address and the free text are
 * gone.
 */
export function pseudonymRef(rowId: string): string {
  return createHash('sha256').update(rowId).digest('hex').slice(0, 12)
}

export function pseudonymName(rowId: string): string {
  return `Erased investor ${pseudonymRef(rowId)}`
}

/**
 * `.invalid` is reserved by RFC 2606 and resolves nowhere, by standard.
 *
 * This matters more than it looks. The one rule this application will not bend
 * is that it never writes to a real address by accident, and an erased account
 * that still held a plausible-looking address would be one bad WHERE clause
 * away from being written to. An address under `.invalid` cannot be delivered
 * to by any mail server anywhere.
 */
export function pseudonymEmail(rowId: string): string {
  return `erased-${pseudonymRef(rowId)}@erased.invalid`
}

/** True for anything this module would have produced. Used by the verifier. */
export function looksErased(value: string | null): boolean {
  if (value === null) return true
  return (
    value === ERASED_MARKER ||
    value === ERASED_STORAGE_KEY ||
    /^Erased investor [0-9a-f]{12}$/.test(value) ||
    /^erased-[0-9a-f]{12}@erased\.invalid$/.test(value)
  )
}
