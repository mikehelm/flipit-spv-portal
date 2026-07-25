/**
 * The updates feed. BUILD_SPEC §6.
 *
 * Four rules, and each is enforced somewhere a later caller cannot route
 * around:
 *
 *   1. **Immutable once published.** `editDraft` refuses a published row, and
 *      there is no update statement anywhere in this file that writes `title`
 *      or `body` outside it. A correction is a new update.
 *   2. **Withdrawal leaves a tombstone.** The row is kept, `withdrawn_at` and a
 *      reason are set, and the audit entry records what was withdrawn and why.
 *      Nothing is deleted.
 *   3. **The audience is resolved once, at publication**, into delivery rows.
 *      The investor's feed reads its own delivery rows, so a targeted update
 *      reaching only its recipients is a join rather than a filter.
 *   4. **Publishing sends nothing.** §14 — "no bulk send; sending is one
 *      recipient at a time, by design". Publishing queues the notifications and
 *      the operator sends each one, exactly as an invitation goes out. The one
 *      unattended sender in this application is the reminder (§6.5), and it is
 *      unattended because §6.5 spells out the constraints that make it safe.
 *      Nothing here inherits that.
 */

import { and, eq, inArray, isNull, sql } from 'drizzle-orm'
import { db } from '@/db'
import { investorAccounts, portalUpdates, updateDeliveries } from '@/db/schema'
import { audit, type Actor } from '@/lib/audit'
import { readServiceConfig } from '@/lib/auth/service-config'
import { sendOneEmail } from '@/lib/email/transport'
import { absoluteUrl, buildVerificationLink } from '@/lib/email/variables'
import { portalAccess, type AccountStatus } from '@/lib/portal/access'
import {
  decodeAudience,
  encodeAudience,
  isAddressable,
  statusesFor,
  type UpdateAudience,
} from './audience'
import { buildUpdateNotification } from './notification'

export const UPDATES_PATH = '/updates'
export const PORTAL_PATH = '/portal'

export type UpdateResult<T = undefined> =
  | ({ ok: true } & (T extends undefined ? object : { value: T }))
  | { ok: false; message: string }

// ---------------------------------------------------------------------------
// Drafting — §6
// ---------------------------------------------------------------------------

export async function createDraft(input: {
  title: string
  body: string
  audience: UpdateAudience
  notifyByEmail: boolean
  authorId: string
  actor: Actor
}): Promise<{ ok: true; updateId: string } | { ok: false; message: string }> {
  const title = input.title.trim()
  const body = input.body.trim()

  if (title === '') return { ok: false, message: 'An update needs a title.' }
  if (body === '') return { ok: false, message: 'An update needs something to say.' }

  const [created] = await db
    .insert(portalUpdates)
    .values({
      title,
      body,
      audienceFilter: encodeAudience(input.audience),
      notifyByEmail: input.notifyByEmail,
      authorId: input.authorId,
    })
    .returning({ id: portalUpdates.id })

  await audit({
    actor: input.actor,
    entityType: 'portal_update',
    entityId: created!.id,
    action: 'update.drafted',
    metadata: {
      audienceKind: input.audience.kind,
      titleCharacters: title.length,
      // `characters`, not `bodyCharacters`: the audit guard rejects any key
      // matching /body/ outright rather than redacting it, and it is right to
      // — the blunt rule is what stops somebody passing the whole object in.
      characters: body.length,
      notifyByEmail: input.notifyByEmail,
    },
  })

  return { ok: true, updateId: created!.id }
}

/**
 * Change a draft. Refuses anything already published (§6).
 *
 * The refusal names the alternative rather than just saying no: a correction is
 * a new update, and the operator should not have to guess that.
 */
