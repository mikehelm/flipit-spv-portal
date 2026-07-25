/**
 * Reads for the Q&A. BUILD_SPEC §6.7.
 *
 * Two audiences, two functions, and the split is the safety property:
 *
 *   - `loadInvestorQa` is bound to one account id taken from the session. Its
 *     shared list goes through `toPublicEntry`, which has no field capable of
 *     carrying an asker. Its private list is filtered on that one account id in
 *     the SQL, not afterwards in JavaScript.
 *   - `loadQaQueue` is the operator's, and it is the only function here that
 *     joins an entry to a person.
 *
 * Nothing in the investor-facing path counts entries by asker, exposes a total,
 * or orders by anything an investor could correlate with a person (§15).
 */

import { and, asc, desc, eq, isNotNull, isNull, sql } from 'drizzle-orm'
import { db } from '@/db'
import {
  investorAccounts,
  offers,
  qaEntries,
  qaThreadMessages,
  rounds,
} from '@/db/schema'
import { readServiceConfig } from '@/lib/auth/service-config'
import { formatMoney, formatPercentage } from '@/lib/money'
import { portalAccess, type AccountStatus, type PortalAccess } from '@/lib/portal/access'
import {
  orderPublicEntries,
  publishBlock,
  toPublicEntry,
  type PublicQaEntry,
  type QaEntrySource,
} from './anonymity'
import { isAwaitingAnswer, lastInvestorMessageTimes } from './service'
import { canAskQuestion, canReadOwnQuestions, sharedQaState, type SharedQaState } from './visibility'

// ---------------------------------------------------------------------------
// Shared entries
// ---------------------------------------------------------------------------

/**
 * The published entries, ordered.
 *
 * The ordering columns are the operator's — pinned, then his sort order, then
 * oldest published first. `published_at` is used as the final tiebreak and is
 * never returned at day precision; `toPublicEntry` coarsens it to a month.
 */
export async function loadSharedQa(): Promise<PublicQaEntry[]> {
  const rows = await db
    .select()
    .from(qaEntries)
    .where(and(eq(qaEntries.isPublished, true), isNull(qaEntries.unpublishedAt)))
    .orderBy(desc(qaEntries.pinned), asc(qaEntries.sortOrder), asc(qaEntries.publishedAt))

  const entries: PublicQaEntry[] = []
  for (const row of rows) {
    const projected = toPublicEntry(row satisfies QaEntrySource)
    if (projected) entries.push(projected)
  }

  return orderPublicEntries(entries)
}

/**
 * Is any round still open? §6.6 makes closing an explicit act — a passed
 * deadline closes nothing — so this reads `closed_at`, never a date comparison.
 *
 * Used only by the §6.7.5 switch. The conservative reading of "hidden until the
 * round closes" is that any open round anywhere means the raise is still
 * running: the switch is one system-wide setting, and it would be strange for
 * the shared section to appear for some investors and not others when what it
 * protects against is the inference that other investors exist at all.
 */
export async function anyRoundOpen(): Promise<boolean> {
  const rows = await db
    .select({ id: rounds.id })
    .from(rounds)
    .where(isNull(rounds.closedAt))
    .limit(1)

  return rows.length > 0
}

// ---------------------------------------------------------------------------
// The investor's own view
// ---------------------------------------------------------------------------

export interface OwnQaMessage {
  id: string
  from: 'YOU' | 'DAVID'
  body: string
  /** Their own correspondence, so a real date is right here. */
  at: Date
}

export interface OwnQaThread {
  entryId: string
  /** Their own words, unchanged. The public rewrite is never shown to them. */
  question: string
  askedAt: Date
  answer: string | null
  answeredAt: Date | null
  /** Whether this one also appears, anonymised, in the shared section. */
  isPublished: boolean
  messages: OwnQaMessage[]
}

export interface InvestorQaView {
  sharedState: SharedQaState
  shared: PublicQaEntry[]
  own: OwnQaThread[]
  canAsk: boolean
  canReadOwn: boolean
}

