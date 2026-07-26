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
  buildFindings,
  contactFindings,
  complianceFindings,
  describeAreas,
  deploymentFindings,
  mailFindings,
  roundFindings,
  schedulerFindings,
  serviceModeFindings,
  overdueFindings,
  stuckClaimFindings,
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
      problems: 0,
    },
    lastBackupAt: hoursAgo(20),
    contact: { hasOperatorAddress: true, hasStandingAddress: true },
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
