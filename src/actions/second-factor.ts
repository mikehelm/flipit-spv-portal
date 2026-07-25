'use server'

import { eq } from 'drizzle-orm'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { actionError, actionOk, type ActionState } from '@/components/admin/action-state'
import { db } from '@/db'
import { users } from '@/db/schema'
import { audit } from '@/lib/audit'
import { requireAdmin, pendingSecondFactorAdmin } from '@/lib/auth/guards'
import { verifyPassword } from '@/lib/auth/password'
import {
  checkRateLimit,
  clearFailures,
  recordFailure,
  signInKeys,
  signInRateLimitStore,
} from '@/lib/auth/rate-limit'
import { markSecondFactorSatisfied, revokeAllSessionsForUser } from '@/lib/auth/session'
import {
  consumeRecoveryCode,
  createTotpEnrolment,
  generateRecoveryCodes,
  normaliseCode,
  SECOND_FACTOR_FAILED_MESSAGE,
  verifyTotp,
} from '@/lib/auth/totp'
import { decrypt, encrypt } from '@/lib/crypto'
import { clientIp } from './client-ip'

/**
 * Two-factor: passing it, and setting it up. BUILD_SPEC §2.2.
 *
 * *"**TOTP two-factor** for both privileged accounts … mandatory before the
 * production deployment sends anything real. Standard authenticator apps;
 * recovery codes issued once at setup."*
 *
 * Three rules run through everything here.
 *
 * **The secret never leaves the server after enrolment.** It is encrypted at
 * rest with the same `encrypt()` as the SMTP password, and the only moment it
 * is ever rendered is on the enrolment screen that created it, because a QR
 * code is the secret. After confirmation there is no screen, route or export
 * that returns it.
 *
 * **Every failure is the same sentence**, exactly as the password step is. A
 * message distinguishing a wrong code from an unknown recovery code would tell
 * somebody holding a stolen password which of the two factors they had cleared.
 *
 * **The second step is rate-limited on the same counters as the first.** A
 * six-digit code is a million possibilities and an unthrottled form would walk
 * it in an afternoon.
 */

const codeSchema = z.object({ code: z.string().min(1).max(64) })

// ---------------------------------------------------------------------------
// Passing the second step
// ---------------------------------------------------------------------------

export async function submitSecondFactorAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const pending = await pendingSecondFactorAdmin()
  if (!pending) redirect('/signin')

  const parsed = codeSchema.safeParse({ code: formData.get('code') })
  const submitted = parsed.success ? parsed.data.code : ''

  const ip = await clientIp()
  const keys = signInKeys(pending.email, ip)
  const rateLimit = signInRateLimitStore()

  const verdict = await checkRateLimit(rateLimit, keys, Date.now())
  if (verdict.locked) {
    await audit({
      actor: { kind: 'system', label: 'second-factor' },
      entityType: 'access',
      entityId: pending.id,
      action: 'access.second_factor_refused',
      metadata: { detail: 'RATE_LIMITED' },
    })
    return actionError(SECOND_FACTOR_FAILED_MESSAGE)
  }

  const user = await db.query.users.findFirst({ where: eq(users.id, pending.id) })
  if (!user?.totpSecretEncrypted) redirect('/signin')

  // The TOTP code first, then the recovery codes. Both are attempted for every
  // submission that is not six digits, so the work done does not say which kind
  // of credential was offered.
  let secret: string | null = null
  try {
    secret = decrypt(user.totpSecretEncrypted)
  } catch {
    secret = null
  }

  const code = normaliseCode(submitted)
  const totpOk = secret !== null && code.length === 6
    ? verifyTotp(secret, code, Math.floor(Date.now() / 1000)) === 'OK'
    : false

  let usedRecovery = false
  let remainingRecovery = user.recoveryCodesHashed

  if (!totpOk) {
    const consumed = consumeRecoveryCode(user.recoveryCodesHashed, submitted)
    usedRecovery = consumed.ok
    remainingRecovery = consumed.remaining
  }

  if (!totpOk && !usedRecovery) {
    await recordFailure(rateLimit, keys, Date.now())
    await audit({
      actor: { kind: 'system', label: 'second-factor' },
      entityType: 'access',
      entityId: pending.id,
      action: 'access.second_factor_refused',
      // Never the code, and never how close it was.
      metadata: { detail: code.length === 6 ? 'WRONG_CODE' : 'NOT_A_CODE' },
    })
    return actionError(SECOND_FACTOR_FAILED_MESSAGE)
  }

  if (usedRecovery) {
    // Removed rather than marked, so there is no state in which a spent code
    // could be reinstated by an update that forgets a flag.
    await db
      .update(users)
      .set({ recoveryCodesHashed: remainingRecovery })
      .where(eq(users.id, pending.id))
  }

  const elevated = await markSecondFactorSatisfied()
  if (!elevated) redirect('/signin')

  await clearFailures(rateLimit, keys)

  await audit({
    actor: { kind: 'user', id: pending.id, label: pending.email },
    entityType: 'user',
    entityId: pending.id,
    action: 'access.second_factor',
    metadata: {
      method: usedRecovery ? 'recovery_code' : 'totp',
      recoveryCodesRemaining: usedRecovery ? remainingRecovery.length : undefined,
    },
  })

  redirect('/admin')
}

