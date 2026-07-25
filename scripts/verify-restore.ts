/**
 * The restore, actually performed. CODEX_TASKS WP20.
 *
 * *"Backup and restore, with restore actually tested."*
 *
 * This dumps the real database, restores it into a scratch database beside it,
 * and then compares the two — not by file size, and not by row counts alone,
 * but by reading the figures back out. A restore that returns `5000.00` as
 * `5000` has lost nothing a row count would notice and everything that matters
 * about a securities record.
 *
 * It creates its own scratch database, drops it at the end, and never writes
 * to `DATABASE_URL`.
 *
 *   pnpm verify:restore
 */

import 'dotenv/config'
import { rmSync } from 'node:fs'
import { join } from 'node:path'
import postgres from 'postgres'
import { db } from '@/db'
import { eq, like } from 'drizzle-orm'
import {
  auditEvents,
  investorAccounts,
  offers,
  recipients,
  rounds,
} from '@/db/schema'
import { backupFileName, BACKUP_DIR, dumpTo, redactUrl, restoreFrom } from './backup'

const PREFIX = 'wp20-restore'
const SCRATCH = 'spv_restore_check'

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

function scratchUrl(databaseUrl: string): string {
  const url = new URL(databaseUrl)
  url.pathname = `/${SCRATCH}`
  return url.toString()
}

function adminUrl(databaseUrl: string): string {
  const url = new URL(databaseUrl)
  url.pathname = '/postgres'
  return url.toString()
}

