/**
 * What an investor's portal shows them. BUILD_SPEC §4, §5, §13.
 *
 * Every query in this file is bound to one account id, taken from the session
 * and never from anything the browser sent. There is no query here that could
 * return a row belonging to somebody else, and no count, total or aggregate
 * over other people's records.
 *
 * §15: no investor-facing page, response or error may reveal that another
 * investor exists. The way that is kept true is that this module never has the
 * data to leak — it does not load it.
 */

import { desc, eq } from 'drizzle-orm'
import { db } from '@/db'
import {
  emailSnapshots,
  investorAccounts,
  offers,
  roadmapTiles,
  rounds,
  sendEvents,
} from '@/db/schema'
import { readServiceConfig } from '@/lib/auth/service-config'
import { listCertificates } from '@/lib/certificate/issue'
import { formatMoney, formatPercentage } from '@/lib/money'
import { forbiddenWordsInTileLabel } from './roadmap'

/**
 * Every amount an investor sees carries its currency.
 *
 * "5,000.00" on a securities invitation is not a number with a missing symbol,
 * it is an ambiguous figure on a document about somebody's money. The round is
 * denominated in USD throughout — §5, and `proposed_amount_usd` and its three
 * siblings are named for it.
 */
const money = (value: string) => formatMoney(value, { currencyCode: 'USD' })
import { portalContacts, type PortalContact } from './contact'
import { portalAccess, type AccountStatus, type PortalAccess } from './access'
import { buildTimeline, showsPaymentSafetyNotice, type OfferStage, type TimelineStep } from './timeline'

export interface PortalOffer {
  offerId: string
  /** Formatted for display. The underlying values never became numbers. */
  proposedAmount: string
  spvPercentage: string
  indirectPercentage: string
  committedAmount: string | null
  acceptedAmount: string | null
  receivedAmount: string | null
  responseDeadline: string
  responseChoice: 'NO_RESPONSE' | 'INTERESTED' | 'NOT_INTERESTED' | 'QUESTION'
  responseNote: string | null
  stage: OfferStage
  timeline: TimelineStep[]
  showPaymentSafetyNotice: boolean
  /** The exact email as sent, if one was. Immutable — §11.4. */
  snapshot: { subject: string; htmlBody: string; sentAt: Date | null } | null
  /**
   * Participation certificates, newest version first (§5.1). Superseded
   * versions stay listed and stay downloadable — a retained record you cannot
   * read is not retained.
   */
  certificates: Array<{
    id: string
    version: number
    issuedOn: string
    superseded: boolean
    amountReceived: string
    currency: string
    valueDate: string
  }>
}

export interface PortalView {
  accountId: string
  name: string
  email: string
  status: AccountStatus
  access: PortalAccess
  /** The investor's own offers, newest round first. Never anybody else's. */
  offers: PortalOffer[]
  tiles: Array<{ label: string; isLive: boolean }>
  roundName: string | null
  /**
   * The addresses to show on a notice, when there is a notice. §4.2, §7.
   *
   * Empty for the normal case, and empty when nothing is configured — the page
   * renders nothing rather than naming a route that is not one. Derived from
   * service configuration alone; nothing here comes from an account.
   */
  contacts: PortalContact[]
}

function formatDate(value: Date | string | null): string | null {
  if (value === null) return null
  const date = typeof value === 'string' ? new Date(`${value}T00:00:00Z`) : value
  if (Number.isNaN(date.getTime())) return typeof value === 'string' ? value : null
  return date.toISOString().slice(0, 10)
}

