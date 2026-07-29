'use server'

import { eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { actionError, actionOk, type ActionState } from '@/components/admin/action-state'
import { db } from '@/db'
import { serviceConfig } from '@/db/schema'
import { audit } from '@/lib/audit'
import { requireAdmin, requireOwner } from '@/lib/auth/guards'
import { readServiceConfig, SERVICE_CONFIG_ID } from '@/lib/auth/service-config'
import { verifyMailConnection } from '@/lib/email/transport'
import {
  smtpCredentialSchema,
  storeSmtpCredential,
} from '@/lib/email/transport/configure'

/**
 * The mail connection, from the admin side. BUILD_SPEC §8.1, §12.
 *
 *   "Provide a 'test connection' action that authenticates against SMTP
 *   without sending."
 *
 * There is deliberately nothing here that sends to
 * anybody: a "test connection" that quietly emails someone is not a test, and
 * a send action in a file called mail-connection is where a bulk send would
 * eventually be added by someone in a hurry. Sending lives behind
 * `sendOneEmail`, one recipient at a time (§14).
 *
 * Testing and disconnecting are open to either acting administrator. The
 * Owner may also configure the shared service mailbox from Settings. That
 * separate action is guarded by `requireOwner()` and never returns the secret.
 */

const REVALIDATE_PATHS = ['/admin', '/admin/settings', '/admin/onboarding']

function revalidate(): void {
  for (const path of REVALIDATE_PATHS) revalidatePath(path)
}

/**
 * Store the shared Gmail app password, then authenticate without sending.
 *
 * The Owner chose to manage this service credential. It is write-only in the
 * UI, encrypted before storage, omitted from audit metadata, and never passed
 * to a mail-sending function.
 */
export async function connectOwnerSendingAccountAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const owner = await requireOwner()

  const parsed = smtpCredentialSchema.safeParse({
    smtpUser: formData.get('smtpUser'),
    smtpPassword: formData.get('smtpPassword'),
  })
  if (!parsed.success) {
    const issues: Record<string, string> = {}
    for (const issue of parsed.error.issues) {
      issues[String(issue.path[0] ?? 'form')] = issue.message
    }
    return actionError('The sending account could not be saved.', issues)
  }

  await storeSmtpCredential(parsed.data)

  await audit({
    actor: { kind: 'user', id: owner.id, label: owner.email },
    entityType: 'mail_connection',
    entityId: SERVICE_CONFIG_ID,
    action: 'mail_connection.configured',
    metadata: { transport: 'SMTP', byRole: 'OWNER' },
  })

  const outcome = await verifyMailConnection({
    actor: { kind: 'user', id: owner.id, label: owner.email },
  })

  revalidate()

  if (!outcome.ok) {
    return actionError(
      'The app password was stored encrypted, but Gmail did not accept the connection. ' +
        `${outcome.detail} Nothing was sent.`,
    )
  }

  return actionOk(
    `Connected and verified as ${outcome.authenticatedAddress ?? parsed.data.smtpUser}. ` +
      'The app password is encrypted and will never be displayed. Nothing was sent.',
  )
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
  const admin = await requireOwner()
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
