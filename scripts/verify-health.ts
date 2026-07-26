/**
 * Verifying the health report itself. BUILD_SPEC §6.5, §7, §8.1, §18.1.
 *
 *   pnpm verify:health
 *
 * `src/lib/health/rules.test.ts` pins the judgement — given these facts, this
 * finding — and it does so without a database, which is the point of the split.
 * What no unit test can reach is whether the facts arriving at those rules are
 * the facts the database actually holds, and whether the command a scheduler
 * runs behaves the way the runbook says it does.
 *
 * That gap matters more here than almost anywhere else in the repository,
 * because of what this thing is for. It is the check that nobody reads until
 * something has gone wrong, and the way it fails is by printing a clean report
 * about a system that is not clean. A watcher that has itself stopped working
 * looks exactly like a system with nothing wrong with it.
 *
 * So this spawns the real `pnpm check:health`, in its own process, against
 * rows it made — a reminder a run took and abandoned, an audit log with no
 * completed run in it — and reads its actual output and its actual exit code,
 * which is what a deployment script reads.
 *
 * It puts everything back. The audit log is append-only by design, so the
 * entries this writes are removed by id rather than by truncation, and the ones
 * it hides are restored.
 */

import 'dotenv/config'
import { spawn } from 'node:child_process'
import { and, eq, inArray, isNull, like } from 'drizzle-orm'
import { db } from '@/db'
import {
  auditEvents,
  investorAccounts,
  offers,
  recipients,
  reminderEvents,
  rounds,
} from '@/db/schema'
import { CLAIM_STUCK_HOURS, RUN_OVERDUE_HOURS } from '@/lib/health/rules'

const PREFIX = 'health-verify'

let passed = 0
let failed = 0

