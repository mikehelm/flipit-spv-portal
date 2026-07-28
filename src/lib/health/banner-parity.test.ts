/**
 * Whether the overview banner and the health page can ever disagree.
 *
 * `storageFindings` states the rule, in a comment above the line that assembles
 * it: *"the overview banner emits exactly this and the banner must never say
 * something the page does not."* That comment was false for a year.
 * `bucketRetentionFindings` — a bucket keeping every file it was told to
 * destroy, which is the most serious thing this report can find — reached the
 * page and never the banner, while a file of the wrong size raised the banner.
 * Nothing said so, because a rule missing from a list looks exactly like a rule
 * that was never written.
 *
 * That was fixed, and a test was written that walks five media states. It names
 * `storageFindings`. **So the next rule to go missing goes missing silently in
 * the same way**, because every parity test in this repository is about the one
 * rule somebody had just got wrong. The erasure rules had no such test at all,
 * and they are the ones about the only action in this application that cannot
 * be undone.
 *
 * This file asks the question without naming a rule.
 *
 * ## The invariant, and why it can be checked mechanically
 *
 * The banner is not the report. It is built from `UnattendedFacts` — the subset
 * of the report's facts that is cheap enough to gather on every admin page load
 * — and it deliberately leaves out everything that would need another query.
 * `overdueFindings` needs a count of reminders past due; `mailFindings` needs
 * the connection state; `backupFindings` needs the last dump. None of those
 * belongs on a page load, and none of them is a defect.
 *
 * So the rule is not *"every finding must be on the banner"*. It is:
 *
 * > **A rule whose answer does not depend on anything the banner cannot afford
 * > has no excuse for not being on the banner.**
 *
 * And that is decidable without a roster to keep up to date. Hold the cheap
 * facts still, vary every expensive fact underneath, and watch what a rule
 * returns. A rule that answers identically every time did not read an expensive
 * fact — it is computable from what the banner already has in its hand. If such
 * a rule produces a `WRONG` that the banner does not carry, that is the defect,
 * whatever the rule is called and whoever wrote it.
 *
 * Every `*Findings` export is discovered from the module namespace rather than
 * listed here, so a rule added tomorrow is covered by this file the moment it is
 * exported, without anybody remembering to come back.
 *
 * ## What it cannot see
 *
 * A rule that reads an expensive fact **and could have been written not to** is
 * invisible here, and correctly so — that is a design judgement rather than an
 * omission. And a coincidence is possible in the other direction: a rule that
 * genuinely needs an expensive fact but happens to return the same answer for
 * every variant would be demanded on the banner. Three maximally different
 * expensive worlds make that unlikely, and the direction of the mistake is the
 * conservative one: it would ask for a finding to be surfaced more loudly than
 * it needs to be, which is the side this repository errs on everywhere else.
 */

import { describe, expect, it } from 'vitest'
import * as rules from './rules'
import type { Finding, HealthFacts, UnattendedFacts } from './rules'

const NOW = new Date('2026-07-26T12:00:00Z')

function hoursAgo(hours: number): Date {
  return new Date(NOW.getTime() - hours * 60 * 60 * 1000)
}

/** The cheap half, with nothing wrong with it. */
function cheapBase(): UnattendedFacts {
  return {
    now: NOW,
    reminders: {
      roundOpen: true,
      scheduleEnabled: true,
      lastRunCompletedAt: hoursAgo(0.5),
      stuck: [],
    },
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
      versioning: 'DISABLED',
      problems: 0,
    },
    unfinishedErasures: [],
  }
}

function withMediaCheck(
  patch: Partial<NonNullable<UnattendedFacts['lastMediaCheck']>>,
): UnattendedFacts {
  const base = cheapBase()
  return { ...base, lastMediaCheck: { ...base.lastMediaCheck!, ...patch } }
}

function withReminders(patch: Partial<UnattendedFacts['reminders']>): UnattendedFacts {
  const base = cheapBase()
  return { ...base, reminders: { ...base.reminders, ...patch } }
}

function withErasures(rows: UnattendedFacts['unfinishedErasures']): UnattendedFacts {
  return { ...cheapBase(), unfinishedErasures: rows }
}

function erasure(
  stage: 'BEGAN' | 'INCOMPLETE',
  objectsDestroyed: number | null,
  hours: number,
): UnattendedFacts['unfinishedErasures'][number] {
  return {
    accountId: `account-${stage.toLowerCase()}-${hours}`,
    at: hoursAgo(hours),
    stage,
    objectsDestroyed,
    objectsRemaining: objectsDestroyed === null ? null : 27,
  }
}

