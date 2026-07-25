import { currentAdmin } from '@/lib/auth/guards'
import { serveMedia } from '@/lib/media/serve'
import { mediaStore } from '@/lib/media/store'
import { mayViewVideo } from '@/lib/media/video'
import { videoById } from '@/lib/media/video-store'

export const dynamic = 'force-dynamic'

/**
 * The operator's own preview. BUILD_SPEC §13.3: *"He sees it before anyone
 * else does. Preview in the real portal layout."*
 *
 * The same bytes as the investor route serves, behind the administrator guard
 * instead of the investor one. The owner may watch too — he is accountable for
 * what appears on a page beside somebody's investment figures — and, as
 * everywhere else in §13.3, he may not record, replace, publish or delete one.
 *
 * `currentAdmin()` rather than `requireAdmin()`, because a redirect to a
 * sign-in page is the wrong answer to a `<video>` element's request. The rule
 * is the same; the response is a status.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ videoId: string }> },
) {
  const notFound = new Response('Not found', {
    status: 404,
    headers: { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' },
  })

  const admin = await currentAdmin()
  if (!admin) return notFound

  const { videoId } = await context.params
  const video = await videoById(videoId)
  if (!video) return notFound

  // Stated rather than assumed, so this route is bound by the same function
  // the portal route is bound by and cannot drift away from it.
  if (!mayViewVideo({ audience: 'ADMIN', publishedAt: video.publishedAt, portalReadable: true })) {
    return notFound
  }

  const store = mediaStore()
  if (!store) return notFound

  // One place builds the response, for both routes, so a range calculation
  // cannot be right here and wrong in the other one. The content type is the
  // sniffed one on the row — never a value that came from a browser.
  return serveMedia({
    request,
    store,
    storageKey: video.storageKey,
    contentType: video.contentType,
    sizeBytes: video.sizeBytes,
    notFound,
  })
}