export async function loadInvestorQa(
  accountId: string,
  access: PortalAccess,
): Promise<InvestorQaView> {
  const config = await readServiceConfig()
  const roundOpen = await anyRoundOpen()

  const state = sharedQaState({
    qaVisibleDuringRaise: config.qaVisibleDuringRaise,
    roundClosed: !roundOpen,
    access,
  })

  const shared = state === 'VISIBLE' ? await loadSharedQa() : []

  const canReadOwn = canReadOwnQuestions(access)
  const own = canReadOwn ? await loadOwnThreads(accountId) : []

  return {
    sharedState: state,
    shared,
    own,
    canAsk: canAskQuestion(access),
    canReadOwn,
  }
}

/**
 * One account's own questions and the replies to them.
 *
 * The account id is in the `where` clause. There is no post-filter here, and no
 * parameter that could widen it — a bug in a later caller cannot turn this into
 * a query for somebody else's thread.
 */
export async function loadOwnThreads(accountId: string): Promise<OwnQaThread[]> {
  const rows = await db
    .select()
    .from(qaEntries)
    .where(eq(qaEntries.askedByAccountId, accountId))
    .orderBy(desc(qaEntries.createdAt))

  if (rows.length === 0) return []

  const threads: OwnQaThread[] = []

  for (const row of rows) {
    const messages = await db
      .select()
      .from(qaThreadMessages)
      .where(eq(qaThreadMessages.entryId, row.id))
      .orderBy(asc(qaThreadMessages.createdAt))

    threads.push({
      entryId: row.id,
      question: row.questionOriginal,
      askedAt: row.createdAt,
      // Only an answer that has actually been sent to them, or published,
      // is theirs to read. A draft in the operator's queue is not.
      answer: row.answerEmailSentAt !== null || row.isPublished ? row.answer : null,
      answeredAt: row.answerEmailSentAt ?? (row.isPublished ? row.answeredAt : null),
      isPublished: row.isPublished && row.unpublishedAt === null,
      messages: messages.map((message) => ({
        id: message.id,
        from: message.direction === 'FROM_INVESTOR' ? ('YOU' as const) : ('DAVID' as const),
        body: message.body,
        at: message.createdAt,
      })),
    })
  }

  return threads
}

// ---------------------------------------------------------------------------
// The operator's queue
// ---------------------------------------------------------------------------

export interface QaQueueEntry {
  id: string
  /** Null for an entry the operator wrote himself (§6.7.4). */
  asker: {
    accountId: string
    name: string
    email: string
    status: AccountStatus
  } | null
  /** Formatted strings. No money or percentage ever becomes a number. */
  offerSummary: {
    proposedAmount: string
    spvPercentage: string
    indirectPercentage: string
    responseDeadline: string
    stage: string
    roundName: string
  } | null
  questionOriginal: string
  questionPublic: string | null
  answer: string | null
  answeredAt: Date | null
  answerEmailSentAt: Date | null
  isPublished: boolean
  publishedAt: Date | null
  unpublishedAt: Date | null
  pinned: boolean
  sortOrder: number
  updatedAtLabel: Date | null
  createdAt: Date
  /** Whether the §6.7.1 notification actually reached the operator. */
  notifiedAt: Date | null
  notifyFailure: string | null
  /** Why this cannot be published yet, if it cannot. */
  publishBlock: ReturnType<typeof publishBlock>
  /** No answer yet, or a follow-up arrived after the last reply went out. */
  awaitingAnswer: boolean
}

export type QaQueueFilter = 'OPEN' | 'ANSWERED' | 'PUBLISHED' | 'ALL'

/**
 * Everything the operator needs to answer with context (§6.7.2): who asked,
 * their offer detail, and their status.
 *
 * The offer chosen is the most recent one on the account rather than the one
 * the question was filed against, when the entry has no `offer_id` — a question
 * asked from the portal is asked about whatever is currently in front of them.
 */