export async function loadPortalView(accountId: string): Promise<PortalView | null> {
  const account = await db.query.investorAccounts.findFirst({
    where: eq(investorAccounts.id, accountId),
  })
  if (!account) return null

  const config = await readServiceConfig()
  const access = portalAccess({
    accountStatus: account.status as AccountStatus,
    closedAccountAccess: config.closedAccountAccess,
    serviceMode: config.serviceMode,
  })

  // Bound to this account. There is no branch of this function that widens it.
  const rows = await db
    .select({
      offerId: offers.id,
      proposedAmountUsd: offers.proposedAmountUsd,
      committedAmountUsd: offers.committedAmountUsd,
      acceptedAmountUsd: offers.acceptedAmountUsd,
      receivedAmountUsd: offers.receivedAmountUsd,
      spvPercentage: offers.spvPercentage,
      indirectPercentage: offers.indirectPercentage,
      responseDeadline: offers.responseDeadline,
      responseChoice: offers.responseChoice,
      responseNote: offers.responseNote,
      responseAt: offers.responseAt,
      stage: offers.stage,
      roundName: rounds.name,
    })
    .from(offers)
    .innerJoin(rounds, eq(offers.roundId, rounds.id))
    .where(eq(offers.accountId, accountId))
    .orderBy(desc(offers.createdAt))

  const portalOffers: PortalOffer[] = []

  for (const row of rows) {
    const snapshotRow = await db.query.emailSnapshots.findFirst({
      where: eq(emailSnapshots.offerId, row.offerId),
      orderBy: desc(emailSnapshots.createdAt),
    })

    const sentEvent = snapshotRow
      ? await db.query.sendEvents.findFirst({
          where: eq(sendEvents.offerId, row.offerId),
          orderBy: desc(sendEvents.createdAt),
        })
      : null

    const decimalPlaces = config.decimalPlaces

    portalOffers.push({
      offerId: row.offerId,
      proposedAmount: money(row.proposedAmountUsd),
      spvPercentage: formatPercentage(row.spvPercentage, { decimalPlaces }),
      indirectPercentage: formatPercentage(row.indirectPercentage, { decimalPlaces }),
      committedAmount: row.committedAmountUsd ? money(row.committedAmountUsd) : null,
      acceptedAmount: row.acceptedAmountUsd ? money(row.acceptedAmountUsd) : null,
      receivedAmount: row.receivedAmountUsd ? money(row.receivedAmountUsd) : null,
      responseDeadline: row.responseDeadline,
      responseChoice: row.responseChoice,
      responseNote: row.responseNote,
      stage: row.stage as OfferStage,
      timeline: buildTimeline(row.stage as OfferStage, {
        sentOn: formatDate(snapshotRow?.createdAt ?? null),
        responseChoice: row.responseChoice,
        respondedOn: formatDate(row.responseAt),
        responseDeadline: row.responseDeadline,
        committedAmount: row.committedAmountUsd ? money(row.committedAmountUsd) : null,
        acceptedAmount: row.acceptedAmountUsd ? money(row.acceptedAmountUsd) : null,
        spvPercentage: formatPercentage(row.spvPercentage, { decimalPlaces }),
        fundsCurrency: row.receivedAmountUsd ? 'USD' : null,
        fundsAmount: row.receivedAmountUsd ? money(row.receivedAmountUsd) : null,
      }),
      showPaymentSafetyNotice: showsPaymentSafetyNotice(row.stage as OfferStage),
      certificates: (await listCertificates(row.offerId)).map((certificate) => ({
        id: certificate.id,
        version: certificate.version,
        issuedOn: certificate.issuedAt.toISOString().slice(0, 10),
        superseded: certificate.supersededAt !== null,
        amountReceived: certificate.amountReceived,
        currency: certificate.currency,
        valueDate: certificate.valueDate,
      })),
      snapshot: snapshotRow
        ? {
            subject: snapshotRow.subject,
            htmlBody: snapshotRow.htmlBody,
            sentAt: sentEvent?.createdAt ?? snapshotRow.createdAt,
          }
        : null,
    })
  }

  // §13.1 "Coming to your portal". Hidden tiles are hidden from everybody —
  // there is no per-investor variation, so this reveals nothing about anyone.
  //
  // A tile whose label breaks §13.1's wording constraint — a promise of
  // return, a valuation, a liquidity event, a date — is also not shown. §13.1
  // calls this section "the easiest place in the build to say something
  // unintended", so the reading here is that a missing tile is a smaller
  // problem than a tile that reads as a promise on a securities page.
  //
  // This is the second of two checks and the quieter one. When a tile-editing
  // surface is built it must call `forbiddenWordsInTileLabel` at write time
  // and refuse out loud, naming the word. Nothing writes these today except
  // the seed, so nothing can currently be dropped without somebody noticing.
  const tiles = (await db.select().from(roadmapTiles).orderBy(roadmapTiles.sortOrder)).filter(
    (tile) => !tile.hidden && forbiddenWordsInTileLabel(tile.label).length === 0,
  )

  return {
    accountId: account.id,
    name: account.name,
    email: account.email,
    status: account.status as AccountStatus,
    access,
    offers: portalOffers,
    tiles: tiles.map((tile) => ({ label: tile.label, isLive: tile.isLive })),
    roundName: rows[0]?.roundName ?? null,
    contacts: access.notice
      ? portalContacts({
          notice: access.notice,
          operatorEmail: config.defaultSenderEmail,
          serviceContactEmail: config.serviceContactEmail,
        })
      : [],
  }
}
