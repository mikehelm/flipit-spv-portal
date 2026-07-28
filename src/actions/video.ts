'use server'

import { eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { actionError, actionOk, type ActionState } from '@/components/admin/action-state'
import { db } from '@/db'
import { operatorVideos } from '@/db/schema'
import { audit } from '@/lib/audit'
import { requireOperator } from '@/lib/auth/guards'
import { optionalText, zodFieldErrors as fieldErrors } from '@/lib/form-values'
import { currentVideo, deleteVideo, videoById } from '@/lib/media/video-store'

/**
 * David's personal video. BUILD_SPEC §13.3.
 *
 * **Every write here is `requireOperator`, not `requireAdmin`.** §13.3 is
 * written in the second person about one person — *"He sees it before anyone
 * else does … nothing is visible to investors until he explicitly publishes
 * it … The whole feature is optional and removable"* — and a video of David
 * speaking is not a record the owner administers. The owner can watch the
 * preview, because he is accountable for what goes on a securities page, and
 * he cannot record, replace, publish or delete one. Where the specification
 * names a person, that is the person.
 *
 * The upload itself is not here: sixty-four megabytes does not belong in a
 * server action's request body, and the browser recorder needs client-side
 * code anyway. It is a route handler at `/admin/video/upload`, behind the same
 * guard.
 */

const VIDEO_PATH = '/admin/video'
const PORTAL_PATH = '/portal'

const textSchema = z.object({
  caption: z
    .string()
    .trim()
    .max(160, 'A caption is one line. Put the detail in the transcript.')
    .nullable(),
  transcript: z
    .string()
    .trim()
    .max(20_000, 'That is longer than a transcript of a short video should be.')
    .nullable(),
})

/**
 * The caption and transcript.
 *
 * §13.3: *"Include a caption/transcript field. Some recipients will open this
 * somewhere they cannot play sound."* So this is not metadata about the video
 * — for some readers it is the video, and it is editable while the video is
 * published rather than only before, because a transcript that cannot be
 * corrected without taking the video down would simply never be corrected.
 */
export async function updateVideoTextAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const operator = await requireOperator()

  const video = await currentVideo()
  if (!video) return actionError('There is no video to describe yet.')

  const parsed = textSchema.safeParse({
    caption: optionalText(formData.get('caption')),
    transcript: optionalText(formData.get('transcript')),
  })
  if (!parsed.success) {
    return actionError('That could not be saved.', fieldErrors(parsed.error))
  }

  await db
    .update(operatorVideos)
    .set({
      caption: parsed.data.caption,
      transcript: parsed.data.transcript,
      updatedAt: new Date(),
    })
    .where(eq(operatorVideos.id, video.id))

  await audit({
    actor: { kind: 'user', id: operator.id, label: operator.email },
    entityType: 'operator_video',
    entityId: video.id,
    action: 'video.text_updated',
    // Lengths, not the text. A transcript is an email body by another name and
    // §15 does not want one in the log.
    metadata: {
      captionLength: parsed.data.caption?.length ?? 0,
      transcriptLength: parsed.data.transcript?.length ?? 0,
    },
  })

  revalidatePath(VIDEO_PATH)
  revalidatePath(PORTAL_PATH)
  return actionOk('Saved.')
}

// ---------------------------------------------------------------------------

/**
 * Publishing. §13.3: *"nothing is visible to investors until he explicitly
 * publishes it"* — so this action exists for no other purpose, takes an
 * explicit confirmation, and is the only thing in the codebase that writes
 * `published_at` to a non-null value.
 */
export async function publishVideoAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const operator = await requireOperator()

  const video = await currentVideo()
  if (!video) return actionError('There is no video to publish yet.')

  if (formData.get('confirm') !== 'PUBLISH') {
    return actionError(
      'Publishing puts the video on every investor’s portal. Tick the confirmation to go ahead.',
      { confirm: 'Confirm you have watched the preview.' },
    )
  }

  if (video.publishedAt) return actionOk('It is already published.')

  const publishedAt = new Date()
  await db
    .update(operatorVideos)
    .set({ publishedAt, updatedAt: publishedAt })
    .where(eq(operatorVideos.id, video.id))

  await audit({
    actor: { kind: 'user', id: operator.id, label: operator.email },
    entityType: 'operator_video',
    entityId: video.id,
    action: 'video.published',
    metadata: { hasCaption: video.caption !== null, hasTranscript: video.transcript !== null },
  })

  revalidatePath(VIDEO_PATH)
  revalidatePath(PORTAL_PATH)
  return actionOk('Published. It is now on the portal for signed-in investors.')
}

/**
 * Unpublishing. §13.3 calls the feature "removable"; taking it down is the
 * reversible half of that and needs no confirmation, because the cautious
 * direction is off.
 */
export async function unpublishVideoAction(
  _previous: ActionState,
  _formData: FormData,
): Promise<ActionState> {
  const operator = await requireOperator()

  const video = await currentVideo()
  if (!video) return actionError('There is no video.')
  if (!video.publishedAt) return actionOk('It is not published.')

  await db
    .update(operatorVideos)
    .set({ publishedAt: null, updatedAt: new Date() })
    .where(eq(operatorVideos.id, video.id))

  await audit({
    actor: { kind: 'user', id: operator.id, label: operator.email },
    entityType: 'operator_video',
    entityId: video.id,
    action: 'video.unpublished',
  })

  revalidatePath(VIDEO_PATH)
  revalidatePath(PORTAL_PATH)
  return actionOk('Taken down. The portal shows no gap where it was.')
}

// ---------------------------------------------------------------------------

/**
 * Removing it altogether. §13.3: *"The whole feature is optional and
 * removable."*
 *
 * The row and the stored bytes both go. There is nothing to retain: unlike a
 * participation certificate, a video is not a record of anything that
 * happened to somebody's money.
 */
export async function removeVideoAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const operator = await requireOperator()

  const videoId = optionalText(formData.get('videoId'))
  const video = videoId ? await videoById(videoId) : await currentVideo()
  if (!video) return actionError('There is no video to remove.')

  try {
    await deleteVideo(video)
  } catch {
    // Bytes first, and the row only if they went. Same rule as the image
    // library and the documents panel; the store's own error names an errno
    // and goes to the server log rather than to this screen.
    return actionError(
      'The stored file could not be deleted, so the video has been kept rather than left ' +
        'in the store with nothing pointing at it. The server log says what the store ' +
        'refused over. Try again once that is fixed.',
    )
  }

  await audit({
    actor: { kind: 'user', id: operator.id, label: operator.email },
    entityType: 'operator_video',
    entityId: video.id,
    action: 'video.removed',
    metadata: { wasPublished: video.publishedAt !== null },
  })

  revalidatePath(VIDEO_PATH)
  revalidatePath(PORTAL_PATH)
  return actionOk('Removed, along with the stored file.')
}