export async function loadQaQueue(filter: QaQueueFilter = 'ALL'): Promise<QaQueueEntry[]> {
  const condition =
    filter === 'OPEN'
      ? isNull(qaEntries.answer)
      : filter === 'ANSWERED'
        ? and(isNotNull(qaEntries.answer), eq(qaEntries.isPublished, false))
        : filter === 'PUBLISHED'
          ? eq(qaEntries.isPublished, true)
          : undefined

  const rows = await db
    .select({
      entry: qaEntries,
      accountId: investorAccounts.id,
      accountName: investorAccounts.name,
      accountEmail: investorAccounts.email,
      accountStatus: investorAccounts.status,
    })
    .from(qaEntries)
    .leftJoin(investorAccounts, eq(qaEntries.askedByAccountId, investorAccounts.id))
    .where(condition)
    .orderBy(
      // Unanswered first — that is the queue. Then oldest first within each
      // group, because the person who has waited longest goes first.
      sql`(${qaEntries.answer} is not null)`,
      asc(qaEntries.createdAt),
    )

  const config = await readServiceConfig()
  const lastInvestorAt = await lastInvestorMessageTimes()
  const out: QaQueueEntry[] = []

  for (const row of rows) {
    let offerSummary: QaQueueEntry['offerSummary'] = null

    if (row.accountId) {
      const offerRows = await db
        .select({
          proposedAmountUsd: offers.proposedAmountUsd,
          spvPercentage: offers.spvPercentage,
          indirectPercentage: offers.indirectPercentage,
          responseDeadline: offers.responseDeadline,
          stage: offers.stage,
          roundName: rounds.name,
        })
        .from(offers)
        .innerJoin(rounds, eq(offers.roundId, rounds.id))
        .where(
          row.entry.offerId
            ? eq(offers.id, row.entry.offerId)
            : eq(offers.accountId, row.accountId),
        )
        .orderBy(desc(offers.createdAt))
        .limit(1)

      const offer = offerRows[0]
      if (offer) {
        offerSummary = {
          proposedAmount: formatMoney(offer.proposedAmountUsd),
          spvPercentage: formatPercentage(offer.spvPercentage, {
            decimalPlaces: config.decimalPlaces,
          }),
          indirectPercentage: formatPercentage(offer.indirectPercentage, {
            decimalPlaces: config.decimalPlaces,
          }),
          responseDeadline: offer.responseDeadline,
          stage: offer.stage,
          roundName: offer.roundName,
        }
      }
    }

    out.push({
      id: row.entry.id,
      asker: row.accountId
        ? {
            accountId: row.accountId,
            name: row.accountName ?? '',
            email: row.accountEmail ?? '',
            status: (row.accountStatus ?? 'INVITED') as AccountStatus,
          }
        : null,
      offerSummary,
      questionOriginal: row.entry.questionOriginal,
      questionPublic: row.entry.questionPublic,
      answer: row.entry.answer,
      answeredAt: row.entry.answeredAt,
      answerEmailSentAt: row.entry.answerEmailSentAt,
      isPublished: row.entry.isPublished,
      publishedAt: row.entry.publishedAt,
      unpublishedAt: row.entry.unpublishedAt,
      pinned: row.entry.pinned,
      sortOrder: row.entry.sortOrder,
      updatedAtLabel: row.entry.updatedAtLabel,
      createdAt: row.entry.createdAt,
      notifiedAt: row.entry.notifiedAt,
      notifyFailure: row.entry.notifyFailure,
      publishBlock: publishBlock(row.entry),
      awaitingAnswer: isAwaitingAnswer({
        answer: row.entry.answer,
        answerEmailSentAt: row.entry.answerEmailSentAt,
        lastInvestorMessageAt: lastInvestorAt.get(row.entry.id) ?? null,
      }),
    })
  }

  return out
}

/** One entry, for the answer screen. Null when the id does not exist. */
export async function loadQaEntry(entryId: string): Promise<QaQueueEntry | null> {
  const all = await loadQaQueue('ALL')
  return all.find((entry) => entry.id === entryId) ?? null
}

/** The access an account currently has, for the actions that need to re-check. */
export async function investorAccessFor(accountId: string): Promise<PortalAccess | null> {
  const account = await db.query.investorAccounts.findFirst({
    where: eq(investorAccounts.id, accountId),
  })
  if (!account) return null

  const config = await readServiceConfig()
  return portalAccess({
    accountStatus: account.status as AccountStatus,
    closedAccountAccess: config.closedAccountAccess,
    serviceMode: config.serviceMode,
  })
}
