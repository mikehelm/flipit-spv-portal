/**
 * Backup and restore. BUILD_SPEC §16, §20; CODEX_TASKS WP20.
 *
 * *"Backup and restore, with restore actually tested."* The second half is the
 * point. A backup nobody has restored is a file, not a backup, and the way that
 * is usually discovered is at the worst possible moment.
 *
 *   pnpm backup                      → writes backups/spv-<stamp>.dump
 *   pnpm backup restore <file>       → restores into RESTORE_DATABASE_URL
 *   pnpm verify:restore              → dumps, restores into a scratch database,
 *                                      and compares, row by row and figure by
 *                                      figure
 *
 * **The custom format, not plain SQL.** `pg_restore` on a custom-format dump
 * can be pointed at a different database name, can restore selectively, and
 * refuses a truncated file outright rather than replaying half of it — which a
 * `psql < file.sql` will cheerfully do, leaving a database that looks restored
 * and is missing the last third of the audit log.
 *
 * **Restore never targets `DATABASE_URL`.** It reads `RESTORE_DATABASE_URL`,
 * and refuses if the two are the same. The single most expensive mistake
 * available here is restoring last week over this week, and the runbook for
 * that day will be read by somebody who is already having a bad morning.
 *
 * Nothing here logs a connection string. The password is passed to the child
 * process in its environment and the URL is printed with its credentials
 * removed.
 */

import 'dotenv/config'
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, statSync } from 'node:fs'
import { basename, join } from 'node:path'
import { audit, systemActor } from '@/lib/audit'
import { BACKUP_COMPLETED_ACTION } from '@/lib/health/rules'

export const BACKUP_DIR = 'backups'

/** A connection string with the password removed, safe to print. */
export function redactUrl(raw: string): string {
  try {
    const url = new URL(raw)
    if (url.password) url.password = '***'
    return url.toString()
  } catch {
    // Not a URL we can parse. Say nothing about it rather than guessing which
    // part is the secret.
    return '(unparseable connection string)'
  }
}

/**
 * A filename-safe timestamp. Taken from the caller rather than from the clock
 * so the naming is testable.
 */
export function backupFileName(now: Date): string {
  return `spv-${now.toISOString().replace(/[:.]/g, '-').replace('Z', 'Z')}.dump`
}

function runPg(command: string, args: string[], env: Record<string, string> = {}) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let output = ''
    child.stdout?.on('data', (b: Buffer) => (output += b.toString()))
    child.stderr?.on('data', (b: Buffer) => (output += b.toString()))

    child.on('error', reject)
    child.on('exit', (code) => {
      if (code === 0) return resolve()
      // The output may contain a host and a database name. It does not contain
      // a password — libpq never echoes PGPASSWORD — and without it a failure
      // here is unfixable.
      reject(new Error(`${command} exited ${code}:\n${output}`))
    })
  })
}

export async function dumpTo(target: string, databaseUrl: string): Promise<string> {
  mkdirSync(BACKUP_DIR, { recursive: true })

  await runPg('pg_dump', [
    databaseUrl,
    '--format=custom',
    // Roles and tablespaces belong to the server, not to this application, and
    // restoring them into a managed Postgres fails on permissions.
    '--no-owner',
    '--no-privileges',
    '--file',
    target,
  ])

  const size = statSync(target).size
  if (size === 0) throw new Error(`The dump is empty: ${target}`)
  return target
}

export async function restoreFrom(file: string, databaseUrl: string): Promise<void> {
  if (!existsSync(file)) throw new Error(`No such backup: ${file}`)

  await runPg('pg_restore', [
    '--dbname',
    databaseUrl,
    '--no-owner',
    '--no-privileges',
    // The target may already hold an older copy. Drop and recreate rather than
    // merging, because a partial merge is the state nobody can reason about.
    '--clean',
    '--if-exists',
    '--single-transaction',
    file,
  ])
}

// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const [action, argument] = process.argv.slice(2)
  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) throw new Error('DATABASE_URL is not set.')

  if (action === undefined || action === 'dump') {
    const file = join(BACKUP_DIR, backupFileName(new Date()))
    await dumpTo(file, databaseUrl)
    const size = statSync(file).size
    console.log(`Backed up ${redactUrl(databaseUrl)}`)
    console.log(`  → ${file} (${size} bytes)`)

    // Record that it happened, so `pnpm check:health` can say when the last one
    // was. A backup regime that stopped in March is exactly the shape of quiet
    // failure that report exists for, and until now nothing anywhere held the
    // date. The size and the file name go in; the connection string does not,
    // and neither does the directory, because a path is a fact about the
    // machine rather than about the backup.
    await audit({
      actor: systemActor,
      entityType: 'database',
      entityId: null,
      action: BACKUP_COMPLETED_ACTION,
      metadata: { file: basename(file), sizeBytes: size },
    })

    console.log('\nRestore it with:  pnpm backup restore ' + file)
    return
  }

  if (action === 'restore') {
    if (!argument) throw new Error('Usage: pnpm backup restore <file>')

    const target = process.env.RESTORE_DATABASE_URL
    if (!target) {
      throw new Error(
        'RESTORE_DATABASE_URL is not set. Restore deliberately does not use ' +
          'DATABASE_URL: restoring an old backup over the live database is the one ' +
          'mistake here that cannot be undone, and it should take a second variable ' +
          'to make.',
      )
    }

    if (target === databaseUrl) {
      throw new Error(
        'RESTORE_DATABASE_URL is the same as DATABASE_URL. Point it at the database ' +
          'you want to overwrite, which is not the live one.',
      )
    }

    await restoreFrom(argument, target)
    console.log(`Restored ${argument}`)
    console.log(`  → ${redactUrl(target)}`)
    return
  }

  throw new Error(`Unknown action: ${action}. Use "dump" or "restore <file>".`)
}

// Only run when invoked directly, so the functions above can be imported by
// the verification script without triggering a dump.
if (process.argv[1]?.endsWith('backup.ts')) {
  main()
    .catch((error) => {
      console.error(error instanceof Error ? error.message : error)
      process.exitCode = 1
    })
    // Explicit, since the dump now records itself in the audit log and that
    // opens a connection pool which holds the event loop open. Without this the
    // command finishes its work and then appears to hang, which on a cron is
    // indistinguishable from a backup that never completed.
    .finally(() => process.exit(process.exitCode ?? 0))
}
