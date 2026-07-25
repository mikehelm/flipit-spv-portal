import { audit } from '@/lib/audit'
import { readServiceConfig } from '@/lib/auth/service-config'
import { mayDownloadDocument } from '@/lib/documents/access'
import { documentWithOwner } from '@/lib/documents/data'
import { mediaStore } from '@/lib/media/store'
import { canView, portalAccess, type AccountStatus } from '@/lib/portal/access'
import { readInvestorAccount } from '@/lib/portal/session'

export const dynamic = 'force-dynamic'

/**
 * An investor downloading their own document package. BUILD_SPEC §5, §7, §13.
 *
 * Built in the same shape as the participation certificate route, and for the
 * same reasons: the account comes from the session, the document is looked up
 * with the offer it belongs to, and **the response for a document that exists
 * but is not theirs is byte-identical to the one for a document that does not
 * exist** (§15). There is no 403 here.
 *
 * §7 is why this stays reachable in more states than most things: *"Investors
 * must be able to download their own records (offer, correspondence, status
 * history, documents) while in `read_only` or `sunset`."* `canView` is already
 * true in both, so this needs no exception — which is the point of asking it
 * rather than reimplementing the rule.
 *
 * The download is audited. §16 wants the trail of what an investor was given
 * and when they took it; the entry records the document id and its title, and
 * never a byte of the file.
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ documentId: string }> },
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

  const { documentId } = await context.params
  const document = await documentWithOwner(documentId)
  if (!document) return notFound

  const allowed = mayDownloadDocument({
    audience: 'INVESTOR',
    issuedAt: document.issuedAt,
    belongsToRequester: document.accountId === account.id,
    portalReadable: canView(access),
  })
  if (!allowed) return notFound

  const store = mediaStore()
  if (!store) return notFound

  const object = await store.get(document.storageKey)
  if (!object) return notFound

  await audit({
    actor: { kind: 'investor', id: account.id, label: 'investor' },
    entityType: 'document_package',
    entityId: document.id,
    action: 'document.downloaded',
    metadata: { offerId: document.offerId, title: document.title },
  })

  return new Response(new Uint8Array(object.bytes), {
    status: 200,
    headers: {
      'Content-Type': document.contentType,
      'Content-Length': String(object.bytes.length),
      'Content-Disposition': `attachment; filename="${safeFilename(document.title)}"`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
      'X-Robots-Tag': 'noindex, nofollow, noarchive, nosnippet',
    },
  })
}

/**
 * A filename built from the title, with everything that is not a letter, a
 * digit, a space or a dash removed.
 *
 * A `Content-Disposition` filename goes into a header, and a title is free
 * text the operator typed. A quote or a newline in one is a header injection,
 * and stripping is safer than escaping because there is no case here where the
 * exact original characters matter.
 */
function safeFilename(title: string): string {
  const cleaned = title.replace(/[^A-Za-z0-9 \-_]/g, '').trim().slice(0, 80)
  return `${cleaned === '' ? 'document' : cleaned}.pdf`
}