// ---------------------------------------------------------------------------
// Enrolment
// ---------------------------------------------------------------------------

/**
 * Starts enrolment. Writes an unconfirmed secret and returns nothing —
 * the page reads it back and renders the QR.
 *
 * Starting again replaces an unconfirmed secret, which is what somebody does
 * when they lost the QR before scanning it. It refuses to replace a *confirmed*
 * one: turning two-factor off is a separate action that asks for a password.
 */
export async function startTotpEnrolmentAction(
  _previous: ActionState,
  _formData: FormData,
): Promise<ActionState> {
  const admin = await requireAdmin()

  const user = await db.query.users.findFirst({ where: eq(users.id, admin.id) })
  if (user?.totpConfirmedAt) {
    return actionError(
      'Two-factor is already switched on for this account. Turn it off first if you ' +
        'want to move it to a different device.',
    )
  }

  const { secret } = createTotpEnrolment(admin.email)

  await db
    .update(users)
    .set({ totpSecretEncrypted: encrypt(secret), totpConfirmedAt: null })
    .where(eq(users.id, admin.id))

  await audit({
    actor: { kind: 'user', id: admin.id, label: admin.email },
    entityType: 'user',
    entityId: admin.id,
    action: 'access.two_factor_enrolment_started',
  })

  revalidatePath('/admin/security')
  return actionOk('Scan the code below, then enter what your app shows to switch it on.')
}

/**
 * Confirms enrolment with a live code, and issues the recovery codes.
 *
 * The code is required before two-factor is switched on, so an account cannot
 * be locked out by a QR that was never successfully scanned. §2.2: *"recovery
 * codes issued once at setup"* — issued here, shown once, and stored as hashes.
 */
export async function confirmTotpEnrolmentAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const admin = await requireAdmin()

  const parsed = codeSchema.safeParse({ code: formData.get('code') })
  if (!parsed.success) return actionError(SECOND_FACTOR_FAILED_MESSAGE)

  const user = await db.query.users.findFirst({ where: eq(users.id, admin.id) })
  if (!user?.totpSecretEncrypted) {
    return actionError('There is nothing to confirm. Start again below.')
  }
  if (user.totpConfirmedAt) {
    return actionError('Two-factor is already switched on for this account.')
  }

  let secret: string
  try {
    secret = decrypt(user.totpSecretEncrypted)
  } catch {
    return actionError('That enrolment could not be read. Start again below.')
  }

  if (verifyTotp(secret, parsed.data.code, Math.floor(Date.now() / 1000)) !== 'OK') {
    await audit({
      actor: { kind: 'user', id: admin.id, label: admin.email },
      entityType: 'user',
      entityId: admin.id,
      action: 'access.two_factor_enrolment_refused',
    })
    return actionError(SECOND_FACTOR_FAILED_MESSAGE)
  }

  const recovery = generateRecoveryCodes()

  await db
    .update(users)
    .set({ totpConfirmedAt: new Date(), recoveryCodesHashed: recovery.hashed })
    .where(eq(users.id, admin.id))

  // This session has just proved possession of the authenticator, so it does
  // not need to be signed out and back in. Every OTHER session for this
  // account is ended: they were opened under one-factor rules and letting them
  // continue would mean switching two-factor on had changed nothing for the
  // sessions that already existed.
  await revokeAllSessionsForUser(admin.id)
  await markSecondFactorSatisfied()

  await audit({
    actor: { kind: 'user', id: admin.id, label: admin.email },
    entityType: 'user',
    entityId: admin.id,
    action: 'access.two_factor_enabled',
    metadata: { recoveryCodesIssued: recovery.plain.length },
  })

  revalidatePath('/admin/security')

  // Shown once. `revealOnce` is the same one-time channel the operator invite
  // uses, and nothing stores the plaintext.
  return actionOk(
    'Two-factor is now switched on. Save these recovery codes somewhere safe — ' +
      'they are shown once and each works once.',
    recovery.plain.join('\n'),
  )
}

