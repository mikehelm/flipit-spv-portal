import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { mediaAssets } from '@/db/schema'
import { isImageFormat } from '@/lib/media/formats'
import { isValidStorageKey, mediaStore } from '@/lib/media/store'

export const dynamic = 'force-dynamic'

/**
 * Serving a library image. BUILD_SPEC §13.2: *"served from the app's own
 * domain — never hot-linked from elsewhere."*
 *
 * **This route has no session check, and that is a decision rather than an
 * oversight.** §13.2 says the library is reusable "across the portal, the
 * email templates, and §13.1's roadmap tiles", and an email client fetching an
 * image carries no cookie — there is no session to check. A logo that only
 * loads for somebody already signed in is a logo that never appears in an
 * email.
 *
 * What makes that safe is what is on the other end of the URL, and it is worth
 * being explicit about all four parts:
 *
 *   1. **Nothing in this library belongs to an investor.** These are brand
 *      assets. There is no column associating an asset with an account and no
 *      code path that creates one; `media-boundary.test.ts` asserts that as an
 *      absence, because "we would never do that" is not a control.
 *   2. **The key is the capability.** Twenty-four random bytes. The library is
 *      not enumerable from one URL, and ids are never in the path.
 *   3. **The row is the authority on the type.** The content type served is the
 *      one sniffed from the file's own bytes at upload, and this route refuses
 *      to serve anything the row does not call an image — so a video or an
 *      unexpected type on a row cannot be served from here at all.
 *   4. **`nosniff`, and never indexed.** The catch-all in `next.config.ts`
 *      already covers both; they are restated here because a header this route
 *      depends on should be visible in the file that depends on it.
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ storageKey: string }> },
) {
  const notFound = new Response('Not found', {
    status: 404,
    headers: { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' },
  })

  const { storageKey } = await context.params

  // Checked before anything is looked up, so a key shaped like a path never
  // reaches a store that would turn it into one.
  if (!isValidStorageKey(storageKey)) return notFound

  const asset = await db.query.mediaAssets.findFirst({
    where: eq(mediaAssets.storageKey, storageKey),
  })
  if (!asset) return notFound

  // A row is not a promise. If it does not say "image", this route does not
  // serve it, whatever the file behind it turns out to be.
  if (!isImageFormat(asset.contentType)) return notFound

  const store = mediaStore()
  if (!store) return notFound

  const object = await store.get(storageKey)
  if (!object) return notFound

  return new Response(new Uint8Array(object.bytes), {
    status: 200,
    headers: {
      'Content-Type': asset.contentType,
      'Content-Length': String(object.bytes.length),
      // The key is unique per upload and its bytes never change, so this can
      // be cached hard. Removing an asset removes the row, and the URL 404s.
      'Cache-Control': 'public, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
      'X-Robots-Tag': 'noindex, nofollow, noarchive, nosnippet',
    },
  })
}