/**
 * The states of the cheap facts, one per thing that can be true of them.
 *
 * Deliberately more than the rules currently distinguish. A state nobody has
 * written a rule for yet is exactly where the next rule will go.
 */
const CHEAP_WORLDS: ReadonlyArray<readonly [string, UnattendedFacts]> = [
  ['nothing wrong', cheapBase()],
  ['no run has ever completed', withReminders({ lastRunCompletedAt: null })],
  ['the last run was hours ago', withReminders({ lastRunCompletedAt: hoursAgo(9) })],
  ['reminders switched off', withReminders({ scheduleEnabled: false })],
  ['no round open', withReminders({ roundOpen: false })],
  [
    'a claim taken and never finished',
    withReminders({ stuck: [{ id: 'reminder-1', claimedAt: hoursAgo(6) }] }),
  ],
  ['an erasure the store refused', withErasures([erasure('INCOMPLETE', 7, 5)])],
  ['an erasure that recorded no outcome', withErasures([erasure('BEGAN', null, 2)])],
  [
    'one of each',
    withErasures([erasure('INCOMPLETE', 7, 5), erasure('BEGAN', null, 2)]),
  ],
  [
    'a refused erasure whose metadata will not parse',
    withErasures([erasure('INCOMPLETE', 7, 5), erasure('INCOMPLETE', null, 9)]),
  ],
  ['a bucket that keeps what it deletes', withMediaCheck({ versioning: 'ENABLED' })],
  ['versioning switched off but not always', withMediaCheck({ versioning: 'SUSPENDED' })],
  ['a store that will not say', withMediaCheck({ versioning: 'UNKNOWN' })],
  ['files missing and files nothing points at', withMediaCheck({ missing: 2, orphans: 1, problems: 3 })],
  [
    'copies kept behind delete markers',
    withMediaCheck({
      versioning: 'DISABLED',
      hiddenVersions: { nonCurrent: 9, deleteMarkers: 2, atLeast: true },
    }),
  ],
  ['a truncated listing', withMediaCheck({ truncated: true, listed: true })],
  ['a store that could not be listed', withMediaCheck({ listed: false })],
  ['no media check has ever run', { ...cheapBase(), lastMediaCheck: null }],
]

/**
 * Three worlds for everything the banner cannot afford to ask about, chosen to
 * be as unlike each other as the types allow. A rule that returns the same
 * answer in all three did not read any of it.
 */
const EXPENSIVE_WORLDS: ReadonlyArray<Omit<HealthFacts, keyof UnattendedFacts | 'reminders'> & {
  reminders: { dueNow: number; overdue: number }
}> = [
  {
    serviceMode: 'ACTIVE',
    appUrl: 'https://spv.flipit.com',
    productionAppUrl: 'https://spv.flipit.com',
    mail: { state: 'HEALTHY', summary: 'Connected.', lastVerifiedAt: hoursAgo(1) },
    compliance: [
      { kind: 'INVITATION', state: 'APPROVED', message: 'Approved.' },
      { kind: 'REMINDER', state: 'APPROVED', message: 'Approved.' },
    ],
    reminders: { dueNow: 0, overdue: 0 },
    round: { open: true, deadlineReached: 0, awaitingResponse: 3 },
    storage: { configured: true, recordsNamingAFile: 4 },
    lastBackupAt: hoursAgo(20),
    contact: { hasOperatorAddress: true, hasStandingAddress: true },
    disabledFlags: [],
  },
  {
    serviceMode: 'READ_ONLY',
    appUrl: 'https://mikehelm.com/SPV',
    productionAppUrl: 'https://spv.flipit.com',
    mail: { state: 'UNVERIFIED', summary: 'Not connected.', lastVerifiedAt: null },
    compliance: [
      { kind: 'INVITATION', state: 'PENDING', message: 'Not approved.' },
      { kind: 'REMINDER', state: 'VOID', message: 'Voided.' },
    ],
    reminders: { dueNow: 6, overdue: 4 },
    round: null,
    storage: { configured: false, recordsNamingAFile: 9 },
    lastBackupAt: null,
    contact: { hasOperatorAddress: false, hasStandingAddress: false },
    disabledFlags: ['portal.updates', 'portal.questions'],
  },
  {
    serviceMode: 'SUNSET',
    appUrl: 'http://localhost:3000',
    productionAppUrl: 'https://spv.flipit.com',
    mail: { state: 'FAILING', summary: 'Refused.', lastVerifiedAt: hoursAgo(400) },
    compliance: [{ kind: 'REMINDER', state: 'DRIFTED', message: 'The template changed.' }],
    reminders: { dueNow: 1, overdue: 0 },
    round: { open: false, deadlineReached: 5, awaitingResponse: 0 },
    storage: { configured: true, recordsNamingAFile: 0 },
    lastBackupAt: hoursAgo(24 * 40),
    contact: { hasOperatorAddress: true, hasStandingAddress: false },
    disabledFlags: [],
  },
]

