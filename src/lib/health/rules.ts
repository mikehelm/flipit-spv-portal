/**
 * The things nobody is watching. BUILD_SPEC §6.5, §7, §8.1, §18.1.
 *
 * Everything in this application that can go quietly wrong has a surface that
 * shows it — the reminders page says why a row will not send, the dashboard
 * carries the mail connection and the compliance state, the round page says who
 * has not answered. Every one of those surfaces requires somebody to open it.
 *
 * The failure this exists for is the one where nobody does. A scheduler that
 * was never installed, or that stopped in March, looks from inside the
 * application exactly like a quiet week: the queue is full of rows with dates in
 * the past and nothing anywhere says that the thing which was supposed to act on
 * them is not running. An expired mail credential looks like nobody has sent
 * anything lately. A run killed between taking a reminder and sending it leaves
 * one row marked as being sent, on a page that may not be opened for a fortnight.
 *
 * So: one command that asks all of those questions at once, in a form that can
 * go on the same schedule as the job it is watching.
 *
 * This file is the judgement and nothing else. It takes facts and returns
 * findings, so every rule below is testable without a database, a mail server or
 * a clock. `report.ts` gathers the facts; `scripts/check-health.ts` prints them.
 *
 * **It never acts.** Deciding that a stuck reminder is safe to release, or that
 * a mail credential should be replaced, needs somebody who knows what has been
 * happening. This tells them, in a sentence each, and stops.
 */

export type Severity = 'OK' | 'ATTENTION' | 'WRONG'

export interface Finding {
  /** The part of the system this is about, for grouping. */
  area: string
  severity: Severity
  /** One line. Reads on its own in a log with no context around it. */
  headline: string
  /** What is actually the case. */
  detail: string
  /** What to do about it, or why there is nothing to do. */
  remedy: string
}

export type ServiceMode = 'ACTIVE' | 'READ_ONLY' | 'SUNSET' | 'DISABLED'

/**
 * The subset of the facts that costs two queries to gather.
 *
 * It exists because the admin overview wants a banner when something needs a
 * person, and the overview is loaded far more often than the health page. The
 * full report reads every template, evaluates the eligibility of every queued
 * reminder and loads the round summary — right for a page somebody opened *to
 * look at the health*, wrong for a page they opened to do something else.
 *
 * The two rules that take only this are the two nothing else in the application
 * surfaces at all: whether the scheduled job is running, and whether a run
 * abandoned a reminder mid-send. Everything else the full report checks already
 * has a panel of its own on the overview, so the cheap subset is also the
 * non-duplicating one.
 *
 * `HealthFacts` satisfies this, so the same rules produce the same findings on
 * both surfaces. There is no second set of rules to drift.
 */
export interface UnattendedFacts {
  now: Date
  reminders: {
    roundOpen: boolean
    scheduleEnabled: boolean
    /** From the audit log: when a run last got to the end. */
    lastRunCompletedAt: Date | null
    /** Rows a run took and never finished with. Ids only — never addresses. */
    stuck: Array<{ id: string; claimedAt: Date }>
  }
}

export interface HealthFacts extends UnattendedFacts {
  now: Date
  serviceMode: ServiceMode
  /** This deployment's public URL, and the one permitted to send (§18.1). */
  appUrl: string
  productionAppUrl: string
  mail: {
    state: string
    summary: string
    lastVerifiedAt: Date | null
  }
  compliance: Array<{
    kind: 'INVITATION' | 'REMINDER'
    state: string
    message: string
  }>
  reminders: {
    /** Null when no round is open, in which case none of the rest applies. */
    roundOpen: boolean
    scheduleEnabled: boolean
    /** From the audit log: when a run last got to the end. */
    lastRunCompletedAt: Date | null
    /** Rows that would send right now if a run happened. */
    dueNow: number
    /** Rows due longer ago than the run cadence allows for, and still unsent. */
    overdue: number
    /** Rows a run took and never finished with. Ids only — never addresses. */
    stuck: Array<{ id: string; claimedAt: Date }>
  }
  round: {
    open: boolean
    deadlineReached: number
    awaitingResponse: number
  } | null
  /** When `pnpm backup` last recorded a successful dump. Null when never. */
  lastBackupAt: Date | null
}

