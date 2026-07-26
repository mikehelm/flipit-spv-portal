import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  BACKUP_STALE_DAYS,
  CLAIM_STUCK_HOURS,
  RUN_OVERDUE_HOURS,
  backupFindings,
  buildFindings,
  complianceFindings,
  deploymentFindings,
  mailFindings,
  roundFindings,
  schedulerFindings,
  serviceModeFindings,
  stuckClaimFindings,
  withoutAddresses,
  worstOf,
  type HealthFacts,
} from './rules'

const NOW = new Date('2026-07-26T12:00:00Z')

function hoursAgo(hours: number): Date {
  return new Date(NOW.getTime() - hours * 60 * 60 * 1000)
}

/** A deployment with nothing wrong with it. Each test breaks one thing. */
function healthy(overrides: Partial<HealthFacts> = {}): HealthFacts {
  return {
    now: NOW,
    serviceMode: 'ACTIVE',
    appUrl: 'https://spv.flipit.com',
    productionAppUrl: 'https://spv.flipit.com',
    mail: {
      state: 'HEALTHY',
      summary: 'Connected as somebody@example.test.',
      lastVerifiedAt: hoursAgo(1),
    },
    compliance: [
      { kind: 'INVITATION', state: 'APPROVED', message: 'Approved.' },
      { kind: 'REMINDER', state: 'APPROVED', message: 'Approved.' },
    ],
    reminders: {
      roundOpen: true,
      scheduleEnabled: true,
      lastRunCompletedAt: hoursAgo(0.5),
      dueNow: 0,
      overdue: 0,
      stuck: [],
    },
    round: { open: true, deadlineReached: 0, awaitingResponse: 3 },
    lastBackupAt: hoursAgo(20),
    ...overrides,
  }
}

function withReminders(patch: Partial<HealthFacts['reminders']>): HealthFacts {
  const base = healthy()
  return { ...base, reminders: { ...base.reminders, ...patch } }
}

describe('a system with nothing wrong with it', () => {
  it('reports no fault and nothing needing attention', () => {
    const findings = buildFindings(healthy())
    expect(worstOf(findings)).toBe('OK')
    expect(findings.every((finding) => finding.severity === 'OK')).toBe(true)
  })

  it('still says what it checked, rather than saying nothing', () => {
    // A report that prints nothing when all is well is indistinguishable from a
    // report that did not run.
    const areas = buildFindings(healthy()).map((finding) => finding.area)
    expect(areas).toContain('Scheduled run')
    expect(areas).toContain('Mail')
    expect(areas).toContain('Deployment')
  })
})