export async function editDraft(input: {
  updateId: string
  title: string
  body: string
  audience: UpdateAudience
  notifyByEmail: boolean
  actor: Actor
}): Promise<{ ok: true } | { ok: false; message: string }> {
  const existing = await db.query.portalUpdates.findFirst({
    where: eq(portalUpdates.id, input.updateId),
  })
  if (!existing) return { ok: false, message: 'That update could not be found.' }

  if (existing.publishedAt !== null) {
    return {
      ok: false,
      message:
        'This update has been published, and a published update cannot be changed. People have ' +
        'read it, and some of them have an email saying it exists. Publish a correction as a ' +
        'new update instead — the original stays where it is, which is the honest record.',
    }
  }

  const title = input.title.trim()
  const body = input.body.trim()
  if (title === '') return { ok: false, message: 'An update needs a title.' }
  if (body === '') return { ok: false, message: 'An update needs something to say.' }

  await db
    .update(portalUpdates)
    .set({
      title,
      body,
      audienceFilter: encodeAudience(input.audience),
      notifyByEmail: input.notifyByEmail,
    })
    .where(eq(portalUpdates.id, input.updateId))

  await audit({
    actor: input.actor,
    entityType: 'portal_update',
    entityId: input.updateId,
    action: 'update.draft_edited',
    metadata: { audienceKind: input.audience.kind, titleCharacters: title.length },
  })

  return { ok: true }
}

export async function deleteDraft(input: {
  updateId: string
  actor: Actor
}): Promise<{ ok: true } | { ok: false; message: string }> {
  const existing = await db.query.portalUpdates.findFirst({
    where: eq(portalUpdates.id, input.updateId),
  })
  if (!existing) return { ok: false, message: 'That update could not be found.' }

  if (existing.publishedAt !== null) {
    return {
      ok: false,
      message:
        'A published update is never deleted. Withdraw it instead — that removes it from every ' +
        'portal and leaves a record of what was withdrawn and why.',
    }
  }

  await db.delete(portalUpdates).where(eq(portalUpdates.id, input.updateId))

  await audit({
    actor: input.actor,
    entityType: 'portal_update',
    entityId: input.updateId,
    action: 'update.draft_discarded',
  })

  return { ok: true }
}

// ---------------------------------------------------------------------------
// Resolving the audience — §6
// ---------------------------------------------------------------------------

export interface ResolvedRecipient {
  accountId: string
  name: string
  email: string
  status: AccountStatus
}

/**
 * Who this audience currently comes to.
 *
 * Used for the preview before publication and again at publication itself. It
 * excludes suspended and archived accounts in every case, including when a
 * status filter names them — neither has portal access, and a delivery row for
 * an account that cannot read is a record of something that did not happen.
 */
export async function resolveAudience(
  audience: UpdateAudience,
): Promise<ResolvedRecipient[]> {
  if (audience.kind === 'ONE') {
    const account = await db.query.investorAccounts.findFirst({
      where: eq(investorAccounts.id, audience.accountId),
    })
    if (!account || !isAddressable(account.status as AccountStatus)) return []
    return [
      {
        accountId: account.id,
        name: account.name,
        email: account.email,
        status: account.status as AccountStatus,
      },
    ]
  }

  const statuses = statusesFor(audience)
  if (statuses.length === 0) return []

  const rows = await db
    .select({
      accountId: investorAccounts.id,
      name: investorAccounts.name,
      email: investorAccounts.email,
      status: investorAccounts.status,
    })
    .from(investorAccounts)
    .where(inArray(investorAccounts.status, statuses as AccountStatus[]))
    .orderBy(investorAccounts.name)

  return rows.map((row) => ({ ...row, status: row.status as AccountStatus }))
}

// ---------------------------------------------------------------------------
// Publishing — §6
// ---------------------------------------------------------------------------

