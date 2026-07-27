/**
 * Carrying out an erasure. OPEN_DECISIONS.md item 12.
 *
 * `plan.ts` says what happens and why. This says it once, in SQL, inside one
 * transaction, and refuses in every case where it cannot say all of it.
 *
 * **Two functions, and the first one is the point.** `previewErasure` reads
 * and changes nothing; it answers "what is actually here for this person"
 * before anybody presses anything. Item 12's complaint was never that deletion
 * was impossible — it was that the procedure was improvised at the moment
 * somebody had asked for it. A preview is the difference between a decision
 * and a keystroke.
 *
 * **Order of operations, and each step is where it is for a reason:**
 *
 *   1. Refuse early — no such account, already erased, or stored objects that
 *      cannot be reached. A half-finished erasure is worse than none.
 *   2. Destroy the stored bytes. **Before** the database write, because the
 *      keys that name them are about to be overwritten. If this half succeeds
 *      and the transaction then fails, a retry finds the objects already gone
 *      and carries on; the reverse order would leave a signed agreement in a
 *      bucket with nothing pointing at it.
 *   3. One transaction for every column in the plan, plus the audit-label
 *      pass, plus unpublishing the Q&A, plus the status change.
 *   4. Revoke every session and every unspent link.
 *   5. Write the audit row, last, so it cannot be caught by its own sweep.
 *
 * The audit row is the one thing an erasure must leave behind. `/privacy` says
 * removal is "subject only to anything that has to be retained to meet a legal
 * or regulatory obligation", and a record that a securities offer's counterparty
 * was erased, by whom and when, is squarely that.
 */

import { and, count, eq, inArray, isNotNull, sql } from 'drizzle-orm'
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core'
import { db } from '@/db'
import {
  accountStatusEvents,
  auditEvents,
  commitments,
  conversationMessages,
  documentPackages,
  emailChangeRequests,
  emailSnapshots,
  fundsReceipts,
  interestRegisterEntries,
  investorAccounts,
  investorResponses,
  offerStatusEvents,
  offers,
  participationCertificates,
  paymentInstructions,
  qaEntries,
  qaThreadMessages,
  recipients,
  sendEvents,
  signInAttempts,
} from '@/db/schema'
import { audit } from '@/lib/audit'
import type { AdminIdentity } from '@/lib/auth/guards'
import { mediaStore } from '@/lib/media/store'
import { revokeAllPortalAccess } from '@/lib/portal/claim'
import {
  ERASED_JSON,
  ERASED_MARKER,
  ERASED_STORAGE_KEY,
  pseudonymEmail,
  pseudonymName,
} from './plan'

// ---------------------------------------------------------------------------
// Preview
// ---------------------------------------------------------------------------

export interface ErasurePreview {
  accountId: string
  /** The name as it stands. Shown once, on the confirmation, and nowhere else. */
  name: string
  email: string
  status: string
  /** True when this account has already been through the procedure. */
  alreadyErased: boolean
  /** How many rows each part of the record holds. Counts, never contents. */
  counts: {
    offers: number
    recipients: number
    statusEvents: number
    offerStatusEvents: number
    emailSnapshots: number
    sendEvents: number
    conversationMessages: number
    investorResponses: number
    emailChangeRequests: number
    commitments: number
    paymentInstructions: number
    fundsReceipts: number
    documentPackages: number
    participationCertificates: number
    qaEntries: number
    qaThreadMessages: number
    registerEntries: number
    auditRowsRelabelled: number
    /** Stored files that will be destroyed and cannot be recovered. */
    storedObjects: number
  }
  /** Set when the stored objects cannot be reached, so an erasure would refuse. */
  blockedBy: string | null
}

/** Ids the whole procedure hangs from, gathered once. */
interface AccountGraph {
  offerIds: string[]
  recipientIds: string[]
  qaEntryIds: string[]
  storageKeys: string[]
}

const EMPTY_GRAPH: AccountGraph = { offerIds: [], recipientIds: [], qaEntryIds: [], storageKeys: [] }

/**
 * The graph for many accounts at once, in four queries rather than four each.
 *
 * `/investors` renders every account on one page and the owner sees an erasure
 * preview on each. The single-account version of this ran about eighteen
 * counting queries per card, so forty investors meant seven hundred queries on
 * a page that had been running three. Correct, and far too slow to leave.
 *
 * Everything below is therefore keyed by list and grouped in the database. The
 * cost is a fixed number of round trips whether there is one account or a
 * hundred.
 */
