import { readServiceConfig } from '@/lib/auth/service-config'
import { canView, portalAccess, type AccountStatus } from '@/lib/portal/access'
import { readInvestorAccount } from '@/lib/portal/session'
import { serveMedia } from '@/lib/media/serve'
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
 * **Range requests are supported**, which they were not, and the comment that
 * used to sit here said why not: a hand-written range parser is a place to get
 * an off-by-one wrong. It is — but it turned out to be load-bearing rather than
 * a nicety. Safari opens a video with `Range: bytes=0-1` and gives up on a
 * server that answers 200 with the whole body, so the personal video did not
 * play on an iPhone at all. The parser lives in `lib/media/ranges.ts`, pure and
 * tested on its own, and the response is built in `lib/media/serve.ts` once for
 * both routes rather than twice.
 */
export async function GET(
  request: Request,
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
