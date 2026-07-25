'use server'

import { redirect } from 'next/navigation'
import { z } from 'zod'
import { actionError, type ActionState } from '@/components/admin/action-state'
import { audit } from '@/lib/audit'
import { drizzleCredentialStore } from '@/lib/auth/credential-store'
import { requireAdmin } from '@/lib/auth/guards'
import { setAdminPassword } from '@/lib/auth/set-password'
import { destroyAdminSession } from '@/lib/auth/session'

/**
 * Choosing and changing an administrator password. BUILD_SPEC §2.2.
 *
 * The password fields are read straight out of `FormData` and handed to
 * `setAdminPassword`. They are never put in an audit entry, a returned message,
 * a redirect parameter or a thrown error — the audit records *that* a password
 * was set and by whom, which is the part that is useful afterwards.
 *
 * `setPasswordHash` deletes every session for the account inside the same
 * transaction that writes the verifier, which includes the session making this
 * request. So both actions finish by clearing the cookie and sending the person
 * to sign in with the password they just chose. That is not merely tidy: a
 * session left holding a cookie whose row has been deleted would appear signed
 * in until its next request, and "appears signed in" is the wrong answer to
 * "did my password change take effect".
 */

const schema = z.object({
  currentPassword: z.string().max(200).optional(),
  newPassword: z.string().min(1, 'Choose a password.').max(200),
  confirmation: z.string().min(1, 'Type the password a second time.').max(200),
})

async function apply(
  formData: FormData,
  expectCurrent: boolean,
): Promise<ActionState> {
  const admin = await requireAdmin()

  const parsed = schema.safeParse({
    currentPassword: formData.get('currentPassword') ?? undefined,
    newPassword: formData.get('newPassword') ?? '',
    confirmation: formData.get('confirmation') ?? '',
  })

  if (!parsed.success) {
    return actionError(
      parsed.error.issues[0]?.message ?? 'That form could not be read. Nothing was changed.',
    )
  }

  const result = await setAdminPassword(
    {
      userId: admin.id,
      email: admin.email,
      name: admin.name,
      newPassword: parsed.data.newPassword,
      confirmation: parsed.data.confirmation,
      currentPassword: expectCurrent ? (parsed.data.currentPassword ?? '') : null,
    },
    { store: drizzleCredentialStore() },
  )

  if (!result.ok) {
    await audit({
      actor: { kind: 'user', id: admin.id, label: admin.email },
      entityType: 'user',
      entityId: admin.id,
      action: 'access.password_change_refused',
      metadata: { reason: result.reason },
    })
    return actionError(result.message)
  }

  await audit({
    actor: { kind: 'user', id: admin.id, label: admin.email },
    entityType: 'user',
    entityId: admin.id,
    action: expectCurrent ? 'access.password_changed' : 'access.password_chosen',
    metadata: { sessionsEnded: 'all' },
  })

  await destroyAdminSession()
  redirect('/signin?changed=password')
}

/** First password, reached after redeeming a one-time setup link. */
export async function choosePasswordAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return apply(formData, false)
}

/** Changing an existing password. Requires the current one. */
export async function changePasswordAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return apply(formData, true)
}

