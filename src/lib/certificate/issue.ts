/**
 * Issuing, reissuing and reading a participation certificate. BUILD_SPEC §5.1.
 *
 * *"Once an investor reaches **Funds received**, the app generates a PDF
 * confirmation for them."*
 * *"Regenerated if a figure is corrected, with the superseded version retained
 * on the record and marked as such."*
 *
 * The version is a **frozen snapshot**, not a live read. A row in
 * `participation_certificates` carries the exact figures that version asserts,
 * and the PDF is regenerated from that snapshot on every download. Two things
 * follow, and both are the reason for doing it this way:
 *
 *   - A superseded version still renders exactly what it said, rather than what
 *     is true now. A retained version that quietly restates the corrected
 *     figures is not a retained version.
 *   - Nothing is stored as a file. There is no blob store in this deployment,
 *     and adding one to hold a document that can be rebuilt byte-for-byte from
 *     eight fields would be storing a derived value.
 *
 * `storage_key` stays on the table, nullable and normally null, for a future
 * deployment that does keep files.
 */

import { and, asc, desc, eq, isNull } from 'drizzle-orm'
import { db } from '@/db'
import {
  fundsReceipts,
  investorAccounts,
  offers,
  participationCertificates,
  rounds,
  users,
} from '@/db/schema'
import { audit, type Actor } from '@/lib/audit'
import { readServiceConfig } from '@/lib/auth/service-config'
import { isoToday } from '@/lib/money'
import { renderCertificatePdf } from './layout'
import { participationCertificateDataSchema, type ParticipationCertificateData } from './types'

export type CertificateRow = typeof participationCertificates.$inferSelect

export type IssueResult =
  | { ok: true; certificateId: string; version: number; superseded: number }
  | { ok: false; message: string }

/**
 * The facts a certificate asserts, assembled from the record.
 *
 * Every figure is taken as the string the driver returned and passed through
 * untouched. Nothing here computes, rounds or reformats a money value — the
 * certificate states what is recorded.
 */
export async function certificateDataFor(
  offerId: string,
  options: { now?: Date } = {},
): Promise<ParticipationCertificateData | { error: string }> {
  const now = options.now ?? new Date()

  const rows = await db
    .select({
      offer: offers,
      accountName: investorAccounts.name,
      roundName: rounds.name,
    })
    .from(offers)
    .innerJoin(investorAccounts, eq(offers.accountId, investorAccounts.id))
    .innerJoin(rounds, eq(offers.roundId, rounds.id))
    .where(eq(offers.id, offerId))
    .limit(1)

  const row = rows[0]
  if (!row) return { error: 'That offer could not be found.' }

  if (row.offer.stage !== 'FUNDS_RECEIVED' && row.offer.stage !== 'COMPLETED') {
    return {
      error:
        'A participation certificate is issued once funds have been received. This offer has ' +
        'not reached that step, so there is nothing to certify yet.',
    }
  }

  const receipt = await db.query.fundsReceipts.findFirst({
    where: eq(fundsReceipts.offerId, offerId),
  })
  if (!receipt) {
    return {
      error:
        'No funds receipt is recorded against this offer, so the amount, value date and ' +
        'reference the certificate has to state do not exist.',
    }
  }

  const config = await readServiceConfig()

  const operator = await db.query.users.findFirst({ where: eq(users.role, 'OPERATOR') })
  const signedByName =
    config.defaultSenderName ?? operator?.displayName ?? operator?.name ?? null

  if (!signedByName) {
    return {
      error:
        'The certificate is signed off by the operator in his stated role, and no name is ' +
        'configured. Set the default sender name in settings, or complete operator onboarding.',
    }
  }

  const candidate = {
    investorName: row.accountName,
    spvName: row.roundName,
    amountReceived: receipt.amount,
    currency: receipt.currency.toUpperCase(),
    valueDate: receipt.valueDate,
    spvPercentage: row.offer.spvPercentage,
    indirectFlipitPercentage: row.offer.indirectPercentage,
    paymentReference: receipt.reference,
    issuedOn: isoToday(now),
    signedByName,
    signedByRole: 'SPV Manager',
    version: 1,
  }

  const parsed = participationCertificateDataSchema.safeParse(candidate)
  if (!parsed.success) {
    return {
      error:
        'The certificate could not be assembled from the record: ' +
        parsed.error.issues.map((issue) => `${issue.path.join('.')} ${issue.message}`).join('; '),
    }
  }

  return parsed.data
}