/** The audit action `pnpm backup` writes. The only record that one happened. */
export const BACKUP_COMPLETED_ACTION = 'backup.completed'

/**
 * How old a backup may be before it is worth mentioning.
 *
 * Not a fault at any age — see `backupFindings`. Two days allows a nightly
 * regime one missed night without saying anything.
 */
export const BACKUP_STALE_DAYS = 2

/**
 * How long after a run before its absence is a fault.
 *
 * The documented cadence is hourly (`DEPLOYMENT.md` §8). Three hours is two
 * missed runs and then some: long enough that a restart, a slow run or a clock
 * skew does not raise anything, short enough that a scheduler which died
 * overnight is a fault by breakfast.
 */
export const RUN_OVERDUE_HOURS = 3

/**
 * How long a reminder may be in flight before it is a stuck claim.
 *
 * A run sends one recipient at a time with retries and backoff behind each, so a
 * long run is normal and an hour is generous for a single message. Past that,
 * the run that took it is not coming back.
 */
export const CLAIM_STUCK_HOURS = 1

const HOUR_MS = 60 * 60 * 1000

function hoursBetween(from: Date, to: Date): number {
  return (to.getTime() - from.getTime()) / HOUR_MS
}

function describeAge(from: Date, to: Date): string {
  const hours = hoursBetween(from, to)
  if (hours < 1) {
    const minutes = Math.round(hours * 60)
    // "0 minutes ago" is what a rounded number gives you and it reads as a bug.
    if (minutes < 1) return 'just now'
    return `${minutes} minute${minutes === 1 ? '' : 's'} ago`
  }
  if (hours < 48) {
    const rounded = Math.round(hours)
    return `${rounded} hour${rounded === 1 ? '' : 's'} ago`
  }
  const days = Math.round(hours / 24)
  return `${days} day${days === 1 ? '' : 's'} ago`
}

/**
 * Take any email address out of text this report did not write itself.
 *
 * The mail connection's own summary names the Gmail address it authenticated
 * as, which is exactly right on the dashboard and wrong here: this report is
 * built to be run by a scheduler and appended to a log file, and a log file is
 * the least protected place in a deployment. It is the operator's own address
 * rather than an investor's, so this is caution rather than a breach — but the
 * reminder job prints no address for the same reason, and a report that watches
 * it should not be the looser of the two.
 *
 * Applied to borrowed text only. Everything this file writes itself contains no
 * address by construction, and masking that would be theatre.
 */
export function withoutAddresses(text: string): string {
  return text.replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[the connected address]')
}

/** The worst of a set of findings — what the exit code is decided from. */
export function worstOf(findings: Finding[]): Severity {
  if (findings.some((finding) => finding.severity === 'WRONG')) return 'WRONG'
  if (findings.some((finding) => finding.severity === 'ATTENTION')) return 'ATTENTION'
  return 'OK'
}

// ---------------------------------------------------------------------------
// The rules
// ---------------------------------------------------------------------------

/**
 * Is the scheduled job running at all?
 *
 * This is the finding the whole report exists for. Every other surface in the
 * application answers "what would happen if a run occurred"; nothing else
 * anywhere answers "is anything running".
 */