describe('is the scheduled job running at all', () => {
  it('is a fault when no run has ever completed', () => {
    const findings = schedulerFindings(withReminders({ lastRunCompletedAt: null }))
    const finding = findings.find((row) => row.severity === 'WRONG')
    expect(finding?.headline).toMatch(/no reminder run has ever completed/i)
    // The remedy names the thing to install, not "check the logs".
    expect(finding?.remedy).toMatch(/DEPLOYMENT\.md/)
  })

  it('is a fault when the last run is older than the cadence allows', () => {
    const findings = schedulerFindings(
      withReminders({ lastRunCompletedAt: hoursAgo(RUN_OVERDUE_HOURS + 1) }),
    )
    expect(worstOf(findings)).toBe('WRONG')
  })

  it('is not a fault between runs', () => {
    const findings = schedulerFindings(
      withReminders({ lastRunCompletedAt: hoursAgo(RUN_OVERDUE_HOURS - 0.5) }),
    )
    expect(worstOf(findings)).toBe('OK')
  })

  it('is a fault even when nothing is due', () => {
    // The point of the check. A dead scheduler is a fault regardless of whether
    // it currently has work, because it will still be dead when it does.
    const findings = schedulerFindings(
      withReminders({ lastRunCompletedAt: hoursAgo(48), dueNow: 0, overdue: 0 }),
    )
    expect(worstOf(findings)).toBe('WRONG')
  })

  it('says nothing at all when no round is open', () => {
    const findings = schedulerFindings(withReminders({ roundOpen: false, lastRunCompletedAt: null }))
    expect(worstOf(findings)).toBe('OK')
    expect(findings[0]?.headline).toMatch(/no round is open/i)
  })

  it('treats a switched-off schedule as a decision, not a fault', () => {
    const findings = schedulerFindings(withReminders({ scheduleEnabled: false }))
    expect(worstOf(findings)).toBe('ATTENTION')
    expect(findings.some((row) => row.remedy.match(/deliberate/i))).toBe(true)
  })

  it('distinguishes a dead scheduler from a gate refusing rows one at a time', () => {
    // A recent run plus overdue rows means something is refusing them, and the
    // remedy is to read the reasons rather than to go and look at cron.
    const findings = schedulerFindings(
      withReminders({ lastRunCompletedAt: hoursAgo(0.2), overdue: 4 }),
    )
    const overdue = findings.find((row) => row.headline.match(/past due/))
    expect(overdue?.severity).toBe('WRONG')
    expect(overdue?.remedy).toMatch(/reminders:run/)
  })

  it('does not report overdue rows as a separate fault when the scheduler is the cause', () => {
    // Otherwise a dead scheduler reads as two unrelated problems.
    const findings = schedulerFindings(
      withReminders({ lastRunCompletedAt: null, overdue: 4 }),
    )
    expect(findings.filter((row) => row.severity === 'WRONG')).toHaveLength(1)
  })
})

describe('a reminder a run took and never finished with', () => {
  it('is a fault once it is older than the threshold', () => {
    const findings = stuckClaimFindings(
      withReminders({ stuck: [{ id: 'rem_1', claimedAt: hoursAgo(CLAIM_STUCK_HOURS + 1) }] }),
    )
    expect(worstOf(findings)).toBe('WRONG')
  })

  it('is not a fault while the run could still be working', () => {
    const findings = stuckClaimFindings(
      withReminders({ stuck: [{ id: 'rem_1', claimedAt: hoursAgo(0.1) }] }),
    )
    expect(findings).toHaveLength(0)
  })

  it('names the oldest one so there is something to go and look at', () => {
    const findings = stuckClaimFindings(
      withReminders({
        stuck: [
          { id: 'rem_newer', claimedAt: hoursAgo(2) },
          { id: 'rem_oldest', claimedAt: hoursAgo(30) },
        ],
      }),
    )
    expect(findings[0]?.detail).toContain('rem_oldest')
    expect(findings[0]?.headline).toMatch(/^2 reminders/)
  })

  it('sends the reader to the lock probe before the reschedule', () => {
    // Rescheduling a reminder a live run is holding would be the wrong move.
    const finding = stuckClaimFindings(
      withReminders({ stuck: [{ id: 'rem_1', claimedAt: hoursAgo(9) }] }),
    )[0]!
    expect(finding.remedy.indexOf('reminders:lock')).toBeLessThan(
      finding.remedy.indexOf('reschedule'),
    )
  })

  it('explains why nothing clears it automatically', () => {
    const finding = stuckClaimFindings(
      withReminders({ stuck: [{ id: 'rem_1', claimedAt: hoursAgo(9) }] }),
    )[0]!
    expect(finding.detail).toMatch(/timer|expired/i)
  })
})