/**
 * Issue a certificate, or reissue after a correction.
 *
 * Reissuing supersedes every currently live version rather than replacing it.
 * §5.1: "with the superseded version retained on the record and marked as
 * such." Nothing in this module deletes a certificate row.
 */
export async function issueCertificate(input: {
  offerId: string
  actor: Actor
  now?: Date
}): Promise<IssueResult> {
  const now = input.now ?? new Date()

  const data = await certificateDataFor(input.offerId, { now })
  if ('error' in data) return { ok: false, message: data.error }

  const existing = await db
    .select()
    .from(participationCertificates)
    .where(eq(participationCertificates.offerId, input.offerId))
    .orderBy(asc(participationCertificates.version))

  const live = existing.filter((row) => row.supersededAt === null)

  // Reissuing an identical certificate would clutter the investor's record with
  // versions that say the same thing. A correction that changed nothing is not
  // a correction.
  const current = live[live.length - 1]
  if (current && sameFacts(current.data, data)) {
    return { ok: false, message: 'The current certificate already states these figures.' }
  }

  const version = existing.reduce((highest, row) => Math.max(highest, row.version), 0) + 1

  for (const row of live) {
    await db
      .update(participationCertificates)
      .set({ supersededAt: now })
      .where(eq(participationCertificates.id, row.id))
  }

  const [created] = await db
    .insert(participationCertificates)
    .values({
      offerId: input.offerId,
      version,
      issuedAt: now,
      data: { ...data, version },
    })
    .returning({ id: participationCertificates.id })

  await audit({
    actor: input.actor,
    entityType: 'participation_certificate',
    entityId: created!.id,
    action: version === 1 ? 'certificate.issued' : 'certificate.reissued',
    // The version and what it supersedes. The figures are on the record.
    metadata: { offerId: input.offerId, version, superseded: live.length },
  })

  return { ok: true, certificateId: created!.id, version, superseded: live.length }
}

function sameFacts(stored: unknown, data: ParticipationCertificateData): boolean {
  if (!stored || typeof stored !== 'object') return false
  const previous = stored as Record<string, unknown>

  return (
    previous.amountReceived === data.amountReceived &&
    previous.currency === data.currency &&
    previous.valueDate === data.valueDate &&
    previous.spvPercentage === data.spvPercentage &&
    previous.indirectFlipitPercentage === data.indirectFlipitPercentage &&
    previous.paymentReference === data.paymentReference &&
    previous.investorName === data.investorName
  )
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

export interface CertificateSummary {
  id: string
  version: number
  issuedAt: Date
  supersededAt: Date | null
  /** What this version asserts. Formatted strings; never numbers. */
  amountReceived: string
  currency: string
  valueDate: string
}

export async function listCertificates(offerId: string): Promise<CertificateSummary[]> {
  const rows = await db
    .select()
    .from(participationCertificates)
    .where(eq(participationCertificates.offerId, offerId))
    .orderBy(desc(participationCertificates.version))

  return rows.map((row) => {
    const data = (row.data ?? {}) as Record<string, string>
    return {
      id: row.id,
      version: row.version,
      issuedAt: row.issuedAt,
      supersededAt: row.supersededAt,
      amountReceived: data.amountReceived ?? '',
      currency: data.currency ?? '',
      valueDate: data.valueDate ?? '',
    }
  })
}

export async function currentCertificate(offerId: string): Promise<CertificateRow | null> {
  const row = await db.query.participationCertificates.findFirst({
    where: and(
      eq(participationCertificates.offerId, offerId),
      isNull(participationCertificates.supersededAt),
    ),
    orderBy: desc(participationCertificates.version),
  })
  return row ?? null
}

/**
 * The PDF for one version, rebuilt from its own frozen snapshot.
 *
 * Bound to an offer id supplied by the caller as well as the certificate id, so
 * the download route can require that the certificate belongs to the account in
 * the session. A guessed certificate id finds nothing rather than finding
 * somebody else's document.
 */
export async function renderCertificate(input: {
  certificateId: string
  offerId: string
}): Promise<Buffer | null> {
  const row = await db.query.participationCertificates.findFirst({
    where: and(
      eq(participationCertificates.id, input.certificateId),
      eq(participationCertificates.offerId, input.offerId),
    ),
  })
  if (!row?.data) return null

  const parsed = participationCertificateDataSchema.safeParse(row.data)
  if (!parsed.success) return null

  return renderCertificatePdf(parsed.data)
}

/** A stable, human-meaningful download name. */
export function certificateFilename(investorName: string, version: number): string {
  const slug = investorName
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .toLowerCase()
  return `flipit-participation-certificate-${slug || 'investor'}-v${version}.pdf`
}