export function schedulerFindings(facts: UnattendedFacts): Finding[] {
  const { reminders, now } = facts

  if (!reminders.roundOpen) {
    return [
      {
        area: 'Scheduled run',
        severity: 'OK',
        headline: 'No round is open, so nothing is scheduled to send.',
        detail: 'Reminders belong to a round. With none open there is no queue to work through.',
        remedy: 'Nothing to do.',
      },
    ]
  }

  const out: Finding[] = []

  if (!reminders.scheduleEnabled) {
    out.push({
      area: 'Scheduled run',
      severity: 'ATTENTION',
      headline: 'Reminders are switched off for this round.',
      detail:
        'The schedule exists but is disabled, so nothing is planned and nothing would send ' +
        'even if the job ran on time.',
      remedy:
        'Deliberate, if somebody turned it off. Reminders → "Send reminders for this round" ' +
        'turns it back on.',
    })
  }

  if (reminders.lastRunCompletedAt === null) {
    out.push({
      area: 'Scheduled run',
      severity: 'WRONG',
      headline: 'No reminder run has ever completed.',
      detail:
        'Nothing in the audit log records a run getting to the end, which means the job has ' +
        'never been run here — most likely because no scheduler is installed.',
      remedy:
        'Install the cron entry in DEPLOYMENT.md §8, then run `pnpm reminders:run` once by ' +
        'hand and check this again.',
    })
  } else if (hoursBetween(reminders.lastRunCompletedAt, now) > RUN_OVERDUE_HOURS) {
    out.push({
      area: 'Scheduled run',
      severity: 'WRONG',
      headline: `The last reminder run completed ${describeAge(reminders.lastRunCompletedAt, now)}.`,
      detail:
        `The documented cadence is hourly, and anything past ${RUN_OVERDUE_HOURS} hours means ` +
        'the scheduler has stopped rather than that it is between runs. Nobody is being ' +
        'chased while this is true, and nothing anywhere else would say so.',
      remedy:
        'Check the scheduler on the deployment and the log it writes to. `pnpm reminders:run` ' +
        'by hand will catch up anything still in date.',
    })
  } else {
    out.push({
      area: 'Scheduled run',
      severity: 'OK',
      headline: `Last run completed ${describeAge(reminders.lastRunCompletedAt, now)}.`,
      detail: 'Within the hourly cadence.',
      remedy: 'Nothing to do.',
    })
  }

  return out
}

/**
 * Reminders that would send if a run happened, and have not.
 *
 * Split from `schedulerFindings` because it costs what that one does not: it
 * needs every queued reminder's eligibility evaluated against the current state
 * of the database, which is a query per offer. The overview banner does not pay
 * that; the full report does.
 *
 * Silent when the scheduler is the cause. A dead cron already has a finding, and
 * reporting its consequence separately would read as two unrelated problems.
 */
export function overdueFindings(facts: HealthFacts): Finding[] {
  const { reminders } = facts
  if (!reminders.roundOpen) return []
  if (reminders.overdue === 0) return []
  if (reminders.lastRunCompletedAt === null) return []
  if (hoursBetween(reminders.lastRunCompletedAt, facts.now) > RUN_OVERDUE_HOURS) return []

  return [
    {
      area: 'Scheduled run',
      severity: 'WRONG',
      headline: `${reminders.overdue} reminder${reminders.overdue === 1 ? ' is' : 's are'} past due and unsent.`,
      detail:
        'These would send if a run happened — they are eligible, they are not blocked, and ' +
        'nothing has taken them. A run has completed recently, so something is refusing them ' +
        'one at a time rather than the scheduler being down.',
      remedy:
        'Run `pnpm reminders:run` and read the reasons it prints; they will name the gate ' +
        'that is refusing each one.',
    },
  ]
}

/**
 * Reminders a run took and never finished with.
 *
 * A claim does not expire, deliberately — see `src/lib/reminders/lock.ts`. The
 * cost of that decision is exactly this: a row that waits for a person. This is
 * the thing that tells the person.
 */
export function stuckClaimFindings(facts: UnattendedFacts): Finding[] {
  const stuck = facts.reminders.stuck.filter(
    (row) => hoursBetween(row.claimedAt, facts.now) > CLAIM_STUCK_HOURS,
  )

  if (stuck.length === 0) return []

  const oldest = stuck.reduce((worst, row) => (row.claimedAt < worst.claimedAt ? row : worst))

  return [
    {
      area: 'Reminders',
      severity: 'WRONG',
      headline: `${stuck.length} reminder${stuck.length === 1 ? ' has' : 's have'} been marked as being sent for over ${CLAIM_STUCK_HOURS} hour${CLAIM_STUCK_HOURS === 1 ? '' : 's'}.`,
      detail:
        `The oldest was taken ${describeAge(oldest.claimedAt, facts.now)} (reminder ` +
        `${oldest.id}). A run took ${stuck.length === 1 ? 'it' : 'them'} and did not finish, ` +
        'so nothing else will send it and nothing will clear it on a timer — a claim that ' +
        'expired would reopen the window it exists to close.',
      remedy:
        '`pnpm reminders:lock` says whether a run is genuinely in progress. If it answers ' +
        'FREE, reschedule the reminder from the reminders page, which releases it. Check the ' +
        'Gmail Sent folder first if it matters whether the message went out.',
    },
  ]
}

