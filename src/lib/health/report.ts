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
import { readUnfinishedErasures } from '@/lib/erasure/unfinished'
import { readMailConnectionHealth } from '@/lib/email/transport'
import { env } from '@/lib/env'
import { disabledFlags, readFeatureFlags } from '@/lib/flags'
import {
  countTrackedFiles,
  MEDIA_CHECK_COMPLETED_ACTION,
  mediaCheckRecordSchema,
} from '@/lib/media/reconcile'
import { mediaStore } from '@/lib/media/store'
import { currentRound, loadQueue } from '@/lib/reminders/queue'
import { loadRoundSummary } from '@/lib/rounds/summary'
import {
  BACKUP_COMPLETED_ACTION,
  buildFindings,
  RUN_OVERDUE_HOURS,
  unattendedFindings,
  worstOf,
  type Finding,
  type HealthFacts,
  type MediaCheckSummary,
  type ServiceMode,
  type Severity,
  type UnattendedFacts,
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
 * What `pnpm media:check` last wrote down, parsed rather than cast.
 *
 * One query, and it never touches a store. The metadata is written by a script
 * and read here weeks later, which is exactly the gap over which a shape drifts
 * — so it goes through the same Zod schema the script builds it with, and a row
 * that does not match is treated as no row at all. A health report that threw on
 * a malformed audit entry would take the whole page down over the one finding
 * that matters least.
 */
async function lastMediaCheck(): Promise<MediaCheckSummary | null> {
  const rows = await db
    .select({ createdAt: auditEvents.createdAt, metadata: auditEvents.metadata })
    .from(auditEvents)
    .where(eq(auditEvents.action, MEDIA_CHECK_COMPLETED_ACTION))
    .orderBy(desc(auditEvents.createdAt))
    .limit(1)

  const row = rows[0]
  if (!row) return null

  const parsed = mediaCheckRecordSchema.safeParse(row.metadata)
  if (!parsed.success) return null

  return { at: row.createdAt, ...parsed.data }
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
    lastMediaCheck: await lastMediaCheck(),
    unfinishedErasures: await readUnfinishedErasures(),
    storage: {
      configured: mediaStore() !== null,
      recordsNamingAFile: await countTrackedFiles(),
    },
    round: summary
      ? {
          open: summary.closedAt === null,
          deadlineReached: summary.counts.deadlineReached,
          awaitingResponse: summary.counts.notResponded,
        }
      : null,
    lastBackupAt: await lastActionAt(BACKUP_COMPLETED_ACTION),
    // Booleans, not the addresses. The rules never see them, so no rule can
    // put one in a log line. Whitespace counts as unset, exactly as
    // `portalContacts` treats it — otherwise a field holding a stray space
    // reads as configured here and renders as nothing on the notice.
    contact: {
      hasOperatorAddress: (config.defaultSenderEmail ?? '').trim() !== '',
      hasStandingAddress: (config.serviceContactEmail ?? '').trim() !== '',
    },
    // Keys only, and only the ones this application actually consults. A row
    // in the table naming something nothing reads is not a portal section
    // switched off; it is a row.
    disabledFlags: disabledFlags(await readFeatureFlags()),
  }
}

/**
 * The handful of indexed reads behind the overview banner.
 *
 * Deliberately not `gatherFacts`. That reads every template, evaluates the
 * eligibility of every queued reminder — a query per offer — and loads the round
 * summary, which is the right cost for a page somebody opened to look at the
 * health and the wrong cost for the page they land on first.
 *
 * What it leaves out is what the overview already shows: the mail connection has
 * its own panel there, the service mode has its own card. What it keeps is the
 * things nothing else anywhere surfaces — and none of them costs more than one
 * bounded query. In particular the media check's *verdict* is read here and the
 * media check itself is not: reconciling stats every stored object over the
 * network, which has no place inside a page render.
 */
export async function gatherUnattendedFacts(
  now: Date = new Date(),
): Promise<UnattendedFacts> {
  const round = await currentRound()
  const schedule = round
    ? await db.query.reminderSchedules.findFirst({
        where: eq(reminderSchedules.roundId, round.id),
      })
    : null

  return {
    now,
    reminders: {
      roundOpen: round !== undefined && round !== null,
      scheduleEnabled: schedule?.enabled ?? false,
      lastRunCompletedAt: await lastActionAt(RUN_COMPLETED_ACTION),
      stuck: await stuckClaims(),
    },
    lastMediaCheck: await lastMediaCheck(),
    unfinishedErasures: await readUnfinishedErasures(),
  }
}

/**
 * What the overview banner needs: how many things need a person, and roughly
 * what they are about. Zero is the answer on a healthy system and the banner
 * shows nothing.
 *
 * `areas` rather than headlines, deliberately. A headline on the overview would
 * be a second place the same sentence is written, and the two would drift; the
 * area is enough to tell somebody whether to stop what they are doing, and the
 * page one click away says exactly what and what to do. It is also the part
 * that cannot leak anything — an area is one of a fixed handful of words.
 */
export async function readUnattendedAlert(
  now: Date = new Date(),
): Promise<{ needsAPerson: number; areas: string[] }> {
  const findings = unattendedFindings(await gatherUnattendedFacts(now)).filter(
    (row) => row.severity === 'WRONG',
  )

  return {
    needsAPerson: findings.length,
    areas: [...new Set(findings.map((row) => row.area))],
  }
}

export async function buildHealthReport(now: Date = new Date()): Promise<HealthReport> {
  const facts = await gatherFacts(now)
  const findings = buildFindings(facts)
  return { at: now, findings, worst: worstOf(findings) }
}

// Re-exported so callers need one import.
export { RUN_OVERDUE_HOURS, type Finding, type HealthFacts, type Severity }
