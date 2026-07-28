import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  BACKUP_STALE_DAYS,
  CLAIM_STUCK_HOURS,
  MEDIA_CHECK_STALE_DAYS,
  RUN_OVERDUE_HOURS,
  backupFindings,
  storageFindings,
  bucketRetentionFindings,
  buildFindings,
  contactFindings,
  flagFindings,
  complianceFindings,
  describeAreas,
  deploymentFindings,
  mailFindings,
  roundFindings,
  schedulerFindings,
  serviceModeFindings,
  overdueFindings,
  stuckClaimFindings,
  erasureFindings,
  unattendedFindings,
  withoutAddresses,
  worstOf,
  type HealthFacts,
  type UnattendedFacts,
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
    storage: { configured: true, recordsNamingAFile: 4 },
    lastMediaCheck: {
      at: hoursAgo(30),
      storeConfigured: true,
      checked: 4,
      missing: 0,
      wrongSize: 0,
      unreadable: 0,
      orphans: 0,
      listed: true,
      truncated: false,
      versioning: 'DISABLED' as const,
      problems: 0,
    },
    unfinishedErasures: [],
    lastBackupAt: hoursAgo(20),
    contact: { hasOperatorAddress: true, hasStandingAddress: true },
    disabledFlags: [],
    ...overrides,
  }
}

/** A healthy deployment with one thing changed about its last media check. */
function withMediaCheck(patch: Partial<NonNullable<HealthFacts['lastMediaCheck']>>): HealthFacts {
  const base = healthy()
  return { ...base, lastMediaCheck: { ...base.lastMediaCheck!, ...patch } }
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
    const findings = overdueFindings(
      withReminders({ lastRunCompletedAt: hoursAgo(0.2), overdue: 4 }),
    )
    expect(findings[0]?.severity).toBe('WRONG')
    expect(findings[0]?.remedy).toMatch(/reminders:run/)
  })

  it('does not report overdue rows as a separate fault when the scheduler is the cause', () => {
    // Otherwise a dead scheduler reads as two unrelated problems.
    for (const lastRunCompletedAt of [null, hoursAgo(RUN_OVERDUE_HOURS + 2)]) {
      const facts = withReminders({ lastRunCompletedAt, overdue: 4 })
      expect(overdueFindings(facts)).toHaveLength(0)
      expect(buildFindings(facts).filter((row) => row.area === 'Scheduled run' && row.severity === 'WRONG')).toHaveLength(1)
    }
  })
})