async function readGraphs(accountIds: string[]): Promise<Map<string, AccountGraph>> {
  const graphs = new Map<string, AccountGraph>()
  for (const id of accountIds) {
    graphs.set(id, { offerIds: [], recipientIds: [], qaEntryIds: [], storageKeys: [] })
  }
  if (accountIds.length === 0) return graphs

  const offerRows = await db
    .select({ id: offers.id, accountId: offers.accountId, recipientId: offers.recipientId })
    .from(offers)
    .where(inArray(offers.accountId, accountIds))

  /** Which account each offer belongs to, so offer-keyed counts can roll up. */
  const offerOwner = new Map<string, string>()
  for (const row of offerRows) {
    offerOwner.set(row.id, row.accountId)
    const graph = graphs.get(row.accountId)
    if (!graph) continue
    graph.offerIds.push(row.id)
    if (row.recipientId && !graph.recipientIds.includes(row.recipientId)) {
      graph.recipientIds.push(row.recipientId)
    }
  }

  const qaRows = await db
    .select({ id: qaEntries.id, accountId: qaEntries.askedByAccountId })
    .from(qaEntries)
    .where(inArray(qaEntries.askedByAccountId, accountIds))
  for (const row of qaRows) {
    if (row.accountId) graphs.get(row.accountId)?.qaEntryIds.push(row.id)
  }

  const allOfferIds = [...offerOwner.keys()]
  if (allOfferIds.length > 0) {
    const docs = await db
      .select({ offerId: documentPackages.offerId, storageKey: documentPackages.storageKey })
      .from(documentPackages)
      .where(inArray(documentPackages.offerId, allOfferIds))
    for (const row of docs) {
      if (!row.storageKey || row.storageKey === ERASED_STORAGE_KEY) continue
      const owner = offerOwner.get(row.offerId)
      if (owner) graphs.get(owner)?.storageKeys.push(row.storageKey)
    }

    const certificates = await db
      .select({
        offerId: participationCertificates.offerId,
        storageKey: participationCertificates.storageKey,
      })
      .from(participationCertificates)
      .where(
        and(
          inArray(participationCertificates.offerId, allOfferIds),
          isNotNull(participationCertificates.storageKey),
        ),
      )
    for (const row of certificates) {
      if (!row.storageKey) continue
      const owner = offerOwner.get(row.offerId)
      if (owner) graphs.get(owner)?.storageKeys.push(row.storageKey)
    }
  }

  return graphs
}

async function readGraph(accountId: string): Promise<AccountGraph> {
  return (await readGraphs([accountId])).get(accountId) ?? EMPTY_GRAPH
}

/** `select key, count(*) ... group by key`, as a map. Empty list, no query. */
async function tallyBy<T extends PgColumn>(
  table: PgTable,
  key: T,
  ids: string[],
): Promise<Map<string, number>> {
  const result = new Map<string, number>()
  if (ids.length === 0) return result
  const rows = await db
    .select({ key, n: count() })
    .from(table)
    .where(inArray(key, ids))
    .groupBy(key)
  for (const row of rows) {
    if (typeof row.key === 'string') result.set(row.key, Number(row.n))
  }
  return result
}

/** Sum a per-offer tally back up to the account that owns those offers. */
function rollUp(tally: Map<string, number>, offerIds: string[]): number {
  let total = 0
  for (const id of offerIds) total += tally.get(id) ?? 0
  return total
}

