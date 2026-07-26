/**
 * Gathering the facts for the health report. BUILD_SPEC §6.5, §7, §8.1, §18.1.
 *
 * `rules.ts` holds the judgement and knows nothing about a database. This holds
 * the reads and makes no judgements, so the split is: everything below can only
 * be wrong about *what is true*, and everything there can only be wrong about
 * *what that means*. The second is where the interesting mistakes live and it is
 * testable without a Postgres.
 *
 * Nothing here writes. The report is a question asked of the system, and a
 * question that changes its subject is not one.
 */

import { and, desc, eq, isNull } from 'drizzle-orm'
import { db } from '@/db'
import { auditEvents, reminderEvents, reminderSchedules } from '@/db/schema'
import { readServiceConfig } from '@/lib/auth/service-config'
import { checkTemplateDrift } from '@/lib/compliance/drift'
import { readMailConnectionHealth } from '@/lib/email/transport'
import { env } from '@/lib/env'
import { currentRound, loadQueue } from '@/lib/reminders/queue'
import { loadRoundSummary } from '@/lib/rounds/summary'
import {
  BACKUP_COMPLETED_ACTION,
  buildFindings,
  RUN_OVERDUE_HOURS,
  worstOf,
  type Finding,
  type HealthFacts,
  type ServiceMode,
  type Severity,
} from './rules'

export interface HealthReport {
  at: Date
  findings: Finding[]
  worst: Severity
}

/** The audit action a completed run writes. The only record that one happened. */
const RUN_COMPLETED_ACTION = 'reminder.run_completed'

/** The most recent time an action was recorded, or null when it never was. */
async function lastActionAt(action: string): Promise<Date | null> {
  const rows = await db
    .select({ createdAt: auditEvents.createdAt })
    .from(auditEvents)
    .where(eq(auditEvents.action, action))
    .orderBy(desc(auditEvents.createdAt))
    .limit(1)

  return rows[0]?.createdAt ?? null
}

/**
 * Reminders a run took and never finished with.
 *
 * Claimed, and not resolved into any of the three outcomes that end a row. Ids
 * only: this report can end up in a log file on a server, and the standing rule
 * that the reminder job prints no address applies to anything that watches it.
 */
async function stuckClaims(): Promise<Array<{ id: string; claimedAt: Date }>> {
  const rows = await db
    .select({ id: reminderEvents.id, claimedAt: reminderEvents.claimedAt })
    .from(reminderEvents)
    .where(
      and(
        isNull(reminderEvents.sentAt),
        isNull(reminderEvents.cancelledAt),
        isNull(reminderEvents.skippedReason),
      ),
    )

  return rows
    .filter((row): row is { id: string; claimedAt: Date } => row.claimedAt !== null)
    .sort((a, b) => a.claimedAt.getTime() - b.claimedAt.getTime())
}

/**
 * Reminders that would send if a run happened, now and long ago.
 *
 * Eligibility is re-evaluated by `loadQueue` against the state of the database
 * this second, which is the same evaluation the runner does — so a row counted
 * here is one a run really would act on, not one that merely has a date in the
 * past. A held row is not evidence that anything is broken.
 */
async function dueCounts(
  roundId: string,
  now: Date,
): Promise<{ dueNow: number; overdue: number }> {
  const queue = await loadQueue(roundId)
  const cutoff = new Date(now.getTime() - RUN_OVERDUE_HOURS * 60 * 60 * 1000)

  const sendable = queue.filter(
    (row) => row.state === 'QUEUED' && row.scheduledFor.getTime() <= now.getTime(),
  )

  return {
    dueNow: sendable.length,
    overdue: sendable.filter((row) => row.scheduledFor < cutoff).length,
  }
}

export async function gatherFacts(now: Date = new Date()): Promise<HealthFacts> {
  const config = await readServiceConfig()
  const mail = await readMailConnectionHealth(now)
  const round = await currentRound()

  const [invitation, reminder] = await Promise.all([
    checkTemplateDrift('INVITATION'),
    checkTemplateDrift('REMINDER'),
  ])

  const schedule = round
    ? await db.query.reminderSchedules.findFirst({
        where: eq(reminderSchedules.roundId, round.id),
      })
    : null

  const counts = round ? await dueCounts(round.id, now) : { dueNow: 0, overdue: 0 }
  const summary = round ? await loadRoundSummary(round.id, { now }) : null

  return {
    now,
    serviceMode: config.serviceMode as ServiceMode,
    appUrl: env().APP_URL,
    productionAppUrl: env().PRODUCTION_APP_URL,
    mail: {
      state: mail.state,
      summary: mail.summary,
      lastVerifiedAt: mail.lastVerifiedAt,
    },
    compliance: [
      { kind: 'INVITATION', state: invitation.state, message: invitation.message },
      { kind: 'REMINDER', state: reminder.state, message: reminder.message },
    ],
    reminders: {
      roundOpen: round !== undefined && round !== null,
      scheduleEnabled: schedule?.enabled ?? false,
      lastRunCompletedAt: await lastActionAt(RUN_COMPLETED_ACTION),
      dueNow: counts.dueNow,
      overdue: counts.overdue,
      stuck: await stuckClaims(),
    },
    round: summary
      ? {
          open: summary.closedAt === null,
          deadlineReached: summary.counts.deadlineReached,
          awaitingResponse: summary.counts.notResponded,
        }
      : null,
    lastBackupAt: await lastActionAt(BACKUP_COMPLETED_ACTION),
  }
}

export async function buildHealthReport(now: Date = new Date()): Promise<HealthReport> {
  const facts = await gatherFacts(now)
  const findings = buildFindings(facts)
  return { at: now, findings, worst: worstOf(findings) }
}

// Re-exported so callers need one import.
export { RUN_OVERDUE_HOURS, type Finding, type HealthFacts, type Severity }
