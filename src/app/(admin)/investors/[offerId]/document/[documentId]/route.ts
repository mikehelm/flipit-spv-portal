import { currentIdentity } from '@/lib/auth/guards'
import { mayDownloadDocument } from '@/lib/documents/access'
import { documentWithOwner } from '@/lib/documents/data'
import { mediaStore } from '@/lib/media/store'

export const dynamic = 'force-dynamic'

/**
 * The operator opening a document before he issues it. BUILD_SPEC §5.
 *
 * There is no point asking somebody to confirm they have checked a file if
 * they have no way to open it, so this is the other half of the confirmation
 * on `issueDocumentAction`.
 *
 * `currentIdentity()` rather than `requireReader()`, because a redirect to a
 * sign-in page is the wrong answer to a link that is downloading a file. The
 * rule is the same; the response is a status.
 *
 * `currentIdentity()` rather than `currentAdmin()` because reading a document
 * is a read, and a read-only administrator is entitled to it — §20's scope
 * names documents. This is one of the few places that deliberately wants the
 * wider question, and it is safe to want it here precisely because the whole
 * handler is a GET that returns bytes and writes nothing. The `offerId` in the path is
 * there so the URL reads as what it is and is checked against the row — a
 * mismatch is a 404 like anything else.
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ offerId: string; documentId: string }> },
) {
  const notFound = new Response('Not found', {
    status: 404,
    headers: { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' },
  })

  const admin = await currentIdentity()
  if (!admin) return notFound

  const { offerId, documentId } = await context.params
  const document = await documentWithOwner(documentId)
  if (!document || document.offerId !== offerId) return notFound

  if (
    !mayDownloadDocument({
      audience: 'ADMIN',
      issuedAt: document.issuedAt,
      belongsToRequester: true,
      portalReadable: true,
    })
  ) {
    return notFound
  }

  const store = mediaStore()
  if (!store) return notFound

  // Opened rather than read, exactly as the investor's route does it. The
  // operator's copy of a document is the same twenty megabytes.
  const opened = await store.openStream(document.storageKey)
  if (!opened) return notFound

  return new Response(opened.stream, {
    status: 200,
    headers: {
      'Content-Type': document.contentType,
      'Content-Length': String(opened.length),
      'Content-Disposition': 'inline',
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
      'X-Robots-Tag': 'noindex, nofollow, noarchive, nosnippet',
    },
  })
}
