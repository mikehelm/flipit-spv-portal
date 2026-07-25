/**
 * Putting a sign-in link in front of the person who asked for it.
 * BUILD_SPEC §4.1, §8.1.
 *
 * One recipient, one call, and the recipient is not a parameter — it is looked
 * up from the account id, so there is no argument anywhere in this module that
 * could be pointed at somebody else's mailbox. That matters more here than
 * almost anywhere: this is the one email an unauthenticated stranger can cause
 * to be sent, and the only thing standing between that and an open relay is
 * that the address is never taken from the request.
 *
 * The transport gate still applies in full (§8.1 credential, §7 service mode,
 * §18.1 deployment). The compliance approval does not, and the reasoning is in
 * `sign-in-email.ts`.
 *
 * **Failure is silent to the investor, on purpose.** They have already been
 * told the one sentence §4.1 requires, and whether the mail server is connected
 * is not their business — telling them it failed would confirm the address
 * exists, which is the whole thing the identical sentence exists to hide. It is
 * loud in the audit log instead, which is where somebody who can act on it
 * looks.
 */

import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { investorAccounts } from '@/db/schema'
import { audit } from '@/lib/audit'
import { readServiceConfig } from '@/lib/auth/service-config'
import { sendOneEmail } from '@/lib/email/transport'
import { buildPortalLink, buildVerificationLink } from '@/lib/email/variables'
import { buildSignInEmail } from './sign-in-email'

export interface DeliverSignInLinkInput {
  accountId: string
  /** The plaintext token. Never logged, never stored, never returned. */
  token: string
  expiresInMinutes: number
}

export type DeliverSignInLinkResult =
  | { delivered: true }
  | { delivered: false; reason: 'NO_SUCH_ACCOUNT' | 'REFUSED' | 'FAILED' }

export async function deliverSignInLink(
  input: DeliverSignInLinkInput,
): Promise<DeliverSignInLinkResult> {
  const account = await db.query.investorAccounts.findFirst({
    where: eq(investorAccounts.id, input.accountId),
    columns: { id: true, email: true },
  })

  // The account was there a moment ago when the link was minted. If it has gone
  // since, nothing is sent and nothing is guessed at.
  if (!account) return { delivered: false, reason: 'NO_SUCH_ACCOUNT' }

  const message = buildSignInEmail(
    buildPortalLink(input.token),
    buildVerificationLink(),
    input.expiresInMinutes,
  )

  const actor = { kind: 'investor' as const, id: account.id, label: 'investor' }
  const config = await readServiceConfig()

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
      actor,
    })
  } catch {
    // A §8.1, §7 or §18.1 refusal. `sendOneEmail` has already audited it with
    // its reason codes, so this records only that a sign-in link was the thing
    // refused — the operator seeing "email.blocked" needs to know what did not
    // arrive.
    await audit({
      actor,
      entityType: 'investor_account',
      entityId: account.id,
      action: 'portal.sign_in_link_not_delivered',
      metadata: { stage: 'GATE' },
    })
    return { delivered: false, reason: 'REFUSED' }
  }

  if (attempt.outcome !== 'SUCCEEDED') {
    await audit({
      actor,
      entityType: 'investor_account',
      entityId: account.id,
      action: 'portal.sign_in_link_not_delivered',
      // The failure class and the attempt count. Never the address, never the
      // token, never the body.
      metadata: {
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
    entityId: account.id,
    action: 'portal.sign_in_link_delivered',
    metadata: { attempts: attempt.attempts },
  })

  return { delivered: true }
}