/** One cheap world, dressed in one expensive one. */
function dress(cheap: UnattendedFacts, expensive: (typeof EXPENSIVE_WORLDS)[number]): HealthFacts {
  return {
    ...expensive,
    ...cheap,
    reminders: { ...cheap.reminders, ...expensive.reminders },
  }
}

/**
 * Every rule in the module, found rather than listed.
 *
 * `buildFindings` and `unattendedFindings` are the two assemblies and are the
 * subject of the comparison rather than participants in it.
 */
const RULES: ReadonlyArray<readonly [string, (facts: HealthFacts) => Finding[]]> = Object.entries(
  rules,
)
  .filter(
    ([name, value]) =>
      name.endsWith('Findings') &&
      name !== 'buildFindings' &&
      name !== 'unattendedFindings' &&
      typeof value === 'function',
  )
  .map(([name, value]) => [name, value as (facts: HealthFacts) => Finding[]] as const)

function headlines(findings: readonly Finding[]): string[] {
  return findings.map((finding) => finding.headline)
}

describe('the rules this file knows about', () => {
  it('found them by looking, and there are enough of them to be looking at', () => {
    // A discovery that silently found nothing would make every test below pass.
    expect(RULES.length).toBeGreaterThanOrEqual(10)
    expect(RULES.map(([name]) => name)).toContain('erasureFindings')
    expect(RULES.map(([name]) => name)).toContain('bucketRetentionFindings')
  })

  it('and the two assemblies are excluded from them', () => {
    expect(RULES.map(([name]) => name)).not.toContain('buildFindings')
    expect(RULES.map(([name]) => name)).not.toContain('unattendedFindings')
  })
})

describe('a rule the banner could afford is a rule the banner must carry', () => {
  for (const [label, cheap] of CHEAP_WORLDS) {
    it(`holds when ${label}`, () => {
      const onTheBanner = new Set(headlines(rules.unattendedFindings(cheap)))

      for (const [name, rule] of RULES) {
        const answers = EXPENSIVE_WORLDS.map((expensive) =>
          JSON.stringify(rule(dress(cheap, expensive))),
        )

        // It read something the banner cannot afford. Its absence is a cost
        // decision rather than an omission, and this file has no opinion on it.
        if (new Set(answers).size > 1) continue

        const wrong = rule(dress(cheap, EXPENSIVE_WORLDS[0]!)).filter(
          (finding) => finding.severity === 'WRONG',
        )

        for (const finding of wrong) {
          expect(
            onTheBanner.has(finding.headline),
            `${name} answers from the cheap facts alone and raises "${finding.headline}", ` +
              'and the overview banner does not carry it. Either add it to ' +
              '`unattendedFindings`, or make the rule read a fact the banner cannot afford ' +
              'and say why.',
          ).toBe(true)
        }
      }
    })
  }
})

describe('and the banner never says something the page does not', () => {
  /*
   * The other direction, and the one the comment in `storageFindings` actually
   * states. A banner carrying a headline the health page does not is worse than
   * a missing one: somebody follows the link the banner gives them and finds a
   * page that disagrees with the sentence that sent them there.
   */
  for (const [label, cheap] of CHEAP_WORLDS) {
    for (const [index, expensive] of EXPENSIVE_WORLDS.entries()) {
      it(`holds when ${label}, in world ${index + 1}`, () => {
        const facts = dress(cheap, expensive)
        const onThePage = new Set(headlines(rules.buildFindings(facts)))

        for (const finding of rules.unattendedFindings(cheap)) {
          expect(
            onThePage.has(finding.headline),
            `the banner says "${finding.headline}" and the health page does not.`,
          ).toBe(true)
        }
      })
    }
  }
})

describe('and a quiet system stays quiet', () => {
  it('raises nothing on the banner when the cheap facts are all fine', () => {
    // The opposite failure, and the one that makes a banner stop being read: a
    // parity rule satisfied by putting everything on the banner would pass every
    // test above.
    expect(
      rules.unattendedFindings(cheapBase()).filter((finding) => finding.severity === 'WRONG'),
    ).toEqual([])
  })

  it('and the report agrees, in every expensive world that is also fine', () => {
    const findings = rules.buildFindings(dress(cheapBase(), EXPENSIVE_WORLDS[0]!))
    expect(findings.every((finding) => finding.severity === 'OK')).toBe(true)
  })
})
