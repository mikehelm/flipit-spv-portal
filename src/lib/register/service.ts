/**
 * Every write the register of interest makes. BUILD_SPEC §5.2.
 *
 * The one to read carefully is `issueOfferFromRegister`. §5.2.3 says an offer
 * issued from the register *"creates a normal `Offer` against that existing
 * account (§4.3) — it does not invent a parallel mechanism"*, and §5.2.4 says
 * *"A freed allocation is a new offer, not a continuation of an old one.
 * Nothing about the register shortcuts any gate."*
 *
 * So it writes exactly what the import writes: a `recipients` row carrying the
 * jurisdiction, and an `offers` row pointing at it. The jurisdiction gate reads
 * `recipients.jurisdiction` through `offers.recipient_id` and has no idea the
 * register exists — which is the point. There is no branch in the gate for
 * this, no flag that skips it, and nothing here that sets `blocked = false`
 * except by asking the same function the import asks.
 *
 * It also does not send. The offer lands in the review screen as a draft and
 * goes out one recipient at a time behind the pre-flight checklist, like every
 * other offer (§14).
 */

import { and, eq, isNull } from 'drizzle-orm'
import { db } from '@/db'
import {
  interestRegisterEntries,
  investorAccounts,
  offers,
  recipients,
  rounds,
} from '@/db/schema'
import { audit, type Actor } from '@/lib/audit'
import { getCurrentApproval } from '@/lib/compliance/approvals'
import { shortBlockReason } from '@/lib/compliance/explain'
import { isJurisdictionApproved } from '@/lib/compliance/jurisdictions'
import { isIsoAlpha2 } from '@/lib/import/iso-countries'
import { computeIndirectPercentage, isoToday, parseMoney, parsePercentage } from '@/lib/money'
import { MIN_OVERRIDE_REASON_LENGTH, OVERRIDE_REASON_REQUIRED } from './order'

export const REGISTER_PATH = '/register'

// ---------------------------------------------------------------------------
// Joining and leaving — §5.2.3
// ---------------------------------------------------------------------------

export type RegisterResult = { ok: true } | { ok: false; message: string }

/**
 * Put an account's name on the register.
 *
 * Idempotent: joining when already on it updates the indicative figure rather
 * than failing. The row is unique per account, so rejoining after a leave
 * clears `left_at` and resets `joined_at` — position in the third band is by
 * the date they joined, and somebody who left and came back joined on the day
 * they came back. That is the honest reading and it is recorded as a decision.
 */
export async function joinRegister(input: {
  accountId: string
  /** Free text as typed. Parsed here; never a number before or after. */
  indicativeAmount?: string | null
  addedByOperator?: boolean
  actor: Actor
  now?: Date
}): Promise<RegisterResult> {
  const now = input.now ?? new Date()

  let indicativeAmountUsd: string | null = null
  const raw = input.indicativeAmount?.trim() ?? ''
  if (raw !== '') {
    const parsed = parseMoney(raw)
    if (!parsed.ok) {
      return {
        ok: false,
        message:
          'That figure could not be read. It is indicative only, so leave it blank if you would ' +
          'rather not say — nothing is held on the basis of it either way.',
      }
    }
    indicativeAmountUsd = parsed.value.toFixed(2)
  }

  const existing = await db.query.interestRegisterEntries.findFirst({
    where: eq(interestRegisterEntries.accountId, input.accountId),
  })

  if (existing) {
    await db
      .update(interestRegisterEntries)
      .set({
        leftAt: null,
        joinedAt: existing.leftAt === null ? existing.joinedAt : now,
        indicativeAmountUsd,
      })
      .where(eq(interestRegisterEntries.accountId, input.accountId))
  } else {
    await db.insert(interestRegisterEntries).values({
      accountId: input.accountId,
      joinedAt: now,
      indicativeAmountUsd,
      addedByOperator: input.addedByOperator ?? false,
    })
  }

  await audit({
    actor: input.actor,
    entityType: 'interest_register',
    entityId: input.accountId,
    action: existing?.leftAt === null && existing ? 'register.updated' : 'register.joined',
    // Whether a figure was given, never the figure — it is indicative and
    // recording it twice adds nothing the row does not already hold.
    metadata: {
      indicativeAmountGiven: indicativeAmountUsd !== null,
      addedByOperator: input.addedByOperator ?? false,
      rejoined: existing !== undefined && existing.leftAt !== null,
    },
  })

  return { ok: true }
}

export async function leaveRegister(input: {
  accountId: string
  actor: Actor
  now?: Date
}): Promise<RegisterResult> {
  const now = input.now ?? new Date()

  const existing = await db.query.interestRegisterEntries.findFirst({
    where: eq(interestRegisterEntries.accountId, input.accountId),
  })

  if (!existing || existing.leftAt !== null) {
    // Not an error worth showing as one. The end state is what they asked for.
    return { ok: true }
  }

  await db
    .update(interestRegisterEntries)
    .set({ leftAt: now })
    .where(eq(interestRegisterEntries.accountId, input.accountId))

  await audit({
    actor: input.actor,
    entityType: 'interest_register',
    entityId: input.accountId,
    action: 'register.left',
  })

  return { ok: true }
}

