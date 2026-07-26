/**
 * Changing the contact address on an investor's record. BUILD_SPEC §13.
 *
 * §13's line is nine words long — *"Change of contact email, effective only
 * after the new address is verified"* — and the whole feature is in the second
 * half. Nothing moves when the investor types an address. The record changes at
 * the moment somebody opens a single-use link **in the new mailbox**, which is
 * the only evidence this application can have that the address belongs to them.
 * Until then the row in `email_change_requests` is a question, not an answer.
 *
 * Three rules shape everything below.
 *
 * **The address list is confidential.** §15, and it is the reason the refusal
 * for "that address already belongs to somebody else" is identical to success.
 * A signed-in investor who could tell an available address from a taken one
 * could walk a list of addresses and learn who else was invited into a private
 * securities round, one guess at a time. So a collision produces the same
 * sentence, the same elapsed time, and no email to anybody — the address on the
 * other side of the collision belongs to a person who did not ask to be told
 * that somebody is trying to move onto it.
 *
 * **The old mailbox gets told.** An address change is what an account takeover
 * looks like from the inside, and the holder of the old mailbox is the only
 * person positioned to notice. They are written to on confirmation, with a
 * contact route, which is why `previousEmail` is a column.
 *
 * **Confirming moves the address and nothing else.** It does not sign anybody
 * in. A sign-in link proves mailbox control in order to hand over a session;
 * this link proves mailbox control in order to record an address, and widening
 * it into a session would make the confirmation email a second, quieter way in.
 */

import { and, desc, eq, isNotNull, isNull, ne } from 'drizzle-orm'
import { db } from '@/db'
import { emailChangeRequests, investorAccounts } from '@/db/schema'
import { audit } from '@/lib/audit'
import { readServiceConfig } from '@/lib/auth/service-config'
import { hashToken, issueToken, tokensMatch } from '@/lib/crypto'
import { portalAccess, type AccountStatus } from './access'
import { revokeAllPortalAccess } from './claim'

/**
 * One hour.
 *
 * Shorter than the forty-five-minute sign-in link is not possible without being
 * absurd, and the fourteen days a claim link gets would be wrong: a claim link
 * arrives unrequested and may reasonably be read days later, whereas this one
 * is asked for by somebody sitting in front of the portal with the new mailbox
 * open. An hour covers "I had to go and find the password for that account"
 * and does not cover a link left lying in an inbox overnight.
 */
export const EMAIL_CHANGE_TOKEN_TTL_MINUTES = 60

/**
 * The one sentence a request produces, whatever happened.
 *
 * Deliberately without a variant. It is what an investor sees when the link is
 * genuinely on its way, and what they see when the address they typed already
 * belongs to another record — because the second case must be indistinguishable
 * from the first (§15). It says what will happen next and makes no claim about
 * the address itself.
 */
export const EMAIL_CHANGE_REQUESTED_MESSAGE =
  'Thank you. If that address can be used, we have emailed a confirmation link to it. ' +
  'Open the link from that mailbox and it becomes the contact address on your record. ' +
  'Nothing has changed yet, and the link expires in an hour.'

/**
 * The sentence for an address that is already the one on the record.
 *
 * This one is allowed to be specific, and it is the only refusal that is: the
 * address in question is the investor's own, already on the screen in front of
 * them, so saying so reveals nothing they did not type.
 */
export const EMAIL_CHANGE_SAME_ADDRESS_MESSAGE =
  'That is already the contact address on your record, so there is nothing to change.'

export const EMAIL_CHANGE_UNREADABLE_MESSAGE =
  'That does not look like an email address we can send to. Nothing has been changed.'

export const EMAIL_CHANGE_READ_ONLY_MESSAGE =
  'This portal is currently read-only, so the contact address cannot be changed at this ' +
  'time. Nothing about your existing record has changed.'

/**
 * The receipt shown after a successful confirmation.
 *
 * It names no address and no record, because the page that shows it can be
 * reached by typing the path. "This address" is as specific as it may be: the
 * reader is holding the mailbox and knows which one that is.
 */
export const EMAIL_CHANGE_CONFIRMED_MESSAGE =
  'This address is now the contact address on the record it was requested for. For safety, ' +
  'any sign-in links issued before now have stopped working and anywhere still signed in ' +
  'has been signed out — sign in again below. We have told the previous address that this ' +
  'happened.'

