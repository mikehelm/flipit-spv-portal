/**
 * The worlds the health rules are asked about.
 *
 * Lifted out of `banner-parity.test.ts` when a **third** surface needed them.
 * The report has three readers — the health page, the overview banner, and the
 * signal an uptime monitor polls — and each of the three is a place a finding
 * can fail to arrive. Two parity tests over two private copies of these fixtures
 * would drift, and a drifted fixture makes two tests disagree about what the
 * system is while both report success.
 *
 * The same argument as `verify/source.ts` and `scripts/lib/browser.ts`: the
 * thing written twice is the thing that ends up wrong in one copy.
 *
 * ## The shape
 *
 * **Cheap facts** are what an admin page load can afford to gather, and are the
 * only thing the overview banner has in its hand. **Expensive facts** need
 * another query each. A rule that returns the same answer in all three expensive
 * worlds did not read any of them, which is how "could this have been on the
 * banner" is decided mechanically rather than from a roster.
 *
 * The cheap worlds are deliberately more numerous than the rules currently
 * distinguish. A state nobody has written a rule for yet is exactly where the
 * next rule will go.
 */

import type { HealthFacts, UnattendedFacts } from './rules'

export const NOW = new Date('2026-07-26T12:00:00Z')

export function hoursAgo(hours: number): Date {
  return new Date(NOW.getTime() - hours * 60 * 60 * 1000)
}

/** The cheap half, with nothing wrong with it. */
export function cheapBase(): UnattendedFacts {
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

export function withMediaCheck(
  patch: Partial<NonNullable<UnattendedFacts['lastMediaCheck']>>,
): UnattendedFacts {
  const base = cheapBase()
  return { ...base, lastMediaCheck: { ...base.lastMediaCheck!, ...patch } }
}

export function withReminders(patch: Partial<UnattendedFacts['reminders']>): UnattendedFacts {
  const base = cheapBase()
  return { ...base, reminders: { ...base.reminders, ...patch } }
}

export function withErasures(rows: UnattendedFacts['unfinishedErasures']): UnattendedFacts {
  return { ...cheapBase(), unfinishedErasures: rows }
}

export function erasure(
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
export const CHEAP_WORLDS: ReadonlyArray<readonly [string, UnattendedFacts]> = [
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
export const EXPENSIVE_WORLDS: ReadonlyArray<Omit<HealthFacts, keyof UnattendedFacts | 'reminders'> & {
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
export function dress(cheap: UnattendedFacts, expensive: (typeof EXPENSIVE_WORLDS)[number]): HealthFacts {
  return {
    ...expensive,
    ...cheap,
    reminders: { ...cheap.reminders, ...expensive.reminders },
  }
}
