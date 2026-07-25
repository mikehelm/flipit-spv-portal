/**
 * Where a round stands. BUILD_SPEC §6.6.
 *
 * *"On the deadline date the app emails David — not the investors — with a
 * summary: who responded, who did not, who asked for more time, and totals
 * committed against the USD 30,000 aggregate."*
 *
 * The four money totals are summed with `decimal.js` and returned as strings.
 * Nothing in this file is ever a JavaScript number except a count of people,
 * which is a count of people.
 */

import { desc, eq, isNull } from 'drizzle-orm'
import { db } from '@/db'
import { investorAccounts, offers, rounds } from '@/db/schema'
import { readServiceConfig } from '@/lib/auth/service-config'
import { Dec, formatMoney, isoToday, sumDecimals } from '@/lib/money'

export interface RoundTotals {
  /** Formatted for display. §5 keeps all four distinct and never sums them together. */
  proposed: string
  committed: string
  accepted: string
  received: string
  /** The aggregate the round may raise, from service configuration. */
  aggregate: string
  /** Whether committed exceeds the aggregate. A warning, never a block (§10). */
  overCommitted: boolean
}

export interface RoundParticipant {
  offerId: string
  accountId: string
  name: string
  email: string
  responseChoice: 'NO_RESPONSE' | 'INTERESTED' | 'NOT_INTERESTED' | 'QUESTION'
  responseDeadline: string
  originalDeadline: string | null
  stage: string
  emailStatus: string
  blocked: boolean
  accountStatus: string
  /** True when their deadline is today or earlier. */
  deadlineReached: boolean
}

export interface RoundSummary {
  roundId: string
  name: string
  openedAt: Date
  closedAt: Date | null
  totals: RoundTotals
  participants: RoundParticipant[]
  counts: {
    total: number
    responded: number
    notResponded: number
    interested: number
    notInterested: number
    askedAQuestion: number
    /** Extended past their original deadline — "who asked for more time". */
    extended: number
    deadlineReached: number
    blocked: number
    notSent: number
  }
  /** The earliest deadline still ahead, or null when every one has passed. */
  nextDeadline: string | null
  /** Whether every deadline in the round has now passed. */
  allDeadlinesPassed: boolean
}

export async function loadRoundSummary(
  roundId: string,
  options: { now?: Date } = {},
): Promise<RoundSummary | null> {
  const now = options.now ?? new Date()
  const today = isoToday(now)

  const round = await db.query.rounds.findFirst({ where: eq(rounds.id, roundId) })
  if (!round) return null

  const config = await readServiceConfig()

  const rows = await db
    .select({
      offerId: offers.id,
      accountId: offers.accountId,
      proposedAmountUsd: offers.proposedAmountUsd,
      committedAmountUsd: offers.committedAmountUsd,
      acceptedAmountUsd: offers.acceptedAmountUsd,
      receivedAmountUsd: offers.receivedAmountUsd,
      responseChoice: offers.responseChoice,
      responseDeadline: offers.responseDeadline,
      originalDeadline: offers.originalDeadline,
      stage: offers.stage,
      emailStatus: offers.emailStatus,
      blocked: offers.blocked,
      name: investorAccounts.name,
      email: investorAccounts.email,
      accountStatus: investorAccounts.status,
    })
    .from(offers)
    .innerJoin(investorAccounts, eq(offers.accountId, investorAccounts.id))
    .where(eq(offers.roundId, roundId))
    .orderBy(desc(offers.createdAt))

  const participants: RoundParticipant[] = rows.map((row) => ({
    offerId: row.offerId,
    accountId: row.accountId,
    name: row.name,
    email: row.email,
    responseChoice: row.responseChoice as RoundParticipant['responseChoice'],
    responseDeadline: row.responseDeadline,
    originalDeadline: row.originalDeadline,
    stage: row.stage,
    emailStatus: row.emailStatus,
    blocked: row.blocked,
    accountStatus: row.accountStatus,
    deadlineReached: row.responseDeadline <= today,
  }))

  const committedTotal = sumDecimals(
    rows.map((row) => row.committedAmountUsd ?? '0'),
  )

  const totals: RoundTotals = {
    proposed: formatMoney(sumDecimals(rows.map((row) => row.proposedAmountUsd)).toFixed(2)),
    committed: formatMoney(committedTotal.toFixed(2)),
    accepted: formatMoney(
      sumDecimals(rows.map((row) => row.acceptedAmountUsd ?? '0')).toFixed(2),
    ),
    received: formatMoney(
      sumDecimals(rows.map((row) => row.receivedAmountUsd ?? '0')).toFixed(2),
    ),
    aggregate: formatMoney(config.aggregateRaiseUsd),
    // §10: "Warn if the sum exceeds the stated aggregate raise. Warn, do not
    // block — the operator may be modelling."
    overCommitted: committedTotal.greaterThan(new Dec(config.aggregateRaiseUsd)),
  }

  const responded = participants.filter((row) => row.responseChoice !== 'NO_RESPONSE')

  const upcoming = participants
    .map((row) => row.responseDeadline)
    .filter((deadline) => deadline > today)
    .sort()

  return {
    roundId: round.id,
    name: round.name,
    openedAt: round.openedAt,
    closedAt: round.closedAt,
    totals,
    participants,
    counts: {
      total: participants.length,
      responded: responded.length,
      notResponded: participants.length - responded.length,
      interested: participants.filter((row) => row.responseChoice === 'INTERESTED').length,
      notInterested: participants.filter((row) => row.responseChoice === 'NOT_INTERESTED')
        .length,
      askedAQuestion: participants.filter((row) => row.responseChoice === 'QUESTION').length,
      extended: participants.filter(
        (row) => row.originalDeadline !== null && row.responseDeadline > row.originalDeadline,
      ).length,
      deadlineReached: participants.filter((row) => row.deadlineReached).length,
      blocked: participants.filter((row) => row.blocked).length,
      notSent: participants.filter((row) => row.emailStatus !== 'SENT').length,
    },
    nextDeadline: upcoming[0] ?? null,
    allDeadlinesPassed: participants.length > 0 && upcoming.length === 0,
  }
}

/** The open round, or null. */
export async function openRound() {
  return db.query.rounds.findFirst({ where: isNull(rounds.closedAt) })
}