/** The one sentence a failed confirmation produces. No variant, same reasoning. */
export const EMAIL_CHANGE_FAILED_MESSAGE =
  'This link cannot be used. It may have already been used, it may have expired — these ' +
  'links work once — or the address on the record may have changed since it was sent. ' +
  'Nothing has been changed. You can ask for the change again from your portal.'

/** Never returned to the browser. For the audit log and for tests. */
export type EmailChangeRequestDetail =
  | 'ISSUED'
  | 'UNREADABLE'
  | 'SAME_ADDRESS'
  | 'ADDRESS_TAKEN'
  | 'NOT_PERMITTED'
  | 'NO_SUCH_ACCOUNT'

export interface RequestEmailChangeInput {
  accountId: string
  newEmail: string
  now?: Date
}

export interface RequestEmailChangeOutcome {
  /** Whether there is an email to send. Never shown to the investor. */
  issued: boolean
  /** Present only when `issued`. Never logged, never returned to a browser. */
  token: string | null
  requestId: string | null
  detail: EmailChangeRequestDetail
}

/**
 * Trim and lower-case, which is what every lookup in this application does.
 *
 * `requestSignInLink` matches on a lower-cased address and nothing has ever
 * written one, because until now nothing wrote `investor_accounts.email` at
 * all. This is the first writer, so it is the first place the two could
 * disagree — an address stored with a capital letter would be a record its
 * owner could no longer sign in to, which is a locked door rather than a typo.
 */
export function normaliseEmail(value: string): string {
  return value.trim().toLowerCase()
}

/**
 * Is this a shape we can send to?
 *
 * Deliberately narrow rather than clever. A single `@`, something either side,
 * a dot in the domain, no whitespace, no angle brackets or commas — the
 * characters that turn one address into two in a header. RFC 5322 permits far
 * stranger things than this accepts; a securities portal refusing an exotic but
 * legal address is a conversation, and an address that splits into a second
 * recipient is an incident.
 */
