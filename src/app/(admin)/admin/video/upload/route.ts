import { revalidatePath } from 'next/cache'
import { db } from '@/db'
import { operatorVideos } from '@/db/schema'
import { audit } from '@/lib/audit'
import { currentAdmin } from '@/lib/auth/guards'
import { evaluateAllowlist } from '@/lib/auth/sign-in-policy'
import { MAX_VIDEO_BYTES } from '@/lib/media/formats'
import { ingest } from '@/lib/media/ingest'
import { stripsMetadata } from '@/lib/media/strip'
import { currentVideo, deleteVideo } from '@/lib/media/video-store'

export const dynamic = 'force-dynamic'

/**
 * Receiving David's video — recorded in the browser or picked off his phone.
 * BUILD_SPEC §13.3: *"Two ways in: record directly in the browser via webcam,
 * or upload a file shot on his phone. Both land in the same place."*
 *
 * A route handler rather than a server action, for two reasons that are both
 * about size: a server action's request body is capped well below what a video
 * needs, and the browser recorder produces a `Blob` that has to be posted by
 * client-side code regardless. Both paths POST here, so "both land in the same
 * place" is literally true — there is one ingest, one gate and one row.
 *
 * **Guarded exactly as the server actions are.** A route handler is a public
 * endpoint that happens to sit under an admin path; the path grants nothing.
 * The role is resolved from the allowlist on this request, and a session
 * waiting on its second factor is not an administrator — `currentAdmin()`
 * returns null for one, so it fails closed here without knowing why.
 */
export async function POST(request: Request) {
  const admin = await currentAdmin()
  if (!admin) return json(401, 'Sign in again — that session is no longer valid.')

  // §13.3 is about David's own video. `requireOperator` redirects, which is
  // wrong for a fetch, so the same rule is applied and answered with a status.
  if (admin.role !== 'OPERATOR') {
    await audit({
      actor: { kind: 'user', id: admin.id, label: admin.email },
      entityType: 'access',
      entityId: admin.id,
      action: 'access.refused',
      metadata: { requiredRole: 'OPERATOR', actualRole: admin.role, surface: 'video.upload' },
    })
    return json(
      403,
      'The personal video is the operator’s own — only he can record, replace or publish it. ' +
        'You can watch the preview.',
    )
  }

  // Refuse on the declared length before a byte is read into memory. The
  // limit is enforced again by `inspect` on the actual bytes, because a
  // Content-Length is a claim.
  const declaredLength = Number(request.headers.get('content-length') ?? '0')
  if (Number.isFinite(declaredLength) && declaredLength > MAX_VIDEO_BYTES * 1.05) {
    return json(413, `That video is over the ${MAX_VIDEO_BYTES / (1024 * 1024)} MB limit.`)
  }

  let file: unknown
  try {
    file = (await request.formData()).get('file')
  } catch {
    return json(400, 'That upload did not arrive intact. Try again.')
  }

  if (!(file instanceof File) || file.size === 0) {
    return json(400, 'No video was attached.')
  }

  const bytes = new Uint8Array(await file.arrayBuffer())
  const result = await ingest('video', bytes, file.type)

  if (!result.ok) {
    await audit({
      actor: { kind: 'user', id: admin.id, label: admin.email },
      entityType: 'operator_video',
      action: 'video.refused',
      metadata: { reason: result.reason },
    })
    return json(result.reason === 'TOO_LARGE' ? 413 : 400, result.message)
  }

  // A replacement takes the previous one down with it. See `video-store.ts`
  // for why, and the screen says so before he presses anything.
  const existing = await currentVideo()
  if (existing) {
    try {
      await deleteVideo(existing)
    } catch {
      // The new bytes are already in the store by this point, and this refuses
      // before the row that would name them is written — so the upload is
      // abandoned rather than half accepted. What is left behind is an object
      // no record points at, which `pnpm media:check` lists as an orphan and a
      // person can delete. The alternative is two videos in the store, a row
      // naming the new one, and the old one unreachable for ever.
      await audit({
        actor: { kind: 'user', id: admin.id, label: admin.email },
        entityType: 'operator_video',
        entityId: existing.id,
        action: 'video.refused',
        metadata: { reason: 'PREVIOUS_NOT_DELETED' },
      })
      return json(
        500,
        'The video already there could not be deleted from the store, so this one has not ' +
          'replaced it and nothing has changed on the portal. The server log says what the ' +
          'store refused over.',
      )
    }
  }

  const [created] = await db
    .insert(operatorVideos)
    .values({
      ownerId: admin.id,
      storageKey: result.storageKey,
      contentType: result.format,
      sizeBytes: result.sizeBytes,
      // Deliberately null. §13.3: nothing is visible to investors until he
      // explicitly publishes it, and that includes a replacement for something
      // that was published a moment ago.
      publishedAt: null,
      // Carried over so a re-record does not silently lose the transcript
      // somebody typed out by hand.
      caption: existing?.caption ?? null,
      transcript: existing?.transcript ?? null,
    })
    .returning()

  await audit({
    actor: { kind: 'user', id: admin.id, label: admin.email },
    entityType: 'operator_video',
    entityId: created!.id,
    action: 'video.uploaded',
    metadata: {
      contentType: result.format,
      sizeBytes: result.sizeBytes,
      replacedPrevious: existing !== null,
      previousWasPublished: existing?.publishedAt !== null && existing !== null,
      metadataStripped: stripsMetadata(result.format),
    },
  })

  revalidatePath('/admin/video')
  revalidatePath('/portal')

  return Response.json(
    {
      ok: true,
      videoId: created!.id,
      message: stripsMetadata(result.format)
        ? 'Uploaded. Location and device metadata were removed before it was stored. Watch the preview, then publish.'
        : 'Uploaded. Watch the preview, then publish.',
    },
    { status: 200, headers: { 'Cache-Control': 'no-store' } },
  )
}

function json(status: number, message: string) {
  return Response.json({ ok: false, message }, { status, headers: { 'Cache-Control': 'no-store' } })
}

// Referenced so the allowlist module is the one authority on roles even here;
// see `guards.ts`. Kept as an explicit import rather than a comment so that a
// change to the allowlist's shape breaks this file too.
void evaluateAllowlist