describe('the cheap subset the overview banner is built from', () => {
  it('is a strict subset of the full report, so the two can never disagree', () => {
    const facts = withReminders({
      lastRunCompletedAt: null,
      stuck: [{ id: 'rem_1', claimedAt: hoursAgo(9) }],
    })
    const full = buildFindings(facts)
    for (const finding of unattendedFindings(facts)) {
      expect(
        full.some(
          (row) => row.headline === finding.headline && row.severity === finding.severity,
        ),
        finding.headline,
      ).toBe(true)
    }
  })

  it('needs only the facts that cost one query each', () => {
    // Assignable without `dueNow`, `overdue`, the mail state, the templates,
    // the round, the storage counts or the backup. If that stops being true the
    // overview starts paying for the full report on a page nobody opened to
    // read one.
    const minimal: UnattendedFacts = {
      now: NOW,
      reminders: {
        roundOpen: true,
        scheduleEnabled: true,
        lastRunCompletedAt: null,
        stuck: [],
      },
      lastMediaCheck: null,
      unfinishedErasures: [],
    }
    expect(unattendedFindings(minimal).some((row) => row.severity === 'WRONG')).toBe(true)
  })

  it('carries the findings nothing else in the application surfaces', () => {
    const areas = unattendedFindings({
      ...withReminders({
        lastRunCompletedAt: hoursAgo(RUN_OVERDUE_HOURS + 2),
        stuck: [{ id: 'rem_1', claimedAt: hoursAgo(9) }],
      }),
      lastMediaCheck: { ...healthy().lastMediaCheck!, missing: 1, problems: 1 },
    }).map((row) => row.area)
    expect(areas).toContain('Scheduled run')
    expect(areas).toContain('Reminders')
    expect(areas).toContain('Stored files')
  })

  it('is silent on a healthy system', () => {
    expect(unattendedFindings(healthy()).filter((row) => row.severity === 'WRONG')).toHaveLength(0)
  })

  it('describes what the banner is about from the findings, not from prose', () => {
    expect(describeAreas(['Scheduled run'])).toBe('the scheduled run')
    expect(describeAreas(['Scheduled run', 'Reminders'])).toBe('the scheduled run and reminders')
    expect(describeAreas(['Scheduled run', 'Reminders', 'Stored files'])).toBe(
      'the scheduled run, reminders and stored files',
    )
  })

  it('describes every area a banner finding can carry', () => {
    // The banner used to name its two rules in a sentence typed into the page,
    // and a third rule joined without the sentence changing. This is the check
    // that a fourth cannot: every area the subset can produce must come back as
    // a readable phrase rather than a bare capitalised label.
    const facts = {
      ...withMediaCheck({ missing: 1, problems: 1 }),
      reminders: {
        ...healthy().reminders,
        lastRunCompletedAt: null,
        stuck: [{ id: 'rem_1', claimedAt: hoursAgo(9) }],
      },
    }
    const areas = [...new Set(unattendedFindings(facts).map((row) => row.area))]
    expect(areas.length).toBeGreaterThanOrEqual(3)
    for (const area of areas) {
      expect(describeAreas([area])).toBe(describeAreas([area]).toLowerCase())
    }
  })

  it('never returns an empty phrase, because the banner puts a full stop after it', () => {
    expect(describeAreas([])).not.toBe('')
  })

  it('is still a strict subset across every shape of fact, not just the healthy one', () => {
    // A matrix rather than one arrangement, and it is here because one
    // arrangement was not enough. The banner's media rule reads the last
    // check's verdict; the page's read the store's *configuration* first and
    // returned early, so on a deployment with no store configured the banner
    // reported two missing files and the page said everything was fine. The
    // browser run found it. This is where it should have been found.
    const variations: HealthFacts[] = []
    for (const storage of [
      { configured: true, recordsNamingAFile: 4 },
      { configured: true, recordsNamingAFile: 0 },
      { configured: false, recordsNamingAFile: 0 },
      { configured: false, recordsNamingAFile: 3 },
    ]) {
      for (const media of [
        null,
        { ...healthy().lastMediaCheck!, problems: 0 },
        { ...healthy().lastMediaCheck!, missing: 2, orphans: 1, problems: 3 },
        { ...healthy().lastMediaCheck!, storeConfigured: false, problems: 2 },
      ]) {
        for (const lastRunCompletedAt of [null, hoursAgo(0.2), hoursAgo(RUN_OVERDUE_HOURS + 2)]) {
          for (const stuck of [[], [{ id: 'rem_1', claimedAt: hoursAgo(9) }]]) {
            const base = healthy()
            variations.push({
              ...base,
              storage,
              lastMediaCheck: media,
              reminders: { ...base.reminders, lastRunCompletedAt, stuck },
            })
          }
        }
      }
    }

    for (const facts of variations) {
      const full = buildFindings(facts)
      for (const finding of unattendedFindings(facts)) {
        expect(
          full.some(
            (row) => row.headline === finding.headline && row.severity === finding.severity,
          ),
          `${finding.headline} — store ${JSON.stringify(facts.storage)}, check ${JSON.stringify(facts.lastMediaCheck?.problems ?? null)}`,
        ).toBe(true)
      }
    }
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

describe('an erasure that started and did not finish', () => {
  const stopped = {
    accountId: 'acct_stopped',
    at: hoursAgo(5),
    stage: 'INCOMPLETE' as const,
    objectsDestroyed: 2,
    objectsRemaining: 1,
  }
  const abandoned = {
    accountId: 'acct_gone',
    at: hoursAgo(30),
    stage: 'BEGAN' as const,
    objectsDestroyed: null,
    objectsRemaining: null,
  }

  it('says nothing when every erasure finished', () => {
    expect(erasureFindings(healthy())).toEqual([])
  })

  it('is a fault, not a note', () => {
    // An investor asked to be erased and their data is in a state nobody chose.
    // Everything else in this file reserves WRONG for something actively
    // failing; this qualifies on the strictest reading of it.
    const findings = erasureFindings(healthy({ unfinishedErasures: [stopped] }))
    expect(findings).toHaveLength(1)
    expect(findings[0]?.severity).toBe('WRONG')
  })

  it('says how many files are gone, because that is the part nothing undoes', () => {
    const finding = erasureFindings(healthy({ unfinishedErasures: [stopped] }))[0]!
    expect(finding.detail).toContain('2 stored files')
    expect(finding.detail).toMatch(/cannot be recovered/i)
  })

  it('says the record still describes the investor in full', () => {
    /*
     * The half that a reader will otherwise assume. Every screen in the
     * application shows an ordinary investor, so a finding that only mentioned
     * the destroyed bytes would leave somebody believing the record had been
     * dealt with.
     */
    const finding = erasureFindings(healthy({ unfinishedErasures: [stopped] }))[0]!
    expect(finding.detail).toMatch(/database was not touched/i)
    expect(finding.detail).toMatch(/name, address/i)
  })

  it('tells the reader to run it again, and that doing so is safe', () => {
    const finding = erasureFindings(healthy({ unfinishedErasures: [stopped] }))[0]!
    expect(finding.remedy).toMatch(/again/)
    expect(finding.remedy).toMatch(/already gone is not an error/)
  })

  it('names the account so the row can be found', () => {
    const finding = erasureFindings(healthy({ unfinishedErasures: [stopped] }))[0]!
    expect(finding.detail).toContain('acct_stopped')
  })

  it('reports a run that vanished as a separate finding with a different remedy', () => {
    /*
     * They are not the same problem. One knows what it destroyed and needs the
     * store fixed; the other knows nothing and needs somebody to look at the
     * record. A single finding with a conditional sentence in it would give the
     * wrong instruction to one of the two every time.
     */
    const findings = erasureFindings(
      healthy({ unfinishedErasures: [stopped, abandoned] }),
    )
    expect(findings).toHaveLength(2)
    expect(findings[1]?.headline).toMatch(/recorded no outcome/)
    expect(findings[1]?.remedy).not.toBe(findings[0]?.remedy)
  })

  it('warns that a vanished run may have left sessions alive', () => {
    // Sessions are revoked after the transaction. A process killed between the
    // two leaves an erased record that somebody is still signed in to, and no
    // other rule anywhere would notice.
    const finding = erasureFindings(healthy({ unfinishedErasures: [abandoned] }))[0]!
    expect(finding.detail).toMatch(/sessions and links/i)
  })

  it('does not report what an abandoned run meant to destroy as what it did', () => {
    const finding = erasureFindings(healthy({ unfinishedErasures: [abandoned] }))[0]!
    expect(finding.detail).not.toMatch(/\d+ stored files? had already been destroyed/)
  })

  it('says "at least" when a row’s counts could not be read', () => {
    const unreadable = { ...stopped, accountId: 'acct_odd', objectsDestroyed: null }
    const finding = erasureFindings(
      healthy({ unfinishedErasures: [stopped, unreadable] }),
    )[0]!
    expect(finding.detail).toContain('at least 2')
  })

  it('reaches the overview banner, not only the health page', () => {
    /*
     * The banner is the only surface an owner sees without going looking. A
     * half-erased investor that appeared solely on `pnpm check:health` would be
     * visible to a cron job and to nobody else.
     */
    const areas = unattendedFindings(healthy({ unfinishedErasures: [stopped] })).map(
      (row) => row.area,
    )
    expect(areas).toContain('Erasure')
  })

  it('and appears in the full report as well', () => {
    const areas = buildFindings(healthy({ unfinishedErasures: [stopped] })).map(
      (row) => row.area,
    )
    expect(areas).toContain('Erasure')
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

describe('stored files against the records that name them', () => {
  it('is quiet when a recent check came back clean', () => {
    const findings = storageFindings(healthy())
    expect(findings).toHaveLength(1)
    expect(findings[0]?.severity).toBe('OK')
    expect(findings[0]?.headline).toMatch(/clean/i)
  })

  it('is a fault when the last check found something', () => {
    const finding = storageFindings(withMediaCheck({ missing: 2, problems: 2 }))[0]!
    expect(finding.severity).toBe('WRONG')
    expect(finding.headline).toMatch(/2 problems/)
    expect(finding.remedy).toMatch(/media:check/)
  })

  it('says which kind of problem it was, so the reader knows what they are walking into', () => {
    const finding = storageFindings(
      withMediaCheck({ missing: 1, wrongSize: 2, unreadable: 3, orphans: 4, problems: 10 }),
    )[0]!
    expect(finding.detail).toMatch(/1 file the record survived without/)
    expect(finding.detail).toMatch(/2 the wrong size/)
    expect(finding.detail).toMatch(/3 the store refused to answer about/)
    expect(finding.detail).toMatch(/4 stored with no record pointing at them/)
  })

  it('says so when the store could not be listed, rather than implying it was clean', () => {
    const finding = storageFindings(withMediaCheck({ listed: false, problems: 1 }))[0]!
    expect(finding.detail).toMatch(/could not be listed/i)
  })

  it('says so when the listing hit its limit', () => {
    const finding = storageFindings(withMediaCheck({ truncated: true, problems: 1 }))[0]!
    expect(finding.detail).toMatch(/limit/i)
  })

  it('reports a check that has never run, which is not the same as a clean one', () => {
    // The failure this exists for: a media check that is never run looks, from
    // every page in this application, exactly like one that keeps coming back
    // clean.
    const finding = storageFindings({ ...healthy(), lastMediaCheck: null })[0]!
    expect(finding.severity).toBe('ATTENTION')
    expect(finding.headline).toMatch(/never been run|no media check has been run/i)
    expect(finding.remedy).toMatch(/DEPLOYMENT\.md/)
  })

  it('does not count a run that had no store to check as having checked this one', () => {
    const finding = storageFindings(withMediaCheck({ storeConfigured: false }))[0]!
    expect(finding.severity).toBe('ATTENTION')
    expect(finding.headline).toMatch(/no media check has been run/i)
  })

  it('notices a weekly check that stopped', () => {
    const finding = storageFindings(
      withMediaCheck({ at: hoursAgo(24 * (MEDIA_CHECK_STALE_DAYS + 4)) }),
    )[0]!
    expect(finding.severity).toBe('ATTENTION')
    expect(finding.headline).toMatch(/days ago/)
  })

  it('does not chase a check that ran within the weekly cadence', () => {
    const finding = storageFindings(
      withMediaCheck({ at: hoursAgo(24 * (MEDIA_CHECK_STALE_DAYS - 3)) }),
    )[0]!
    expect(finding.severity).toBe('OK')
  })

  it('does not claim files added since the last run were checked', () => {
    const facts = {
      ...healthy(),
      storage: { configured: true, recordsNamingAFile: 9 },
    }
    const finding = storageFindings(facts)[0]!
    expect(finding.severity).toBe('OK')
    expect(finding.detail).toMatch(/5 records have been added since/)
  })

  it('is a fault when records name files and there is nowhere to read one from', () => {
    const finding = storageFindings({
      ...healthy(),
      storage: { configured: false, recordsNamingAFile: 6 },
    })[0]!
    expect(finding.severity).toBe('WRONG')
    expect(finding.headline).toMatch(/6 records name a stored file/)
    expect(finding.remedy).toMatch(/MEDIA_STORE/)
  })

  it('does not lose a recorded problem when the store is switched off', () => {
    // Turning `MEDIA_STORE` off does not find two missing files. The page used
    // to return the configuration answer and stop, which meant the banner said
    // something the page did not.
    const findings = storageFindings({
      ...withMediaCheck({ missing: 2, problems: 2 }),
      storage: { configured: false, recordsNamingAFile: 0 },
    })
    expect(findings).toHaveLength(1)
    expect(findings[0]?.severity).toBe('WRONG')
    expect(findings[0]?.headline).toMatch(/2 problems/)
  })

  it('reports both when there is nowhere to read from and a check found things', () => {
    const findings = storageFindings({
      ...withMediaCheck({ missing: 2, problems: 2 }),
      storage: { configured: false, recordsNamingAFile: 3 },
    })
    expect(findings).toHaveLength(2)
    expect(findings.every((row) => row.severity === 'WRONG')).toBe(true)
  })

  it('treats no store and nothing needing one as the supported state it is', () => {
    // §13.2 — the portal, the invitation and the certificate are all complete
    // with an empty media library, which is what a fresh install has.
    const findings = storageFindings({
      ...healthy(),
      storage: { configured: false, recordsNamingAFile: 0 },
      lastMediaCheck: null,
    })
    expect(findings[0]?.severity).toBe('OK')
    expect(findings[0]?.remedy).toMatch(/nothing to do/i)
  })

  it('names no storage key, label or record id, because it only ever had counts', () => {
    const finding = storageFindings(
      withMediaCheck({ missing: 1, orphans: 1, problems: 2 }),
    )[0]!
    const text = `${finding.headline} ${finding.detail} ${finding.remedy}`
    expect(text).not.toMatch(/img_|doc_|vid_/)
  })
})

describe('the contact route on a notice', () => {
  function contact(patch: Partial<HealthFacts['contact']>, mode: HealthFacts['serviceMode'] = 'ACTIVE') {
    return contactFindings(
      healthy({
        serviceMode: mode,
        contact: { hasOperatorAddress: true, hasStandingAddress: true, ...patch },
      }),
    )
  }

  it('is fine when both addresses are set', () => {
    expect(contact({})[0]?.severity).toBe('OK')
  })

  it('is worth knowing when only the operator address is set', () => {
    // §7: the standing address is "shown once the portal is closed and after
    // the operator's own address stops being monitored". Having only his is a
    // plan that works until the day it is needed — Open Decision 7, as a
    // finding rather than a line in a file.
    const findings = contact({ hasStandingAddress: false })
    expect(findings[0]?.severity).toBe('ATTENTION')
    expect(findings[0]?.area).toBe('Contact route')
  })

  it('is worth knowing when only the standing address is set', () => {
    expect(contact({ hasOperatorAddress: false })[0]?.severity).toBe('ATTENTION')
  })

  it('is worth knowing when neither is set and the portal is running', () => {
    const findings = contact({ hasOperatorAddress: false, hasStandingAddress: false })
    expect(findings[0]?.severity).toBe('ATTENTION')
  })

  it.each(['SUNSET', 'DISABLED'] as const)(
    'needs a person in %s, where the notice is the only route left',
    (mode) => {
      // Every investor is now looking at a closing or closed notice, and in
      // these modes there is nothing else on the page to act on.
      expect(contact({ hasOperatorAddress: false, hasStandingAddress: false }, mode)[0]?.severity).toBe(
        'WRONG',
      )
      expect(contact({ hasStandingAddress: false }, mode)[0]?.severity).toBe('WRONG')
    },
  )

  it('stays worth-knowing in read-only, where the record is still on the screen', () => {
    expect(contact({ hasStandingAddress: false }, 'READ_ONLY')[0]?.severity).toBe('ATTENTION')
  })

  it('says exactly one thing however many addresses are missing', () => {
    // Two findings about the same absence would be two lines in a log about
    // one setting.
    expect(contact({ hasOperatorAddress: false, hasStandingAddress: false })).toHaveLength(1)
  })

  it('is on the full report and not on the overview banner', () => {
    // The banner is for things a run left behind. A setting that was never
    // filled in is not urgent in that sense, and the banner's own rule is that
    // it carries only what nothing else surfaces.
    const facts = healthy({ contact: { hasOperatorAddress: false, hasStandingAddress: false } })
    expect(buildFindings(facts).some((row) => row.area === 'Contact route')).toBe(true)
    expect(unattendedFindings(facts).some((row) => row.area === 'Contact route')).toBe(false)
  })

  it('never names either address', () => {
    // It only ever sees booleans, which is the point of the fact shape.
    for (const mode of ['ACTIVE', 'READ_ONLY', 'SUNSET', 'DISABLED'] as const) {
      for (const operator of [true, false]) {
        for (const standing of [true, false]) {
          for (const finding of contact(
            { hasOperatorAddress: operator, hasStandingAddress: standing },
            mode,
          )) {
            const text = `${finding.headline} ${finding.detail} ${finding.remedy}`
            expect(text).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.]+/)
          }
        }
      }
    }
  })
})

describe('a portal section switched off by a flag', () => {
  it('says so, as a decision rather than a fault', () => {
    const findings = flagFindings(healthy({ disabledFlags: ['qa_shared'] }))
    expect(findings[0]?.severity).toBe('ATTENTION')
    expect(findings[0]?.area).toBe('Portal sections')
    expect(findings[0]?.detail).toContain('qa_shared')
  })

  it('counts them when there is more than one, and names them in order', () => {
    const findings = flagFindings(healthy({ disabledFlags: ['roadmap_tiles', 'qa_shared'] }))
    expect(findings[0]?.headline).toContain('2 portal sections')
    expect(findings[0]?.detail).toContain('qa_shared, roadmap_tiles')
  })

  it('says it checked, when nothing is off', () => {
    // A report that prints nothing when all is well is indistinguishable from
    // one that did not look.
    const findings = flagFindings(healthy())
    expect(findings[0]?.severity).toBe('OK')
  })

  it('is never a fault, whatever is off', () => {
    // Somebody's decision. Same treatment as a non-active service mode, and
    // the same reason: a check that goes red for a deliberate setting is a
    // check that gets ignored.
    const all = flagFindings(
      healthy({ disabledFlags: ['qa_shared', 'roadmap_tiles', 'operator_video', 'register_of_interest'] }),
    )
    expect(all.every((row) => row.severity !== 'WRONG')).toBe(true)
  })

  it('says plainly that nothing an investor wrote has been removed', () => {
    const findings = flagFindings(healthy({ disabledFlags: ['qa_shared'] }))
    expect(findings[0]?.detail).toMatch(/never removes|stay readable/)
  })

  it('is on the full report and not on the overview banner', () => {
    const facts = healthy({ disabledFlags: ['qa_shared'] })
    expect(buildFindings(facts).some((row) => row.area === 'Portal sections')).toBe(true)
    expect(unattendedFindings(facts).some((row) => row.area === 'Portal sections')).toBe(false)
  })
})

describe('what the report is allowed to say', () => {
  const facts: HealthFacts = {
    ...withReminders({
      lastRunCompletedAt: null,
      dueNow: 3,
      overdue: 3,
      stuck: [{ id: 'rem_stuck', claimedAt: hoursAgo(9) }],
    }),
    // Included so the standing rules below — no address, no amount, always
    // something to do — are applied to the erasure findings as well. A rule
    // that only ever sees the findings that existed when it was written stops
    // being a rule about the report.
    unfinishedErasures: [
      {
        accountId: 'acct_stopped',
        at: hoursAgo(5),
        stage: 'INCOMPLETE',
        objectsDestroyed: 2,
        objectsRemaining: 1,
      },
      {
        accountId: 'acct_gone',
        at: hoursAgo(30),
        stage: 'BEGAN',
        objectsDestroyed: null,
        objectsRemaining: null,
      },
    ],
  }

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

/**
 * A bucket that keeps what it is told to delete.
 *
 * The finding exists because this is the one failure an erasure cannot see from
 * inside: on a versioned bucket the delete succeeds, the store reports the
 * object as gone, `media:check` reconciles cleanly, and the signed subscription
 * agreement an investor asked to have destroyed is still there.
 */
describe('whether the store keeps what it is told to delete', () => {
  it('says nothing when deletes are permanent', () => {
    expect(bucketRetentionFindings(withMediaCheck({ versioning: 'DISABLED' }))).toEqual([])
  })

  it('says nothing when the run predates the question', () => {
    // Absent is not DISABLED and it is not a warning either. There is no
    // evidence, and a finding manufactured from an absent field would appear on
    // every deployment until its next scheduled run.
    expect(bucketRetentionFindings(withMediaCheck({ versioning: undefined }))).toEqual([])
  })

  it('says nothing when there was no store to ask', () => {
    expect(
      bucketRetentionFindings(withMediaCheck({ storeConfigured: false, versioning: 'UNKNOWN' })),
    ).toEqual([])
  })

  it('is WRONG when versioning is on', () => {
    const findings = bucketRetentionFindings(withMediaCheck({ versioning: 'ENABLED' }))
    expect(findings).toHaveLength(1)
    expect(findings[0]!.severity).toBe('WRONG')
    expect(findings[0]!.headline).toContain('keeps what it is told to delete')
    expect(findings[0]!.remedy).toContain('Turn versioning off')
  })

  it('and WRONG when it is suspended, because the old copies remain', () => {
    const findings = bucketRetentionFindings(withMediaCheck({ versioning: 'SUSPENDED' }))
    expect(findings).toHaveLength(1)
    expect(findings[0]!.severity).toBe('WRONG')
    expect(findings[0]!.detail).toContain('still in the bucket')
  })

  it('is ATTENTION, not silence, when the store will not say', () => {
    const findings = bucketRetentionFindings(withMediaCheck({ versioning: 'UNKNOWN' }))
    expect(findings).toHaveLength(1)
    expect(findings[0]!.severity).toBe('ATTENTION')
    expect(findings[0]!.headline).toContain('will not say')
  })

  it('reaches the storage findings, so the report and the banner both carry it', () => {
    // The rule is only worth anything if something surfaces it. This is the
    // path from the recorded fact to the page somebody reads.
    const findings = storageFindings(withMediaCheck({ versioning: 'ENABLED' }))
    expect(findings.some((finding) => finding.headline.includes('told to delete'))).toBe(true)
  })

  it('and it survives a store that was switched off after the run', () => {
    // A store turned off does not un-keep the copies a versioned bucket made.
    // This is the same argument the problem findings make and it is checked for
    // the same reason.
    const facts = withMediaCheck({ versioning: 'ENABLED' })
    const findings = storageFindings({
      ...facts,
      storage: { configured: false, recordsNamingAFile: 2 },
    })
    expect(findings.some((finding) => finding.headline.includes('told to delete'))).toBe(true)
  })
})

describe('copies the store kept behind delete markers', () => {
  const hidden = (patch: { nonCurrent: number; deleteMarkers: number; atLeast?: boolean }) =>
    withMediaCheck({
      hiddenVersions: { atLeast: false, ...patch },
    })

  it('says nothing when there are none', () => {
    expect(bucketRetentionFindings(hidden({ nonCurrent: 0, deleteMarkers: 0 }))).toEqual([])
  })

  it('says nothing when the store cannot say', () => {
    expect(bucketRetentionFindings(withMediaCheck({ hiddenVersions: null }))).toEqual([])
  })

  it('says nothing on a run from before the question existed', () => {
    expect(bucketRetentionFindings(withMediaCheck({ hiddenVersions: undefined }))).toEqual([])
  })

  it('is WRONG even when versioning now reports permanent deletes', () => {
    /*
     * The finding this rule would otherwise lose at exactly the wrong moment.
     * Somebody reads the warning, switches versioning off, and the status goes
     * quiet — while every copy it made is still in the bucket.
     */
    const findings = bucketRetentionFindings(
      hidden({ nonCurrent: 3, deleteMarkers: 3 }),
    )
    expect(findings).toHaveLength(1)
    expect(findings[0]!.severity).toBe('WRONG')
    expect(findings[0]!.headline).toContain('6 copies')
    expect(findings[0]!.remedy).toContain('Expire the non-current versions')
  })

  it('says "at least" when the listing was truncated', () => {
    const findings = bucketRetentionFindings(
      hidden({ nonCurrent: 500, deleteMarkers: 500, atLeast: true }),
    )
    expect(findings[0]!.headline).toContain('at least 1000')
  })

  it('and both findings appear when versioning is still on', () => {
    const facts = withMediaCheck({
      versioning: 'ENABLED',
      hiddenVersions: { nonCurrent: 1, deleteMarkers: 1, atLeast: false },
    })
    const findings = bucketRetentionFindings(facts)
    expect(findings).toHaveLength(2)
    expect(findings.every((finding) => finding.severity === 'WRONG')).toBe(true)
  })

  it('and it reaches the storage findings the page reads', () => {
    const findings = storageFindings(hidden({ nonCurrent: 2, deleteMarkers: 0 }))
    expect(findings.some((finding) => finding.headline.includes('still holding'))).toBe(true)
  })
})
