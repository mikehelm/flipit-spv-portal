'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { actionError, actionOk, type ActionState } from '@/components/admin/action-state'
import { audit } from '@/lib/audit'
import { currentAdmin, requireOwner } from '@/lib/auth/guards'
import {
  createTile,
  moveTile,
  renameTile,
  setTileHidden,
  setTileLive,
} from '@/lib/portal/roadmap-tiles'

/**
 * The "Coming to your portal" tiles. BUILD_SPEC §13.1, §22 AC30.
 *
 * Owner-only, and not because the operator cannot be trusted with a word: this
 * copy sits on a securities offer page, §13.1 calls it *"the easiest place in
 * the build to say something unintended"*, and it asks the compliance approver
 * to review it alongside the email. Whoever answers for that wording is the
 * owner, so the owner is who writes it.
 *
 * Every mutation goes through `requireOwner()` on the server. A refused attempt
 * is logged, in the shape `actions/compliance.ts` established — an attempt to
 * edit investor-facing copy is worth knowing about even when it failed.
 */

const ROADMAP_PATH = '/admin/roadmap'
const PORTAL_PATH = '/portal'

const tileIdSchema = z.string().trim().min(1)

/** Logs the refusal and returns the operator's message. Owner-only, §13.1. */
async function refuse(action: string): Promise<ActionState> {
  const admin = await currentAdmin()

  await audit({
    actor: admin
      ? { kind: 'user', id: admin.id, label: admin.email }
      : { kind: 'system', label: 'unauthenticated' },
    entityType: 'roadmap_tile',
    action: 'roadmap_tile.refused',
    // The key names are `actions/compliance.ts`'s, deliberately: one audit
    // query should find every refused privileged action, not one per module.
    metadata: {
      attemptedAction: action,
      refusalReason: admin ? 'NOT_OWNER' : 'NOT_SIGNED_IN',
      actorRole: admin?.role ?? null,
      requiredRole: 'OWNER',
    },
  })

  return actionError(
    admin
      ? 'The portal roadmap is the owner’s to edit. §13.1 puts this copy in front of the compliance approver alongside the email, so it stays with whoever answers for it.'
      : 'You are not signed in.',
  )
}

/** Every action shares this: owner or nothing, and the refusal is recorded. */
async function asOwner(
  action: string,
  run: (actor: { kind: 'user'; id: string; label: string }) => Promise<ActionState>,
): Promise<ActionState> {
  const admin = await currentAdmin()
  if (!admin || admin.role !== 'OWNER') return refuse(action)

  const owner = await requireOwner()
  const result = await run({ kind: 'user', id: owner.id, label: owner.email })

  revalidatePath(ROADMAP_PATH)
  revalidatePath(PORTAL_PATH)
  return result
}

export async function createTileAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return asOwner('create', async (actor) => {
    const label = typeof formData.get('label') === 'string' ? String(formData.get('label')) : ''
    const result = await createTile({ actor, label })

    return result.ok
      ? actionOk(
          'Tile added, in development. It appears on every investor portal in the order shown here.',
        )
      : actionError(result.message, { label: result.message })
  })
}

export async function renameTileAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return asOwner('rename', async (actor) => {
    const tileId = tileIdSchema.safeParse(formData.get('tileId'))
    if (!tileId.success) return actionError('That tile could not be identified.')

    const label = typeof formData.get('label') === 'string' ? String(formData.get('label')) : ''
    const result = await renameTile({ actor, tileId: tileId.data, label })

    return result.ok
      ? actionOk('Renamed. Every investor sees the new label immediately.')
      : actionError(result.message, { label: result.message })
  })
}

export async function setTileHiddenAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return asOwner('hide', async (actor) => {
    const tileId = tileIdSchema.safeParse(formData.get('tileId'))
    if (!tileId.success) return actionError('That tile could not be identified.')

    const hidden = formData.get('hidden') === 'true'
    const result = await setTileHidden({ actor, tileId: tileId.data, hidden })

    if (!result.ok) return actionError(result.message)
    return actionOk(
      hidden
        ? 'Hidden. The tile is kept rather than deleted, so the log still answers what the portal showed on a given day.'
        : 'Shown again on every investor portal.',
    )
  })
}

export async function setTileLiveAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return asOwner('set live', async (actor) => {
    const tileId = tileIdSchema.safeParse(formData.get('tileId'))
    if (!tileId.success) return actionError('That tile could not be identified.')

    const isLive = formData.get('isLive') === 'true'
    const result = await setTileLive({ actor, tileId: tileId.data, isLive })

    if (!result.ok) return actionError(result.message)
    return actionOk(
      isLive
        ? 'Marked available. The standing line beneath the tiles stays either way — it is not configurable.'
        : 'Back to in development.',
    )
  })
}

export async function moveTileAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return asOwner('reorder', async (actor) => {
    const tileId = tileIdSchema.safeParse(formData.get('tileId'))
    if (!tileId.success) return actionError('That tile could not be identified.')

    const direction = formData.get('direction') === 'up' ? 'up' : 'down'
    const result = await moveTile({ actor, tileId: tileId.data, direction })

    return result.ok ? actionOk('Order saved.') : actionError(result.message)
  })
}
