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
 *   1a. Write a line saying an erasure is starting. Everything after this point
 *      is destructive and none of it is atomic across the two stores, so this
 *      is the only record that survives the process being killed in the middle.
 *      It is resolved by the completion row at the end, or by the incomplete
 *      row if the store refuses; an unresolved one is a health finding.
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

import { and, asc, count, eq, inArray, isNotNull, sql } from 'drizzle-orm'
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
      // Ordered so that the loop which destroys these reaches them in the same
      // sequence every time. Without it a `select` may hand them back in any
      // order, and an erasure that stops part way through destroys a different
      // subset on each attempt — which makes the one failure that matters
      // irreproducible, and makes "run it again" a different act each time.
      .orderBy(asc(documentPackages.storageKey))
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
      .orderBy(asc(participationCertificates.storageKey))
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
  /**
   * The store refused, and it had already destroyed something.
   *
   * Separate from `OBJECT_NOT_DESTROYED` because the two states differ in the
   * one way that matters: this one has lost bytes for ever and that one has
   * not. They used to share a reason and a message, and the message said
   * *"Nothing was changed"* — which was true of the database and false of the
   * bucket, on the one action in this application that cannot be undone.
   */
  | 'OBJECTS_PARTIALLY_DESTROYED'

export type ErasureResult =
  | {
      ok: true
      /** The label the record now carries. Safe to show; identifies nobody. */
      pseudonym: string
      offersAffected: number
      objectsDestroyed: number
      auditRowsRelabelled: number
    }
  | {
      ok: false
      reason: ErasureRefusal
      message: string
      /**
       * How many stored files are gone despite the refusal. Zero on every
       * refusal that decided before the loop, which is most of them.
       *
       * On the failure shape deliberately, rather than only in the message: a
       * caller that wants to act on this should not have to read English to
       * discover that the irreversible half already happened.
       */
      objectsDestroyed: number
    }

const MESSAGES: Record<Exclude<ErasureRefusal, 'OBJECTS_PARTIALLY_DESTROYED'>, string> = {
  NO_SUCH_ACCOUNT: 'That account could not be found. Nothing was changed.',
  ALREADY_ERASED:
    'That account has already been erased. Nothing was changed, and running it again would ' +
    'produce exactly the record that is already there.',
  MEDIA_STORE_UNREACHABLE:
    'This investor holds stored files and no media store is configured, so the bytes cannot ' +
    'be destroyed. Nothing was changed. Set MEDIA_STORE and try again.',
  OBJECT_NOT_DESTROYED:
    'A stored file could not be destroyed, so the erasure stopped before touching the ' +
    'database. Nothing was changed — no file was destroyed and no record was altered. The ' +
    'store said why in the server log.',
}

/**
 * What the owner is told when the erasure destroyed some of the files and then
 * stopped.
 *
 * It says the true thing first. The previous version of this sentence opened
 * with *"Nothing was changed"*, which described the database and not the bucket
 * — and the bucket is the half that cannot be put back.
 *
 * Counts, never a key: this is rendered on a screen and the key is a capability.
 */
export function partiallyDestroyedMessage(destroyed: number, remaining: number): string {
  return (
    `${destroyed} stored file${destroyed === 1 ? ' was' : 's were'} destroyed and cannot be ` +
    'recovered, and then the store refused on another — so the erasure stopped there. ' +
    'The database was NOT changed: the record still names every file, including the ' +
    `${destroyed === 1 ? 'one that is' : `${destroyed} that are`} gone. ` +
    `${remaining} file${remaining === 1 ? '' : 's'} remain${remaining === 1 ? 's' : ''} in the ` +
    'store. This is written to the audit log and the health report will keep raising it. ' +
    'Fix whatever the store is refusing over, then run the erasure again — destroying a file ' +
    'that is already gone is not an error, so a second run finishes the job.'
  )
}

// ---------------------------------------------------------------------------
// The three lines an erasure attempt writes
// ---------------------------------------------------------------------------

/**
 * Written before the first byte is destroyed, and resolved by one of the two
 * below.
 *
 * **This is the only thing that survives the process dying.** An erasure runs a
 * `remove()` loop, then a transaction, then a session revocation, then its own
 * audit row — and a kill, a restart or a deploy at any point in that sequence
 * used to leave no trace whatsoever. The record would be half destroyed, or
 * fully destroyed with live sessions still attached to it, and every screen in
 * this application would show an ordinary investor.
 *
 * A line at the start costs one insert on an action that happens a handful of
 * times in the life of a deployment, and it turns a silent hole into a finding.
 *
 * It carries no address and no name: the metadata sweep inside the transaction
 * substitutes the old address wherever it appears, and a row written *before*
 * that sweep with an address in it would be caught by it — which is harmless
 * and confusing. Counts only, as everything else here is.
 */
export const ERASURE_BEGAN_ACTION = 'investor_account.erase_began'

