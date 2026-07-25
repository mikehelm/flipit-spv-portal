/**
 * Choosing and changing an administrator password. BUILD_SPEC §2.2.
 *
 * Two entry points, one function, because they differ in exactly one respect:
 *
 *   - **Choosing** a password for the first time. The account exists (the seed
 *     made it) and has no verifier. Authority comes from having redeemed a
 *     single-use setup link, which the caller has already established.
 *   - **Changing** one. Authority comes from knowing the current password, and
 *     it is checked here rather than by the caller so that no caller can decide
 *     to skip it.
 *
 * Both end every other session. §2.2 says a password change ends every other
 * session immediately, and the same reasoning applies to a first password: the
 * setup-link session that got here is the one session that must not survive,
 * because a setup link is a bearer token that may have been read over someone's
 * shoulder on its way to the console.
 *
 * The password itself never appears in a return value, an audit entry, an error
 * message or a log line. `checkPassword` reports *why* a password was refused
 * without quoting it.
 */

import type { CredentialStore } from './credential-store'
import { checkPassword, hashPassword, verifyPassword } from './password'

export type SetPasswordFailure =
  | 'NO_SUCH_ACCOUNT'
  | 'WEAK_PASSWORD'
  | 'MISMATCHED_CONFIRMATION'
  | 'WRONG_CURRENT_PASSWORD'
  | 'ALREADY_SET'

export type SetPasswordResult =
  | { ok: true }
  | { ok: false; reason: SetPasswordFailure; message: string }

export interface SetPasswordInput {
  userId: string
  email: string
  name?: string | null
  newPassword: string
  confirmation: string
  /**
   * Required when the account already has a password. Ignored — and refused —
   * when it does not, so a first-time setup screen cannot be replayed against
   * an account that has since been secured.
   */
  currentPassword?: string | null
}

export interface SetPasswordDeps {
  store: CredentialStore
  now?: () => Date
}

const MESSAGES: Record<SetPasswordFailure, string> = {
  NO_SUCH_ACCOUNT: 'That account could not be found. Nothing was changed.',
  WEAK_PASSWORD: '',
  MISMATCHED_CONFIRMATION: 'The two passwords do not match. Nothing was changed.',
  WRONG_CURRENT_PASSWORD:
    'That is not the current password for this account. Nothing was changed.',
  ALREADY_SET:
    'This account already has a password, so it has to be changed rather than chosen. ' +
    'Sign in and change it, or ask the owner for a fresh setup link.',
}

export async function setAdminPassword(
  input: SetPasswordInput,
  deps: SetPasswordDeps,
): Promise<SetPasswordResult> {
  const now = deps.now?.() ?? new Date()

  const credential = await deps.store.findByEmail(input.email)
  if (!credential || credential.userId !== input.userId) {
    return { ok: false, reason: 'NO_SUCH_ACCOUNT', message: MESSAGES.NO_SUCH_ACCOUNT }
  }

  // Confirmation before strength, so a plain typo is reported as a typo rather
  // than as a lecture about password length.
  if (input.newPassword !== input.confirmation) {
    return {
      ok: false,
      reason: 'MISMATCHED_CONFIRMATION',
      message: MESSAGES.MISMATCHED_CONFIRMATION,
    }
  }

  if (credential.passwordHash === null) {
    // First time. A `currentPassword` here means the form was replayed against
    // an account in a different state than the one it was rendered for.
    if (typeof input.currentPassword === 'string' && input.currentPassword !== '') {
      return { ok: false, reason: 'NO_SUCH_ACCOUNT', message: MESSAGES.NO_SUCH_ACCOUNT }
    }
  } else {
    const current = input.currentPassword ?? ''
    if (current === '') {
      return { ok: false, reason: 'ALREADY_SET', message: MESSAGES.ALREADY_SET }
    }
    if (!(await verifyPassword(credential.passwordHash, current))) {
      return {
        ok: false,
        reason: 'WRONG_CURRENT_PASSWORD',
        message: MESSAGES.WRONG_CURRENT_PASSWORD,
      }
    }
  }

  const strength = checkPassword(input.newPassword, {
    email: input.email,
    name: input.name ?? null,
  })
  if (!strength.ok) {
    return { ok: false, reason: 'WEAK_PASSWORD', message: strength.message }
  }

  const hash = await hashPassword(input.newPassword)
  await deps.store.setPasswordHash(credential.userId, hash, now)

  return { ok: true }
}
