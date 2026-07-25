/**
 * The operator's list of investor accounts. BUILD_SPEC §4.2.
 *
 * Reads only. Nothing here changes a status — that is `changeAccountStatus`,
 * which revokes sessions and links in the same function so a caller cannot do
 * one and forget the other.
 *
 * This is an admin surface, so it does load more than one investor. That is the
 * difference between it and `data.ts`, which is investor-facing and deliberately
 * never has another account's data to leak.
 */

import { desc, eq, sql } from 'drizzle-orm'
import { db } from '@/db'
import {
  accountStatusEvents,
  investorAccounts,
  investorSessions,
  offers,
  portalTokens,
  users,
} from '@/db/schema'
import type { AccountStatus } from './access'

export interface AccountStatusEntry {
  from: AccountStatus | null
  to: AccountStatus
  reason: string
  at: Date
  by: string | null
  investorNotified: boolean
}

export interface AdminAccountRow {
  id: string
  name: string
  email: string
  status: AccountStatus
  emailVerifiedAt: Date | null
  lastSignInAt: Date | null
  offerCount: number
  /** Sessions that have not been revoked and have not expired. */
  liveSessions: number
  /** Claim and sign-in links that are still redeemable. */
  liveLinks: number
  history: AccountStatusEntry[]
}

/**
 * Every investor account, with what a status change would actually end.
 *
 * The live session and live link counts are the point of this screen. §4.2 says
 * suspension "takes effect immediately — active sessions are terminated,
 * outstanding links are revoked", and an operator deciding whether to suspend
 * somebody should be able to see what that sentence means for this person
 * before pressing the button rather than after.
 */
export async function loadAdminAccounts(): Promise<AdminAccountRow[]> {
  const now = new Date()

  const rows = await db
    .select({
      id: investorAccounts.id,
      name: investorAccounts.name,
      email: investorAccounts.email,
      status: investorAccounts.status,
      emailVerifiedAt: investorAccounts.emailVerifiedAt,
      lastSignInAt: investorAccounts.lastSignInAt,
    })
    .from(investorAccounts)
    .orderBy(investorAccounts.name)

  if (rows.length === 0) return []

  const offerCounts = await db
    .select({ accountId: offers.accountId, count: sql<number>`count(*)::int` })
    .from(offers)
    .groupBy(offers.accountId)

  const sessions = await db
    .select({ accountId: investorSessions.accountId, expires: investorSessions.expires })
    .from(investorSessions)
    .where(sql`${investorSessions.revokedAt} is null`)

  const links = await db
    .select({ accountId: portalTokens.accountId, expiresAt: portalTokens.expiresAt })
    .from(portalTokens)
    .where(sql`${portalTokens.usedAt} is null and ${portalTokens.revokedAt} is null`)

  const events = await db
    .select({
      accountId: accountStatusEvents.accountId,
      fromStatus: accountStatusEvents.fromStatus,
      toStatus: accountStatusEvents.toStatus,
      reason: accountStatusEvents.reason,
      createdAt: accountStatusEvents.createdAt,
      investorNotified: accountStatusEvents.investorNotified,
      actorEmail: users.email,
    })
    .from(accountStatusEvents)
    .leftJoin(users, eq(accountStatusEvents.actorUserId, users.id))
    .orderBy(desc(accountStatusEvents.createdAt))

  const tally = (
    source: Array<{ accountId: string; expires?: Date; expiresAt?: Date }>,
  ): Map<string, number> => {
    const counts = new Map<string, number>()
    for (const row of source) {
      const expiry = row.expires ?? row.expiresAt
      if (expiry && expiry.getTime() <= now.getTime()) continue
      counts.set(row.accountId, (counts.get(row.accountId) ?? 0) + 1)
    }
    return counts
  }

  const sessionCounts = tally(sessions)
  const linkCounts = tally(links)
  const offerTally = new Map(offerCounts.map((row) => [row.accountId, row.count]))

  const historyByAccount = new Map<string, AccountStatusEntry[]>()
  for (const event of events) {
    const list = historyByAccount.get(event.accountId) ?? []
    list.push({
      from: event.fromStatus as AccountStatus | null,
      to: event.toStatus as AccountStatus,
      reason: event.reason,
      at: event.createdAt,
      by: event.actorEmail,
      investorNotified: event.investorNotified,
    })
    historyByAccount.set(event.accountId, list)
  }

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    email: row.email,
    status: row.status as AccountStatus,
    emailVerifiedAt: row.emailVerifiedAt,
    lastSignInAt: row.lastSignInAt,
    offerCount: offerTally.get(row.id) ?? 0,
    liveSessions: sessionCounts.get(row.id) ?? 0,
    liveLinks: linkCounts.get(row.id) ?? 0,
    history: historyByAccount.get(row.id) ?? [],
  }))
}