export async function publishUpdate(input: {
  updateId: string
  actor: Actor
  now?: Date
}): Promise<{ ok: true; recipients: number } | { ok: false; message: string }> {
  const now = input.now ?? new Date()

  const existing = await db.query.portalUpdates.findFirst({
    where: eq(portalUpdates.id, input.updateId),
  })
  if (!existing) return { ok: false, message: 'That update could not be found.' }
  if (existing.publishedAt !== null) {
    return { ok: false, message: 'That update is already published.' }
  }

  const audience = decodeAudience(existing.audienceFilter)
  const recipients = await resolveAudience(audience)

  if (recipients.length === 0) {
    return {
      ok: false,
      message:
        'Nobody currently matches this audience, so publishing it would put a notice where ' +
        'nobody can read it. Widen the audience, or leave it as a draft until somebody does.',
    }
  }

  await db.transaction(async (tx) => {
    await tx
      .update(portalUpdates)
      .set({ publishedAt: now })
      .where(eq(portalUpdates.id, input.updateId))

    for (const recipient of recipients) {
      await tx
        .insert(updateDeliveries)
        .values({ updateId: input.updateId, accountId: recipient.accountId })
        .onConflictDoNothing()
    }
  })

  await audit({
    actor: input.actor,
    entityType: 'portal_update',
    entityId: input.updateId,
    action: 'update.published',
    // A count and the audience shape. Never the body, and never the list of
    // addresses — the delivery rows are the record of who, and duplicating
    // them into the audit log would put a roster of investors in it.
    metadata: {
      audienceKind: audience.kind,
      recipients: recipients.length,
      notifyByEmail: existing.notifyByEmail,
    },
  })

  return { ok: true, recipients: recipients.length }
}

/**
 * Withdraw a published update. §6: "Withdrawal is possible but leaves a
 * tombstone in the audit log."
 *
 * The row is kept and the delivery rows are kept. Only the feed stops showing
 * it. Deleting would destroy the evidence of what was published, which is the
 * opposite of what a tombstone is for.
 */
export async function withdrawUpdate(input: {
  updateId: string
  reason: string
  actor: Actor
  now?: Date
}): Promise<{ ok: true } | { ok: false; message: string }> {
  const now = input.now ?? new Date()
  const reason = input.reason.trim()

  if (reason.length < 10) {
    return {
      ok: false,
      message:
        'Withdrawing needs a recorded reason of at least ten characters. It goes in the audit ' +
        'log, not on anybody’s screen.',
    }
  }

  const existing = await db.query.portalUpdates.findFirst({
    where: eq(portalUpdates.id, input.updateId),
  })
  if (!existing) return { ok: false, message: 'That update could not be found.' }
  if (existing.publishedAt === null) {
    return { ok: false, message: 'That update was never published, so there is nothing to withdraw.' }
  }
  if (existing.withdrawnAt !== null) {
    return { ok: false, message: 'That update has already been withdrawn.' }
  }

  await db
    .update(portalUpdates)
    .set({ withdrawnAt: now, withdrawnReason: reason })
    .where(eq(portalUpdates.id, input.updateId))

  await audit({
    actor: input.actor,
    entityType: 'portal_update',
    entityId: input.updateId,
    action: 'update.withdrawn',
    metadata: {
      reason,
      publishedAt: existing.publishedAt.toISOString(),
      title: existing.title,
    },
  })

  return { ok: true }
}

export const WITHDRAWAL_NOTICE =
  'Withdrawing removes it from every portal. It does not un-send it — anyone who has already ' +
  'read it has already read it, and anyone who was emailed still has the email. The withdrawal, ' +
  'its reason and the title are recorded in the audit log.'

// ---------------------------------------------------------------------------
// Notifying — one recipient at a time (§6, §14)
// ---------------------------------------------------------------------------

export type NotifyResult =
  | { ok: true; messageId: string }
  | { ok: false; message: string }

/**
 * Send one notification, to one recipient.
 *
 * There is no counterpart that takes a list. §14: "no bulk send anywhere, in
 * the UI or the API. Sending is one recipient at a time by design." Publishing
 * queues these; each one is a press.
 *
 * The body is `buildUpdateNotification(portalLink, verificationLink)` and takes
 * nothing else — no title, no body, no name, no figure. §6 requires it to carry
 * no amounts, percentages or personal detail, and the way that is guaranteed is
 * that there is nothing to pass in.
 */
