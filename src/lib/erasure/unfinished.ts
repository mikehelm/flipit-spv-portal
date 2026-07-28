/**
 * Erasures that started and did not finish. OPEN_DECISIONS.md item 12.
 *
 * **The gap this closes was written down before it was closed.** The entry in
 * PROGRESS.md for the object-store erasure section says it plainly: *"whatever
 * was destroyed is gone for good, the rows still name it, and nothing records
 * that it happened."* An erasure is not atomic across the database and the
 * object store and cannot be — the bytes have to go first, or a failure leaves
 * them behind for ever — so the honest response is not to pretend otherwise but
 * to make the half-finished state something a person is told about.
 *
 * `erase.ts` writes three actions. This reads them back and answers one
 * question: is there an account whose most recent erasure line is not a
 * completion?
 *
 *   began      an attempt started. Written before the first `remove()`.
 *   incomplete the store refused. Says how many objects were destroyed first.
 *   erased     it finished.
 *
 * Two states need a person, and they need different things done about them:
 *
 *   - **The latest line is `incomplete`.** The store refused. The bytes named in
 *     it are gone, the record still describes the investor in full, and running
 *     the erasure again is the remedy.
 *   - **The latest line is `began`.** Nothing followed it, which means the
 *     process did not survive the attempt — a restart, a kill, a deploy. What
 *     state the record is in cannot be told from this row alone, which is
 *     exactly why it is worth raising.
 *
 * Nothing here writes, and nothing here reads a name, an address or a storage
 * key. The account id is the only identifier it returns, on the same footing as
 * the reminder id in a stuck-claim finding: enough to find the row with, and
 * nothing that means anything to somebody who should not have it.
 */

import { and, asc, eq, inArray } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '@/db'
import { auditEvents } from '@/db/schema'
import {
  ERASURE_BEGAN_ACTION,
  ERASURE_COMPLETED_ACTION,
  ERASURE_INCOMPLETE_ACTION,
} from './erase'

/** Which of the two unresolved states an account is sitting in. */
export type ErasureStage = 'BEGAN' | 'INCOMPLETE'

export interface UnfinishedErasure {
  /** The account. Never its name and never its address. */
  accountId: string
  /** When the unresolved line was written. */
  at: Date
  stage: ErasureStage
  /**
   * How many stored files are gone. Known for `INCOMPLETE`, which counts them
   * before it returns; null for `BEGAN`, where the process died and the count
   * died with it.
   */
  objectsDestroyed: number | null
  /** How many the store still holds. Null for the same reason. */
  objectsRemaining: number | null
}

/**
 * Parsed rather than cast, and every field optional.
 *
 * The same rule `mediaCheckRecordSchema` follows and for the same reason: this
 * metadata is written by one version of the application and read back by
 * another, and a row that fails to parse must degrade to *"something unfinished
 * is here and it will not say how much"* rather than to nothing at all. A
 * finding that disappears because a field was renamed is worse than one that is
 * vague.
 */
const incompleteMetadataSchema = z.object({
  objectsDestroyed: z.number().int().min(0).optional(),
  objectsRemaining: z.number().int().min(0).optional(),
})

/** completed resolves; incomplete resolves and still needs a person; began does not. */
const RESOLUTION_ORDER: Record<string, number> = {
  [ERASURE_COMPLETED_ACTION]: 0,
  [ERASURE_INCOMPLETE_ACTION]: 1,
  [ERASURE_BEGAN_ACTION]: 2,
}

/**
 * The unresolved erasures, most recent first.
 *
 * One indexed read. It is bounded by the number of erasures ever attempted on
 * this deployment — two rows each, on an action a round of forty investors
 * might see a handful of times in its life — which is why it can sit in the
 * cheap fact set the overview banner is built from without a `distinct on`.
 *
 * Ties are broken towards *reporting*. Two rows written in the same microsecond
 * would have to come from opposite ends of a transaction and a network round
 * trip, so the case is theoretical; if it ever happened, the less resolved
 * action wins and somebody is told to look at an erasure that is fine. That is
 * the right way round: a spurious "check this" costs a minute, and a silently
 * half-erased investor is the failure this whole file exists for.
 */
export async function readUnfinishedErasures(): Promise<UnfinishedErasure[]> {
  const rows = await db
    .select({
      entityId: auditEvents.entityId,
      action: auditEvents.action,
      createdAt: auditEvents.createdAt,
      metadata: auditEvents.metadata,
    })
    .from(auditEvents)
    .where(
      and(
        eq(auditEvents.entityType, 'investor_account'),
        inArray(auditEvents.action, [
          ERASURE_BEGAN_ACTION,
          ERASURE_INCOMPLETE_ACTION,
          ERASURE_COMPLETED_ACTION,
        ]),
      ),
    )
    .orderBy(asc(auditEvents.createdAt))

  return latestPerAccount(rows)
}

/**
 * The fold, separated from the query so the rule it encodes can be tested
 * without a database.
 *
 * Last write wins per account, after sorting by time and then by how resolved
 * the action is. Exported for the tests and for nothing else.
 */
export function latestPerAccount(
  rows: ReadonlyArray<{
    entityId: string | null
    action: string
    createdAt: Date
    metadata: unknown
  }>,
): UnfinishedErasure[] {
  const sorted = [...rows].sort((a, b) => {
    const byTime = a.createdAt.getTime() - b.createdAt.getTime()
    if (byTime !== 0) return byTime
    return (RESOLUTION_ORDER[a.action] ?? 3) - (RESOLUTION_ORDER[b.action] ?? 3)
  })

  const latest = new Map<string, (typeof sorted)[number]>()
  for (const row of sorted) {
    if (row.entityId === null) continue
    latest.set(row.entityId, row)
  }

  const out: UnfinishedErasure[] = []
  for (const [accountId, row] of latest) {
    if (row.action === ERASURE_COMPLETED_ACTION) continue

    const parsed = incompleteMetadataSchema.safeParse(row.metadata)
    const counts = parsed.success ? parsed.data : {}

    out.push({
      accountId,
      at: row.createdAt,
      stage: row.action === ERASURE_INCOMPLETE_ACTION ? 'INCOMPLETE' : 'BEGAN',
      // A `began` row carries how many objects there were to destroy, never how
      // many went — the process that knew died. Null rather than that figure:
      // reporting the intention as the outcome would overstate the damage on
      // every single one.
      objectsDestroyed:
        row.action === ERASURE_INCOMPLETE_ACTION ? (counts.objectsDestroyed ?? null) : null,
      objectsRemaining:
        row.action === ERASURE_INCOMPLETE_ACTION ? (counts.objectsRemaining ?? null) : null,
    })
  }

  return out.sort((a, b) => b.at.getTime() - a.at.getTime())
}