/** The mail connection (§8.1) — and whether anything is waiting on it. */
export function mailFindings(facts: HealthFacts): Finding[] {
  if (facts.mail.state === 'HEALTHY') {
    return [
      {
        area: 'Mail',
        severity: 'OK',
        headline: 'The mail connection is healthy.',
        detail: withoutAddresses(facts.mail.summary),
        remedy: 'Nothing to do.',
      },
    ]
  }

  // Unhealthy with nothing waiting is a thing to fix before the next send.
  // Unhealthy with reminders due is a thing that is failing right now.
  const blocking = facts.serviceMode === 'ACTIVE' && facts.reminders.dueNow > 0

  return [
    {
      area: 'Mail',
      severity: blocking ? 'WRONG' : 'ATTENTION',
      headline: blocking
        ? 'The mail connection is not healthy and reminders are due.'
        : 'The mail connection is not healthy.',
      detail: withoutAddresses(facts.mail.summary),
      remedy:
        'Onboarding step 3 re-enters the Gmail app password, and the dashboard has a test ' +
        'connection action that authenticates without sending.',
    },
  ]
}

/** The compliance gate (§8.2) — an approval, and a template that still matches it. */
export function complianceFindings(facts: HealthFacts): Finding[] {
  return facts.compliance
    .filter((entry) => entry.state !== 'APPROVED')
    .map((entry) => {
      const blocking = entry.kind === 'REMINDER' && facts.reminders.dueNow > 0
      return {
        area: 'Compliance',
        severity: blocking ? 'WRONG' : 'ATTENTION',
        headline: blocking
          ? `The ${entry.kind.toLowerCase()} template is not approved, and reminders are due.`
          : `The ${entry.kind.toLowerCase()} template is not approved.`,
        detail: withoutAddresses(entry.message),
        remedy:
          'The owner records the approval on the compliance page. Only the owner can — the ' +
          'operator cannot record, amend or void one, by design.',
      }
    })
}

/** The service mode (§7). Not active is a decision, not a fault. */
export function serviceModeFindings(facts: HealthFacts): Finding[] {
  if (facts.serviceMode === 'ACTIVE') return []

  return [
    {
      area: 'Service mode',
      severity: 'ATTENTION',
      headline: `The service mode is ${facts.serviceMode}.`,
      detail:
        'Nothing sends outside active mode. Queued reminders are held rather than deleted, so ' +
        'switching back to active before the deadlines restores them.',
      remedy: 'Deliberate, if somebody set it. Settings → service mode.',
    },
  ]
}

/**
 * The §18.1 base-URL guard.
 *
 * Correct behaviour on a testing deployment and a disaster on the real one, and
 * from inside the application the two are indistinguishable — which is why this
 * says which URL it is actually configured with rather than just "refused".
 */
export function deploymentFindings(facts: HealthFacts): Finding[] {
  if (facts.appUrl === facts.productionAppUrl) {
    return [
      {
        area: 'Deployment',
        severity: 'OK',
        headline: 'This deployment is the one permitted to send real invitations.',
        detail: `APP_URL is ${facts.appUrl}, which matches PRODUCTION_APP_URL.`,
        remedy: 'Nothing to do.',
      },
    ]
  }

  return [
    {
      area: 'Deployment',
      severity: 'ATTENTION',
      headline: 'Real invitations are refused from this deployment.',
      detail:
        `APP_URL is ${facts.appUrl}; PRODUCTION_APP_URL is ${facts.productionAppUrl}. Every ` +
        'portal link embeds the domain it was issued from, so a link issued here would die ' +
        'the moment the application moves.',
      remedy:
        'Correct on anything but production. On production, APP_URL is wrong and no ' +
        'invitation will send until it matches.',
    },
  ]
}