/**
 * Written when the store refused part way through, whether or not anything was
 * destroyed first.
 *
 * The zero case is recorded too. A refusal that destroyed nothing changed
 * nothing and still says something worth keeping — that this store would not
 * delete, on this day — and leaving it out would mean the `began` line above
 * had no resolution and every clean refusal raised a finding.
 */
export const ERASURE_INCOMPLETE_ACTION = 'investor_account.erase_incomplete'

/** Written last, when the whole thing succeeded. */
export const ERASURE_COMPLETED_ACTION = 'investor_account.erased'

export interface EraseInput {
  accountId: string
  actor: AdminIdentity
}

export async function eraseAccount(input: EraseInput): Promise<ErasureResult> {
  const { accountId, actor } = input

  const account = await db.query.investorAccounts.findFirst({
    where: eq(investorAccounts.id, accountId),
  })
  if (!account) {
    return {
      ok: false,
      reason: 'NO_SUCH_ACCOUNT',
      message: MESSAGES.NO_SUCH_ACCOUNT,
      objectsDestroyed: 0,
    }
  }

  const newEmail = pseudonymEmail(accountId)
  const newName = pseudonymName(accountId)
  if (account.email === newEmail) {
    return {
      ok: false,
      reason: 'ALREADY_ERASED',
      message: MESSAGES.ALREADY_ERASED,
      objectsDestroyed: 0,
    }
  }

  const oldEmail = account.email
  const { offerIds, recipientIds, qaEntryIds, storageKeys } = await readGraph(accountId)
  const noOffers = offerIds.length === 0
  const noQa = qaEntryIds.length === 0

  // ---- 1. The bytes, first, and only if every one of them can be reached ---
  //
  // The no-store refusal is decided before the `began` line is written, so a
  // deployment with nothing configured records an attempt that could not start
  // rather than one that started and vanished.
  let objectsDestroyed = 0
  const store = storageKeys.length > 0 ? mediaStore() : null
  if (storageKeys.length > 0 && !store) {
    return {
      ok: false,
      reason: 'MEDIA_STORE_UNREACHABLE',
      message: MESSAGES.MEDIA_STORE_UNREACHABLE,
      objectsDestroyed: 0,
    }
  }

  // ---- The line that survives the process dying ----------------------------
  //
  // Written for every erasure, not only the ones holding files. The byte loop
  // is the irreversible part, but it is not the only part with a gap in it: the
  // session revocation and the completion row both happen *after* the
  // transaction, so a kill between them leaves an erased record that still has
  // live sessions attached and nothing anywhere saying so.
  await audit({
    actor: { kind: 'user', id: actor.id, label: actor.email },
    entityType: 'investor_account',
    entityId: accountId,
    action: ERASURE_BEGAN_ACTION,
    metadata: {
      objectsToDestroy: storageKeys.length,
      offersAffected: offerIds.length,
      recipientsAffected: recipientIds.length,
      questionsAffected: qaEntryIds.length,
      previousStatus: account.status,
    },
  })

  if (store) {
    for (const key of storageKeys) {
      try {
        await store.remove(key)
        objectsDestroyed += 1
      } catch {
        // Deliberately no detail in the message: the key is a capability and
        // the store's own error may quote it. The store logs its own failure.
        const remaining = storageKeys.length - objectsDestroyed
        await auditErasureIncomplete(actor, accountId, objectsDestroyed, remaining)

        // Nothing destroyed is a clean refusal and says so. Something destroyed
        // is not, and must not borrow the sentence that says nothing changed.
        if (objectsDestroyed === 0) {
          return {
            ok: false,
            reason: 'OBJECT_NOT_DESTROYED',
            message: MESSAGES.OBJECT_NOT_DESTROYED,
            objectsDestroyed: 0,
          }
        }

        return {
          ok: false,
          reason: 'OBJECTS_PARTIALLY_DESTROYED',
          message: partiallyDestroyedMessage(objectsDestroyed, remaining),
          objectsDestroyed,
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
    action: ERASURE_COMPLETED_ACTION,
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

/**
 * The line that resolves the `began` one when the store refused.
 *
 * Counts only, and the same three the health report reads back. Not the key,
 * not the title of the document, not the address — this row is exported and
 * read on a screen, and it is written at the one moment when the record it
 * describes is half of what it was.
 *
 * Written *before* the return, deliberately: a caller that ignores the result
 * still leaves the record behind, and the result is the thing most likely to be
 * ignored, because the only surface that reads it is a form somebody may have
 * already navigated away from.
 */
async function auditErasureIncomplete(
  actor: AdminIdentity,
  accountId: string,
  objectsDestroyed: number,
  objectsRemaining: number,
): Promise<void> {
  await audit({
    actor: { kind: 'user', id: actor.id, label: actor.email },
    entityType: 'investor_account',
    entityId: accountId,
    action: ERASURE_INCOMPLETE_ACTION,
    metadata: {
      objectsDestroyed,
      objectsRemaining,
      // What the database looks like now, said plainly, because the row will be
      // read by somebody deciding what to do about it months later.
      databaseChanged: false,
    },
  })
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
