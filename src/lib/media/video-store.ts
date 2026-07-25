/**
 * Reading and replacing the operator's video. BUILD_SPEC §13.3.
 *
 * **There is at most one.** §13.3 describes "a short personal video" and asks
 * for the ability to "re-record or replace as many times as he likes" — which
 * is one video with a history of nothing, not a library. Keeping one row means
 * "is there a video, and is it published" is a single question with a single
 * answer, and the portal never has to decide which of two to show.
 *
 * **A replacement always arrives unpublished, and replacing a published video
 * takes it down.** This is the conservative reading of §13.3's "he sees it
 * before anyone else does". The alternative — swapping the bytes underneath a
 * published record — would put a video in front of investors that the operator
 * had not previewed in place, which is the one thing that sentence forbids.
 * The screen says so before he uploads, in as many words.
 */

import { desc, eq } from 'drizzle-orm'
import { db } from '@/db'
import { operatorVideos } from '@/db/schema'
import { mediaStore } from './store'

export interface OperatorVideo {
  id: string
  ownerId: string
  storageKey: string
  contentType: string
  sizeBytes: number
  caption: string | null
  transcript: string | null
  publishedAt: Date | null
  createdAt: Date
  updatedAt: Date
}

/**
 * The current video, or null.
 *
 * Ordered newest-first and limited to one so that a row left behind by a
 * failure part-way through a replacement cannot become the one the portal
 * shows. The invariant is "at most one"; the query does not depend on it.
 */
export async function currentVideo(): Promise<OperatorVideo | null> {
  const rows = await db
    .select()
    .from(operatorVideos)
    .orderBy(desc(operatorVideos.createdAt))
    .limit(1)

  return rows[0] ?? null
}

export async function videoById(videoId: string): Promise<OperatorVideo | null> {
  const row = await db.query.operatorVideos.findFirst({
    where: eq(operatorVideos.id, videoId),
  })
  return row ?? null
}

/**
 * Delete a video row and the bytes behind it.
 *
 * Bytes first. A row pointing at a file that is gone renders a broken player;
 * a file with no row is unreachable, because every route looks the key up on a
 * row before it reads anything. Of the two halves to leave behind, the
 * orphaned file is the harmless one.
 */
export async function deleteVideo(video: Pick<OperatorVideo, 'id' | 'storageKey'>): Promise<void> {
  const store = mediaStore()
  if (store) await store.remove(video.storageKey)
  await db.delete(operatorVideos).where(eq(operatorVideos.id, video.id))
}
