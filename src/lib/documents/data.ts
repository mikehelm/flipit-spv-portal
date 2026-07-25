/**
 * Reading document packages. BUILD_SPEC §5, §13.
 *
 * Two shapes, and the difference between them is the whole point:
 *
 *   - `documentsForOffer` is the **operator's** view of one offer. Everything
 *     on the record, issued or not.
 *   - `investorDocuments` is the **investor's**. It takes an account id, joins
 *     through their own offers, and returns only what has been issued.
 *
 * They are separate functions rather than one function with a flag, because a
 * flag defaulting the wrong way is how an unissued document ends up on
 * somebody's portal.
 */

import { and, asc, eq, isNotNull } from 'drizzle-orm'
import { db } from '@/db'
import { documentPackages, offers, rounds } from '@/db/schema'
import { issuedOnly } from './access'

export interface DocumentRecord {
  id: string
  offerId: string
  title: string
  description: string | null
  storageKey: string
  contentType: string
  sizeBytes: number
  issuedAt: Date | null
  /** §5's version history. See `lib/documents/versions.ts`. */
  version: number
  supersededAt: Date | null
  supersedesId: string | null
  createdAt: Date
}

/** Everything on one offer's record. Operator-side. */
export async function documentsForOffer(offerId: string): Promise<DocumentRecord[]> {
  return db
    .select()
    .from(documentPackages)
    .where(eq(documentPackages.offerId, offerId))
    .orderBy(asc(documentPackages.createdAt))
}

/**
 * What one investor may download, across all of their offers.
 *
 * The account id is a join condition rather than a filter applied afterwards,
 * so a document belonging to somebody else is not fetched and then discarded —
 * it is never selected. §4.3 means an account can hold offers across several
 * rounds, and all of their documents belong to them.
 */
export async function investorDocuments(accountId: string): Promise<DocumentRecord[]> {
  const rows = await db
    .select({
      id: documentPackages.id,
      offerId: documentPackages.offerId,
      title: documentPackages.title,
      description: documentPackages.description,
      storageKey: documentPackages.storageKey,
      contentType: documentPackages.contentType,
      sizeBytes: documentPackages.sizeBytes,
      issuedAt: documentPackages.issuedAt,
      version: documentPackages.version,
      supersededAt: documentPackages.supersededAt,
      supersedesId: documentPackages.supersedesId,
      createdAt: documentPackages.createdAt,
    })
    .from(documentPackages)
    .innerJoin(offers, eq(documentPackages.offerId, offers.id))
    .where(eq(offers.accountId, accountId))
    .orderBy(asc(documentPackages.createdAt))

  return issuedOnly(rows)
}

/**
 * One document, with the account it belongs to, for the download route.
 *
 * The account id comes back on the row rather than being passed in, so the
 * route compares it against the session itself. A helper that took the account
 * id and returned "the document or null" would hide the comparison the route
 * exists to make.
 */
export async function documentWithOwner(documentId: string): Promise<
  (DocumentRecord & { accountId: string }) | null
> {
  const rows = await db
    .select({
      id: documentPackages.id,
      offerId: documentPackages.offerId,
      title: documentPackages.title,
      description: documentPackages.description,
      storageKey: documentPackages.storageKey,
      contentType: documentPackages.contentType,
      sizeBytes: documentPackages.sizeBytes,
      issuedAt: documentPackages.issuedAt,
      version: documentPackages.version,
      supersededAt: documentPackages.supersededAt,
      supersedesId: documentPackages.supersedesId,
      createdAt: documentPackages.createdAt,
      accountId: offers.accountId,
    })
    .from(documentPackages)
    .innerJoin(offers, eq(documentPackages.offerId, offers.id))
    .where(eq(documentPackages.id, documentId))
    .limit(1)

  return rows[0] ?? null
}

/** Whether an offer has at least one issued document — for the timeline. */
export async function hasIssuedDocuments(offerId: string): Promise<boolean> {
  const rows = await db
    .select({ id: documentPackages.id })
    .from(documentPackages)
    .where(
      and(eq(documentPackages.offerId, offerId), isNotNull(documentPackages.issuedAt)),
    )
    .limit(1)

  return rows.length > 0
}

/** A human-readable size for a list. Never used as a value for anything. */
export function documentSizeLabel(sizeBytes: number): string {
  if (sizeBytes < 1024) return `${sizeBytes} bytes`
  if (sizeBytes < 1024 * 1024) return `${Math.round(sizeBytes / 1024)} KB`
  return `${Math.round((sizeBytes / (1024 * 1024)) * 10) / 10} MB`
}

// ---------------------------------------------------------------------------

export interface AccountOfferDocuments {
  offerId: string
  roundName: string | null
  documents: DocumentRecord[]
}

/**
 * Every account's offers with their documents, keyed by account, for the
 * Investors screen. Operator-side, so unissued documents are included.
 *
 * One query rather than one per account. The Investors screen renders every
 * account on one page, and a per-card lookup would be a query per investor on
 * a screen whose whole job is to show them all at once.
 */
export async function documentsByAccount(): Promise<Map<string, AccountOfferDocuments[]>> {
  const rows = await db
    .select({
      accountId: offers.accountId,
      offerId: offers.id,
      roundName: rounds.name,
      documentId: documentPackages.id,
      title: documentPackages.title,
      description: documentPackages.description,
      storageKey: documentPackages.storageKey,
      contentType: documentPackages.contentType,
      sizeBytes: documentPackages.sizeBytes,
      issuedAt: documentPackages.issuedAt,
      version: documentPackages.version,
      supersededAt: documentPackages.supersededAt,
      supersedesId: documentPackages.supersedesId,
      createdAt: documentPackages.createdAt,
    })
    .from(offers)
    .leftJoin(rounds, eq(offers.roundId, rounds.id))
    .leftJoin(documentPackages, eq(documentPackages.offerId, offers.id))
    .orderBy(asc(offers.createdAt), asc(documentPackages.createdAt))

  const byAccount = new Map<string, AccountOfferDocuments[]>()

  for (const row of rows) {
    const offersForAccount = byAccount.get(row.accountId) ?? []
    let entry = offersForAccount.find((candidate) => candidate.offerId === row.offerId)

    if (!entry) {
      entry = { offerId: row.offerId, roundName: row.roundName, documents: [] }
      offersForAccount.push(entry)
      byAccount.set(row.accountId, offersForAccount)
    }

    // A left join gives one row with nulls for an offer that has no documents.
    if (row.documentId) {
      entry.documents.push({
        id: row.documentId,
        offerId: row.offerId,
        title: row.title!,
        description: row.description,
        storageKey: row.storageKey!,
        contentType: row.contentType!,
        sizeBytes: row.sizeBytes!,
        issuedAt: row.issuedAt,
        version: row.version!,
        supersededAt: row.supersededAt,
        supersedesId: row.supersedesId,
        createdAt: row.createdAt!,
      })
    }
  }

  return byAccount
}
