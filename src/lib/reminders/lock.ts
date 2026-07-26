/**
 * One reminder run at a time. BUILD_SPEC §6.5, §14.
 *
 * `runDueReminders` was written to be run from a person's shell, and read that
 * way it is safe: it selects the rows that are due, then sends them one at a
 * time. Put it on a schedule and the same code has a hole in it. An hourly cron
 * and a run that takes longer than an hour — fifty recipients, each with SMTP
 * retries and backoff behind them, is enough — means a second run starts while
 * the first is still in its loop. Both select the same due rows, because nothing
 * marks a row as taken until `sent_at` is written *after* the send. Both pass
 * the same gates, because the gates are about the recipient rather than the run.
 * The investor receives the same reminder twice.
 *
 * There are two defences and they are deliberately independent.
 *
 *   1. **This lock**, around the whole run. A Postgres advisory lock is held for
 *      as long as the run lasts, and a second run that cannot take it does
 *      nothing at all — it does not wait, it does not send, it reports and
 *      exits. `pg_try_advisory_lock`, never `pg_advisory_lock`: a run that
 *      *queues* behind another run is a run that starts sending at an
 *      unpredictable time, which is the opposite of what a schedule is for.
 *
 *   2. **The per-row claim** in `run.ts`, an UPDATE that requires
 *      `claimed_at` to still be null. That one holds even where this one does
 *      not — two deployments pointed at the same database with different lock
 *      keys, a `sendOne` called directly from a script while the cron job runs,
 *      or this file being changed by somebody who has not read this comment.
 *
 * Either alone would usually be enough. "Usually" is not the standard for the
 * only thing in this application that sends without a human present.
 *
 * The lock is taken on its own connection rather than on the shared pool. An
 * advisory lock belongs to a session, and `db` is a pool of ten: the statement
 * that takes the lock and the statement that releases it are not guaranteed to
 * land on the same connection, so a pooled lock is one that may never be
 * released. A transaction-scoped lock would fix the session problem and
 * introduce a worse one — the whole run inside a single transaction, where a
 * rollback would erase the record of emails that have already left the building.
 */

import postgres from 'postgres'
import { env } from '@/lib/env'

/**
 * The lock key, as the two-integer form of `pg_try_advisory_lock`.
 *
 * Two `int4`s rather than one `int8` so nothing depends on how a bigint
 * survives the driver. The numbers are arbitrary and fixed; what matters is only
 * that every deployment of this application uses the same pair, so they are
 * written as literals rather than derived from anything that could vary.
 */
export const REMINDER_RUN_LOCK_KEY: readonly [number, number] = [1_599_078_400, 1_617]

export type RunLock<T> =
  | { acquired: true; result: T }
  | { acquired: false; result: null }

/**
 * The message a caller shows when another run holds the lock.
 *
 * It says what happened and what to do, per the standing rule on errors. It
 * names no recipient and no count, because a run that did not start does not
 * know either.
 */
export const RUN_IN_PROGRESS_MESSAGE =
  'Another reminder run is already in progress, so this one sent nothing and stopped. ' +
  'That is the intended behaviour: two runs at once would send the same reminder twice. ' +
  'The reminders that were due are still due and the next run will pick them up.'

/**
 * True while this process holds the lock. See `withRunLock` for why.
 *
 * Module-level rather than passed in as an option, deliberately. An option
 * would be a parameter that turns the safety mechanism off, and the one rule
 * about this gate is that nothing may add an override to it. This is not an
 * override: it is a fact about the current process that the process itself
 * establishes and clears, and no caller can set it.
 */
let heldByThisProcess = false

/**
 * Run `work` while holding the reminder-run lock, or do not run it at all.
 *
 * The lock is released whatever `work` does, including throwing, and the
 * connection is closed on the way out. A process killed mid-run releases it too,
 * because the session ends with the process — which is the one respect in which
 * a lock is kinder than a column, and the reason the per-row claim exists to
 * cover what a released lock leaves behind.
 *
 * **Re-entrant within one process.** The scheduled job does two things that
 * send: the reminders, and §6.6's deadline digest to the operator. Both need to
 * be inside the lock, and `runDueReminders` takes it for itself so that any
 * caller is covered — so the outer call and the inner call are the same run and
 * must not fight each other. A second Postgres session cannot take a lock the
 * first session holds, so without this the inner call would report the outer one
 * as a competing run and send nothing at all.
 *
 * The nesting this supports is sequential, inside one process, which is the only
 * shape the scheduled job has. It is not a way for two things to run at once.
 */
export async function withRunLock<T>(work: () => Promise<T>): Promise<RunLock<T>> {
  if (heldByThisProcess) return { acquired: true, result: await work() }

  const sql = postgres(env().DATABASE_URL, { max: 1 })
  const [high, low] = REMINDER_RUN_LOCK_KEY

  try {
    const rows = await sql<Array<{ acquired: boolean }>>`
      select pg_try_advisory_lock(${high}::int4, ${low}::int4) as acquired
    `
    if (rows[0]?.acquired !== true) return { acquired: false, result: null }

    heldByThisProcess = true
    try {
      return { acquired: true, result: await work() }
    } finally {
      heldByThisProcess = false
      await sql`select pg_advisory_unlock(${high}::int4, ${low}::int4)`
    }
  } finally {
    await sql.end({ timeout: 5 })
  }
}
