'use server'

import { asc, eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { actionError, actionOk, type ActionState } from '@/components/admin/action-state'
import { db } from '@/db'
import { roadmapTiles } from '@/db/schema'
import { audit } from '@/lib/audit'
import { requireOwner } from '@/lib/auth/guards'
import { forbiddenWordsInTileLabel } from '@/lib/portal/roadmap'
import { checkbox, optionalText, zodFieldErrors as fieldErrors } from '@/lib/form-values'

/**
 * The "Coming to your portal" tiles. BUILD_SPEC §13.1, §22 AC30.
 *
 * §13.1: *"Configurable by the owner: tiles can be added, renamed, hidden, or
 * switched from 'in development' to live as features ship."*
 *
 * The tiles have existed since WP8 and this surface has not, so half of AC30
 * has been unmet all along. `forbiddenWordsInTileLabel` was written in WP18 as
 * a gate ahead of this screen, and this is the screen it was waiting for.
 *
 * **The wording gate refuses at write time and names the word.** §13.1 is
 * unusually direct about why: *"Have the compliance approver look at this
 * section along with the email — it is the easiest place in the build to say
 * something unintended."* A label is free text an owner types onto a securities
 * offer page, so it is checked before it is stored, out loud, rather than
 * silently dropped at render. The read-time filter in `lib/portal/data.ts`
 * stays as the quieter second layer for anything that reached the table by some
 * other route.
 *
 * **Owner only.** §13.1 says "configurable by the owner", and the tiles sit on
 * the page an investor reads beside their own figures. Where the specification
 * names a role, that is the role.
 */

const TILES_PATH = '/admin/roadmap'
const PORTAL_PATH = '/portal'

const labelSchema = z
  .string()
  .trim()
  .min(2, 'A tile needs a name.')
  // §13.1: "names only", "short labels and no explanation". A long label is a
  // sentence, and a sentence on this section is where the trouble starts.
  .max(40, 'Keep it to a short name — §13.1 asks for names only, not explanations.')

function refuseForbiddenWords(label: string): ActionState | null {
  const found = forbiddenWordsInTileLabel(label)
  if (found.length === 0) return null

  return actionError(
    `That name cannot go on the portal: it contains ${found
      .map((word) => `“${word}”`)
      .join(', ')}. This section sits on a securities offer page, so §13.1 keeps it ` +
      'to tooling and communication — nothing that reads as a promise of returns, a ' +
      'valuation, liquidity, or a date.',
    { label: `Remove ${found.map((word) => `“${word}”`).join(', ')}.` },
  )
}

// ---------------------------------------------------------------------------

const addSchema = z.object({ label: labelSchema })

export async function addRoadmapTileAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const owner = await requireOwner()

  const parsed = addSchema.safeParse({ label: formData.get('label') })
  if (!parsed.success) {
    return actionError('That tile could not be added.', fieldErrors(parsed.error))
  }

  const refusal = refuseForbiddenWords(parsed.data.label)
  if (refusal) {
    await audit({
      actor: { kind: 'user', id: owner.id, label: owner.email },
      entityType: 'roadmap_tile',
      action: 'roadmap_tile.refused',
      metadata: { reason: 'FORBIDDEN_WORDING' },
    })
    return refusal
  }

  const existing = await db.select().from(roadmapTiles).orderBy(asc(roadmapTiles.sortOrder))

  if (existing.some((tile) => tile.label.toLowerCase() === parsed.data.label.toLowerCase())) {
    return actionError('There is already a tile with that name.', {
      label: 'Pick a different name.',
    })
  }

  // §13.1 wants "a small set". Ten is well past small and stops the section
  // from becoming a list of promises by accumulation.
  if (existing.length >= 10) {
    return actionError(
      'There are already ten tiles, which is past what §13.1 calls "a small set". ' +
        'Hide or remove one before adding another.',
    )
  }

  const nextOrder = existing.reduce((max, tile) => Math.max(max, tile.sortOrder), -1) + 1

  const [created] = await db
    .insert(roadmapTiles)
    .values({ label: parsed.data.label, sortOrder: nextOrder })
    .returning()

  await audit({
    actor: { kind: 'user', id: owner.id, label: owner.email },
    entityType: 'roadmap_tile',
    entityId: created!.id,
    action: 'roadmap_tile.added',
    metadata: { label: created!.label },
  })

  revalidatePath(TILES_PATH)
  revalidatePath(PORTAL_PATH)
  return actionOk('Added. It is marked as in development until you switch it to live.')
}

// ---------------------------------------------------------------------------

const updateSchema = z.object({
  tileId: z.string().min(1),
  label: labelSchema,
  isLive: z.boolean(),
  hidden: z.boolean(),
})

export async function updateRoadmapTileAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const owner = await requireOwner()

  const parsed = updateSchema.safeParse({
    tileId: optionalText(formData.get('tileId')),
    label: formData.get('label'),
    isLive: checkbox(formData.get('isLive')),
    hidden: checkbox(formData.get('hidden')),
  })

  if (!parsed.success) {
    return actionError('That tile could not be saved.', fieldErrors(parsed.error))
  }

  const refusal = refuseForbiddenWords(parsed.data.label)
  if (refusal) {
    await audit({
      actor: { kind: 'user', id: owner.id, label: owner.email },
      entityType: 'roadmap_tile',
      entityId: parsed.data.tileId,
      action: 'roadmap_tile.refused',
      metadata: { reason: 'FORBIDDEN_WORDING' },
    })
    return refusal
  }

  const before = await db.query.roadmapTiles.findFirst({
    where: eq(roadmapTiles.id, parsed.data.tileId),
  })
  if (!before) return actionError('That tile no longer exists.')

  await db
    .update(roadmapTiles)
    .set({
      label: parsed.data.label,
      isLive: parsed.data.isLive,
      hidden: parsed.data.hidden,
    })
    .where(eq(roadmapTiles.id, parsed.data.tileId))

  await audit({
    actor: { kind: 'user', id: owner.id, label: owner.email },
    entityType: 'roadmap_tile',
    entityId: parsed.data.tileId,
    action: 'roadmap_tile.updated',
    metadata: {
      fromLabel: before.label,
      toLabel: parsed.data.label,
      isLive: parsed.data.isLive,
      hidden: parsed.data.hidden,
    },
  })

  revalidatePath(TILES_PATH)
  revalidatePath(PORTAL_PATH)
  return actionOk('Saved.')
}

// ---------------------------------------------------------------------------

/**
 * Removes a tile outright.
 *
 * Hiding is the ordinary way to take one off the portal — it keeps the row and
 * is reversible with one click. Removal exists for a tile added by mistake, and
 * is audited with the label so the log still says what was there.
 */
export async function removeRoadmapTileAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const owner = await requireOwner()

  const tileId = optionalText(formData.get('tileId'))
  if (!tileId) return actionError('That tile could not be removed.')

  const [removed] = await db
    .delete(roadmapTiles)
    .where(eq(roadmapTiles.id, tileId))
    .returning()

  if (!removed) return actionError('That tile no longer exists.')

  await audit({
    actor: { kind: 'user', id: owner.id, label: owner.email },
    entityType: 'roadmap_tile',
    entityId: tileId,
    action: 'roadmap_tile.removed',
    metadata: { label: removed.label },
  })

  revalidatePath(TILES_PATH)
  revalidatePath(PORTAL_PATH)
  return actionOk('Removed.')
}
