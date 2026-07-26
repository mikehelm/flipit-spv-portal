import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { REMINDER_RUN_LOCK_KEY, RUN_IN_PROGRESS_MESSAGE } from './lock'
import { ALREADY_CLAIMED_REASON } from './run'

/**
 * Two reminder runs at once. BUILD_SPEC §6.5, §14.
 *
 * The behaviour these guard is inherently about two processes and a database,
 * so the proof that it works is `pnpm verify:reminders`, which runs two racing
 * runs against a real Postgres. What is pinned here is everything that can be
 * pinned without one: the shape of the defences, and — mostly — that they are
 * still in the source in the order that makes them defences at all.
 *
 * These are the tests that must fail loudly if somebody weakens the rule later,
 * which is the whole reason they are written against the source text. A test
 * that only calls the function passes just as happily when the claim has been
 * moved to after the send.
 */

const DIR = join(process.cwd(), 'src/lib/reminders')

function source(name: string): string {
  return readFileSync(join(DIR, name), 'utf8')
}

/** The file with comments and string literals removed, so a rule cannot be satisfied by prose. */
function code(name: string): string {
  return source(name)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

describe('the lock key', () => {
  it('is two int4s, because that is the signature it is passed to', () => {
    expect(REMINDER_RUN_LOCK_KEY).toHaveLength(2)
    for (const part of REMINDER_RUN_LOCK_KEY) {
      expect(Number.isInteger(part)).toBe(true)
      expect(part).toBeGreaterThan(0)
      expect(part).toBeLessThanOrEqual(2_147_483_647)
    }
  })

  it('is a literal, so every deployment uses the same one', () => {
    // Derived from a hostname, a start time or an environment variable, two
    // deployments against one database would take two different locks and both
    // would send.
    const lock = code('lock.ts')
    expect(lock).toMatch(/REMINDER_RUN_LOCK_KEY[^=]*=\s*\[\s*[\d_]+\s*,\s*[\d_]+\s*\]/)
    expect(lock).not.toMatch(/REMINDER_RUN_LOCK_KEY[^=]*=[^\n]*env\(/)
  })
})

describe('the lock never waits', () => {
  it('tries, and does not queue', () => {
    const lock = code('lock.ts')
    expect(lock).toContain('pg_try_advisory_lock')
    // `pg_advisory_lock` blocks. A run that queues behind another run is a run
    // that starts sending at an unpredictable time.
    expect(lock).not.toMatch(/[^_]pg_advisory_lock\(/)
  })

  it('releases what it took, in a finally', () => {
    const lock = code('lock.ts')
    expect(lock).toContain('pg_advisory_unlock')
    const unlockAt = lock.indexOf('pg_advisory_unlock')
    const finallyBefore = lock.lastIndexOf('finally', unlockAt)
    expect(finallyBefore).toBeGreaterThan(-1)
  })

  it('takes it on its own connection, not on the shared pool', () => {
    // An advisory lock belongs to a session. `db` is a pool of ten, so the
    // statement that takes it and the statement that releases it are not
    // guaranteed to reach the same connection.
    const lock = code('lock.ts')
    expect(lock).toContain("import postgres from 'postgres'")
    expect(lock).toContain('max: 1')
    expect(lock).not.toContain("from '@/db'")
  })

  it('closes the connection whatever happened', () => {
    expect(code('lock.ts')).toContain('sql.end(')
  })
})

describe('the lock has no override', () => {
  it('takes no option that would skip it', () => {
    const lock = code('lock.ts')
    // `withRunLock` takes exactly one parameter: the work. Nothing that could
    // be spelled `{ force: true }` reaches it.
    expect(lock).toMatch(/export async function withRunLock<T>\(work: \(\) => Promise<T>\)/)
    expect(lock).not.toMatch(/\bforce\b/)
    expect(lock).not.toMatch(/\bskipLock\b/)
  })

  it('sets its re-entrancy flag only from inside itself', () => {
    const lock = code('lock.ts')
    // The flag is module-private: assigned twice inside `withRunLock`, exported
    // nowhere, and settable by no caller.
    expect(lock).not.toMatch(/export[^\n]*heldByThisProcess/)
    expect(lock).toContain('let heldByThisProcess = false')
    // The declaration, plus exactly one set and one clear. A third assignment
    // would be a path that leaves it on.
    const assignments = lock.match(/heldByThisProcess = /g) ?? []
    expect(assignments).toHaveLength(3)
  })

  it('clears the flag in the same finally that releases the lock', () => {
    const lock = code('lock.ts')
    const clearAt = lock.indexOf('heldByThisProcess = false')
    const unlockAt = lock.indexOf('pg_advisory_unlock')
    expect(clearAt).toBeGreaterThan(-1)
    expect(unlockAt).toBeGreaterThan(clearAt)
  })
})

describe('the run is inside the lock', () => {
  it('wraps the whole of it, refresh included', () => {
    const run = code('run.ts')
    // The exported entry point does nothing but take the lock and delegate. If
    // the queue refresh or the due-row select had crept outside it, two runs
    // would still both be writing to the queue.
    const exported = run.slice(
      run.indexOf('export async function runDueReminders('),
      run.indexOf('async function runDueRemindersUnderLock('),
    )
    expect(exported).toContain('withRunLock(')
    expect(exported).not.toContain('refreshQueue(')
    expect(exported).not.toContain('sendOne(')
  })

  it('reports a run that did not happen as distinct from one that found nothing', () => {
    const run = code('run.ts')
    expect(run).toContain('ran: false')
    expect(run).toContain('ran: true')
  })

  it('sends nothing when the lock was not acquired', () => {
    const run = code('run.ts')
    const exported = run.slice(
      run.indexOf('export async function runDueReminders('),
      run.indexOf('async function runDueRemindersUnderLock('),
    )
    const notAcquired = exported.slice(exported.indexOf('if (!attempt.acquired)'))
    // Everything in the not-acquired branch is a zero.
    expect(notAcquired).toMatch(/sent: 0/)
    expect(notAcquired).toMatch(/considered: 0/)
    expect(notAcquired).toMatch(/outcomes: \[\]/)
  })
})

describe('the per-row claim', () => {
  const run = code('run.ts')
  const sendOne = run.slice(
    run.indexOf('export async function sendOne('),
    run.indexOf('async function skip('),
  )

  it('happens before the send', () => {
    const claimAt = sendOne.indexOf('isNull(reminderEvents.claimedAt)')
    const sendAt = sendOne.indexOf('sendInvitation(')
    expect(claimAt).toBeGreaterThan(-1)
    expect(sendAt).toBeGreaterThan(claimAt)
  })

  it('happens after every gate, so a claim is never taken on a send that was going to be refused', () => {
    const eligibilityAt = sendOne.indexOf('eligibility.eligible')
    const staleAt = sendOne.indexOf('isStale(')
    const complianceAt = sendOne.indexOf("loadGateContext('REMINDER')")
    const claimAt = sendOne.indexOf('isNull(reminderEvents.claimedAt)')

    expect(claimAt).toBeGreaterThan(eligibilityAt)
    expect(claimAt).toBeGreaterThan(staleAt)
    expect(claimAt).toBeGreaterThan(complianceAt)
  })

  it('is one atomic update, not a read followed by a write', () => {
    // `if (row.claimedAt === null) { update }` is two statements with a gap
    // between them, and the gap is the whole problem.
    const claim = sendOne.slice(
      sendOne.indexOf('const claimed = await db'),
      sendOne.indexOf('if (claimed.length === 0)'),
    )
    expect(claim).toContain('.update(reminderEvents)')
    expect(claim).toContain('claimedAt: now')
    expect(claim).toContain('isNull(reminderEvents.claimedAt)')
    expect(claim).toContain('.returning(')
  })

  it('requires the row to be unsent, uncancelled and unskipped as well', () => {
    const claim = sendOne.slice(
      sendOne.indexOf('const claimed = await db'),
      sendOne.indexOf('if (claimed.length === 0)'),
    )
    expect(claim).toContain('isNull(reminderEvents.sentAt)')
    expect(claim).toContain('isNull(reminderEvents.cancelledAt)')
    expect(claim).toContain('isNull(reminderEvents.skippedReason)')
  })

  it('stops the run that lost, and says so without blaming the recipient', () => {
    expect(sendOne).toContain('ALREADY_CLAIMED_REASON')
    expect(ALREADY_CLAIMED_REASON).toMatch(/another run/i)
    expect(ALREADY_CLAIMED_REASON).not.toMatch(/error|failed|wrong/i)
  })

  it('writes no skip and no audit entry for the row it lost', () => {
    const lost = sendOne.slice(
      sendOne.indexOf('if (claimed.length === 0)'),
      sendOne.indexOf('const result = await sendInvitation('),
    )
    // The run that won will record what it did. A second outcome written here
    // would overwrite it.
    expect(lost).not.toContain('await skip(')
    expect(lost).not.toContain('await audit(')
  })
})

describe('releasing a claim', () => {
  it('happens on a transient failure, so the next run retries', () => {
    const run = code('run.ts')
    const failure = run.slice(
      run.indexOf("if (result.outcome === 'FAILED')"),
      run.indexOf("return {\n      kind: 'FAILED'"),
    )
    expect(failure).toContain('claimedAt: null')
  })

  it('happens on a skip, so a refusal never counts against the cap', () => {
    const run = code('run.ts')
    const skip = run.slice(run.indexOf('async function skip('))
    expect(skip).toContain('claimedAt: null')
  })

  it('happens on a reschedule, which is the operator releasing a run that died', () => {
    const queue = code('queue.ts')
    const reschedule = queue.slice(queue.indexOf('export async function rescheduleReminder('))
    expect(reschedule).toContain('claimedAt: null')
  })

  it('does not happen on a timer', () => {
    // A claim that expired would reopen the window it was added to close.
    const lock = code('lock.ts')
    const run = code('run.ts')
    const queue = code('queue.ts')
    for (const [name, text] of [
      ['lock.ts', lock],
      ['run.ts', run],
      ['queue.ts', queue],
    ] as const) {
      expect(text, name).not.toMatch(/claimedAt[^\n]*(lt|lte|gt|gte)\(/)
      expect(text, name).not.toMatch(/CLAIM_(EXPIRY|TIMEOUT|TTL)/)
    }
  })
})

describe('a claimed row is left alone by everything else', () => {
  const queue = code('queue.ts')

  it('is never deleted by a queue refresh', () => {
    const refresh = queue.slice(
      queue.indexOf('export async function refreshQueue('),
      queue.indexOf('export async function loadQueue('),
    )
    // Deletion works from `pending`, and `pending` excludes anything in flight.
    expect(refresh).toContain('const pending = active.filter((event) => !inFlight(event))')
    const deleteAt = refresh.indexOf('for (const event of pending) {')
    expect(deleteAt).toBeGreaterThan(refresh.indexOf('const pending = active.filter'))
  })

  it('still occupies its moment, so nothing plans a second one on top of it', () => {
    const refresh = queue.slice(
      queue.indexOf('export async function refreshQueue('),
      queue.indexOf('export async function loadQueue('),
    )
    expect(refresh).toContain('active.map((event) => event.scheduledFor.getTime())')
  })

  it('cannot be cancelled', () => {
    const cancel = queue.slice(
      queue.indexOf('export async function cancelReminder('),
      queue.indexOf('export async function rescheduleReminder('),
    )
    const guardAt = cancel.indexOf('event.claimedAt !== null')
    const updateAt = cancel.indexOf('.update(reminderEvents)')
    expect(guardAt).toBeGreaterThan(-1)
    expect(updateAt).toBeGreaterThan(guardAt)
  })

  it('counts against the cap while it is in flight', () => {
    expect(queue).toContain('event.claimedAt !== null && event.skippedReason === null')
  })

  it('reads as being sent rather than as queued', () => {
    expect(queue).toContain("'SENDING'")
    const state = queue.slice(queue.indexOf("const state: QueueRow['state']"))
    // Under SENT and CANCELLED and SKIPPED, above the eligibility question.
    expect(state.indexOf("'SENT'")).toBeLessThan(state.indexOf("'SENDING'"))
    expect(state.indexOf("'SENDING'")).toBeLessThan(state.indexOf('eligibility.eligible'))
  })
})

describe('the scheduled job as a whole', () => {
  const script = readFileSync(join(process.cwd(), 'scripts/run-reminders.ts'), 'utf8')

  it('puts the deadline digest inside the same lock', () => {
    // The digest is a second thing that sends, with the same check-then-send
    // shape. Two runs reading "no digest has been sent" both send one.
    const lockAt = script.indexOf('withRunLock(')
    const digestAt = script.indexOf('sendRoundDigest(')
    const jobAt = script.indexOf('async function job(')
    expect(lockAt).toBeGreaterThan(-1)
    expect(digestAt).toBeGreaterThan(jobAt)
    expect(script.indexOf('async function main(')).toBeGreaterThan(digestAt)
  })

  it('exits zero when another run holds the lock', () => {
    // An alert that fires when nothing is wrong is an alert that gets switched
    // off, and this is the safety mechanism working.
    const branch = script.slice(
      script.indexOf('if (!attempt.acquired)'),
      script.indexOf('\nmain()'),
    )
    expect(branch).not.toMatch(/exitCode = 1/)
    expect(branch).not.toMatch(/throw /)
    expect(RUN_IN_PROGRESS_MESSAGE).toMatch(/already in progress/i)
  })

  it('prints no address, subject or body', () => {
    expect(script).not.toMatch(/\.email\b/)
    expect(script).not.toMatch(/\.subject\b/)
    expect(script).not.toMatch(/\.html\b/)
    expect(script).not.toMatch(/\.text\b/)
  })
})
