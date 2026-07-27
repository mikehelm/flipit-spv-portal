/**
 * Access-request abuse and isolation checks against a disposable database.
 *
 * This deliberately submits concurrently: a serial test cannot prove the
 * per-source limit is atomic. It creates only obvious example.invalid fixtures
 * and removes them in finally. It sends no email and creates no account.
 */

import 'dotenv/config'
import { createHmac } from 'node:crypto'
import { count, eq, like } from 'drizzle-orm'
import { db } from '@/db'
import {
  accessRequestAttempts,
  accessRequests,
  operatorInvites,
  users,
} from '@/db/schema'
import { recordAccessRequest } from '@/lib/access-requests/store'
import { env } from '@/lib/env'

const PREFIX = 'verify-access-request-'
const SOURCE = '203.0.113.42'
const SOURCE_LIMIT = 8
const DISPOSABLE_DATABASE_PREFIX = 'spv_reconciled_'

function sourceHash(): string {
  return createHmac('sha256', env().AUTH_SECRET)
    .update(`access-request:${SOURCE}`)
    .digest('hex')
}

function requireDisposableDatabase(): void {
  const database = new URL(env().DATABASE_URL).pathname.replace(/^\//, '')
  if (!database.startsWith(DISPOSABLE_DATABASE_PREFIX)) {
    throw new Error(
      `Refusing to mutate database "${database}". This verifier requires a disposable ` +
        `"${DISPOSABLE_DATABASE_PREFIX}*" database.`,
    )
  }
}

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

async function fixtureCount(table: typeof users | typeof operatorInvites) {
  const [row] = await db.select({ value: count() }).from(table)
  return Number(row?.value ?? 0)
}

async function cleanUp(): Promise<void> {
  await db
    .delete(accessRequests)
    .where(like(accessRequests.email, `${PREFIX}%`))
  await db
    .delete(accessRequestAttempts)
    .where(eq(accessRequestAttempts.sourceHash, sourceHash()))
}

async function main(): Promise<void> {
  console.log('Access-request concurrency and isolation\n')
  requireDisposableDatabase()
  await cleanUp()

  const usersBefore = await fixtureCount(users)
  const invitesBefore = await fixtureCount(operatorInvites)

  try {
    const attempts = Array.from({ length: 20 }, (_, index) =>
      recordAccessRequest(
        {
          firstName: 'Test',
          lastName: String(index),
          email: `${PREFIX}${index}@example.invalid`,
          phone: `+1 202 555 ${String(index).padStart(4, '0')}`,
        },
        SOURCE,
      ),
    )

    const results = await Promise.all(attempts)
    const rows = await db
      .select()
      .from(accessRequests)
      .where(like(accessRequests.email, `${PREFIX}%`))

    check(
      'twenty simultaneous submissions create exactly the limit of eight rows',
      rows.length === 8,
      `${rows.length} rows`,
    )
    check(
      'exactly eight callers receive an edit capability',
      results.filter((result) => result.editCapability !== null).length === 8,
    )

    await cleanUp()
    const duplicateAttempts = await Promise.all(
      Array.from({ length: 20 }, () =>
        recordAccessRequest(
          {
            firstName: 'Duplicate',
            lastName: 'Test',
            email: `${PREFIX}duplicate@example.invalid`,
            phone: '+1 202 555 0100',
          },
          SOURCE,
        ),
      ),
    )
    const duplicateRows = await db
      .select()
      .from(accessRequests)
      .where(like(accessRequests.email, `${PREFIX}%`))

    check(
      'twenty same-email attempts create only one queue row',
      duplicateRows.length === 1,
      `${duplicateRows.length} rows`,
    )
    check(
      'same-email retries consume the source limit and later calls throttle',
      duplicateAttempts.filter(
        (result) => result.id === null && result.editCapability === null,
      ).length === 20 - SOURCE_LIMIT,
    )

  } finally {
    const usersAfter = await fixtureCount(users)
    const invitesAfter = await fixtureCount(operatorInvites)
    check('no account was created', usersAfter === usersBefore)
    check('no invitation was created', invitesAfter === invitesBefore)
    await cleanUp()
  }

  console.log(`\n${passed} passed, ${failed} failed\n`)
  // `postgres-js` keeps its pool alive after the last query. This verifier is a
  // standalone command, so finish explicitly after every assertion and cleanup
  // have completed instead of leaving CI waiting on an idle database socket.
  process.exit(failed > 0 ? 1 : 0)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
