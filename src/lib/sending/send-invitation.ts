/**
 * Sending one invitation to one recipient. BUILD_SPEC §12, §14, §19.
 *
 * The order of operations is the whole design, so it is written out here:
 *
 *   1. **Compliance gate** (§8.2) — approval recorded, not voided, template
 *      hash unchanged, and this recipient's jurisdiction cleared. A refusal
 *      here stops this recipient and writes a BLOCKED send event. It touches
 *      nobody else.
 *   2. **Claim token** — a single-use hashed token, minted only now. Nothing
 *      earlier in the flow issues one; the preview deliberately uses a fake
 *      (§11.4), because a preview that minted a working credential would be a
 *      send by another name.
 *   3. **Render** — with that real link. Fails loudly on any unresolved
 *      variable rather than substituting a blank.
 *   4. **Snapshot** — the exact subject and both bodies, written before the
 *      transport is touched. §11.4 calls the snapshot immutable, and a snapshot
 *      written after a successful send would not exist for a failed one, which
 *      is precisely the case where knowing what was attempted matters.
 *   5. **Send** — the transport gate (§8.1 credential, §7 service mode, §18.1
 *      production deployment) is inside `sendOneEmail` and is a separate
 *      authority from the compliance gate. Both apply. Neither substitutes for
 *      the other.
 *   6. **Record** — a send event, and the offer's email status.
 *
 * One recipient per call. There is no list parameter, no loop over recipients
 * and no `sendMany` anywhere in this module (§14). A caller wanting to send to
 * three people calls this three times, each behind its own confirmation.
 */

import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { emailSnapshots, offers, portalTokens, sendEvents } from '@/db/schema'
import { audit } from '@/lib/audit'
import type { Actor } from '@/lib/audit'
import {
  ComplianceBlockedError,
  evaluateOfferCompliance,
  type ComplianceApprovalRecord,
  type ComplianceDecision,
  type GateableOffer,
} from '@/lib/compliance'
import type { DriftEvaluation } from '@/lib/compliance'
import { issueToken } from '@/lib/crypto'
import { renderEmail, UnresolvedVariableError } from '@/lib/email/render'
import { assertNoOfferTerms } from '@/lib/reminders/no-offer-terms'
import { loadCurrentTemplate, type EmailTemplateKind } from '@/lib/email/templates'
import { sendOneEmail } from '@/lib/email/transport'
import type { SendAttemptResult } from '@/lib/email/transport'
import {
  buildPortalLink,
  type RecipientVariableInput,
  type SenderDefaults,
} from '@/lib/email/variables'

/**
 * Fourteen days. §4.1 says the claim link is single-use and expiring without
 * naming a duration, so this is the conservative reading: long enough that an
 * invitation read a week later still works, short enough that a link sitting in
 * an old mailbox stops being a way in. A fresh one is one click from the
 * portal, so the cost of expiry is low and the cost of a permanent link is not.
 */
export const CLAIM_TOKEN_TTL_DAYS = 14

/**
 * The document about to be sent is the document that was approved.
 *
 * §8.2 item 2: a changed word is a different offer document. The drift check
 * establishes that when the batch is loaded; this establishes it again for the
 * one email at the moment it is rendered, which is where it actually matters.
 * A hash that disagrees is not a warning — nothing goes out.
 */
export class TemplateNotApprovedError extends Error {
  constructor(rendered: string, approved: string) {
    super(
      'The email that was about to be sent is not the email that was approved. Its template ' +
        `hashes to ${rendered.slice(0, 12)}…, and the recorded approval covers ` +
        `${approved.slice(0, 12)}…. Nothing was sent. Record a new approval for the current ` +
        'template, or restore the approved wording.',
    )
    this.name = 'TemplateNotApprovedError'
  }
}

function assertApprovedSource(
  renderedHash: string,
  approval: ComplianceApprovalRecord | null,
): void {
  // A null approval never reaches here — the compliance gate refused it in
  // step 1 — but the check is written so that it would refuse rather than pass.
  if (!approval) return
  if (renderedHash !== approval.approvedTemplateHash) {
    throw new TemplateNotApprovedError(renderedHash, approval.approvedTemplateHash)
  }
}

export interface SendInvitationTarget {
  offerId: string
  accountId: string
  recipientName: string
  recipientEmail: string
  jurisdiction: string | null
  blocked: boolean
  blockReason: GateableOffer['blockReason']
  blockDetail: string | null
  jurisdictionApprovalRef: string | null
  /** Decimal strings, straight from the driver. Never coerced. */
  proposedAmountUsd: string
  spvPercentage: string
  indirectPercentage: string
  responseDeadline: string
  rowSenderName: string | null
  rowSenderEmail: string | null
  rowSenderPhone: string | null
}

