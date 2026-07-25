import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { investorAccounts, offers, participationCertificates } from '@/db/schema'
import { audit } from '@/lib/audit'
import { certificateFilename, renderCertificate } from '@/lib/certificate/issue'
import { readServiceConfig } from '@/lib/auth/service-config'
import { canView, portalAccess, type AccountStatus } from '@/lib/portal/access'
import { readInvestorAccount } from '@/lib/portal/session'

export const dynamic = 'force-dynamic'

/**
 * Downloading a participation certificate. BUILD_SPEC §5.1.
 *
 * *"Downloadable from their portal and attached to no email by default — it
 * lives where the rest of their record lives."*
 *
 * The account comes from the session and the certificate is looked up by
 * **both** its own id and the offer it belongs to, with the offer required to
 * belong to that account. A guessed certificate id finds nothing rather than
 * finding somebody else's document, and the response for a certificate that
 * exists but is not theirs is byte-identical to the one for a certificate that
 * does not exist (§15).
 *
 * Superseded versions stay downloadable. §5.1 says the superseded version is
 * retained on the record, and a record you cannot read is not retained.
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ certificateId: string }> },
) {
  const notFound = new Response('Not found', { status: 404 })

  const account = await readInvestorAccount()
  if (!account) return notFound

  const config = await readServiceConfig()
  const access = portalAccess({
    accountStatus: account.status as AccountStatus,
    closedAccountAccess: config.closedAccountAccess,
    serviceMode: config.serviceMode,
  })
  if (!canView(access)) return notFound

  const { certificateId } = await context.params

  const rows = await db
    .select({
      certificateId: participationCertificates.id,
      version: participationCertificates.version,
      offerId: offers.id,
      accountId: offers.accountId,
      investorName: investorAccounts.name,
    })
    .from(participationCertificates)
    .innerJoin(offers, eq(participationCertificates.offerId, offers.id))
    .innerJoin(investorAccounts, eq(offers.accountId, investorAccounts.id))
    .where(eq(participationCertificates.id, certificateId))
    .limit(1)

  const row = rows[0]
  // Same response for "does not exist" and "is not yours". Nothing here tells
  // a visitor that a document they cannot have is nonetheless real.
  if (!row || row.accountId !== account.id) return notFound

  const pdf = await renderCertificate({
    certificateId: row.certificateId,
    offerId: row.offerId,
  })
  if (!pdf) return notFound

  await audit({
    actor: { kind: 'investor', id: account.id, label: 'investor' },
    entityType: 'participation_certificate',
    entityId: row.certificateId,
    action: 'certificate.downloaded',
    metadata: { version: row.version },
  })

  return new Response(new Uint8Array(pdf), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${certificateFilename(row.investorName, row.version)}"`,
      'Cache-Control': 'private, no-store',
      'X-Robots-Tag': 'noindex, nofollow',
    },
  })
}