describe('the mail connection', () => {
  it('is a note when nothing is waiting on it', () => {
    const base = healthy()
    const findings = mailFindings({
      ...base,
      mail: { state: 'UNCONFIGURED', summary: 'No sending account is connected.', lastVerifiedAt: null },
    })
    expect(findings[0]?.severity).toBe('ATTENTION')
  })

  it('is a fault when reminders are due and the service is active', () => {
    const base = withReminders({ dueNow: 2 })
    const findings = mailFindings({
      ...base,
      mail: { state: 'UNCONFIGURED', summary: 'No sending account is connected.', lastVerifiedAt: null },
    })
    expect(findings[0]?.severity).toBe('WRONG')
    expect(findings[0]?.headline).toMatch(/reminders are due/i)
  })

  it('is only a note when the service mode already stops everything', () => {
    const base = { ...withReminders({ dueNow: 2 }), serviceMode: 'READ_ONLY' as const }
    const findings = mailFindings({
      ...base,
      mail: { state: 'UNCONFIGURED', summary: 'No sending account is connected.', lastVerifiedAt: null },
    })
    expect(findings[0]?.severity).toBe('ATTENTION')
  })

  it('passes the connection’s own summary through rather than paraphrasing it', () => {
    const base = healthy()
    const findings = mailFindings({
      ...base,
      mail: { state: 'STALE', summary: 'Last verified 14 hours ago.', lastVerifiedAt: hoursAgo(14) },
    })
    expect(findings[0]?.detail).toBe('Last verified 14 hours ago.')
  })
})

describe('the compliance gate', () => {
  it('says nothing when both templates are approved', () => {
    expect(complianceFindings(healthy())).toHaveLength(0)
  })

  it('raises each unapproved template separately', () => {
    const findings = complianceFindings({
      ...healthy(),
      compliance: [
        { kind: 'INVITATION', state: 'DRIFTED', message: 'The template has changed.' },
        { kind: 'REMINDER', state: 'NONE', message: 'No approval recorded.' },
      ],
    })
    expect(findings).toHaveLength(2)
  })

  it('is a fault when the reminder template blocks reminders that are due', () => {
    const findings = complianceFindings({
      ...withReminders({ dueNow: 1 }),
      compliance: [
        { kind: 'INVITATION', state: 'APPROVED', message: 'Approved.' },
        { kind: 'REMINDER', state: 'DRIFTED', message: 'The template has changed.' },
      ],
    })
    expect(findings[0]?.severity).toBe('WRONG')
  })

  it('never suggests the operator could fix it', () => {
    // The operator cannot record, amend or void an approval, and a remedy that
    // implied otherwise would send them at a wall.
    const findings = complianceFindings({
      ...healthy(),
      compliance: [
        { kind: 'INVITATION', state: 'NONE', message: 'No approval recorded.' },
        { kind: 'REMINDER', state: 'NONE', message: 'No approval recorded.' },
      ],
    })
    for (const finding of findings) {
      expect(finding.remedy).toMatch(/owner/i)
      expect(finding.remedy).toMatch(/operator cannot/i)
    }
  })
})

describe('the service mode', () => {
  it('says nothing when active', () => {
    expect(serviceModeFindings(healthy())).toHaveLength(0)
  })

  it('is a note rather than a fault in every other mode', () => {
    for (const mode of ['READ_ONLY', 'SUNSET', 'DISABLED'] as const) {
      const findings = serviceModeFindings({ ...healthy(), serviceMode: mode })
      expect(findings[0]?.severity, mode).toBe('ATTENTION')
      expect(findings[0]?.headline, mode).toContain(mode)
    }
  })
})

describe('the base-URL guard', () => {
  it('confirms the production deployment rather than staying silent', () => {
    const findings = deploymentFindings(healthy())
    expect(findings[0]?.severity).toBe('OK')
    expect(findings[0]?.headline).toMatch(/permitted to send/i)
  })

  it('names both URLs when they disagree', () => {
    const findings = deploymentFindings({
      ...healthy(),
      appUrl: 'https://mikehelm.com/SPV',
    })
    expect(findings[0]?.detail).toContain('https://mikehelm.com/SPV')
    expect(findings[0]?.detail).toContain('https://spv.flipit.com')
  })

  it('says it is correct on a testing deployment and wrong on production', () => {
    // From inside the application the two are indistinguishable, so the report
    // must not pick one.
    const finding = deploymentFindings({ ...healthy(), appUrl: 'http://localhost:3000' })[0]!
    expect(finding.severity).toBe('ATTENTION')
    expect(finding.remedy).toMatch(/correct on anything but production/i)
  })
})