/**
 * Turns two-factor off. Requires the account password, not merely a session.
 *
 * A session is a bearer token on a laptop somebody may have walked away from;
 * this is the control that stops a borrowed screen removing the second factor
 * and then sending mail as the operator.
 */
export async function disableTotpAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const admin = await requireAdmin()

  const password = String(formData.get('password') ?? '')
  const user = await db.query.users.findFirst({ where: eq(users.id, admin.id) })

  if (!user?.totpConfirmedAt) {
    return actionError('Two-factor is not switched on for this account.')
  }

  const passwordOk =
    user.passwordHash !== null && (await verifyPassword(user.passwordHash, password))

  if (!passwordOk) {
    await audit({
      actor: { kind: 'user', id: admin.id, label: admin.email },
      entityType: 'user',
      entityId: admin.id,
      action: 'access.two_factor_disable_refused',
    })
    return actionError('That password was not accepted.')
  }

  await db
    .update(users)
    .set({
      totpSecretEncrypted: null,
      totpConfirmedAt: null,
      recoveryCodesHashed: [],
    })
    .where(eq(users.id, admin.id))

  await audit({
    actor: { kind: 'user', id: admin.id, label: admin.email },
    entityType: 'user',
    entityId: admin.id,
    action: 'access.two_factor_disabled',
  })

  revalidatePath('/admin/security')
  return actionOk(
    'Two-factor is off. Real invitations cannot be sent from the production ' +
      'deployment without it.',
  )
}

/**
 * Issues a fresh set of recovery codes, invalidating the old ones.
 *
 * Requires a live authenticator code rather than a password: this is the action
 * somebody takes when they have their phone and have lost the paper, and
 * proving they still hold the second factor is the relevant question.
 */
export async function regenerateRecoveryCodesAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const admin = await requireAdmin()

  const parsed = codeSchema.safeParse({ code: formData.get('code') })
  if (!parsed.success) return actionError(SECOND_FACTOR_FAILED_MESSAGE)

  const user = await db.query.users.findFirst({ where: eq(users.id, admin.id) })
  if (!user?.totpConfirmedAt || !user.totpSecretEncrypted) {
    return actionError('Two-factor is not switched on for this account.')
  }

  let secret: string
  try {
    secret = decrypt(user.totpSecretEncrypted)
  } catch {
    return actionError('That enrolment could not be read.')
  }

  if (verifyTotp(secret, parsed.data.code, Math.floor(Date.now() / 1000)) !== 'OK') {
    return actionError(SECOND_FACTOR_FAILED_MESSAGE)
  }

  const recovery = generateRecoveryCodes()

  await db
    .update(users)
    .set({ recoveryCodesHashed: recovery.hashed })
    .where(eq(users.id, admin.id))

  await audit({
    actor: { kind: 'user', id: admin.id, label: admin.email },
    entityType: 'user',
    entityId: admin.id,
    action: 'access.recovery_codes_reissued',
    metadata: { count: recovery.plain.length },
  })

  revalidatePath('/admin/security')
  return actionOk(
    'New recovery codes. The old ones no longer work — replace whatever you had ' +
      'written down.',
    recovery.plain.join('\n'),
  )
}