export interface SendInvitationInput {
  target: SendInvitationTarget
  defaults: SenderDefaults
  /** Loaded once for the batch by the caller, so N sends do not do N lookups. */
  approval: ComplianceApprovalRecord | null
  drift: Pick<DriftEvaluation, 'state' | 'message'>
  actor: Actor
  actorUserId: string | null
  kind?: EmailTemplateKind
  /**
   * Whether a successful or failed send rewrites `offers.email_status`.
   *
   * True for an invitation, because that column IS the state of the
   * invitation. False for a reminder: a reminder that fails must not mark the
   * offer's invitation as FAILED when the invitation itself arrived perfectly
   * a week ago. A reminder's outcome lives in `reminder_events` and
   * `send_events`, which is where somebody looking for it would go.
   */
  updateOfferEmailStatus?: boolean
  now?: Date
}

export type SendInvitationResult =
  | { outcome: 'SENT'; messageId: string; snapshotId: string }
  | {
      outcome: 'BLOCKED'
      /** Verbatim from the gate. Specific, never generic. */
      message: string
      decision: Extract<ComplianceDecision, { allowed: false }>
    }
  | { outcome: 'FAILED'; message: string; snapshotId: string | null; permanent: boolean }

/**
 * `renderEmail` needs the figures as strings and the portal link as a real URL.
 * Nothing in here converts a money value or a percentage to a number.
 */
function variableInput(
  target: SendInvitationTarget,
  portalLink: string,
): RecipientVariableInput {
  return {
    offerId: target.offerId,
    recipientName: target.recipientName,
    recipientEmail: target.recipientEmail,
    proposedAmountUsd: target.proposedAmountUsd,
    spvPercentage: target.spvPercentage,
    indirectPercentage: target.indirectPercentage,
    responseDeadline: target.responseDeadline,
    portalLink,
    rowSenderName: target.rowSenderName,
    rowSenderEmail: target.rowSenderEmail,
    rowSenderPhone: target.rowSenderPhone,
  }
}