function check(label: string, condition: boolean, detail?: string): void {
  if (condition) {
    passed += 1
    console.log(`  ok    ${label}`)
  } else {
    failed += 1
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

interface Run {
  code: number
  out: string
}

/**
 * Run the real command, exactly as a scheduler would.
 *
 * `out` is the report and nothing else. Everything pnpm prints before it — the
 * package name and version, the command it is about to run — is not the report
 * and would otherwise be asserted about by mistake. It cost a false failure
 * once: `flipit-spv-portal@0.1.0` matches an email address well enough for the
 * check that the report names none.
 */
function runCheck(): Promise<Run> {
  return new Promise((resolve) => {
    const child = spawn('pnpm', ['check:health'], { cwd: process.cwd(), env: process.env })
    let out = ''
    child.stdout.on('data', (chunk: Buffer) => (out += chunk.toString()))
    child.stderr.on('data', (chunk: Buffer) => (out += chunk.toString()))
    child.on('close', (code) => {
      const start = out.indexOf('Health report at')
      resolve({ code: code ?? -1, out: start === -1 ? out : out.slice(start) })
    })
  })
}

function hoursAgo(hours: number): Date {
  return new Date(Date.now() - hours * 60 * 60 * 1000)
}

async function cleanup(): Promise<void> {
  const accounts = await db
    .select({ id: investorAccounts.id })
    .from(investorAccounts)
    .where(like(investorAccounts.email, `${PREFIX}%`))

  for (const account of accounts) {
    const rows = await db
      .select({ id: offers.id, recipientId: offers.recipientId })
      .from(offers)
      .where(eq(offers.accountId, account.id))

    for (const row of rows) {
      await db.delete(reminderEvents).where(eq(reminderEvents.offerId, row.id))
    }
    await db.delete(offers).where(eq(offers.accountId, account.id))
    for (const row of rows) {
      if (row.recipientId) {
        await db.delete(recipients).where(eq(recipients.id, row.recipientId))
      }
    }
    await db.delete(investorAccounts).where(eq(investorAccounts.id, account.id))
  }

  await db.delete(recipients).where(like(recipients.email, `${PREFIX}%`))
}

async function main(): Promise<void> {
  await cleanup()

  const round = await db.query.rounds.findFirst({ where: isNull(rounds.closedAt) })
  if (!round) throw new Error('No open round. Run `pnpm db:seed` first.')

  console.log('The report reads the database it is pointed at')

  // --- A system with no completed run -------------------------------------
  //
  // The audit log is append-only, so rather than deleting the real entries the
  // action is renamed for the duration and put back afterwards. Nothing is lost
  // and nothing is rewritten in place — every row keeps its actor and its time.
  const HIDDEN = 'reminder.run_completed__hidden_by_verify'
  const existing = await db
    .select({ id: auditEvents.id })
    .from(auditEvents)
    .where(eq(auditEvents.action, 'reminder.run_completed'))

  if (existing.length > 0) {
    await db
      .update(auditEvents)
      .set({ action: HIDDEN })
      .where(
        inArray(
          auditEvents.id,
          existing.map((row) => row.id),
        ),
      )
  }

  const neverRun = await runCheck()
  check(
    'a system where no run has ever completed exits non-zero',
    neverRun.code !== 0,
    `exit ${neverRun.code}`,
  )
  check(
    'and says so in as many words',
    /No reminder run has ever completed/.test(neverRun.out),
  )
  check(
    'and names the runbook section that fixes it',
    /DEPLOYMENT\.md §8/.test(neverRun.out),
  )
  check(
    'and does not merely say something went wrong',
    !/something went wrong/i.test(neverRun.out),
  )

  // --- A scheduler that stopped -------------------------------------------
  const [stale] = await db
    .insert(auditEvents)
    .values({
      actorLabel: 'verify-health',
      entityType: 'round',
      entityId: round.id,
      action: 'reminder.run_completed',
      createdAt: hoursAgo(RUN_OVERDUE_HOURS + 5),
      metadata: { note: 'written by pnpm verify:health' },
    })
    .returning({ id: auditEvents.id })

  const stopped = await runCheck()
  check('a scheduler that stopped hours ago exits non-zero', stopped.code !== 0)
  check(
    'and reports how long ago the last run was, not just that it was old',
    /last reminder run completed \d+ hours ago/i.test(stopped.out),
    stopped.out.match(/last reminder run completed[^\n]*/i)?.[0],
  )

  // --- A recent run: the same system, now healthy on that axis -------------
  await db
    .update(auditEvents)
    .set({ createdAt: new Date() })
    .where(eq(auditEvents.id, stale!.id))

  const recent = await runCheck()
  check(
    'a run minutes ago is not reported as a fault',
    !/last reminder run completed \d+ hours ago/i.test(recent.out),
  )

  // --- A reminder a run took and abandoned --------------------------------
  const [account] = await db
    .insert(investorAccounts)
    .values({
      email: `${PREFIX}-stuck@example.test`,
      name: 'Stuck Claim',
      status: 'ACTIVE',
    })
    .returning()

  const [recipient] = await db
    .insert(recipients)
    .values({
      roundId: round.id,
      email: `${PREFIX}-stuck@example.test`,
      name: 'Stuck Claim',
      jurisdiction: 'GB',
    })
    .returning()

  const [offer] = await db
    .insert(offers)
    .values({
      roundId: round.id,
      accountId: account!.id,
      recipientId: recipient!.id,
      // Strings, not numbers. Money and percentages never become a JavaScript
      // number at any point, including in a verification script.
      proposedAmountUsd: '5000.00',
      spvPercentage: '16.666667',
      indirectPercentage: '5.000000',
      responseDeadline: new Date(Date.now() + 20 * 86400000).toISOString().slice(0, 10),
      emailStatus: 'SENT',
      responseChoice: 'NO_RESPONSE',
    })
    .returning()

  const [claimed] = await db
    .insert(reminderEvents)
    .values({
      offerId: offer!.id,
      scheduledFor: hoursAgo(6),
      sequence: 1,
      claimedAt: hoursAgo(CLAIM_STUCK_HOURS + 4),
    })
    .returning()

  const stuck = await runCheck()
  check('a reminder abandoned mid-send exits non-zero', stuck.code !== 0)
  check(
    'and is reported as being stuck rather than as queued',
    /marked as being sent for over/i.test(stuck.out),
  )
  check('and names the reminder by its id', stuck.out.includes(claimed!.id))
  check(
    'and names no email address anywhere in the report',
    !/[\w.+-]+@[\w-]+\.[\w.]+/.test(stuck.out),
    stuck.out.match(/[\w.+-]+@[\w-]+\.[\w.]+/)?.[0],
  )
  check(
    'and sends the reader to the lock probe first',
    stuck.out.indexOf('reminders:lock') < stuck.out.indexOf('reschedule'),
  )

  // --- A claim young enough that the run could still be working ------------
  await db
    .update(reminderEvents)
    .set({ claimedAt: new Date() })
    .where(eq(reminderEvents.id, claimed!.id))

  const fresh = await runCheck()
  check(
    'a reminder taken a moment ago is not reported as stuck',
    !/marked as being sent for over/i.test(fresh.out),
  )

  // --- Resolved: the row finished, the report goes quiet -------------------
  await db
    .update(reminderEvents)
    .set({ sentAt: new Date() })
    .where(eq(reminderEvents.id, claimed!.id))

  const resolved = await runCheck()
  check(
    'a reminder that finished is not reported at all',
    !resolved.out.includes(claimed!.id),
  )

  console.log('\nWhat the report is allowed to say')

  check(
    'it prints no amount and no percentage',
    !/[£$€]\s?\d/.test(resolved.out) && !/\d\s?%/.test(resolved.out),
  )
  check(
    'every finding that is not ok carries something to do about it',
    resolved.out
      .split('\n\n')
      .filter((block) => /^\s{2}(WRONG|note)/.test(block))
      .every((block) => block.includes('→')),
  )
  check(
    'it says what it checked even when nothing is wrong',
    /Scheduled run/.test(resolved.out) && /Deployment/.test(resolved.out),
  )

  console.log('\nPutting everything back')

  await db.delete(auditEvents).where(eq(auditEvents.id, stale!.id))
  if (existing.length > 0) {
    await db
      .update(auditEvents)
      .set({ action: 'reminder.run_completed' })
      .where(eq(auditEvents.action, HIDDEN))
  }

  await cleanup()

  const orphans = await db
    .select({ id: investorAccounts.id })
    .from(investorAccounts)
    .where(like(investorAccounts.email, `${PREFIX}%`))
  check('verification data is removed', orphans.length === 0)

  const leftHidden = await db
    .select({ id: auditEvents.id })
    .from(auditEvents)
    .where(eq(auditEvents.action, HIDDEN))
  check('no audit entry is left renamed', leftHidden.length === 0)

  const restored = await db
    .select({ id: auditEvents.id })
    .from(auditEvents)
    .where(eq(auditEvents.action, 'reminder.run_completed'))
  check(
    'and the real ones are back, all of them',
    restored.length === existing.length,
    `${restored.length} of ${existing.length}`,
  )

  const noVerifyRows = await db
    .select({ id: auditEvents.id })
    .from(auditEvents)
    .where(and(eq(auditEvents.actorLabel, 'verify-health')))
  check('and the entry this wrote is gone', noVerifyRows.length === 0)

  console.log(`\n${passed} passed, ${failed} failed`)
  if (failed > 0) process.exitCode = 1
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => process.exit(process.exitCode ?? 0))
