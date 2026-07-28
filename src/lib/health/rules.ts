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

import type { BucketVersioning } from '@/lib/media/s3'

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
 * The subset of the facts that costs one query each to gather.
 *
 * It exists because the admin overview wants a banner when something needs a
 * person, and the overview is loaded far more often than the health page. The
 * full report reads every template, evaluates the eligibility of every queued
 * reminder and loads the round summary — right for a page somebody opened *to
 * look at the health*, wrong for a page they opened to do something else.
 *
 * The rules that take only this are the ones nothing else in the application
 * surfaces at all: whether the scheduled job is running, whether a run abandoned
 * a reminder mid-send, and what the last reconciliation of stored files against
 * their records came back with. Everything else the full report checks already
 * has a panel of its own on the overview, so the cheap subset is also the
 * non-duplicating one.
 *
 * The bound is per-fact, and it is a bound on *this page*, not on the check:
 * each field below is one indexed read, and none of them touches a template, a
 * queue evaluation or a media store.
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
  /**
   * What `pnpm media:check` last found, from the one line it writes when it
   * runs. Null when it has never run here.
   *
   * One query, which is why it is in the cheap subset. The reconciliation
   * itself is not: it stats every stored object and lists the store, which is a
   * network round trip per file and belongs in a command rather than on a page
   * load. What is read here is the *verdict of the last run*, never the run.
   */
  lastMediaCheck: MediaCheckSummary | null
}

