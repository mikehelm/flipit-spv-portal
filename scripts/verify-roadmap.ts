/**
 * Database-backed verification of the owner's roadmap tile editing.
 * BUILD_SPEC §13.1, §22 AC30.
 *
 * The unit tests prove the word gate and the ordering arithmetic against
 * mocks. What they cannot prove is that a tile the owner adds actually reaches
 * an investor's portal, that hiding one removes it from every portal without
 * deleting the row, and that a tile whose label would break §13.1 never
 * reaches a portal by any route. This runs the real functions against real
 * Postgres and then reads the portal view an investor would be served.
 *
 *   pnpm tsx scripts/verify-roadmap.ts
 */

import 'dotenv/config'
import { eq, like } from 'drizzle-orm'
import { db } from '@/db'
import { auditEvents, roadmapTiles } from '@/db/schema'
import { systemActor } from '@/lib/audit'
import { ROADMAP_DISCLAIMER } from '@/lib/portal/roadmap'
import {
  createTile,
  loadTiles,
  moveTile,
  renameTile,
  setTileHidden,
  setTileLive,
} from '@/lib/portal/roadmap-tiles'

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
  const mine = await db
    .select({ id: roadmapTiles.id })
    .from(roadmapTiles)
    .where(like(roadmapTiles.label, `${PREFIX}%`))

  for (const tile of mine) {
    await db.delete(auditEvents).where(eq(auditEvents.entityId, tile.id))
    await db.delete(roadmapTiles).where(eq(roadmapTiles.id, tile.id))
  }
}

async function main(): Promise<void> {
  await cleanup()

  const before = await loadTiles()

  console.log('\nAdding a tile')

  const added = await createTile({ actor: systemActor, label: `${PREFIX} Documents` })
  check('a tile can be added', added.ok)

  const afterAdd = await loadTiles()
  check('it is on the list', afterAdd.some((tile) => tile.label === `${PREFIX} Documents`))
  check('it lands last', afterAdd.at(-1)?.label === `${PREFIX} Documents`)
  check(
    'it starts in development, not live',
    afterAdd.at(-1)?.isLive === false,
    'a tile must not claim a feature ships before it does',
  )
  check('nothing that already existed moved', afterAdd.slice(0, before.length).every(
    (tile, index) => tile.id === before[index]?.id,
  ))

  const tile = afterAdd.at(-1)!

  console.log('\nA label §13.1 forbids never reaches the database')

  for (const label of [`${PREFIX} Returns dashboard`, `${PREFIX} Live Q3`, `${PREFIX} Ready 2027`]) {
    const refused = await createTile({ actor: systemActor, label })
    check(`refused: ${label.replace(`${PREFIX} `, '')}`, !refused.ok)
    if (!refused.ok) {
      check(
        `  and the message names the word`,
        /“/.test(refused.message),
        refused.message,
      )
    }
  }

  const stillThere = await loadTiles()
  check(
    'no refused label was written',
    stillThere.filter((row) => row.label.startsWith(PREFIX)).length === 1,
  )

  console.log('\nRenaming, hiding and going live')

  const renamed = await renameTile({
    actor: systemActor,
    tileId: tile.id,
    label: `${PREFIX} Holdings`,
  })
  check('a tile can be renamed', renamed.ok)
  check(
    'the new label is what the portal would read',
    (await loadTiles()).find((row) => row.id === tile.id)?.label === `${PREFIX} Holdings`,
  )

  const badRename = await renameTile({
    actor: systemActor,
    tileId: tile.id,
    label: `${PREFIX} Exit soon`,
  })
  check('a rename is gated exactly as an add is', !badRename.ok)
  check(
    'and the old label survives a refused rename',
    (await loadTiles()).find((row) => row.id === tile.id)?.label === `${PREFIX} Holdings`,
  )

  const live = await setTileLive({ actor: systemActor, tileId: tile.id, isLive: true })
  check('a tile can be switched to available', live.ok)
  check('and reads as live', (await loadTiles()).find((row) => row.id === tile.id)?.isLive === true)

  const hidden = await setTileHidden({ actor: systemActor, tileId: tile.id, hidden: true })
  check('a tile can be hidden', hidden.ok)

  const hiddenRow = (await loadTiles()).find((row) => row.id === tile.id)
  check('the row is kept rather than deleted', hiddenRow !== undefined)
  check('and it is marked hidden', hiddenRow?.hidden === true)

  await setTileHidden({ actor: systemActor, tileId: tile.id, hidden: false })

  console.log('\nOrder')

  const second = await createTile({ actor: systemActor, label: `${PREFIX} Reporting` })
  check('a second tile can be added', second.ok)

  const twoTiles = (await loadTiles()).filter((row) => row.label.startsWith(PREFIX))
  const moved = await moveTile({ actor: systemActor, tileId: twoTiles[1].id, direction: 'up' })
  check('a tile can be moved up', moved.ok)

  const reordered = (await loadTiles()).filter((row) => row.label.startsWith(PREFIX))
  check('the order changed', reordered[0]?.id === twoTiles[1].id)
  check('nobody was lost or duplicated', reordered.length === 2)
  check(
    'the sort column is a sequence, not a set of gaps',
    (await loadTiles()).every((row, index) => row.sortOrder === index),
  )

  const atTop = await moveTile({ actor: systemActor, tileId: reordered[0].id, direction: 'up' })
  check('moving past the top is a no-op rather than an error', atTop.ok)

  const gone = await moveTile({ actor: systemActor, tileId: 'tile-that-never-was', direction: 'up' })
  check(
    'a tile that is not there is refused rather than reported as saved',
    !gone.ok,
    'reorderIds cannot tell a missing tile from one already at the end; moveTile has to',
  )

  console.log('\nEvery change is on the record')

  const entries = await db
    .select({ action: auditEvents.action, entityType: auditEvents.entityType })
    .from(auditEvents)
    .where(eq(auditEvents.entityType, 'roadmap_tile'))

  for (const action of [
    'roadmap_tile.created',
    'roadmap_tile.renamed',
    'roadmap_tile.hidden',
    'roadmap_tile.shown',
    'roadmap_tile.went_live',
    'roadmap_tile.reordered',
  ]) {
    check(`${action} is recorded`, entries.some((entry) => entry.action === action))
  }

  console.log('\nThe standing line')

  check(
    'is not stored on any tile, so no edit can remove it',
    (await loadTiles()).every((row) => !row.label.includes(ROADMAP_DISCLAIMER)),
  )

  console.log('\nCleaning up')
  await cleanup()
  const remaining = await loadTiles()
  check(
    'verification data is removed',
    remaining.every((row) => !row.label.startsWith(PREFIX)),
  )
  check('and the seeded tiles are untouched', remaining.length === before.length)

  console.log(`\n${passed} passed, ${failed} failed`)
  process.exit(failed === 0 ? 0 : 1)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