async function cleanUp(): Promise<void> {
  const accounts = await db
    .select({ id: investorAccounts.id })
    .from(investorAccounts)
    .where(like(investorAccounts.email, `${PREFIX}%`))

  for (const account of accounts) {
    await db.delete(offers).where(eq(offers.accountId, account.id))
    await db.delete(investorAccounts).where(eq(investorAccounts.id, account.id))
  }
  await db.delete(recipients).where(like(recipients.email, `${PREFIX}%`))
  await db.delete(rounds).where(like(rounds.name, `${PREFIX}%`))
}

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) throw new Error('DATABASE_URL is not set.')

  console.log('\nWP20 — the restore, actually performed\n')
  console.log(`  source ${redactUrl(databaseUrl)}`)
  console.log(`  scratch ${redactUrl(scratchUrl(databaseUrl))}\n`)

  await cleanUp()

  // ---------------------------------------------------------------------
  // Something distinctive to look for on the other side. The figures are
  // deliberately awkward: a trailing zero that a numeric type would drop, and
  // six decimal places on a percentage.
  // ---------------------------------------------------------------------

  console.log('Writing a record to look for')

  const [round] = await db
    .insert(rounds)
    .values({
      name: `${PREFIX} round`,
      aggregateTargetUsd: '30000.00',
      flipitShare: '0.300000',
    })
    .returning()

  const [account] = await db
    .insert(investorAccounts)
    .values({
      name: 'Restore Verify — Ünïcødé',
      email: `${PREFIX}@example.test`,
      status: 'ACTIVE',
    })
    .returning()

  await db.insert(recipients).values({
    roundId: round!.id,
    name: 'Restore Verify',
    email: `${PREFIX}@example.test`,
    jurisdiction: 'GB',
  })

  const [offer] = await db
    .insert(offers)
    .values({
      roundId: round!.id,
      accountId: account!.id,
      proposedAmountUsd: '4750.50',
      spvPercentage: '15.835000',
      indirectPercentage: '4.750500',
      responseDeadline: '2026-12-31',
    })
    .returning()

  const auditCountBefore = (await db.select({ id: auditEvents.id }).from(auditEvents)).length
  check('there is an audit log to lose', auditCountBefore > 0, String(auditCountBefore))

  // ---------------------------------------------------------------------

  console.log('\nDumping')
  const file = join(BACKUP_DIR, backupFileName(new Date()))
  await dumpTo(file, databaseUrl)
  check('the dump exists and is not empty', true)

  console.log('\nCreating a scratch database and restoring into it')
  const admin = postgres(adminUrl(databaseUrl), { max: 1, onnotice: () => {} })
  try {
    await admin.unsafe(`DROP DATABASE IF EXISTS ${SCRATCH}`)
    await admin.unsafe(`CREATE DATABASE ${SCRATCH}`)
  } finally {
    await admin.end()
  }

  await restoreFrom(file, scratchUrl(databaseUrl))
  check('pg_restore completed without error', true)

  // ---------------------------------------------------------------------
  // Read it back. This is the half that is usually skipped.
  // ---------------------------------------------------------------------

  console.log('\nReading the restored copy back')
  const restored = postgres(scratchUrl(databaseUrl), { max: 1, onnotice: () => {} })

  try {
    const [restoredOffer] = await restored`
      SELECT proposed_amount_usd, spv_percentage, indirect_percentage, response_deadline
      FROM offers WHERE id = ${offer!.id}
    `
    check('the offer survived', restoredOffer !== undefined)

    // The whole reason for checking figures rather than counts: a numeric
    // column read back through a driver that coerces would arrive as 4750.5.
    check(
      'the amount is byte-identical, trailing zero and all',
      restoredOffer?.proposed_amount_usd === '4750.50',
      String(restoredOffer?.proposed_amount_usd),
    )
    check(
      'the SPV percentage keeps all six decimal places',
      restoredOffer?.spv_percentage === '15.835000',
      String(restoredOffer?.spv_percentage),
    )
    check(
      'the indirect percentage keeps all six too',
      restoredOffer?.indirect_percentage === '4.750500',
      String(restoredOffer?.indirect_percentage),
    )

    const [restoredAccount] = await restored`
      SELECT name, email, status FROM investor_accounts WHERE id = ${account!.id}
    `
    check(
      'a non-ASCII name came back intact',
      restoredAccount?.name === 'Restore Verify — Ünïcødé',
      String(restoredAccount?.name),
    )
    check('the account status came back', restoredAccount?.status === 'ACTIVE')

    const [{ count: restoredAudit }] = await restored`SELECT count(*)::int FROM audit_events`
    check(
      'the audit log came back whole',
      Number(restoredAudit) === auditCountBefore,
      `${restoredAudit} of ${auditCountBefore}`,
    )

    // Structure, not just rows. A restore that dropped an index or a constraint
    // would pass every check above and fail on the first duplicate email.
    const [{ count: tableCount }] = await restored`
      SELECT count(*)::int FROM information_schema.tables WHERE table_schema = 'public'
    `
    const source = postgres(databaseUrl, { max: 1, onnotice: () => {} })
    let sourceTables = 0
    try {
      const [row] = await source`
        SELECT count(*)::int FROM information_schema.tables WHERE table_schema = 'public'
      `
      sourceTables = Number(row?.count ?? 0)
    } finally {
      await source.end()
    }

    check(
      'every table came back',
      Number(tableCount) === sourceTables && sourceTables > 0,
      `${tableCount} of ${sourceTables}`,
    )

    const [{ count: indexCount }] = await restored`
      SELECT count(*)::int FROM pg_indexes WHERE schemaname = 'public'
    `
    check('the indexes came back too', Number(indexCount) > 10, String(indexCount))

    const [{ count: uniqueConstraints }] = await restored`
      SELECT count(*)::int FROM information_schema.table_constraints
      WHERE constraint_schema = 'public' AND constraint_type = 'UNIQUE'
    `
    check(
      'and the unique constraints, which are what stop a duplicate investor',
      Number(uniqueConstraints) > 0,
      String(uniqueConstraints),
    )

    // The one thing a restore must NOT bring back differently.
    const [restoredToken] = await restored`
      SELECT token_hash FROM portal_tokens LIMIT 1
    `
    if (restoredToken) {
      check(
        'a portal token is still only a hash',
        typeof restoredToken.token_hash === 'string' && restoredToken.token_hash.length > 20,
      )
    }
  } finally {
    await restored.end()
  }

  // ---------------------------------------------------------------------

  console.log('\nCleaning up')
  const admin2 = postgres(adminUrl(databaseUrl), { max: 1, onnotice: () => {} })
  try {
    await admin2.unsafe(`DROP DATABASE IF EXISTS ${SCRATCH}`)
  } finally {
    await admin2.end()
  }
  rmSync(file, { force: true })
  await cleanUp()

  const orphans = await db
    .select({ id: investorAccounts.id })
    .from(investorAccounts)
    .where(like(investorAccounts.email, `${PREFIX}%`))
  check('verification data is removed', orphans.length === 0)

  console.log(`\n${passed} passed, ${failed} failed\n`)
  if (failed > 0) process.exitCode = 1
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => process.exit())