/** The counted outcome of one `pnpm media:check`, as it was written down. */
export interface MediaCheckSummary {
  at: Date
  /** False when that run found no store configured, and so checked nothing. */
  storeConfigured: boolean
  checked: number
  missing: number
  wrongSize: number
  unreadable: number
  orphans: number
  /** Whether the store could be listed at all on that run. */
  listed: boolean
  truncated: boolean
  /**
   * What the store said about keeping what it is told to delete.
   *
   * Undefined on a row written before the command asked. Undefined is not
   * `DISABLED` and must not be reported as one.
   */
  versioning?: BucketVersioning
  /** Everything wrong on that run, counted once. */
  problems: number
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
  /**
   * Whether there is anywhere to put a file, and whether anything needs one.
   *
   * Two facts and three counts, and deliberately not the reconciliation. See
   * `storageFindings` for why the report reads a verdict rather than producing
   * one.
   */
  storage: {
    /** `MEDIA_STORE` selects an implementation. Empty is a supported state. */
    configured: boolean
    /** How many rows across the three tables name a stored file. */
    recordsNamingAFile: number
  }
  /** When `pnpm backup` last recorded a successful dump. Null when never. */
  lastBackupAt: Date | null
  /**
   * Whether an investor stuck on a notice has anywhere to write. §4.2, §7.
   *
   * Booleans, never the addresses themselves — this report is appended to a log
   * file by a scheduler, and the reminder job prints no address for the same
   * reason.
   */
  contact: {
    /** `default_sender_email` — the operator's own, read while the portal runs. */
    hasOperatorAddress: boolean
    /** `service_contact_email` — the one shown once the portal has closed. */
    hasStandingAddress: boolean
  }
  /**
   * Feature flags that are switched off. §7.
   *
   * Keys, which are a fixed handful of words naming modules — never a row and
   * never anything an investor wrote.
   */
  disabledFlags: string[]
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
 * How old a clean media check may be before it is worth mentioning.
 *
 * `DEPLOYMENT.md` §8 puts `pnpm media:check` on a weekly cron. Ten days is one
 * missed week and a little, so a deployment running it on schedule never sees
 * this and one where the entry was never installed says so within a fortnight.
 */
export const MEDIA_CHECK_STALE_DAYS = 10

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

/**
 * The areas of a set of findings, as a phrase somebody can read.
 *
 * The overview banner says how many things need a person and what they are
 * about, and it used to say what they were about in a sentence typed into the
 * page: *"the scheduled reminder job, or a reminder a run took and never
 * finished sending"*. That was true of the two rules the banner had at the time
 * and became false the moment a third was added, silently, because a hardcoded
 * sentence has nothing to check it against. This derives the phrase from the
 * findings, so a rule that starts appearing on the banner starts being named by
 * it.
 *
 * Areas, not headlines. A headline on the overview would be the same sentence
 * written in two places and the two would drift — and an area is one of a fixed
 * handful of words, so there is nothing in it that could be about a person.
 */
export function describeAreas(areas: readonly string[]): string {
  const phrases = areas.map((area) => {
    const lowered = area.charAt(0).toLowerCase() + area.slice(1)
    // "the scheduled run" reads; "scheduled run" does not. "Reminders" and
    // "stored files" are plurals and take no article.
    return lowered === 'scheduled run' ? 'the scheduled run' : lowered
  })

  if (phrases.length === 0) return 'something this screen does not show'
  if (phrases.length === 1) return phrases[0]!
  return `${phrases.slice(0, -1).join(', ')} and ${phrases[phrases.length - 1]}`
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

/**
 * Is there a way to reach anybody, on the pages where that is all there is?
 *
 * §4.2 gives a suspended account *"a neutral notice page with a contact
 * route"*; §7 gives a disabled service *"a neutral closed page with a contact
 * address"*. Those notices are the last thing an investor sees and the only
 * thing they can act on, and nothing else in the application would ever notice
 * that they are blank — the operator reading his own settings sees two empty
 * optional fields, not a locked-out reader looking at a dead end.
 *
 * Two settings, and they are not interchangeable. §7 is explicit that
 * `service_contact_email` is *"shown once the portal is closed and after the
 * operator's own address stops being monitored"* — so having only the
 * operator's address is a plan that works until the day it is needed, which is
 * Open Decision 7 as a finding rather than a line in a file.
 *
 * Booleans in, never addresses. This report is appended to a log by a scheduler.
 */
export function contactFindings(facts: HealthFacts): Finding[] {
  const { hasOperatorAddress, hasStandingAddress } = facts.contact
  const ending = facts.serviceMode === 'SUNSET' || facts.serviceMode === 'DISABLED'

  if (!hasOperatorAddress && !hasStandingAddress) {
    return [
      {
        area: 'Contact route',
        severity: ending ? 'WRONG' : 'ATTENTION',
        headline: 'A locked-out investor is given no way to reach anybody.',
        detail: ending
          ? 'The service mode means every investor now sees a closing or closed notice, and ' +
            'neither the sending address nor the standing contact address is set — so those ' +
            'notices name nobody. It is the only route those readers have.'
          : 'Neither the sending address nor the standing contact address is set. A suspended ' +
            'or closed account sees a notice with no address on it, and the page deliberately ' +
            'says nothing rather than naming a route that is not one.',
        remedy: 'Settings → the sending address, and the contact address below it.',
      },
    ]
  }

  if (!hasStandingAddress) {
    return [
      {
        area: 'Contact route',
        severity: ending ? 'WRONG' : 'ATTENTION',
        headline: ending
          ? 'The closing notice points at an address that is about to stop being read.'
          : 'There is no address for after the operator stops reading his.',
        detail:
          'The sending address is the only one configured. Once the portal closes it stops ' +
          'being monitored, and a notice offering an unread address is a dead end dressed ' +
          'as a route.',
        remedy: 'Settings → contact address. It is the one shown once the portal has closed.',
      },
    ]
  }

  if (!hasOperatorAddress) {
    return [
      {
        area: 'Contact route',
        severity: 'ATTENTION',
        headline: 'A suspended investor is sent to the standing address rather than the operator.',
        detail:
          'The contact address is set and the sending address is not, so a notice raised while ' +
          'the portal is still running points past the person who could act on it.',
        remedy: 'Settings → the sending address.',
      },
    ]
  }

  return [
    {
      area: 'Contact route',
      severity: 'OK',
      headline: 'Both contact addresses are set.',
      detail:
        'A suspended or closed account is given the sending address with the standing one ' +
        'underneath; a closing or closed portal is given the standing one alone.',
      remedy: 'Nothing to do.',
    },
  ]
}

/**
 * A portal section switched off by a flag.
 *
 * §7 puts phase-two modules behind flags *"so functionality can be switched on
 * for a later round without redeployment risk"*. The table shipped with four
 * rows and nothing read it, so a flag was a switch with no wire; it has one
 * now, which makes the opposite failure possible for the first time. Somebody
 * turns one off by hand in a database in October and in March nobody remembers
 * why the register does not accept a join.
 *
 * `ATTENTION`, never `WRONG`. A flag that is off is somebody's decision, and
 * the report's rule for a decision is to say it plainly and exit zero — the
 * same treatment a non-active service mode gets.
 */
export function flagFindings(facts: HealthFacts): Finding[] {
  if (facts.disabledFlags.length === 0) {
    return [
      {
        area: 'Portal sections',
        severity: 'OK',
        headline: 'Every portal section is switched on.',
        detail: 'No feature flag is turning anything off.',
        remedy: 'Nothing to do.',
      },
    ]
  }

  const names = [...facts.disabledFlags].sort().join(', ')

  return [
    {
      area: 'Portal sections',
      severity: 'ATTENTION',
      headline:
        facts.disabledFlags.length === 1
          ? 'A portal section is switched off by a feature flag.'
          : `${facts.disabledFlags.length} portal sections are switched off by feature flags.`,
      detail:
        `Off: ${names}. A flag never removes what an investor has already written — the ` +
        'register and the question thread stay readable and stop accepting anything new — ' +
        'and the video and the tiles are absent while their flag is off.',
      remedy:
        'Deliberate, if somebody set it. The flags are rows in feature_flags; nothing in ' +
        'this application writes them.',
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
 * What `pnpm media:check` last found, when what it found was wrong.
 *
 * **This reads a verdict; it does not reach a store.** Reconciling costs a
 * `stat` per stored object and a listing of the whole bucket — right for a
 * weekly command with a log file behind it, wrong for a page that renders while
 * somebody waits, where the same work would put an unbounded number of network
 * round trips inside a request. So the command writes down what it found and
 * this reads the line. The cost is that a report is only ever as current as the
 * last run, which is exactly why the *absence* of a run is itself a finding
 * below.
 *
 * Shared between the full report and the overview banner, so the two can never
 * describe the same fact differently. One query either side.
 */
/**
 * A bucket that keeps what it is told to delete.
 *
 * **Separate from the problem findings below, because it is a different kind of
 * fact.** Everything there is a disagreement between the rows and the store,
 * found by comparing them. This one cannot be found that way at all: a
 * versioned bucket answers `stat`, `list` and `get` exactly as an unversioned
 * one does, and a `DELETE` against it succeeds. It has to be asked, and the
 * asking happens in `pnpm media:check` so that no request to this endpoint
 * costs a round trip to a bucket.
 *
 * What is at stake is the one action in this application that cannot be undone.
 * With versioning on, an investor erasure reports that it destroyed a signed
 * subscription agreement, and the agreement is still there.
 */
export function bucketRetentionFindings(facts: UnattendedFacts): Finding[] {
  const last = facts.lastMediaCheck
  if (last === null) return []
  if (!last.storeConfigured) return []

  const versioning = last.versioning
  // A run from before the command asked. Saying nothing is right: there is no
  // evidence either way, and inventing a warning from an absent field would put
  // one on every deployment until the next scheduled run.
  if (versioning === undefined) return []
  if (versioning === 'DISABLED') return []

  if (versioning === 'UNKNOWN') {
    return [
      {
        area: 'Stored files',
        severity: 'ATTENTION',
        headline: 'The store will not say whether it keeps what it is told to delete.',
        detail:
          'The last media check asked the store whether versioning is on and did not get an ' +
          'answer — the provider may not implement the question, or the key pair may be ' +
          'scoped to objects and not to the bucket’s configuration. Both are ordinary. It is ' +
          'reported because the answer matters: on a versioned bucket a delete keeps the ' +
          'object, and an investor erasure would report success over a document that is still ' +
          'there.',
        remedy:
          'Check in the provider’s console that versioning is off for this bucket, along with ' +
          'any object lock or retention rule. DEPLOYMENT.md §1 says why. Nothing here can ' +
          'confirm it for you.',
      },
    ]
  }

  return [
    {
      area: 'Stored files',
      severity: 'WRONG',
      headline:
        versioning === 'ENABLED'
          ? 'The bucket keeps what it is told to delete.'
          : 'The bucket kept what it was told to delete, and still holds those copies.',
      detail:
        versioning === 'ENABLED'
          ? 'Versioning is on. A delete writes a marker and keeps the object, so every check ' +
            'in this application passes while every deleted file remains recoverable from the ' +
            'provider’s console. An investor erasure destroys stored documents outright and ' +
            'says so on the screen — on this bucket that sentence is not true.'
          : 'Versioning is suspended, which stops new versions being written and keeps every ' +
            'one already there. Anything deleted while it was on — including any file an ' +
            'investor erasure destroyed — is still in the bucket.',
      remedy:
        'Turn versioning off for this bucket, and expire the non-current versions: a lifecycle ' +
        'rule that removes them immediately is the usual way. Then run `pnpm media:check` ' +
        'again. Until that is done, treat any erasure carried out against this bucket as ' +
        'incomplete — DEPLOYMENT.md §12.',
    },
  ]
}

export function mediaProblemFindings(facts: UnattendedFacts): Finding[] {
  const last = facts.lastMediaCheck
  if (last === null) return []
  // A run with no store to check reports the rows it could not reach. That case
  // needs the current counts to describe properly and belongs to
  // `storageFindings`, which has them.
  if (!last.storeConfigured) return []
  if (last.problems === 0) return []

  const parts: string[] = []
  if (last.missing > 0) {
    parts.push(`${last.missing} file${last.missing === 1 ? '' : 's'} the record survived without`)
  }
  if (last.wrongSize > 0) {
    parts.push(`${last.wrongSize} the wrong size`)
  }
  if (last.unreadable > 0) {
    parts.push(`${last.unreadable} the store refused to answer about`)
  }
  if (last.orphans > 0) {
    parts.push(`${last.orphans} stored with no record pointing at ${last.orphans === 1 ? 'it' : 'them'}`)
  }
  if (!last.listed) {
    parts.push('and the store could not be listed at all')
  }
  if (last.truncated) {
    parts.push('and the listing hit its limit, so there may be more it did not see')
  }

  return [
    {
      area: 'Stored files',
      severity: 'WRONG',
      headline: `The last media check found ${last.problems} problem${last.problems === 1 ? '' : 's'}.`,
      detail:
        `It ran ${describeAge(last.at, facts.now)} over ${last.checked} record` +
        `${last.checked === 1 ? '' : 's'} and found ${parts.join(', ')}. A record with no file ` +
        'behind it is a broken image or a document that will not download, one at a time, as ' +
        'somebody happens to click; an object with no record is a file nothing in this ' +
        'application will ever show and nothing will ever delete.',
      remedy:
        'Run `pnpm media:check` — it names every one, and it changes nothing. The usual cause ' +
        'is a database restored without the bucket it was taken alongside (DEPLOYMENT.md §1.1).',
    },
  ]
}

/**
 * Whether stored files and the records that name them still agree — and, first,
 * whether anybody is asking.
 *
 * The failure this exists for is the same shape as the scheduler one. A media
 * check that is never run looks, from every page in this application, exactly
 * like a media check that keeps coming back clean.
 */
export function storageFindings(facts: HealthFacts): Finding[] {
  const { storage, lastMediaCheck: last } = facts

  // First, unconditionally, because the overview banner emits exactly this and
  // the banner must never say something the page does not. The configuration
  // branches below are additions to it, not alternatives — a store switched off
  // after a check found two files missing does not make those files found.
  const problems = [...bucketRetentionFindings(facts), ...mediaProblemFindings(facts)]

  if (!storage.configured) {
    if (storage.recordsNamingAFile > 0) {
      return [
        ...problems,
        {
          area: 'Stored files',
          severity: 'WRONG',
          headline: `${storage.recordsNamingAFile} record${storage.recordsNamingAFile === 1 ? '' : 's'} name a stored file and there is nowhere to read one from.`,
          detail:
            'MEDIA_STORE is empty, so every image, video and document package in the database ' +
            'points at a file this deployment cannot reach. Nothing has been lost — the objects ' +
            'are wherever they were put — but nothing will load until the application is told ' +
            'where that is.',
          remedy:
            'Set MEDIA_STORE back to what this deployment was configured with, and its store ' +
            'settings with it. Then `pnpm media:check` will say whether the files are still ' +
            'there.',
        },
      ]
    }

    // Nothing needs a store — but a previous run may still have found something
    // that nobody has dealt with, and "nothing needs one" alongside "two files
    // are missing" would be a report arguing with itself.
    if (problems.length > 0) return problems

    return [
      {
        area: 'Stored files',
        severity: 'OK',
        headline: 'No media store is configured, and nothing needs one.',
        detail:
          'A deployment with no media store is complete: the portal, the invitation and the ' +
          'participation certificate all work with an empty media library, and an upload is ' +
          'refused with a message saying what to set.',
        remedy: 'Nothing to do.',
      },
    ]
  }

  if (problems.length > 0) return problems

  if (last === null || !last.storeConfigured) {
    return [
      {
        area: 'Stored files',
        severity: 'ATTENTION',
        headline: 'No media check has been run against this store.',
        detail:
          '`pnpm media:check` writes a line to the audit log each time it runs, and there is ' +
          'none from a run that had a store to check. Nothing is known to be wrong; nothing has ' +
          'looked. A database restored without its bucket is invisible until something does.',
        remedy:
          'Run `pnpm media:check` once by hand, then install the weekly cron entry in ' +
          'DEPLOYMENT.md §8 so this keeps answering.',
      },
    ]
  }

  const days = hoursBetween(last.at, facts.now) / 24

  if (days > MEDIA_CHECK_STALE_DAYS) {
    return [
      {
        area: 'Stored files',
        severity: 'ATTENTION',
        headline: `The last media check was ${describeAge(last.at, facts.now)}.`,
        detail:
          `It was clean. The documented cadence is weekly, so something has been running it ` +
          'and appears to have stopped — which means this line is now describing a state that ' +
          'may have changed since.',
        remedy: 'Check the weekly cron entry in DEPLOYMENT.md §8, and run it once by hand.',
      },
    ]
  }

  // Files added since the last run are not a fault — the next one will see
  // them — but a report that said "all present" about files nothing has looked
  // at would be claiming more than it knows.
  const added = storage.recordsNamingAFile - last.checked

  return [
    {
      area: 'Stored files',
      severity: 'OK',
      headline: `Last media check ${describeAge(last.at, facts.now)}, and it was clean.`,
      detail:
        `${last.checked} record${last.checked === 1 ? '' : 's'} checked: every file present, ` +
        'every one the size its record says, and nothing stored that no record points at.' +
        (added > 0
          ? ` ${added} record${added === 1 ? ' has' : 's have'} been added since, which the ` +
            'next run will cover.'
          : ''),
      remedy: 'Nothing to do.',
    },
  ]
}

/**
 * The findings nothing else in the application surfaces, from the queries it
 * takes to know them.
 *
 * This is what the admin overview shows a banner from. It is a strict subset of
 * `buildFindings` — same rules, same wording, fewer of them — so the banner and
 * the health page can never say different things about the same fact.
 */
export function unattendedFindings(facts: UnattendedFacts): Finding[] {
  return [...schedulerFindings(facts), ...stuckClaimFindings(facts), ...mediaProblemFindings(facts)]
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
    ...contactFindings(facts),
    ...flagFindings(facts),
    ...roundFindings(facts),
    ...storageFindings(facts),
    ...backupFindings(facts),
  ]
}
