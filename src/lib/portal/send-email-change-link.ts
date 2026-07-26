/**
 * Putting the two contact-address messages in front of the right mailboxes.
 * BUILD_SPEC §13, §8.1.
 *
 * Neither function takes an address. Both take a request id and read the
 * mailbox off the row — the same invariant as `send-sign-in-link.ts`, and for a
 * sharper reason here: one of these messages is caused by an authenticated
 * investor typing an address into a form, so an address parameter anywhere in
 * this module would be a way to make this application send mail to an arbitrary
 * recipient. It is why `email_change_requests` carries `previous_email` at all.
 *
 * The transport gate applies in full (§8.1 credential, §7 service mode, §18.1
 * deployment). The compliance approval does not — see `email-change-email.ts`.
 *
 * **Failure is silent to the investor.** They have already been told the one
 * sentence §13's flow requires, and whether the mail server is connected is not
 * their business. It is loud in the audit log instead.
 */

import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { emailChangeRequests } from '@/db/schema'
import { audit } from '@/lib/audit'
import { readServiceConfig } from '@/lib/auth/service-config'
import { sendOneEmail } from '@/lib/email/transport'
import { buildEmailChangeLink, buildVerificationLink } from '@/lib/email/variables'
import { buildEmailChangeConfirmation, buildEmailChangeNotice } from './email-change-email'

export type DeliveryResult =
  | { delivered: true }
  | { delivered: false; reason: 'NO_SUCH_REQUEST' | 'NO_ADDRESS' | 'REFUSED' | 'FAILED' }

export interface DeliverEmailChangeLinkInput {
  requestId: string
  /** The plaintext token. Never logged, never stored, never returned. */
  token: string
  expiresInMinutes: number
}

/**
 * The confirmation link, to the address the investor asked to move to.
 *
 * The recipient is `email_change_requests.new_email` for this request id and
 * cannot be anything else.
 */
export async function deliverEmailChangeLink(
  input: DeliverEmailChangeLinkInput,
): Promise<DeliveryResult> {
  const request = await db.query.emailChangeRequests.findFirst({
    where: eq(emailChangeRequests.id, input.requestId),
    columns: { id: true, accountId: true, newEmail: true },
  })
  if (!request) return { delivered: false, reason: 'NO_SUCH_REQUEST' }

  const message = buildEmailChangeConfirmation(
    buildEmailChangeLink(input.token),
    buildVerificationLink(),
    input.expiresInMinutes,
  )

  return await deliver({
    accountId: request.accountId,
    to: request.newEmail,
    message,
    action: 'portal.email_change_link',
    stageMetadata: { part: 'CONFIRMATION' },
  })
}

/**
 * The "this happened" notice, to the address the record used to carry.
 *
 * Called after the change has taken effect. If the request has no
 * `previous_email` — only possible for a row written before this column
 * existed — nothing is sent rather than a message being guessed at.
 */
export async function notifyPreviousAddress(requestId: string): Promise<DeliveryResult> {
  const request = await db.query.emailChangeRequests.findFirst({
    where: eq(emailChangeRequests.id, requestId),
    columns: { id: true, accountId: true, previousEmail: true },
  })
  if (!request) return { delivered: false, reason: 'NO_SUCH_REQUEST' }

  const previous = request.previousEmail?.trim() ?? ''
  if (previous === '') return { delivered: false, reason: 'NO_ADDRESS' }

  const config = await readServiceConfig()

  // Where to raise it. The operator's own address while the portal runs, and
  // the standing address as the fallback — the same order as `contact.ts`,
  // and null when neither is configured, in which case the message tells the
  // reader to reply to previous correspondence rather than naming a route that
  // is not one.
  const contact =
    config.defaultSenderEmail?.trim() || config.serviceContactEmail?.trim() || null

  const message = buildEmailChangeNotice(contact, buildVerificationLink())

  return await deliver({
    accountId: request.accountId,
    to: previous,
    message,
    action: 'portal.email_change_notice',
    stageMetadata: { part: 'PREVIOUS_ADDRESS_NOTICE' },
  })
}

async function deliver(input: {
  accountId: string
  to: string
  message: { subject: string; html: string; text: string }
  action: string
  stageMetadata: Record<string, unknown>
}): Promise<DeliveryResult> {
  const actor = { kind: 'investor' as const, id: input.accountId, label: 'investor' }
  const config = await readServiceConfig()

  let attempt
  try {
    attempt = await sendOneEmail({
      intent: 'NOTIFICATION',
      message: {
        to: input.to,
        fromName: config.defaultSenderName ?? 'Flipit',
        subject: input.message.subject,
        html: input.message.html,
        text: input.message.text,
      },
      actor,
    })
  } catch {
    // A §8.1, §7 or §18.1 refusal. `sendOneEmail` has already audited it with
    // its reason codes; this records only which message did not arrive.
    await audit({
      actor,
      entityType: 'investor_account',
      entityId: input.accountId,
      action: `${input.action}_not_delivered`,
      metadata: { ...input.stageMetadata, stage: 'GATE' },
    })
    return { delivered: false, reason: 'REFUSED' }
  }

  if (attempt.outcome !== 'SUCCEEDED') {
    await audit({
      actor,
      entityType: 'investor_account',
      entityId: input.accountId,
      action: `${input.action}_not_delivered`,
      // The failure class and the attempt count. Never an address, never the
      // token, never the body.
      metadata: {
        ...input.stageMetadata,
        stage: 'TRANSPORT',
        outcome: attempt.outcome,
        attempts: attempt.attempts,
      },
    })
    return { delivered: false, reason: 'FAILED' }
  }

  await audit({
    actor,
    entityType: 'investor_account',
    entityId: input.accountId,
    action: `${input.action}_delivered`,
    metadata: { ...input.stageMetadata, attempts: attempt.attempts },
  })

  return { delivered: true }
}