/** Deadlines that have passed with people still to answer (§6.6). */
export function roundFindings(facts: HealthFacts): Finding[] {
  if (!facts.round || !facts.round.open) return []
  if (facts.round.deadlineReached === 0) return []

  return [
    {
      area: 'The round',
      severity: 'ATTENTION',
      headline: `${facts.round.deadlineReached} deadline${facts.round.deadlineReached === 1 ? ' has' : 's have'} passed.`,
      detail:
        `${facts.round.awaitingResponse} recipient${facts.round.awaitingResponse === 1 ? ' has' : 's have'} ` +
        'still not answered. A deadline passing closes nothing and takes nothing away — they ' +
        'can still respond — so this stays true until somebody decides what to do.',
      remedy:
        'The round page has per-recipient and global extensions, and the explicit close ' +
        'button. Inaction is a valid choice and is why this is not a fault.',
    },
  ]
}

/**
 * When the database was last backed up.
 *
 * Never a fault, at any age, and that is a deliberate limit on what this report
 * is entitled to conclude. `pnpm backup` records a line when it runs, so this
 * can only ever say when *that command* last ran here. A deployment whose
 * backups are the host's volume snapshots is backed up perfectly well and has
 * nothing to record, and a report that called that a fault would be wrong every
 * single day until somebody switched it off.
 *
 * So it says what it knows and names the limit of it.
 */
export function backupFindings(facts: HealthFacts): Finding[] {
  if (facts.lastBackupAt === null) {
    return [
      {
        area: 'Backups',
        severity: 'ATTENTION',
        headline: 'This application has no record of a backup.',
        detail:
          '`pnpm backup` writes a line to the audit log each time it runs, and there is none. ' +
          'That means the command has not been run here — not that nothing is backed up. If ' +
          'the deployment is snapshotted by its host, this is expected and there is nothing ' +
          'to see.',
        remedy:
          'If backups are meant to come from `pnpm backup`, put it on a schedule and test a ' +
          'restore with `pnpm verify:restore`. If they come from somewhere else, this line ' +
          'will keep saying this.',
      },
    ]
  }

  const days = hoursBetween(facts.lastBackupAt, facts.now) / 24
  if (days <= BACKUP_STALE_DAYS) {
    return [
      {
        area: 'Backups',
        severity: 'OK',
        headline: `Last backup ${describeAge(facts.lastBackupAt, facts.now)}.`,
        detail: 'Recorded by `pnpm backup`.',
        remedy: 'Nothing to do.',
      },
    ]
  }

  return [
    {
      area: 'Backups',
      severity: 'ATTENTION',
      headline: `The last recorded backup was ${describeAge(facts.lastBackupAt, facts.now)}.`,
      detail:
        'Something has been running `pnpm backup` and appears to have stopped. This is not ' +
        'called a fault because a backup regime that moved elsewhere looks identical from ' +
        'here — but one that stopped by accident looks identical too, and only somebody who ' +
        'knows which can tell them apart.',
      remedy:
        'Check whatever runs the backup. `pnpm verify:restore` proves a backup can actually ' +
        'be restored, which is the half that goes untested.',
    },
  ]
}

/**
 * The two findings nothing else in the application surfaces, from the two
 * queries it takes to know them.
 *
 * This is what the admin overview shows a banner from. It is a strict subset of
 * `buildFindings` — same rules, same wording, fewer of them — so the banner and
 * the health page can never say different things about the same fact.
 */
export function unattendedFindings(facts: UnattendedFacts): Finding[] {
  return [...schedulerFindings(facts), ...stuckClaimFindings(facts)]
}

/** Every rule, in the order they are printed. */
export function buildFindings(facts: HealthFacts): Finding[] {
  return [
    ...schedulerFindings(facts),
    ...overdueFindings(facts),
    ...stuckClaimFindings(facts),
    ...mailFindings(facts),
    ...complianceFindings(facts),
    ...serviceModeFindings(facts),
    ...deploymentFindings(facts),
    ...roundFindings(facts),
    ...backupFindings(facts),
  ]
}
