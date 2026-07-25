import { readServiceConfig } from '@/lib/auth/service-config'
import { canView, portalAccess, type AccountStatus } from '@/lib/portal/access'
import { readInvestorAccount } from '@/lib/portal/session'
import { mediaStore } from '@/lib/media/store'
import { mayViewVideo } from '@/lib/media/video'
import { videoById } from '@/lib/media/video-store'

export const dynamic = 'force-dynamic'

/**
 * Serving David's video to a signed-in investor. BUILD_SPEC §13.3.
 *
 * *"Video is hosted on the app's own domain, served only to authenticated
 * investors, and never indexed."*
 *
 * The three refusals — no session, not published, portal not readable — all
 * produce the **same 404 as an id that does not exist**. Not a 403, and not a
 * different 404. A response that distinguishes "there is a video and you may
 * not have it" from "there is no video" is a response that answers a question
 * nobody signed in is entitled to ask.
 *
 * Range requests are not supported, deliberately. A browser will download the
 * whole file and play it, which for a short personal video is fine, and a
 * hand-written range parser on a route that reads bytes off a store is a place
 * to get an off-by-one wrong. If seeking in a long video ever matters, that is
 * the moment for a real object store with range support behind it, not for
 * arithmetic here.
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ videoId: string }> },
) {
  const notFound = new Response('Not found', {
    status: 404,
    headers: { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' },
  })

  const account = await readInvestorAccount()
  if (!account) return notFound

  const config = await readServiceConfig()
  const access = portalAccess({
    accountStatus: account.status as AccountStatus,
    closedAccountAccess: config.closedAccountAccess,
    serviceMode: config.serviceMode,
  })

  const { videoId } = await context.params
  const video = await videoById(videoId)
  if (!video) return notFound

  const allowed = mayViewVideo({
    audience: 'INVESTOR',
    publishedAt: video.publishedAt,
    portalReadable: canView(access),
  })
  if (!allowed) return notFound

  const store = mediaStore()
  if (!store) return notFound

  const object = await store.get(video.storageKey)
  if (!object) return notFound

  return new Response(new Uint8Array(object.bytes), {
    status: 200,
    headers: {
      // The stored content type, sniffed from the file's own bytes at upload.
      // Never a value that came from a browser.
      'Content-Type': video.contentType,
      'Content-Length': String(object.bytes.length),
      'Content-Disposition': 'inline',
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
      'X-Robots-Tag': 'noindex, nofollow, noarchive, nosnippet',
    },
  })
}
