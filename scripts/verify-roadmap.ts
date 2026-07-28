/**
 * The second layer under the roadmap tiles, checked against real Postgres.
 * BUILD_SPEC §13.1, §22 AC30.
 *
 * The editing surface refuses a forbidden label at write time and names the
 * word it will not take — `actions/roadmap.ts` does that, and
 * `lib/portal/roadmap.test.ts` proves it at the source. Neither can be checked
 * here: every action goes through `requireOwner()`, and a script has no session.
 *
 * What this covers is the layer beneath, which is the one nobody would notice
 * failing. `lib/portal/data.ts` filters the tiles again on the way out, and that
 * filter is what stands between an investor and a row that reached the table by
 * some other route — a seed, a migration, a hand at a database prompt, or the
 * build before the gate existed. It only ever does anything for a row that
 * should not be there, which makes it exactly the code that rots unnoticed.
 *
 * So: write the rows the gate would have refused, straight past the gate, and
 * then read the portal an investor would actually be served.
 *
 *   pnpm verify:roadmap
 */

import 'dotenv/config'
import { eq, like } from 'drizzle-orm'
import { db } from '@/db'
import { investorAccounts, roadmapTiles } from '@/db/schema'
import { loadPortalView } from '@/lib/portal/data'
import { ROADMAP_DISCLAIMER, forbiddenWordsInTileLabel } from '@/lib/portal/roadmap'
import { everyOf } from '@/lib/verify/vacuous'

const PREFIX = 'RoadmapVerify'

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

async function cleanup(): Promise<void> {
  await db.delete(roadmapTiles).where(like(roadmapTiles.label, `${PREFIX}%`))
  await db.delete(investorAccounts).where(like(investorAccounts.email, `${PREFIX}%`))
}

async function main(): Promise<void> {
  await cleanup()

  const seeded = await db.select().from(roadmapTiles)
  const seededVisible = seeded.filter((tile) => !tile.hidden).length

  console.log('\nRows the write-time gate would have refused')

  const planted = await db
    .insert(roadmapTiles)
    .values([
      { label: `${PREFIX} Documents`, sortOrder: 900, isLive: false, hidden: false },
      { label: `${PREFIX} Returns dashboard`, sortOrder: 901, isLive: false, hidden: false },
      { label: `${PREFIX} Liquidity window`, sortOrder: 902, isLive: true, hidden: false },
      { label: `${PREFIX} Live Q3`, sortOrder: 903, isLive: false, hidden: false },
      { label: `${PREFIX} Ready 2027`, sortOrder: 904, isLive: false, hidden: false },
      { label: `${PREFIX} Reporting`, sortOrder: 905, isLive: false, hidden: true },
    ])
    .returning()

  check('six rows were written directly, with no gate in the way', planted.length === 6)

  for (const label of ['Returns dashboard', 'Liquidity window', 'Live Q3', 'Ready 2027']) {
    check(
      `the write-time gate would have refused “${label}”`,
      forbiddenWordsInTileLabel(label).length > 0,
      'if this fails the fixture is wrong, not the filter',
    )
  }

  console.log('\nWhat an investor is actually served')

  const [account] = await db
    .insert(investorAccounts)
    .values({
      email: `${PREFIX}-investor@example.test`,
      name: 'Verification Investor',
      status: 'ACTIVE',
    })
    .returning()

  const view = await loadPortalView(account.id)
  check('the portal view loads for an active account', view !== null)

  const labels = (view?.tiles ?? []).map((tile) => tile.label)

  check(
    'the clean tile reaches the portal',
    labels.includes(`${PREFIX} Documents`),
    'the filter must not be refusing everything',
  )

  for (const label of ['Returns dashboard', 'Liquidity window', 'Live Q3', 'Ready 2027']) {
    check(`“${label}” never reaches the portal`, !labels.includes(`${PREFIX} ${label}`))
  }

  check(
    'a hidden tile is hidden even though its label is clean',
    !labels.includes(`${PREFIX} Reporting`),
  )

  check(
    'exactly one of the six planted rows is visible',
    labels.filter((label) => label.startsWith(PREFIX)).length === 1,
  )

  check(
    'the seeded tiles are unaffected by any of this',
    labels.filter((label) => !label.startsWith(PREFIX)).length === seededVisible,
  )

  console.log('\nThe standing line')

  check(
    'is a constant rather than a row, so no tile edit can remove or reword it',
    everyOf(seeded, (tile) => !tile.label.includes(ROADMAP_DISCLAIMER)) &&
      ROADMAP_DISCLAIMER.length > 0,
  )

  console.log('\nHiding is reversible, and the row survives it')

  await db
    .update(roadmapTiles)
    .set({ hidden: false })
    .where(eq(roadmapTiles.label, `${PREFIX} Reporting`))

  const afterShowing = await loadPortalView(account.id)
  check(
    'showing a hidden tile again puts it back on the portal',
    (afterShowing?.tiles ?? []).some((tile) => tile.label === `${PREFIX} Reporting`),
  )

  console.log('\nCleaning up')
  await cleanup()

  const remaining = await db.select().from(roadmapTiles)
  // A count, not an `every`: none is the *right* answer here, and `everyOf`
  // would refuse an empty table that is empty because the cleanup worked.
  check(
    'verification data is removed',
    remaining.filter((tile) => tile.label.startsWith(PREFIX)).length === 0,
  )
  check('and the seeded tiles are exactly as they were', remaining.length === seeded.length)

  console.log(`\n${passed} passed, ${failed} failed`)
  process.exit(failed === 0 ? 0 : 1)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