describe('deadlines that have passed', () => {
  it('says nothing while every deadline is ahead', () => {
    expect(roundFindings(healthy())).toHaveLength(0)
  })

  it('is a note, because inaction closes nothing and is a valid choice', () => {
    const findings = roundFindings({
      ...healthy(),
      round: { open: true, deadlineReached: 2, awaitingResponse: 5 },
    })
    expect(findings[0]?.severity).toBe('ATTENTION')
    expect(findings[0]?.detail).toMatch(/closes nothing/i)
  })

  it('says nothing about a closed round', () => {
    const findings = roundFindings({
      ...healthy(),
      round: { open: false, deadlineReached: 9, awaitingResponse: 9 },
    })
    expect(findings).toHaveLength(0)
  })
})

describe('when the database was last backed up', () => {
  it('is never a fault, at any age', () => {
    // This can only say when `pnpm backup` last ran here. A deployment
    // snapshotted by its host is backed up perfectly well and has nothing to
    // record, and a report that called that a fault would be wrong every day
    // until somebody switched it off.
    for (const lastBackupAt of [null, hoursAgo(24 * 400)]) {
      const findings = backupFindings({ ...healthy(), lastBackupAt })
      expect(worstOf(findings)).toBe('ATTENTION')
    }
  })

  it('says what it actually knows when there is no record', () => {
    const finding = backupFindings({ ...healthy(), lastBackupAt: null })[0]!
    expect(finding.detail).toMatch(/not that nothing is backed up/i)
    expect(finding.detail).toMatch(/snapshot/i)
  })

  it('is quiet about a recent one, without being silent', () => {
    const findings = backupFindings({ ...healthy(), lastBackupAt: hoursAgo(10) })
    expect(findings[0]?.severity).toBe('OK')
    expect(findings[0]?.headline).toMatch(/last backup/i)
  })

  it('notices one that stopped', () => {
    const findings = backupFindings({
      ...healthy(),
      lastBackupAt: hoursAgo(24 * (BACKUP_STALE_DAYS + 5)),
    })
    expect(findings[0]?.severity).toBe('ATTENTION')
    expect(findings[0]?.headline).toMatch(/days ago/)
  })

  it('points at the half of backups that goes untested', () => {
    const finding = backupFindings({ ...healthy(), lastBackupAt: hoursAgo(24 * 30) })[0]!
    expect(finding.remedy).toMatch(/verify:restore/)
  })
})

describe('what the report is allowed to say', () => {
  const facts = withReminders({
    lastRunCompletedAt: null,
    dueNow: 3,
    overdue: 3,
    stuck: [{ id: 'rem_stuck', claimedAt: hoursAgo(9) }],
  })

  it('never contains an email address', () => {
    // This ends up in a log file on a server. The reminder job prints no
    // address, and neither does the thing that watches it.
    for (const finding of buildFindings(facts)) {
      const text = `${finding.headline} ${finding.detail} ${finding.remedy}`
      expect(text, finding.headline).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.]+/)
    }
  })

  it('masks the address the mail connection puts in its own summary', () => {
    // The dashboard is right to name it. A log file appended to by a scheduler
    // is not the dashboard.
    const findings = mailFindings({
      ...healthy(),
      mail: {
        state: 'HEALTHY',
        summary: 'Connected as serenedavid@gmail.com, verified an hour ago.',
        lastVerifiedAt: hoursAgo(1),
      },
    })
    expect(findings[0]?.detail).not.toContain('serenedavid@gmail.com')
    expect(findings[0]?.detail).toContain('verified an hour ago')
  })

  it('masks an address borrowed from a compliance message too', () => {
    const findings = complianceFindings({
      ...healthy(),
      compliance: [
        { kind: 'INVITATION', state: 'NONE', message: 'Recorded by mike@flipit.com.' },
        { kind: 'REMINDER', state: 'APPROVED', message: 'Approved.' },
      ],
    })
    expect(findings[0]?.detail).not.toContain('mike@flipit.com')
  })

  it('leaves text that has no address in it alone', () => {
    expect(withoutAddresses('Nothing to do.')).toBe('Nothing to do.')
  })

  it('never contains a money amount or a percentage', () => {
    for (const finding of buildFindings(facts)) {
      const text = `${finding.headline} ${finding.detail} ${finding.remedy}`
      expect(text, finding.headline).not.toMatch(/[£$€]\s?\d/)
      expect(text, finding.headline).not.toMatch(/\d\s?%/)
    }
  })

  it('gives every finding that is not OK something to do', () => {
    for (const finding of buildFindings(facts)) {
      if (finding.severity === 'OK') continue
      expect(finding.remedy.length, finding.headline).toBeGreaterThan(20)
    }
  })

  it('never says something went wrong without saying what', () => {
    for (const finding of buildFindings(facts)) {
      expect(finding.detail.length, finding.headline).toBeGreaterThan(20)
      expect(finding.headline, finding.headline).not.toMatch(/^(error|problem|failed)$/i)
    }
  })
})