export async function sendInvitation(
  input: SendInvitationInput,
): Promise<SendInvitationResult> {
  const kind = input.kind ?? 'INVITATION'
  const now = input.now ?? new Date()
  const target = input.target
  const writesEmailStatus = input.updateOfferEmailStatus ?? true

  // --- 1. The compliance gate --------------------------------------------
  const decision = evaluateOfferCompliance({
    offer: {
      id: target.offerId,
      jurisdiction: target.jurisdiction,
      blocked: target.blocked,
      blockReason: target.blockReason,
      blockDetail: target.blockDetail,
      jurisdictionApprovalRef: target.jurisdictionApprovalRef,
      recipientName: target.recipientName,
    },
    approval: input.approval,
    drift: input.drift,
  })

  if (!decision.allowed) {
    // Recorded against this offer alone. Nothing about any other recipient
    // changes, and the caller's loop — if it has one — carries on.
    await db.insert(sendEvents).values({
      offerId: target.offerId,
      kind,
      outcome: 'BLOCKED',
      blockReason: decision.reason,
      actorUserId: input.actorUserId,
    })

    const blockUpdate = {
      ...(writesEmailStatus ? { emailStatus: 'BLOCKED' as const } : {}),
      ...(decision.blockReason
        ? { blocked: true, blockReason: decision.blockReason }
        : {}),
    }

    // A reminder refused for a reason that is not per-recipient — no approval
    // recorded, or template drift — changes nothing on the offer. The send
    // event above is the record. Issuing an empty `set` would throw.
    if (Object.keys(blockUpdate).length > 0) {
      await db.update(offers).set(blockUpdate).where(eq(offers.id, target.offerId))
    }

    await audit({
      actor: input.actor,
      entityType: 'offer',
      entityId: target.offerId,
      action: 'invitation.blocked',
      // The reason, never the email body.
      metadata: { kind, reason: decision.reason },
    })

    return { outcome: 'BLOCKED', message: decision.message, decision }
  }

  // --- 2. The claim token -------------------------------------------------
  const { token, hash } = issueToken()
  const expiresAt = new Date(now.getTime() + CLAIM_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000)

  await db.insert(portalTokens).values({
    accountId: target.accountId,
    offerId: target.offerId,
    purpose: 'CLAIM',
    tokenHash: hash,
    expiresAt,
  })

  // --- 3. Render ----------------------------------------------------------
  //
  // `loadCurrentTemplate`, not `templateSource`. The drift check in §8.2 hashes
  // `loadCurrentTemplate`, which prefers a stored `email_templates` row over
  // the built-in default. Rendering from the built-in while approving the
  // stored one would mean the gate passed on one document and a different
  // document went out — which is the one thing the compliance approval exists
  // to prevent. The two loaders must be the same loader.
  //
  // `assertApprovedSource` below is the belt to that braces: whatever was
  // loaded, its hash has to be the hash that was approved.
  const source = await loadCurrentTemplate(kind)
  let rendered
  try {
    rendered = renderEmail(source, variableInput(target, buildPortalLink(token)), input.defaults)
    assertApprovedSource(rendered.templateHash, input.approval)
    if (kind === 'REMINDER') assertNoOfferTerms({ template: source, rendered })
  } catch (error) {
    // Pre-flight is supposed to have caught this for the whole batch. Reaching
    // here means something changed in between, so the token just minted is
    // revoked rather than left live for a link that was never sent.
    await db
      .update(portalTokens)
      .set({ revokedAt: now })
      .where(eq(portalTokens.tokenHash, hash))

    const message =
      error instanceof UnresolvedVariableError
        ? error.message
        : error instanceof Error
          ? error.message
          : 'The email could not be rendered.'

    await db.insert(sendEvents).values({
      offerId: target.offerId,
      kind,
      outcome: 'FAILED_PERMANENT',
      errorDetail: message,
      actorUserId: input.actorUserId,
    })
    if (writesEmailStatus) {
      await db
        .update(offers)
        .set({ emailStatus: 'FAILED' })
        .where(eq(offers.id, target.offerId))
    }

    return { outcome: 'FAILED', message, snapshotId: null, permanent: true }
  }

  // --- 4. The snapshot, before the transport is touched -------------------
  const fromName = input.defaults.defaultSenderName ?? 'Flipit'
  const fromAddress =
    input.defaults.defaultSenderEmail ?? input.defaults.authenticatedSenderEmail ?? ''

  const [snapshot] = await db
    .insert(emailSnapshots)
    .values({
      offerId: target.offerId,
      kind,
      subject: rendered.subject,
      htmlBody: rendered.html,
      textBody: rendered.text,
      fromAddress,
      fromName,
      toAddress: target.recipientEmail,
      templateHash: rendered.templateHash,
    })
    .returning({ id: emailSnapshots.id })

  const snapshotId = snapshot!.id

  // --- 5. The transport gate, then the send -------------------------------
  let attempt: SendAttemptResult
  try {
    attempt = await sendOneEmail({
      // The intent follows the kind. Both are gated identically, but an audit
      // entry that calls a reminder an invitation is a lie in the one record
      // somebody reads after the fact.
      intent: kind,
      message: {
        to: target.recipientEmail,
        fromName,
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
      },
      actor: input.actor,
      now,
    })
  } catch (error) {
    // A §8.1/§7/§18.1 refusal. Specific message, already audited by the gate.
    const message =
      error instanceof Error ? error.message : 'Sending is currently refused.'

    await db
      .update(portalTokens)
      .set({ revokedAt: now })
      .where(eq(portalTokens.tokenHash, hash))

    await db.insert(sendEvents).values({
      offerId: target.offerId,
      snapshotId,
      kind,
      outcome: 'BLOCKED',
      errorDetail: message,
      actorUserId: input.actorUserId,
    })

    return { outcome: 'FAILED', message, snapshotId, permanent: true }
  }

  // --- 6. Record ----------------------------------------------------------
  if (attempt.outcome === 'SUCCEEDED') {
    await db.insert(sendEvents).values({
      offerId: target.offerId,
      snapshotId,
      kind,
      outcome: 'SUCCEEDED',
      messageId: attempt.result.messageId,
      attempt: attempt.attempts,
      actorUserId: input.actorUserId,
    })

    if (writesEmailStatus) {
      await db
        .update(offers)
        .set({ emailStatus: 'SENT' })
        .where(eq(offers.id, target.offerId))
    }

    await audit({
      actor: input.actor,
      entityType: 'offer',
      entityId: target.offerId,
      action: 'invitation.sent',
      // The Message-ID and the snapshot, never the subject or either body.
      metadata: { kind, snapshotId, attempts: attempt.attempts },
    })

    return { outcome: 'SENT', messageId: attempt.result.messageId, snapshotId }
  }

  const permanent = attempt.outcome === 'FAILED_PERMANENT'

  await db.insert(sendEvents).values({
    offerId: target.offerId,
    snapshotId,
    kind,
    outcome: attempt.outcome,
    errorDetail: attempt.failure.message,
    attempt: attempt.attempts,
    actorUserId: input.actorUserId,
  })

  if (writesEmailStatus) {
    await db
      .update(offers)
      .set({ emailStatus: 'FAILED' })
      .where(eq(offers.id, target.offerId))
  }

  // The token stays live for a transient failure — the same invitation will be
  // retried and should carry a link the investor can still use. A permanent
  // failure revokes it: nothing is going to that address.
  if (permanent) {
    await db
      .update(portalTokens)
      .set({ revokedAt: now })
      .where(eq(portalTokens.tokenHash, hash))
  }

  return {
    outcome: 'FAILED',
    message: attempt.failure.message,
    snapshotId,
    permanent,
  }
}

export { ComplianceBlockedError }