export function isSendableAddress(value: string): boolean {
  if (value.length === 0 || value.length > 320) return false
  if (/[\s,;<>"\\]/.test(value)) return false
  const parts = value.split('@')
  if (parts.length !== 2) return false
  const [local, domain] = parts
  if (local.length === 0 || local.length > 64) return false
  if (domain.length === 0 || !domain.includes('.')) return false
  if (domain.startsWith('.') || domain.endsWith('.') || domain.includes('..')) return false
  return true
}

/**
 * Ask to move the contact address.
 *
 * Every path writes the same outcome shape and the caller returns the same
 * sentence for all of them; only `issued` decides whether an email follows.
 */
export async function requestEmailChange(
  input: RequestEmailChangeInput,
): Promise<RequestEmailChangeOutcome> {
  const now = input.now ?? new Date()
  const newEmail = normaliseEmail(input.newEmail)

  const nothing = (detail: EmailChangeRequestDetail): RequestEmailChangeOutcome => ({
    issued: false,
    token: null,
    requestId: null,
    detail,
  })

  if (!isSendableAddress(newEmail)) return nothing('UNREADABLE')

  const account = await db.query.investorAccounts.findFirst({
    where: eq(investorAccounts.id, input.accountId),
    columns: { id: true, email: true, status: true },
  })
  if (!account) return nothing('NO_SUCH_ACCOUNT')

  if (normaliseEmail(account.email) === newEmail) return nothing('SAME_ADDRESS')

  // §7. A read-only or closing portal is a record to be read, not a surface to
  // be changed — and the address is what a reminder and a notice would be sent
  // to, so moving it in a mode where nothing may be sent is a change with no
  // way to be verified.
  const config = await readServiceConfig()
  const access = portalAccess({
    accountStatus: account.status as AccountStatus,
    closedAccountAccess: config.closedAccountAccess,
    serviceMode: config.serviceMode,
  })
  if (access.capability !== 'FULL') return nothing('NOT_PERMITTED')

  // The address list is confidential (§15). A collision is recorded for the
  // operator and is silent outward — no email to the requester's chosen
  // address, because that address belongs to somebody who did not ask to hear
  // from us, and no different sentence to the requester.
  const taken = await db.query.investorAccounts.findFirst({
    where: and(eq(investorAccounts.email, newEmail), ne(investorAccounts.id, account.id)),
    columns: { id: true },
  })
  if (taken) {
    await audit({
      actor: { kind: 'investor', id: account.id, label: 'investor' },
      entityType: 'investor_account',
      entityId: account.id,
      // No address in the metadata, and specifically not the one that
      // collided: it identifies another investor.
      action: 'portal.email_change_refused',
      metadata: { reason: 'ADDRESS_TAKEN' },
    })
    return nothing('ADDRESS_TAKEN')
  }

  // Asking twice must not leave two live ways to move the address.
  await db
    .update(emailChangeRequests)
    .set({ revokedAt: now })
    .where(
      and(
        eq(emailChangeRequests.accountId, account.id),
        isNull(emailChangeRequests.confirmedAt),
        isNull(emailChangeRequests.revokedAt),
      ),
    )

  const { token, hash } = issueToken()

  const [row] = await db
    .insert(emailChangeRequests)
    .values({
      accountId: account.id,
      newEmail,
      previousEmail: normaliseEmail(account.email),
      tokenHash: hash,
      expiresAt: new Date(now.getTime() + EMAIL_CHANGE_TOKEN_TTL_MINUTES * 60 * 1000),
    })
    .returning({ id: emailChangeRequests.id })

  await audit({
    actor: { kind: 'investor', id: account.id, label: 'investor' },
    entityType: 'investor_account',
    entityId: account.id,
    action: 'portal.email_change_requested',
    // The token is not in here and never will be. Neither is either address —
    // the request row holds those, and an audit log is exported (§20).
    metadata: { expiresInMinutes: EMAIL_CHANGE_TOKEN_TTL_MINUTES },
  })

  return { issued: true, token, requestId: row.id, detail: 'ISSUED' }
}

// ---------------------------------------------------------------------------
// Confirming
// ---------------------------------------------------------------------------

export type ConfirmEmailChangeDetail =
  | 'OK'
  | 'UNKNOWN_TOKEN'
  | 'ALREADY_USED'
  | 'REVOKED'
  | 'EXPIRED'
  | 'ACCOUNT_MOVED'
  | 'ADDRESS_TAKEN'
  | 'NOT_PERMITTED'

export type ConfirmEmailChangeResult =
  | { ok: true; accountId: string; requestId: string }
  | { ok: false; detail: ConfirmEmailChangeDetail }

/**
 * Redeem the link from the new mailbox, and move the address.
 *
 * Single use is enforced by a conditional UPDATE inside the transaction that
 * moves the address, not by reading the row and then writing it, so two
 * simultaneous redemptions cannot both succeed and a failure to move the
 * address cannot leave the request marked as spent.
 */
export async function confirmEmailChange(
  rawToken: string,
  options: { now?: Date } = {},
): Promise<ConfirmEmailChangeResult> {
  const token = rawToken.trim()
  if (token === '') return { ok: false, detail: 'UNKNOWN_TOKEN' }

  const now = options.now ?? new Date()

  const row = await db.query.emailChangeRequests.findFirst({
    where: eq(emailChangeRequests.tokenHash, hashToken(token)),
  })

  // Constant-time comparison as well as the hash lookup, for the same reason
  // `claimPortalToken` does it.
  if (!row || !tokensMatch(token, row.tokenHash)) {
    return { ok: false, detail: 'UNKNOWN_TOKEN' }
  }

  if (row.revokedAt !== null) return { ok: false, detail: 'REVOKED' }
  if (row.confirmedAt !== null) return { ok: false, detail: 'ALREADY_USED' }
  if (row.expiresAt.getTime() <= now.getTime()) return { ok: false, detail: 'EXPIRED' }

  const account = await db.query.investorAccounts.findFirst({
    where: eq(investorAccounts.id, row.accountId),
    columns: { id: true, email: true, status: true },
  })
  if (!account) return { ok: false, detail: 'UNKNOWN_TOKEN' }

  // The state is asked about now, not as it was when the link was sent. An
  // account suspended in the meantime does not get its address moved by a link
  // that was in flight.
  const config = await readServiceConfig()
  const access = portalAccess({
    accountStatus: account.status as AccountStatus,
    closedAccountAccess: config.closedAccountAccess,
    serviceMode: config.serviceMode,
  })
  if (access.capability !== 'FULL') return { ok: false, detail: 'NOT_PERMITTED' }

  // The record must still carry the address this request was made against. If
  // it does not, something else moved it and this link is answering a question
  // about a state that no longer exists.
  if (row.previousEmail !== null && normaliseEmail(account.email) !== row.previousEmail) {
    return { ok: false, detail: 'ACCOUNT_MOVED' }
  }

  const taken = await db.query.investorAccounts.findFirst({
    where: and(
      eq(investorAccounts.email, row.newEmail),
      ne(investorAccounts.id, account.id),
    ),
    columns: { id: true },
  })
  if (taken) return { ok: false, detail: 'ADDRESS_TAKEN' }

  let moved = false
  try {
    await db.transaction(async (tx) => {
      const [spent] = await tx
        .update(emailChangeRequests)
        .set({ confirmedAt: now })
        .where(
          and(
            eq(emailChangeRequests.id, row.id),
            isNull(emailChangeRequests.confirmedAt),
            isNull(emailChangeRequests.revokedAt),
          ),
        )
        .returning({ id: emailChangeRequests.id })

      if (!spent) return

      await tx
        .update(investorAccounts)
        .set({
          email: row.newEmail,
          // Opening this link is the verification. §13's "effective only after
          // the new address is verified" is this line and the one above it.
          emailVerifiedAt: now,
          updatedAt: now,
        })
        .where(eq(investorAccounts.id, account.id))

      moved = true
    })
  } catch {
    // A unique-constraint violation from a race with another confirmation. The
    // transaction rolled back, so the request is not spent and the address did
    // not move. The error object is deliberately dropped: it is a database
    // message containing the address that collided.
    return { ok: false, detail: 'ADDRESS_TAKEN' }
  }

  if (!moved) return { ok: false, detail: 'ALREADY_USED' }

  // Every link and session that reached the old mailbox is now dead.
  //
  // This is the conservative reading and it is the whole security value of the
  // feature. The commonest reason to move a contact address in a hurry is that
  // the old mailbox is no longer yours, and outstanding sign-in links sitting
  // in it are exactly what somebody holding it would use. §4.2 already pairs
  // "sessions terminated" with "outstanding links revoked" for suspension; the
  // same pair applies here, at the cost of one sign-in.
  await revokeAllPortalAccess(account.id)

  await audit({
    actor: { kind: 'investor', id: account.id, label: 'investor' },
    entityType: 'investor_account',
    entityId: account.id,
    action: 'portal.email_change_confirmed',
    metadata: { requestId: row.id },
  })

  return { ok: true, accountId: account.id, requestId: row.id }
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

export interface PendingEmailChange {
  /** The address the investor asked for. Their own submission, shown back. */
  newEmail: string
  expiresAt: Date
}

/**
 * The outstanding request for this account, if there is one.
 *
 * Bound to the account id, so there is no argument that could return somebody
 * else's pending change.
 */
export async function pendingEmailChange(
  accountId: string,
  options: { now?: Date } = {},
): Promise<PendingEmailChange | null> {
  const now = options.now ?? new Date()

  const row = await db.query.emailChangeRequests.findFirst({
    where: and(
      eq(emailChangeRequests.accountId, accountId),
      isNull(emailChangeRequests.confirmedAt),
      isNull(emailChangeRequests.revokedAt),
    ),
    orderBy: desc(emailChangeRequests.createdAt),
    columns: { newEmail: true, expiresAt: true },
  })

  if (!row) return null
  if (row.expiresAt.getTime() <= now.getTime()) return null

  return { newEmail: row.newEmail, expiresAt: row.expiresAt }
}

/**
 * The address a record was moved to, for §20's `updated contact email` column.
 *
 * The newest **confirmed** request, and nothing else — an outstanding request
 * is not a changed address, and an export that showed one would be reporting
 * something that has not happened.
 */
export async function confirmedEmailChangeFor(
  accountId: string,
): Promise<string | null> {
  // `isNotNull` rather than sorting and checking, because Postgres sorts NULLs
  // first on a DESC ordering — an outstanding request would have come back at
  // the top of that list and read as "no change", which is the wrong answer for
  // the wrong reason.
  const row = await db.query.emailChangeRequests.findFirst({
    where: and(
      eq(emailChangeRequests.accountId, accountId),
      isNotNull(emailChangeRequests.confirmedAt),
    ),
    orderBy: desc(emailChangeRequests.confirmedAt),
    columns: { newEmail: true },
  })

  return row?.newEmail ?? null
}