describe('worst-of, which the exit code is decided from', () => {
  it('is OK for an empty report', () => {
    expect(worstOf([])).toBe('OK')
  })

  it('lets one fault outrank any number of notes', () => {
    const findings = buildFindings(
      withReminders({ lastRunCompletedAt: null }),
    )
    expect(worstOf(findings)).toBe('WRONG')
  })

  it('does not promote a note to a fault', () => {
    const findings = buildFindings({ ...healthy(), serviceMode: 'READ_ONLY' })
    expect(worstOf(findings)).toBe('ATTENTION')
  })
})

// ---------------------------------------------------------------------------
// Source-level rules
// ---------------------------------------------------------------------------

describe('the health modules obey the standing rules', () => {
  function code(path: string): string {
    return readFileSync(join(process.cwd(), path), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '')
  }

  it('never writes to the database', () => {
    // A question that changes its subject is not one.
    const report = code('src/lib/health/report.ts')
    for (const verb of ['.insert(', '.update(', '.delete(', 'audit(']) {
      expect(report, verb).not.toContain(verb)
    }
  })

  it('never sends', () => {
    const report = code('src/lib/health/report.ts')
    const script = code('scripts/check-health.ts')
    for (const [name, text] of [
      ['report.ts', report],
      ['check-health.ts', script],
    ] as const) {
      expect(text, name).not.toContain('sendOneEmail')
      expect(text, name).not.toContain('sendInvitation')
      expect(text, name).not.toContain('nodemailer')
    }
  })

  it('keeps the judgement out of the layer that reads the database', () => {
    // Every rule is testable without a Postgres because the split holds.
    const rules = code('src/lib/health/rules.ts')
    expect(rules).not.toContain("from '@/db'")
    expect(rules).not.toContain('drizzle-orm')
  })

  it('selects reminder ids and claim times, and no address', () => {
    const report = code('src/lib/health/report.ts')
    const stuck = report.slice(
      report.indexOf('async function stuckClaims('),
      report.indexOf('async function dueCounts('),
    )
    expect(stuck).toContain('reminderEvents.id')
    expect(stuck).not.toContain('email')
    expect(stuck).not.toContain('investorAccounts')
  })

  it('exits non-zero only for a fault', () => {
    const script = code('scripts/check-health.ts')
    const wrongAt = script.indexOf('if (wrong > 0)')
    const attentionAt = script.indexOf('if (attention > 0)')
    const exitAt = script.indexOf('process.exitCode = 1', wrongAt)
    expect(wrongAt).toBeGreaterThan(-1)
    expect(exitAt).toBeGreaterThan(wrongAt)
    expect(exitAt).toBeLessThan(attentionAt)
  })
})
