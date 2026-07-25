import { asc, eq } from 'drizzle-orm'
import { db } from '@/db'
import { roadmapTiles } from '@/db/schema'
import { audit, type Actor } from '@/lib/audit'
import { forbiddenWordsInTileLabel } from './roadmap'

/**
 * The owner's control over the "Coming to your portal" tiles. BUILD_SPEC §13.1:
 * *"Configurable by the owner: tiles can be added, renamed, hidden, or switched
 * from 'in development' to live as features ship."*
 *
 * Until now the tiles came from the seed and nothing could change them, which
 * left §22 AC30 half met — the wording rules were enforced, but the second half
 * of the sentence was a feature that did not exist.
 *
 * **The gate is here, at write time, and it refuses out loud.** `data.ts` also
 * drops an offending tile at read time, and that stays: it is the quieter of
 * the two checks and it protects a row written before this module existed, or
 * by a hand at a database prompt. But a tile silently missing from a portal is
 * a worse problem to debug than a form that says which word it will not take,
 * which is why the loud one belongs on the way in.
 *
 * Every mutation is audited. §13.1 asks the compliance approver to look at this
 * section along with the email, and a reviewer who cannot see what changed
 * since they last looked is reviewing from memory.
 */

export const MAX_TILE_LABEL_LENGTH = 40

export type TileResult = { ok: true } | { ok: false; message: string }

export interface TileRow {
  id: string
  label: string
  sortOrder: number
  isLive: boolean
  hidden: boolean
}

/**
 * Why a label is refused, in words the owner can act on.
 *
 * §13.1 wants "short labels and no explanation", so length is a rule and not a
 * suggestion: a tile long enough to carry a sentence is long enough to carry a
 * promise, and the four suggested labels are all well inside this.
 */
export function checkTileLabel(label: string): TileResult {
  const trimmed = label.trim()

  if (trimmed.length === 0) {
    return { ok: false, message: 'A tile needs a label.' }
  }
  if (trimmed.length > MAX_TILE_LABEL_LENGTH) {
    return {
      ok: false,
      message: `Keep a tile label to ${MAX_TILE_LABEL_LENGTH} characters. §13.1 asks for names only — a label long enough for a sentence is long enough for a promise.`,
    }
  }

  const forbidden = forbiddenWordsInTileLabel(trimmed)
  if (forbidden.length > 0) {
    const words = forbidden.map((word) => `“${word}”`).join(', ')
    return {
      ok: false,
      message:
        `This label cannot go on a securities offer page: ${words}. ` +
        'BUILD_SPEC §13.1 keeps these tiles about tooling and communication — never a return, ' +
        'a valuation, liquidity or a timeline, and no dates. Name the tool, not what it will do for them.',
    }
  }

  return { ok: true }
}

export async function loadTiles(): Promise<TileRow[]> {
  const rows = await db.select().from(roadmapTiles).orderBy(asc(roadmapTiles.sortOrder))
  return rows.map((row) => ({
    id: row.id,
    label: row.label,
    sortOrder: row.sortOrder,
    isLive: row.isLive,
    hidden: row.hidden,
  }))
}

/**
 * The label a portal reader would see for an existing tile, for the audit
 * entry. Never the whole row: nothing here is secret, but an audit entry is
 * easier to read when it says what changed rather than everything that did not.
 */
async function tileLabel(tileId: string): Promise<string | null> {
  const [row] = await db
    .select({ label: roadmapTiles.label })
    .from(roadmapTiles)
    .where(eq(roadmapTiles.id, tileId))
  return row?.label ?? null
}

export async function createTile(input: { actor: Actor; label: string }): Promise<TileResult> {
  const verdict = checkTileLabel(input.label)
  if (!verdict.ok) return verdict

  const label = input.label.trim()
  const existing = await loadTiles()
  const sortOrder = existing.reduce((highest, tile) => Math.max(highest, tile.sortOrder), -1) + 1

  const [created] = await db
    .insert(roadmapTiles)
    .values({ label, sortOrder, isLive: false })
    .returning({ id: roadmapTiles.id })

  await audit({
    actor: input.actor,
    entityType: 'roadmap_tile',
    entityId: created?.id ?? null,
    action: 'roadmap_tile.created',
    metadata: { label, sortOrder },
  })

  return { ok: true }
}

