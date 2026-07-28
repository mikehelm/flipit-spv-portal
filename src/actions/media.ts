'use server'

import { desc, eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { actionError, actionOk, type ActionState } from '@/components/admin/action-state'
import { db } from '@/db'
import { mediaAssets } from '@/db/schema'
import { audit } from '@/lib/audit'
import { requireOnboardedAdmin } from '@/lib/auth/guards'
import { optionalText, requiredText, zodFieldErrors as fieldErrors } from '@/lib/form-values'
import { ingest } from '@/lib/media/ingest'
import { readDimensions } from '@/lib/media/dimensions'
import { isImageFormat } from '@/lib/media/formats'
import { mediaStore } from '@/lib/media/store'

/**
 * The admin media library. BUILD_SPEC §13.2.
 *
 * *"Owner and operator can upload images … Stored with a name and description,
 * re-usable across the portal, the email templates, and §13.1's roadmap tiles
 * … Size and type limits, stripped of EXIF, served from the app's own domain —
 * never hot-linked from elsewhere. Uploading an image is audit-logged."*
 *
 * **Both roles, deliberately.** §13.2 names them both, and it is the one place
 * in this application where it does. The library holds brand assets — a logo,
 * a header image, a headshot — and nothing in it belongs to an investor. There
 * is no per-investor image and no code path that associates one with an
 * account; `media-boundary.test.ts` asserts that as an absence rather than
 * trusting it as a convention.
 *
 * **Every byte goes through `ingest`.** The type is decided from the file's own
 * leading bytes, the metadata is removed before anything is written, and the
 * size limit is checked first. None of that is repeated here, and there is no
 * second way in.
 */

const LIBRARY_PATH = '/admin/media'

const detailsSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, 'Give it a name you will recognise in a list.')
    .max(80, 'Keep the name short — the description is where the detail goes.'),
  description: z.string().trim().max(400, 'Keep the description under 400 characters.').nullable(),
})

export async function uploadMediaAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const admin = await requireOnboardedAdmin()

  const parsed = detailsSchema.safeParse({
    name: requiredText(formData.get('name')),
    description: optionalText(formData.get('description')),
  })
  if (!parsed.success) {
    return actionError('That image was not uploaded.', fieldErrors(parsed.error))
  }

  const file = formData.get('file')
  if (!(file instanceof File) || file.size === 0) {
    return actionError('Choose an image file first.', { file: 'No file was attached.' })
  }

  const bytes = new Uint8Array(await file.arrayBuffer())
  const result = await ingest('image', bytes, file.type)

  if (!result.ok) {
    // A refused upload is recorded, with the reason and never the filename —
    // a filename is free text somebody typed and it is not worth the risk of
    // it carrying something that does not belong in the log.
    await audit({
      actor: { kind: 'user', id: admin.id, label: admin.email },
      entityType: 'media_asset',
      action: 'media.refused',
      metadata: { reason: result.reason },
    })
    return actionError(result.message)
  }

  const dimensions = isImageFormat(result.format)
    ? readDimensions(result.format, result.stored)
    : null

  const [created] = await db
    .insert(mediaAssets)
    .values({
      name: parsed.data.name,
      description: parsed.data.description,
      storageKey: result.storageKey,
      contentType: result.format,
      sizeBytes: result.sizeBytes,
      width: dimensions?.width ?? null,
      height: dimensions?.height ?? null,
      uploadedById: admin.id,
    })
    .returning()

  await audit({
    actor: { kind: 'user', id: admin.id, label: admin.email },
    entityType: 'media_asset',
    entityId: created!.id,
    action: 'media.uploaded',
    metadata: {
      name: created!.name,
      contentType: result.format,
      sizeBytes: result.sizeBytes,
      metadataBytesRemoved: result.strippedBytes,
    },
  })

  revalidatePath(LIBRARY_PATH)

  return actionOk(
    result.strippedBytes > 0
      ? `Uploaded. ${result.strippedBytes} bytes of embedded metadata were removed before it was stored.`
      : 'Uploaded. It carried no embedded metadata.',
  )
}

// ---------------------------------------------------------------------------

export async function updateMediaDetailsAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const admin = await requireOnboardedAdmin()

  const assetId = optionalText(formData.get('assetId'))
  if (!assetId) return actionError('That image could not be saved.')

  const parsed = detailsSchema.safeParse({
    name: requiredText(formData.get('name')),
    description: optionalText(formData.get('description')),
  })
  if (!parsed.success) {
    return actionError('That image could not be saved.', fieldErrors(parsed.error))
  }

  const before = await db.query.mediaAssets.findFirst({ where: eq(mediaAssets.id, assetId) })
  if (!before) return actionError('That image no longer exists.')

  await db
    .update(mediaAssets)
    .set({ name: parsed.data.name, description: parsed.data.description })
    .where(eq(mediaAssets.id, assetId))

  await audit({
    actor: { kind: 'user', id: admin.id, label: admin.email },
    entityType: 'media_asset',
    entityId: assetId,
    action: 'media.updated',
    metadata: { fromName: before.name, toName: parsed.data.name },
  })

  revalidatePath(LIBRARY_PATH)
  return actionOk('Saved.')
}

// ---------------------------------------------------------------------------

/**
 * Removing an image.
 *
 * The row goes and the stored bytes go with it. There is no soft delete: an
 * image is a brand asset with no history worth keeping, and a "deleted" file
 * still sitting behind a live URL is the opposite of what somebody pressing
 * this button is asking for.
 *
 * The bytes are removed first. If that fails the row stays, and the operator
 * sees a failure rather than a library entry pointing at nothing.
 */
export async function removeMediaAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const admin = await requireOnboardedAdmin()

  const assetId = optionalText(formData.get('assetId'))
  if (!assetId) return actionError('That image could not be removed.')

  const asset = await db.query.mediaAssets.findFirst({ where: eq(mediaAssets.id, assetId) })
  if (!asset) return actionError('That image no longer exists.')

  const store = mediaStore()
  if (store) {
    try {
      await store.remove(asset.storageKey)
    } catch {
      // The promise in this function's own comment, kept. Until the filesystem
      // store stopped swallowing its own failures this branch was unreachable
      // there, so the row always went whatever happened to the bytes.
      //
      // No detail in the message: the store's error names an errno, the server
      // log has it, and a library screen is not where a filesystem path or a
      // storage key belongs.
      return actionError(
        'The stored file could not be deleted, so the image has been kept rather than left as ' +
          'a library entry pointing at nothing. The server log says what the store refused ' +
          'over. Try again once that is fixed.',
      )
    }
  }

  await db.delete(mediaAssets).where(eq(mediaAssets.id, assetId))

  await audit({
    actor: { kind: 'user', id: admin.id, label: admin.email },
    entityType: 'media_asset',
    entityId: assetId,
    action: 'media.removed',
    metadata: { name: asset.name },
  })

  revalidatePath(LIBRARY_PATH)
  return actionOk('Removed, along with the stored file.')
}

// ---------------------------------------------------------------------------

export interface MediaListItem {
  id: string
  name: string
  description: string | null
  storageKey: string
  contentType: string
  sizeBytes: number
  width: number | null
  height: number | null
  createdAt: Date
}

/** The library, newest first. Read by the admin screen only. */
export async function listMedia(): Promise<MediaListItem[]> {
  return db.select().from(mediaAssets).orderBy(desc(mediaAssets.createdAt))
}