// ---------------------------------------------------------------------------
// The operator's manual add — §5.2.3
// ---------------------------------------------------------------------------

/**
 * Add somebody by name and address, including somebody who was never on the
 * original recipient list. §5.2.3: "This is how the register becomes the
 * starting list for a later round (§21)."
 *
 * A new account is created in `INVITED` — the state §4.1 gives an account that
 * exists but whose mailbox has not been verified. It cannot sign in; it gains
 * portal access the ordinary way, by claiming an invitation, if and when one is
 * ever issued.
 */
export async function addToRegisterManually(input: {
  name: string
  email: string
  indicativeAmount?: string | null
  actor: Actor
  now?: Date
}): Promise<{ ok: true; accountId: string; createdAccount: boolean } | { ok: false; message: string }> {
  const name = input.name.trim()
  const email = input.email.trim().toLowerCase()

  if (name === '') return { ok: false, message: 'A name is needed.' }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, message: 'That does not look like an email address.' }
  }

  const existing = await db.query.investorAccounts.findFirst({
    where: eq(investorAccounts.email, email),
  })

  let accountId: string
  let createdAccount = false

  if (existing) {
    accountId = existing.id
  } else {
    const [created] = await db
      .insert(investorAccounts)
      .values({ email, name, status: 'INVITED' })
      .returning({ id: investorAccounts.id })
    accountId = created!.id
    createdAccount = true

    await audit({
      actor: input.actor,
      entityType: 'investor_account',
      entityId: accountId,
      action: 'account.created_from_register',
      metadata: { hadNoPriorRecord: true },
    })
  }

  const joined = await joinRegister({
    accountId,
    indicativeAmount: input.indicativeAmount ?? null,
    addedByOperator: true,
    actor: input.actor,
    now: input.now,
  })
  if (!joined.ok) return joined

  return { ok: true, accountId, createdAccount }
}

// ---------------------------------------------------------------------------
// Ordering overrides — §5.2.2
// ---------------------------------------------------------------------------

/**
 * Move somebody in the order. Only with a recorded reason.
 *
 * The reason is required by the signature, not only by the form. A required
 * field on a screen is something a future caller can route around by calling
 * the function from somewhere else.
 */
export async function setOrderOverride(input: {
  accountId: string
  position: number
  reason: string
  actorUserId: string | null
  actor: Actor
}): Promise<RegisterResult> {
  const reason = input.reason.trim()
  if (reason.length < MIN_OVERRIDE_REASON_LENGTH) {
    return { ok: false, message: OVERRIDE_REASON_REQUIRED }
  }
  if (!Number.isInteger(input.position) || input.position < 1) {
    return { ok: false, message: 'A position is a whole number, counting from one.' }
  }

  const existing = await db.query.interestRegisterEntries.findFirst({
    where: and(
      eq(interestRegisterEntries.accountId, input.accountId),
      isNull(interestRegisterEntries.leftAt),
    ),
  })
  if (!existing) {
    return { ok: false, message: 'That person is not currently on the register.' }
  }

  await db
    .update(interestRegisterEntries)
    .set({
      operatorOrderOverride: input.position,
      overrideReason: reason,
      overrideById: input.actorUserId,
    })
    .where(eq(interestRegisterEntries.accountId, input.accountId))

  await audit({
    actor: input.actor,
    entityType: 'interest_register',
    entityId: input.accountId,
    action: 'register.order_overridden',
    // The reason IS the point of the entry, so it is recorded — it is the
    // operator's own words about process, not anybody's correspondence.
    metadata: { position: input.position, reason },
  })

  return { ok: true }
}

export async function clearOrderOverride(input: {
  accountId: string
  actor: Actor
}): Promise<RegisterResult> {
  await db
    .update(interestRegisterEntries)
    .set({ operatorOrderOverride: null, overrideReason: null, overrideById: null })
    .where(eq(interestRegisterEntries.accountId, input.accountId))

  await audit({
    actor: input.actor,
    entityType: 'interest_register',
    entityId: input.accountId,
    action: 'register.order_override_cleared',
  })

  return { ok: true }
}

// ---------------------------------------------------------------------------
// Issuing an offer from the register — §5.2.3, §5.2.4
// ---------------------------------------------------------------------------

export interface IssueOfferInput {
  accountId: string
  /** ISO 3166-1 alpha-2. Required, because the gate has nothing to check without it. */
  jurisdiction: string
  /** As typed. Parsed here. Never a number. */
  investmentAmountUsd: string
  spvPercentage: string
  responseDeadline: string
  senderName?: string | null
  senderEmail?: string | null
  senderPhone?: string | null
  internalNotes?: string | null
  actor: Actor
  now?: Date
}

export type IssueOfferResult =
  | {
      ok: true
      offerId: string
      /** True when the jurisdiction gate held it. The offer still exists. */
      blocked: boolean
      blockDetail: string | null
    }
  | { ok: false; message: string }