export async function renameTile(input: {
  actor: Actor
  tileId: string
  label: string
}): Promise<TileResult> {
  const verdict = checkTileLabel(input.label)
  if (!verdict.ok) return verdict

  const previous = await tileLabel(input.tileId)
  if (previous === null) return { ok: false, message: 'That tile no longer exists.' }

  const label = input.label.trim()
  if (label === previous) return { ok: true }

  await db.update(roadmapTiles).set({ label }).where(eq(roadmapTiles.id, input.tileId))

  await audit({
    actor: input.actor,
    entityType: 'roadmap_tile',
    entityId: input.tileId,
    action: 'roadmap_tile.renamed',
    metadata: { from: previous, to: label },
  })

  return { ok: true }
}

/**
 * Hidden, not deleted.
 *
 * A tile an investor has seen is part of what they were shown, and §16 wants
 * the log to answer what the portal looked like on a given day. Hiding leaves
 * the row and the trail; deleting would leave neither.
 */
export async function setTileHidden(input: {
  actor: Actor
  tileId: string
  hidden: boolean
}): Promise<TileResult> {
  const label = await tileLabel(input.tileId)
  if (label === null) return { ok: false, message: 'That tile no longer exists.' }

  await db.update(roadmapTiles).set({ hidden: input.hidden }).where(eq(roadmapTiles.id, input.tileId))

  await audit({
    actor: input.actor,
    entityType: 'roadmap_tile',
    entityId: input.tileId,
    action: input.hidden ? 'roadmap_tile.hidden' : 'roadmap_tile.shown',
    metadata: { label },
  })

  return { ok: true }
}

/** §13.1: "switched from 'in development' to live as features ship". */
export async function setTileLive(input: {
  actor: Actor
  tileId: string
  isLive: boolean
}): Promise<TileResult> {
  const label = await tileLabel(input.tileId)
  if (label === null) return { ok: false, message: 'That tile no longer exists.' }

  await db.update(roadmapTiles).set({ isLive: input.isLive }).where(eq(roadmapTiles.id, input.tileId))

  await audit({
    actor: input.actor,
    entityType: 'roadmap_tile',
    entityId: input.tileId,
    action: input.isLive ? 'roadmap_tile.went_live' : 'roadmap_tile.in_development',
    metadata: { label },
  })

  return { ok: true }
}

/**
 * Reordering, computed as a whole rather than by swapping two rows.
 *
 * Swapping leaves gaps and duplicates behind over time, and the portal orders
 * by this column. Rewriting the sequence keeps it a sequence.
 */
export function reorderIds(ids: string[], tileId: string, direction: 'up' | 'down'): string[] {
  const index = ids.indexOf(tileId)
  if (index === -1) return ids

  const target = direction === 'up' ? index - 1 : index + 1
  if (target < 0 || target >= ids.length) return ids

  const next = [...ids]
  const [moved] = next.splice(index, 1)
  next.splice(target, 0, moved)
  return next
}

export async function moveTile(input: {
  actor: Actor
  tileId: string
  direction: 'up' | 'down'
}): Promise<TileResult> {
  const tiles = await loadTiles()
  const ids = tiles.map((tile) => tile.id)

  // A tile that is not there and a tile that cannot move further are the same
  // answer to `reorderIds` and must not be the same answer here — every other
  // mutation in this module says so when the row has gone.
  if (!ids.includes(input.tileId)) return { ok: false, message: 'That tile no longer exists.' }

  const next = reorderIds(ids, input.tileId, input.direction)

  if (next.join() === ids.join()) {
    // Already at the end it was asked to move towards. Nothing to record.
    return { ok: true }
  }

  // One statement per row, so the sequence is only ever a sequence. A failure
  // half way through would otherwise leave two tiles claiming one position.
  await db.transaction(async (tx) => {
    for (const [index, id] of next.entries()) {
      await tx.update(roadmapTiles).set({ sortOrder: index }).where(eq(roadmapTiles.id, id))
    }
  })

  await audit({
    actor: input.actor,
    entityType: 'roadmap_tile',
    entityId: input.tileId,
    action: 'roadmap_tile.reordered',
    metadata: {
      direction: input.direction,
      position: next.indexOf(input.tileId),
      of: next.length,
    },
  })

  return { ok: true }
}