export async function notifyOneRecipient(input: {
  updateId: string
  accountId: string
  actor: Actor
  now?: Date
}): Promise<NotifyResult> {
  const now = input.now ?? new Date()

  const delivery = await db.query.updateDeliveries.findFirst({
    where: and(
      eq(updateDeliveries.updateId, input.updateId),
      eq(updateDeliveries.accountId, input.accountId),
    ),
  })
  if (!delivery) {
    return {
      ok: false,
      message: 'That person is not among this update’s recipients, so nothing was sent.',
    }
  }
  if (delivery.notifiedAt !== null) {
    return { ok: false, message: 'They have already been notified about this update.' }
  }

  const update = await db.query.portalUpdates.findFirst({
    where: eq(portalUpdates.id, input.updateId),
  })
  if (!update || update.publishedAt === null) {
    return { ok: false, message: 'That update is not published, so nothing can be sent about it.' }
  }
  if (update.withdrawnAt !== null) {
    return {
      ok: false,
      message: 'That update has been withdrawn. Notifying people about it now would be worse ' +
        'than the original mistake.',
    }
  }

  const account = await db.query.investorAccounts.findFirst({
    where: eq(investorAccounts.id, input.accountId),
  })
  if (!account) return { ok: false, message: 'That account could not be found.' }

  // The account must still be able to read what it is being told about. A
  // suspension between publication and notification is a decision about a
  // person, and it wins.
  const config = await readServiceConfig()
  const access = portalAccess({
    accountStatus: account.status as AccountStatus,
    closedAccountAccess: config.closedAccountAccess,
    serviceMode: config.serviceMode,
  })
  if (access.capability === 'NONE') {
    return {
      ok: false,
      message:
        'That account cannot currently reach the portal, so an email telling them to open it ' +
        'would be pointless at best. Nothing was sent.',
    }
  }

  const message = buildUpdateNotification(absoluteUrl(PORTAL_PATH), buildVerificationLink())

  let attempt
  try {
    attempt = await sendOneEmail({
      intent: 'NOTIFICATION',
      message: {
        to: account.email,
        fromName: config.defaultSenderName ?? 'Flipit',
        subject: message.subject,
        html: message.html,
        text: message.text,
      },
      actor: input.actor,
      now,
    })
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'Sending is currently refused.'
    await audit({
      actor: input.actor,
      entityType: 'portal_update',
      entityId: input.updateId,
      action: 'update.notification_blocked',
      metadata: { accountId: input.accountId },
    })
    return { ok: false, message: detail }
  }

  if (attempt.outcome !== 'SUCCEEDED') {
    await audit({
      actor: input.actor,
      entityType: 'portal_update',
      entityId: input.updateId,
      action: 'update.notification_failed',
      metadata: {
        accountId: input.accountId,
        outcome: attempt.outcome,
        reason: attempt.failure.reason,
      },
    })
    return { ok: false, message: attempt.failure.message }
  }

  await db
    .update(updateDeliveries)
    .set({ notifiedAt: now })
    .where(eq(updateDeliveries.id, delivery.id))

  await audit({
    actor: input.actor,
    entityType: 'portal_update',
    entityId: input.updateId,
    action: 'update.notification_sent',
    metadata: { accountId: input.accountId, messageId: attempt.result.messageId },
  })

  return { ok: true, messageId: attempt.result.messageId }
}

/** Mark an update as read by the account looking at it. */
export async function markRead(input: {
  updateId: string
  accountId: string
  now?: Date
}): Promise<void> {
  await db
    .update(updateDeliveries)
    .set({ readAt: input.now ?? new Date() })
    .where(
      and(
        eq(updateDeliveries.updateId, input.updateId),
        eq(updateDeliveries.accountId, input.accountId),
        isNull(updateDeliveries.readAt),
      ),
    )
}

/** How many of an update's recipients have been notified. */
export async function notificationProgress(
  updateId: string,
): Promise<{ total: number; notified: number }> {
  const [row] = await db
    .select({
      total: sql<number>`count(*)::int`,
      notified: sql<number>`count(${updateDeliveries.notifiedAt})::int`,
    })
    .from(updateDeliveries)
    .where(eq(updateDeliveries.updateId, updateId))

  return { total: row?.total ?? 0, notified: row?.notified ?? 0 }
}