/**
 * Create an ordinary offer for somebody on the register.
 *
 * Everything the import does, in the same order, with the same gate:
 *
 *   1. Validate the figures as strings and compute the indirect percentage
 *      with the one function allowed to compute it.
 *   2. Write a `recipients` row carrying the jurisdiction.
 *   3. Write an `offers` row pointing at it, with `blocked` set by the same
 *      jurisdiction check the import uses.
 *
 * It does not send, it does not mint a token, and it does not remove anybody
 * from the register — leaving is the investor's decision, and an offer that is
 * declined should not silently cost them their place.
 */
export async function issueOfferFromRegister(
  input: IssueOfferInput,
): Promise<IssueOfferResult> {
  const now = input.now ?? new Date()

  const account = await db.query.investorAccounts.findFirst({
    where: eq(investorAccounts.id, input.accountId),
  })
  if (!account) return { ok: false, message: 'That account could not be found.' }

  const member = await db.query.interestRegisterEntries.findFirst({
    where: and(
      eq(interestRegisterEntries.accountId, input.accountId),
      isNull(interestRegisterEntries.leftAt),
    ),
  })
  if (!member) {
    return {
      ok: false,
      message:
        'That person is not currently on the register, so an offer cannot be issued from it. ' +
        'They may have removed their name.',
    }
  }

  const round = await db.query.rounds.findFirst({ where: isNull(rounds.closedAt) })
  if (!round) {
    return {
      ok: false,
      message:
        'There is no open round to issue this offer into. A closed round is closed; open the ' +
        'next one first.',
    }
  }

  const jurisdiction = input.jurisdiction.trim().toUpperCase()
  if (!isIsoAlpha2(jurisdiction)) {
    return {
      ok: false,
      message:
        'That is not a valid ISO 3166-1 alpha-2 country code. The compliance gate has nothing ' +
        'to check without one, so the offer is not created.',
    }
  }

  const amount = parseMoney(input.investmentAmountUsd)
  if (!amount.ok) {
    return { ok: false, message: 'The investment amount could not be read as a figure.' }
  }

  const percentage = parsePercentage(input.spvPercentage)
  if (!percentage.ok) {
    return { ok: false, message: 'The SPV percentage could not be read as a figure.' }
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.responseDeadline)) {
    return { ok: false, message: 'Use the date picker for the response deadline.' }
  }
  if (input.responseDeadline < isoToday(now)) {
    return {
      ok: false,
      message: 'The response deadline is in the past. Nobody can answer an invitation by then.',
    }
  }

  const existingRecipient = await db.query.recipients.findFirst({
    where: and(eq(recipients.roundId, round.id), eq(recipients.email, account.email)),
  })
  if (existingRecipient) {
    return {
      ok: false,
      message:
        'This person already has a record in the open round, so a second offer here would be a ' +
        'duplicate rather than a freed allocation. Amend the existing one instead.',
    }
  }

  // The same gate the import consults, reading the same list: the one on the
  // current compliance approval, never the settings copy (§8.2).
  const approval = await getCurrentApproval('INVITATION')
  const cleared = isJurisdictionApproved(jurisdiction, approval)
  const blockDetail = cleared
    ? null
    : shortBlockReason(jurisdiction, approval?.approvedJurisdictions ?? [])

  const indirectPercentage = computeIndirectPercentage(
    percentage.value.toFixed(6),
    round.flipitShare,
  )

  let offerId = ''

  await db.transaction(async (tx) => {
    const [recipient] = await tx
      .insert(recipients)
      .values({
        roundId: round.id,
        name: account.name,
        email: account.email,
        jurisdiction,
        internalNotes: input.internalNotes?.trim() || null,
        senderName: input.senderName?.trim() || null,
        senderEmail: input.senderEmail?.trim() || null,
        senderPhone: input.senderPhone?.trim() || null,
      })
      .returning({ id: recipients.id })

    const [offer] = await tx
      .insert(offers)
      .values({
        roundId: round.id,
        accountId: account.id,
        recipientId: recipient!.id,
        proposedAmountUsd: amount.value.toFixed(2),
        spvPercentage: percentage.value.toFixed(6),
        indirectPercentage,
        responseDeadline: input.responseDeadline,
        originalDeadline: input.responseDeadline,
        emailStatus: cleared ? 'DRAFT' : 'BLOCKED',
        blocked: !cleared,
        blockReason: cleared ? null : 'JURISDICTION_NOT_APPROVED',
        blockDetail,
      })
      .returning({ id: offers.id })

    offerId = offer!.id
  })

  await audit({
    actor: input.actor,
    entityType: 'offer',
    entityId: offerId,
    action: cleared ? 'register.offer_issued' : 'register.offer_issued_blocked',
    metadata: {
      accountId: input.accountId,
      roundId: round.id,
      jurisdiction,
      fromRegister: true,
      blocked: !cleared,
    },
  })

  return { ok: true, offerId, blocked: !cleared, blockDetail }
}