export async function previewErasureMany(
  accountIds: string[],
): Promise<Map<string, ErasurePreview>> {
  const previews = new Map<string, ErasurePreview>()
  if (accountIds.length === 0) return previews

  const accounts = await db
    .select({
      id: investorAccounts.id,
      name: investorAccounts.name,
      email: investorAccounts.email,
      status: investorAccounts.status,
    })
    .from(investorAccounts)
    .where(inArray(investorAccounts.id, accountIds))
  if (accounts.length === 0) return previews

  const found = accounts.map((row) => row.id)
  const graphs = await readGraphs(found)
  const allOfferIds = found.flatMap((id) => graphs.get(id)?.offerIds ?? [])
  const allQaIds = found.flatMap((id) => graphs.get(id)?.qaEntryIds ?? [])

  const [
    statusEvents,
    conversations,
    changeRequests,
    registerEntries,
    auditRows,
    offerStatus,
    snapshots,
    sends,
    responses,
    commitmentRows,
    instructions,
    receipts,
    documents,
    certificates,
    threads,
  ] = await Promise.all([
    tallyBy(accountStatusEvents, accountStatusEvents.accountId, found),
    tallyBy(conversationMessages, conversationMessages.accountId, found),
    tallyBy(emailChangeRequests, emailChangeRequests.accountId, found),
    tallyBy(interestRegisterEntries, interestRegisterEntries.accountId, found),
    tallyBy(auditEvents, auditEvents.actorAccountId, found),
    tallyBy(offerStatusEvents, offerStatusEvents.offerId, allOfferIds),
    tallyBy(emailSnapshots, emailSnapshots.offerId, allOfferIds),
    tallyBy(sendEvents, sendEvents.offerId, allOfferIds),
    tallyBy(investorResponses, investorResponses.offerId, allOfferIds),
    tallyBy(commitments, commitments.offerId, allOfferIds),
    tallyBy(paymentInstructions, paymentInstructions.offerId, allOfferIds),
    tallyBy(fundsReceipts, fundsReceipts.offerId, allOfferIds),
    tallyBy(documentPackages, documentPackages.offerId, allOfferIds),
    tallyBy(participationCertificates, participationCertificates.offerId, allOfferIds),
    tallyBy(qaThreadMessages, qaThreadMessages.entryId, allQaIds),
  ])

  // Read once for the whole page rather than once per account.
  const store = mediaStore()

  for (const account of accounts) {
    const graph = graphs.get(account.id) ?? EMPTY_GRAPH
    const { offerIds, recipientIds, qaEntryIds, storageKeys } = graph

    previews.set(account.id, {
      accountId: account.id,
      name: account.name,
      email: account.email,
      status: account.status,
      alreadyErased: account.email === pseudonymEmail(account.id),
      counts: {
        offers: offerIds.length,
        recipients: recipientIds.length,
        statusEvents: statusEvents.get(account.id) ?? 0,
        conversationMessages: conversations.get(account.id) ?? 0,
        emailChangeRequests: changeRequests.get(account.id) ?? 0,
        registerEntries: registerEntries.get(account.id) ?? 0,
        auditRowsRelabelled: auditRows.get(account.id) ?? 0,
        offerStatusEvents: rollUp(offerStatus, offerIds),
        emailSnapshots: rollUp(snapshots, offerIds),
        sendEvents: rollUp(sends, offerIds),
        investorResponses: rollUp(responses, offerIds),
        commitments: rollUp(commitmentRows, offerIds),
        paymentInstructions: rollUp(instructions, offerIds),
        fundsReceipts: rollUp(receipts, offerIds),
        documentPackages: rollUp(documents, offerIds),
        participationCertificates: rollUp(certificates, offerIds),
        qaEntries: qaEntryIds.length,
        qaThreadMessages: rollUp(threads, qaEntryIds),
        storedObjects: storageKeys.length,
      },
      blockedBy:
        storageKeys.length > 0 && !store
          ? 'This investor holds stored files and no media store is configured, so the bytes ' +
            'cannot be destroyed. Set MEDIA_STORE and try again — an erasure that leaves the ' +
            'documents behind is not an erasure.'
          : null,
    })
  }

  return previews
}

export async function previewErasure(accountId: string): Promise<ErasurePreview | null> {
  return (await previewErasureMany([accountId])).get(accountId) ?? null
}

// ---------------------------------------------------------------------------
// Erasure
// ---------------------------------------------------------------------------

export type ErasureRefusal =
  | 'NO_SUCH_ACCOUNT'
  | 'ALREADY_ERASED'
  | 'MEDIA_STORE_UNREACHABLE'
  | 'OBJECT_NOT_DESTROYED'

export type ErasureResult =
  | {
      ok: true
      /** The label the record now carries. Safe to show; identifies nobody. */
      pseudonym: string
      offersAffected: number
      objectsDestroyed: number
      auditRowsRelabelled: number
    }
  | { ok: false; reason: ErasureRefusal; message: string }

const MESSAGES: Record<ErasureRefusal, string> = {
  NO_SUCH_ACCOUNT: 'That account could not be found. Nothing was changed.',
  ALREADY_ERASED:
    'That account has already been erased. Nothing was changed, and running it again would ' +
    'produce exactly the record that is already there.',
  MEDIA_STORE_UNREACHABLE:
    'This investor holds stored files and no media store is configured, so the bytes cannot ' +
    'be destroyed. Nothing was changed. Set MEDIA_STORE and try again.',
  OBJECT_NOT_DESTROYED:
    'A stored file could not be destroyed, so the erasure stopped before touching the ' +
    'database. Nothing was changed. The store said why in the server log.',
}

