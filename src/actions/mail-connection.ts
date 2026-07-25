'use server'

import { eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { actionError, actionOk, type ActionState } from '@/components/admin/action-state'
import { db } from '@/db'
import { serviceConfig } from '@/db/schema'
import { audit } from '@/lib/audit'
import { requireAdmin } from '@/lib/auth/guards'
import { readServiceConfig, SERVICE_CONFIG_ID } from '@/lib/auth/service-config'
import { verifyMailConnection } from '@/lib/email/transport'

/**
 * The mail connection, from the admin side. BUILD_SPEC §8.1, §12.
 *
 *   "Provide a 'test connection' action that authenticates against SMTP
 *   without sending."
 *
 * Two actions and no more. There is deliberately nothing here that sends to
 * anybody: a "test connection" that quietly emails someone is not a test, and
 * a send action in a file called mail-connection is where a bulk send would
 * eventually be added by someone in a hurry. Sending lives behind
 * `sendOneEmail`, one recipient at a time (§14).
 *
 * Both actions are open to either privileged role. The credential is the
 * operator's and only he enters it (onboarding step 3, §2.1) — but the owner
 * has full access to all records (§2), connection health is on the main
 * dashboard both of them see (§12), and an owner who can see that sending is
 * broken but cannot test or revoke it is an owner who has to phone someone.
 * Neither action reveals the credential; testing it and removing it are both
 * safe capabilities to hold.
 */

const REVALIDATE_PATHS = ['/admin', '/admin/settings', '/admin/onboarding']

function revalidate(): void {
  for (const path of REVALIDATE_PATHS) revalidatePath(path)
}

/**
 * Authenticate against smtp.gmail.com and record the result. Sends nothing.
 *
 * The result and its timestamp are written to `service_config` by
 * `verifyMailConnection`, so the dashboard and the send guard both read the
 * same record rather than each forming their own opinion.
 */
export async function testMailConnectionAction(
  _previous: ActionState,
  _formData: FormData,
): Promise<ActionState> {
  const admin = await requireAdmin()

  const outcome = await verifyMailConnection({
    actor: { kind: 'user', id: admin.id, label: admin.email },
  })

  revalidate()

  if (!outcome.ok) {
    // Specific, never generic. The operator has to know which of the four or
    // five possible causes this is. `detail` is produced by the classifier and
    // has already had any credential scrubbed out of it.
    return actionError(outcome.detail)
  }

  return actionOk(
    `Connected as ${outcome.authenticatedAddress ?? 'the configured account'} over STARTTLS on ` +
      'smtp.gmail.com:587. Nothing was sent to anyone — the check authenticates and stops. ' +
      'Verified just now, which is what the pre-flight checklist asks for.',
  )
}

/**
 * Disconnect the sending account.
 *
 * The encrypted values are cleared, not blanked-over, and the verification
 * record goes with them — leaving a stale "OK" behind would let the guard
 * believe a credential that no longer exists had passed a check.
 *
 * This does not revoke the app password at Google. It cannot: an app password
 * is revoked from the Google account that issued it, which is the honest
 * trade-off §8.1 records. The message says so, because someone disconnecting
 * because they think it is compromised needs to do the other half.
 */
export async function disconnectSendingAccountAction(
  _previous: ActionState,
  _formData: FormData,
): Promise<ActionState> {
  const admin = await requireAdmin()
  const config = await readServiceConfig()

  const wasConfigured = Boolean(config.smtpUserEncrypted) && Boolean(config.smtpPasswordEncrypted)

  if (!wasConfigured) {
    return actionError(
      'There is no sending account connected, so there is nothing to disconnect.',
    )
  }

  await db
    .update(serviceConfig)
    .set({
      smtpUserEncrypted: null,
      smtpPasswordEncrypted: null,
      smtpLastVerifiedAt: null,
      smtpLastVerifyResult: null,
    })
    .where(eq(serviceConfig.id, SERVICE_CONFIG_ID))

  await audit({
    actor: { kind: 'user', id: admin.id, label: admin.email },
    entityType: 'mail_connection',
    entityId: SERVICE_CONFIG_ID,
    action: 'mail_connection.disconnected',
    // Neither half of the credential goes in the log. BUILD_SPEC §15.
    metadata: { transport: config.emailTransport, byRole: admin.role },
  })

  revalidate()

  return actionOk(
    'Sending account disconnected and the stored app password deleted. Nothing can send until ' +
      'an account is connected again. This does not revoke the app password at Google — if the ' +
      "reason is that it may be compromised, revoke it in that Google account's security " +
      'settings as well.',
  )
}
