/**
 * Reads for the register of interest. BUILD_SPEC §5.2.
 *
 * Two views, and the difference between them is the whole point of §5.2.2's
 * closing paragraph:
 *
 *   - `loadInvestorRegisterView` returns whether *this* account is on the
 *     register and what indicative figure they gave. It has no position, no
 *     band, no count, no other member and no field one could be put in.
 *   - `loadOperatorRegister` returns the computed order with everybody's
 *     history. It is the operator's, and it is the only function here that can
 *     see more than one person.
 */

import { and, desc, eq, isNull } from 'drizzle-orm'
import { db } from '@/db'
import { flagEnabled, PORTAL_FLAGS, readFeatureFlags } from '@/lib/flags'
import {
  commitments,
  fundsReceipts,
  interestRegisterEntries,
  investorAccounts,
  offers,
  recipients,
  rounds,
} from '@/db/schema'
import { readServiceConfig } from '@/lib/auth/service-config'
import { formatMoney, formatPercentage } from '@/lib/money'
import type { AccountStatus, PortalAccess } from '@/lib/portal/access'
import {
  BAND_LABEL,
  orderRegister,
  type OrderedRegisterMember,
  type RegisterCandidate,
} from './order'

// ---------------------------------------------------------------------------
// The investor's own view
// ---------------------------------------------------------------------------

/**
 * Deliberately four fields.
 *
 * There is no `position`, no `rank`, no `total`, no `memberCount` and no
 * `band`. §5.2.2: "The computed order is never shown to investors. No one sees
 * their own position or anyone else's." The way that is kept true is that the
 * investor-facing type has nowhere to put one, and a test asserts the key set.
 */
export interface InvestorRegisterView {
  onRegister: boolean
  /** Formatted for display, or null. Never a number at any point. */
  indicativeAmount: string | null
  /** Whether the portal is in a state that accepts a join or a leave. */
  canChange: boolean
}

export async function loadInvestorRegisterView(
  accountId: string,
  access: PortalAccess,
): Promise<InvestorRegisterView> {
  const row = await db.query.interestRegisterEntries.findFirst({
    where: eq(interestRegisterEntries.accountId, accountId),
  })

  const onRegister = row !== undefined && row.leftAt === null

  return {
    onRegister,
    indicativeAmount:
      onRegister && row.indicativeAmountUsd ? formatMoney(row.indicativeAmountUsd) : null,
    // §5.2.3: "Any active investor can join or leave from their portal."
    // §7: and not while the flag is off — the section stays on the screen with
    // whatever they have already told us, and stops accepting a change.
    canChange:
      access.capability === 'FULL' &&
      flagEnabled(await readFeatureFlags(), PORTAL_FLAGS.registerOfInterest),
  }
}

// ---------------------------------------------------------------------------
// The operator's view
// ---------------------------------------------------------------------------

export interface RegisterHistory {
  /** Formatted strings throughout. Nothing here is a number. */
  proposedAmount: string | null
  spvPercentage: string | null
  committedAmount: string | null
  commitmentAgreedAt: Date | null
  receivedAmount: string | null
  fundsValueDate: string | null
  roundName: string | null
  stage: string | null
}

export interface RegisterMember extends OrderedRegisterMember {
  name: string
  email: string
  status: AccountStatus
  joinedAt: Date
  indicativeAmount: string | null
  addedByOperator: boolean
  bandLabel: string
  history: RegisterHistory
  /** Whether this person could be sent an offer at all right now. */
  jurisdiction: string | null
}

/**
 * The register in computed order, with each person's history (§5.2.3).
 *
 * A member who has left is absent: `left_at` is the leave, and a leave means
 * they are not on the register. The row is kept rather than deleted so that
 * rejoining is one write and the audit trail keeps its subject.
 */
export async function loadOperatorRegister(): Promise<RegisterMember[]> {
  const rows = await db
    .select({
      entry: interestRegisterEntries,
      accountId: investorAccounts.id,
      name: investorAccounts.name,
      email: investorAccounts.email,
      status: investorAccounts.status,
    })
    .from(interestRegisterEntries)
    .innerJoin(investorAccounts, eq(interestRegisterEntries.accountId, investorAccounts.id))
    .where(isNull(interestRegisterEntries.leftAt))

  if (rows.length === 0) return []

  const config = await readServiceConfig()
  const histories = new Map<string, RegisterHistory>()
  const candidates: RegisterCandidate[] = []

  for (const row of rows) {
    const history = await loadHistory(row.accountId, config.decimalPlaces)
    histories.set(row.accountId, history)

    candidates.push({
      accountId: row.accountId,
      joinedAt: row.entry.joinedAt,
      fundsValueDate: history.fundsValueDate,
      commitmentAgreedAt: history.commitmentAgreedAt,
      operatorOrderOverride: row.entry.operatorOrderOverride,
      overrideReason: row.entry.overrideReason,
    })
  }

  const byAccount = new Map(rows.map((row) => [row.accountId, row]))

  const members: RegisterMember[] = []
  for (const ordered of orderRegister(candidates)) {
    const row = byAccount.get(ordered.accountId)
    if (!row) continue

    members.push({
      ...ordered,
      name: row.name,
      email: row.email,
      status: row.status as AccountStatus,
      joinedAt: row.entry.joinedAt,
      indicativeAmount: row.entry.indicativeAmountUsd
        ? formatMoney(row.entry.indicativeAmountUsd)
        : null,
      addedByOperator: row.entry.addedByOperator,
      bandLabel: BAND_LABEL[ordered.band],
      history: histories.get(ordered.accountId) ?? emptyHistory(),
      jurisdiction: await latestJurisdiction(row.accountId),
    })
  }

  return members
}