export interface EraseInput {
  accountId: string
  actor: AdminIdentity
}

export async function eraseAccount(input: EraseInput): Promise<ErasureResult> {
  const { accountId, actor } = input

  const account = await db.query.investorAccounts.findFirst({
    where: eq(investorAccounts.id, accountId),
  })
  if (!account) return { ok: false, reason: 'NO_SUCH_ACCOUNT', message: MESSAGES.NO_SUCH_ACCOUNT }

  const newEmail = pseudonymEmail(accountId)
  const newName = pseudonymName(accountId)
  if (account.email === newEmail) {
    return { ok: false, reason: 'ALREADY_ERASED', message: MESSAGES.ALREADY_ERASED }
  }

  const oldEmail = account.email
  const { offerIds, recipientIds, qaEntryIds, storageKeys } = await readGraph(accountId)
  const noOffers = offerIds.length === 0
  const noQa = qaEntryIds.length === 0

  // ---- 1. The bytes, first, and only if every one of them can be reached ---
  let objectsDestroyed = 0
  if (storageKeys.length > 0) {
    const store = mediaStore()
    if (!store) {
      return {
        ok: false,
        reason: 'MEDIA_STORE_UNREACHABLE',
        message: MESSAGES.MEDIA_STORE_UNREACHABLE,
      }
    }
    for (const key of storageKeys) {
      try {
        await store.remove(key)
        objectsDestroyed += 1
      } catch {
        // Deliberately no detail: the key is a capability and the message may
        // quote it. The store logs its own failure.
        return {
          ok: false,
          reason: 'OBJECT_NOT_DESTROYED',
          message: MESSAGES.OBJECT_NOT_DESTROYED,
        }
      }
    }
  }

  // ---- 2. Every column in the plan, once ----------------------------------
  let auditRowsRelabelled = 0

  await db.transaction(async (tx) => {
    await tx
      .update(investorAccounts)
      .set({ name: newName, email: newEmail, emailVerifiedAt: null })
      .where(eq(investorAccounts.id, accountId))

    if (recipientIds.length > 0) {
      for (const recipientId of recipientIds) {
        await tx
          .update(recipients)
          .set({
            name: pseudonymName(recipientId),
            // Unique per round, so it is derived from the recipient row rather
            // than the account: one account can hold more than one of these.
            email: pseudonymEmail(recipientId),
            internalNotes: null,
            senderName: null,
            senderEmail: null,
            senderPhone: null,
          })
          .where(eq(recipients.id, recipientId))
      }
    }

    await tx
      .update(accountStatusEvents)
      .set({ reason: ERASED_MARKER })
      .where(eq(accountStatusEvents.accountId, accountId))

    if (!noOffers) {
      await tx
        .update(offers)
        .set({ responseNote: null, blockDetail: null })
        .where(inArray(offers.id, offerIds))

      await tx
        .update(offerStatusEvents)
        .set({ reason: null, investorNote: null, internalNote: null })
        .where(inArray(offerStatusEvents.offerId, offerIds))

      await tx
        .update(emailSnapshots)
        .set({
          subject: ERASED_MARKER,
          htmlBody: ERASED_MARKER,
          textBody: ERASED_MARKER,
          toAddress: newEmail,
        })
        .where(inArray(emailSnapshots.offerId, offerIds))

      await tx
        .update(sendEvents)
        .set({ errorDetail: null })
        .where(inArray(sendEvents.offerId, offerIds))

      await tx
        .update(investorResponses)
        .set({ message: null })
        .where(inArray(investorResponses.offerId, offerIds))

      await tx.update(commitments).set({ note: null }).where(inArray(commitments.offerId, offerIds))

      await tx
        .update(paymentInstructions)
        .set({ deliveryNote: null })
        .where(inArray(paymentInstructions.offerId, offerIds))

      await tx
        .update(fundsReceipts)
        .set({ reference: ERASED_MARKER })
        .where(inArray(fundsReceipts.offerId, offerIds))

      await tx
        .update(documentPackages)
        .set({
          title: ERASED_MARKER,
          description: null,
          storageKey: ERASED_STORAGE_KEY,
        })
        .where(inArray(documentPackages.offerId, offerIds))

      await tx
        .update(participationCertificates)
        .set({ data: { ...ERASED_JSON }, storageKey: null })
        .where(inArray(participationCertificates.offerId, offerIds))
    }

    await tx
      .update(conversationMessages)
      .set({ body: ERASED_MARKER, emailMessageId: null, inReplyTo: null })
      .where(eq(conversationMessages.accountId, accountId))

    await tx
      .update(emailChangeRequests)
      .set({ newEmail, previousEmail: null })
      .where(eq(emailChangeRequests.accountId, accountId))

    if (!noQa) {
      await tx
        .update(qaEntries)
        .set({
          questionOriginal: ERASED_MARKER,
          questionPublic: null,
          notifyFailure: null,
          // Anonymised is not erased. Unpublishing takes it off the shared page
          // in the same statement that empties it, so there is no window where
          // the entry is blank and still listed. The answer is not touched —
          // see ANSWER_IS_KEPT_BECAUSE in plan.ts.
          isPublished: false,
        })
        .where(inArray(qaEntries.id, qaEntryIds))

      await tx
        .update(qaThreadMessages)
        .set({ body: ERASED_MARKER })
        .where(inArray(qaThreadMessages.entryId, qaEntryIds))
    }

    await tx
      .update(interestRegisterEntries)
      .set({ overrideReason: null })
      .where(eq(interestRegisterEntries.accountId, accountId))

    // ---- The audit log ----------------------------------------------------
    //
    // The only write to `audit_events` in this application that is not an
    // insert from `audit()`, and it is one column on rows this account itself
    // wrote. Every action, entity, timestamp and metadata object survives. See
    // the rule in plan.ts for why the events are kept and the address is not.
    const relabelled = await tx
      .update(auditEvents)
      .set({ actorLabel: newEmail })
      .where(eq(auditEvents.actorAccountId, accountId))
      .returning({ id: auditEvents.id })
    auditRowsRelabelled = relabelled.length

    // An administrator's own audit row can quote the investor's address inside
    // `metadata` — a blocked send, a link issued. The address is an exact,
    // unambiguous token, so it is substituted wherever it appears. The name is
    // deliberately NOT swept: "David" or "Lee" inside a JSON string is not a
    // token, and a blind replace across every metadata object would corrupt
    // rows belonging to other people. DEPLOYMENT.md says to check by hand.
    await tx.execute(sql`
      update audit_events
         set metadata = replace(metadata::text, ${oldEmail}, ${newEmail})::jsonb
       where metadata::text like ${'%' + oldEmail + '%'}
    `)

    // Throttle counters keyed by the address itself. The one outright removal.
    await tx.delete(signInAttempts).where(eq(signInAttempts.key, oldEmail))

    // The account can no longer be signed into and its address is undeliverable,
    // so leaving it ACTIVE would be a lie on the investors screen. The reason on
    // this event is fixed text rather than anything the owner typed: an erasure
    // must not be the moment new prose about a person enters the record.
    if (account.status !== 'ARCHIVED') {
      await tx
        .update(investorAccounts)
        .set({ status: 'ARCHIVED' })
        .where(eq(investorAccounts.id, accountId))

      await tx.insert(accountStatusEvents).values({
        accountId,
        fromStatus: account.status,
        toStatus: 'ARCHIVED',
        reason: 'Erased at the investor’s request.',
        actorUserId: actor.id,
        investorNotified: false,
      })
    }
  })

  // ---- 3. Sessions and links ----------------------------------------------
  await revokeAllPortalAccess(accountId)

  // ---- 4. The row that survives -------------------------------------------
  //
  // Written last, deliberately. The sweep above matches `actorAccountId`, and
  // this row is the owner's, so it would not be caught either way — but the
  // ordering means that is true by construction rather than by argument.
  await audit({
    actor: { kind: 'user', id: actor.id, label: actor.email },
    entityType: 'investor_account',
    entityId: accountId,
    action: 'investor_account.erased',
    metadata: {
      pseudonym: newName,
      offersAffected: offerIds.length,
      recipientsAffected: recipientIds.length,
      questionsAffected: qaEntryIds.length,
      objectsDestroyed,
      auditRowsRelabelled,
      previousStatus: account.status,
    },
  })

  return {
    ok: true,
    pseudonym: newName,
    offersAffected: offerIds.length,
    objectsDestroyed,
    auditRowsRelabelled,
  }
}

/** Only for the refused case, so a refusal is as visible as a success. */
export async function auditErasureRefusal(
  actor: { id: string; label: string } | null,
  accountId: string | null,
  detail: Record<string, unknown>,
): Promise<void> {
  await audit({
    actor: actor
      ? { kind: 'user', id: actor.id, label: actor.label }
      : { kind: 'system', label: 'unauthenticated' },
    entityType: 'investor_account',
    entityId: accountId,
    action: 'investor_account.erase_refused',
    metadata: detail,
  })
}
