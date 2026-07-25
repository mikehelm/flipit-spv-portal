/**
 * Reads for the updates feed. BUILD_SPEC §6.
 *
 * The investor's feed is a join through `update_deliveries` on their own
 * account id. It is not a query over `portal_updates` with a filter applied
 * afterwards, and that is the difference between "a targeted update reaches
 * only its intended recipients" being a property of the schema and it being a
 * property of somebody remembering to write a `where` clause.
 */

import { and, desc, eq, isNotNull, isNull } from 'drizzle-orm'
import { db } from '@/db'
import { investorAccounts, portalUpdates, updateDeliveries, users } from '@/db/schema'
import type { PortalAccess } from '@/lib/portal/access'
import { decodeAudience, describeAudience, type UpdateAudience } from './audience'

// ---------------------------------------------------------------------------
// The investor's feed
// ---------------------------------------------------------------------------

export interface InvestorUpdate {
  id: string
  title: string
  body: string
  /** A real date. It is their own notice and there is nothing to coarsen. */
  publishedAt: Date
  /** Whether they have opened it before. Theirs alone. */
  read: boolean
}

export interface InvestorUpdatesView {
  updates: InvestorUpdate[]
  canView: boolean
}

/**
 * This account's published, unwithdrawn updates, newest first (§6).
 *
 * A withdrawn update disappears. §6 puts the tombstone in the audit log, not on
 * the investor's screen — leaving "this notice was withdrawn" on the page would
 * be a second communication about the thing that was withdrawn.
 */
export async function loadInvestorUpdates(
  accountId: string,
  access: PortalAccess,
): Promise<InvestorUpdatesView> {
  const canView = access.capability === 'FULL' || access.capability === 'READ_ONLY'
  if (!canView) return { updates: [], canView: false }

  const rows = await db
    .select({
      id: portalUpdates.id,
      title: portalUpdates.title,
      body: portalUpdates.body,
      publishedAt: portalUpdates.publishedAt,
      readAt: updateDeliveries.readAt,
    })
    .from(updateDeliveries)
    .innerJoin(portalUpdates, eq(updateDeliveries.updateId, portalUpdates.id))
    .where(
      and(
        eq(updateDeliveries.accountId, accountId),
        isNotNull(portalUpdates.publishedAt),
        isNull(portalUpdates.withdrawnAt),
      ),
    )
    .orderBy(desc(portalUpdates.publishedAt))

  return {
    canView: true,
    updates: rows
      .filter((row): row is typeof row & { publishedAt: Date } => row.publishedAt !== null)
      .map((row) => ({
        id: row.id,
        title: row.title,
        body: row.body,
        publishedAt: row.publishedAt,
        read: row.readAt !== null,
      })),
  }
}

// ---------------------------------------------------------------------------
// The operator's list
// ---------------------------------------------------------------------------

export interface OperatorUpdate {
  id: string
  title: string
  body: string
  audience: UpdateAudience
  audienceLabel: string
  notifyByEmail: boolean
  publishedAt: Date | null
  withdrawnAt: Date | null
  withdrawnReason: string | null
  createdAt: Date
  authorEmail: string | null
  /** Empty until published — the audience is resolved at publication. */
  recipients: Array<{
    accountId: string
    name: string
    email: string
    notifiedAt: Date | null
    readAt: Date | null
  }>
}

export async function loadOperatorUpdates(): Promise<OperatorUpdate[]> {
  const rows = await db
    .select({
      update: portalUpdates,
      authorEmail: users.email,
    })
    .from(portalUpdates)
    .leftJoin(users, eq(portalUpdates.authorId, users.id))
    .orderBy(desc(portalUpdates.createdAt))

  const out: OperatorUpdate[] = []

  for (const row of rows) {
    const audience = decodeAudience(row.update.audienceFilter)

    const deliveries = await db
      .select({
        accountId: investorAccounts.id,
        name: investorAccounts.name,
        email: investorAccounts.email,
        notifiedAt: updateDeliveries.notifiedAt,
        readAt: updateDeliveries.readAt,
      })
      .from(updateDeliveries)
      .innerJoin(investorAccounts, eq(updateDeliveries.accountId, investorAccounts.id))
      .where(eq(updateDeliveries.updateId, row.update.id))
      .orderBy(investorAccounts.name)

    const singleName =
      audience.kind === 'ONE'
        ? ((
            await db.query.investorAccounts.findFirst({
              where: eq(investorAccounts.id, audience.accountId),
            })
          )?.name ?? null)
        : null

    out.push({
      id: row.update.id,
      title: row.update.title,
      body: row.update.body,
      audience,
      audienceLabel: describeAudience(audience, singleName),
      notifyByEmail: row.update.notifyByEmail,
      publishedAt: row.update.publishedAt,
      withdrawnAt: row.update.withdrawnAt,
      withdrawnReason: row.update.withdrawnReason,
      createdAt: row.update.createdAt,
      authorEmail: row.authorEmail,
      recipients: deliveries,
    })
  }

  return out
}

export async function loadOperatorUpdate(updateId: string): Promise<OperatorUpdate | null> {
  const all = await loadOperatorUpdates()
  return all.find((row) => row.id === updateId) ?? null
}

/** Accounts an update can be addressed to individually. Operator-facing. */
export async function addressableAccounts() {
  return db
    .select({
      id: investorAccounts.id,
      name: investorAccounts.name,
      email: investorAccounts.email,
      status: investorAccounts.status,
    })
    .from(investorAccounts)
    .orderBy(investorAccounts.name)
}