function emptyHistory(): RegisterHistory {
  return {
    proposedAmount: null,
    spvPercentage: null,
    committedAmount: null,
    commitmentAgreedAt: null,
    receivedAmount: null,
    fundsValueDate: null,
    roundName: null,
    stage: null,
  }
}

/**
 * One account's participation, for the ordering and for the operator's screen.
 *
 * The commitment date and the funds value date come from `commitments` and
 * `funds_receipts` rather than from the offer's amount columns, because §5.2.2
 * orders by *when* those happened and only those tables record it.
 */
async function loadHistory(accountId: string, decimalPlaces: number): Promise<RegisterHistory> {
  const offerRows = await db
    .select({
      id: offers.id,
      proposedAmountUsd: offers.proposedAmountUsd,
      spvPercentage: offers.spvPercentage,
      committedAmountUsd: offers.committedAmountUsd,
      receivedAmountUsd: offers.receivedAmountUsd,
      stage: offers.stage,
      roundName: rounds.name,
    })
    .from(offers)
    .innerJoin(rounds, eq(offers.roundId, rounds.id))
    .where(eq(offers.accountId, accountId))
    .orderBy(desc(offers.createdAt))

  if (offerRows.length === 0) return emptyHistory()

  const offerIds = offerRows.map((row) => row.id)

  let commitmentAgreedAt: Date | null = null
  let fundsValueDate: string | null = null

  for (const offerId of offerIds) {
    const commitment = await db.query.commitments.findFirst({
      where: eq(commitments.offerId, offerId),
    })
    if (commitment) {
      // Earliest, because §5.2.2 rewards having finished first.
      if (!commitmentAgreedAt || commitment.agreedAt < commitmentAgreedAt) {
        commitmentAgreedAt = commitment.agreedAt
      }
    }

    const receipt = await db.query.fundsReceipts.findFirst({
      where: eq(fundsReceipts.offerId, offerId),
    })
    if (receipt) {
      if (!fundsValueDate || receipt.valueDate < fundsValueDate) {
        fundsValueDate = receipt.valueDate
      }
    }
  }

  const latest = offerRows[0]!

  return {
    proposedAmount: formatMoney(latest.proposedAmountUsd),
    spvPercentage: formatPercentage(latest.spvPercentage, { decimalPlaces }),
    committedAmount: latest.committedAmountUsd ? formatMoney(latest.committedAmountUsd) : null,
    commitmentAgreedAt,
    receivedAmount: latest.receivedAmountUsd ? formatMoney(latest.receivedAmountUsd) : null,
    fundsValueDate,
    roundName: latest.roundName,
    stage: latest.stage,
  }
}

/**
 * The jurisdiction on this person's most recent recipient row, if any.
 *
 * Shown on the operator's screen so he can see before he starts that issuing to
 * someone in an uncleared country will block. It is not the gate — the gate
 * runs on the offer, from `recipients.jurisdiction`, exactly as it does for an
 * imported row (§5.2.4).
 */
export async function latestJurisdiction(accountId: string): Promise<string | null> {
  const rows = await db
    .select({ jurisdiction: recipients.jurisdiction })
    .from(offers)
    .innerJoin(recipients, eq(offers.recipientId, recipients.id))
    .where(eq(offers.accountId, accountId))
    .orderBy(desc(offers.createdAt))
    .limit(1)

  return rows[0]?.jurisdiction ?? null
}

/** Whether a round is open to receive a new offer. */
export async function openRound(): Promise<{ id: string; name: string; flipitShare: string } | null> {
  const row = await db.query.rounds.findFirst({
    where: isNull(rounds.closedAt),
  })
  if (!row) return null
  return { id: row.id, name: row.name, flipitShare: row.flipitShare }
}

/** An account by address, for the operator's manual add (§5.2.3). */
export async function findAccountByEmail(email: string) {
  return db.query.investorAccounts.findFirst({
    where: eq(investorAccounts.email, email.trim().toLowerCase()),
  })
}

/** Whether this account already has an offer in the given round. */
export async function hasOfferInRound(accountId: string, roundId: string): Promise<boolean> {
  const rows = await db
    .select({ id: offers.id })
    .from(offers)
    .where(and(eq(offers.accountId, accountId), eq(offers.roundId, roundId)))
    .limit(1)
  return rows.length > 0
}
