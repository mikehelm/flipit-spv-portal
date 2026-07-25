import { redirect } from 'next/navigation'
import { audit } from '@/lib/audit'
import type { PrivilegedRole } from '@/lib/roles'
import { drizzleCredentialStore } from './credential-store'
import { isOnboardingComplete } from './onboarding'
import { readOnboardingSnapshot } from './onboarding-store'
import { readAdminSessionUser } from './session'
import { evaluateAllowlist } from './sign-in-policy'

/**
 * Server-side authorization. Every admin page, route handler and server action
 * calls one of these first, before it reads or writes anything.
 *
 * "Never rely on the UI having hidden a button." A hidden button is a styling
 * choice; these are the access control.
 *
 * The role is re-resolved from the allowlist on every request rather than
 * trusted from the session or from the stored `users.role` column, so an
 * address removed from the environment allowlist loses access immediately
 * rather than whenever someone remembers to update a row.
 */

export interface AdminIdentity {
  id: string
  email: string
  name: string | null
  role: PrivilegedRole
}

export const SIGN_IN_PATH = '/signin'
export const NO_ACCESS_PATH = '/admin/no-access'
export const PASSWORD_PATH = '/admin/password'
export const SECOND_FACTOR_PATH = '/signin/second-factor'

/**
 * A session that has not yet passed the second factor is not an
 * administrator. BUILD_SPEC §2.2.
 *
 * The check lives here, in the one function every guard on every page and
 * every server action already goes through, rather than being added to each
 * of them. A guard that forgets to ask about two-factor gets `null` and
 * redirects to sign-in — the failure is closed, not open.
 *
 * `secondFactorAt` is null in two different situations and only one of them is
 * pending: an account with no TOTP enrolled has nothing to satisfy. That is
 * the whole of the resolution, and it is here so no caller has to repeat it.
 */
function secondFactorPending(
  user: { totpConfirmedAt: Date | null },
  session: { secondFactorAt: Date | null },
): boolean {
  return user.totpConfirmedAt !== null && session.secondFactorAt === null
}

/** The signed-in administrator, or null. Never throws, never redirects. */
export async function currentAdmin(): Promise<AdminIdentity | null> {
  const found = await readAdminSessionUser()
  if (!found) return null

  const { user, session } = found

  const decision = evaluateAllowlist(user.email)
  if (!decision.allowed) return null

  if (secondFactorPending(user, session)) return null

  return {
    id: user.id,
    email: decision.email,
    name: user.displayName ?? user.name ?? null,
    role: decision.role,
  }
}

/**
 * The half-authenticated identity behind the second-factor form, and nowhere
 * else. BUILD_SPEC §2.2.
 *
 * This is the one function in the application that looks at a session
 * `currentAdmin()` has deliberately refused. It returns an id and an address
 * and no capability: the page it serves has one form on it.
 */
export async function pendingSecondFactorAdmin(): Promise<{
  id: string
  email: string
} | null> {
  const found = await readAdminSessionUser()
  if (!found) return null

  const { user, session } = found

  const decision = evaluateAllowlist(user.email)
  if (!decision.allowed) return null

  if (!secondFactorPending(user, session)) return null

  return { id: user.id, email: decision.email }
}

/**
 * Signed in as either privileged role. Redirects if not.
 *
 * A session waiting on its second factor is sent to the form rather than to
 * sign-in — it has a valid password behind it and asking for the password
 * again would be a puzzle rather than a control.
 */
export async function requireAdmin(): Promise<AdminIdentity> {
  const admin = await currentAdmin()
  if (admin) return admin

  if (await pendingSecondFactorAdmin()) redirect(SECOND_FACTOR_PATH)
  redirect(SIGN_IN_PATH)
}

/**
 * Signed in, and holding a password of their own.
 *
 * An account reached through a one-time setup link has a session but no
 * verifier yet. It is a real session — the link proved possession — but it is
 * one step short of an account, and letting it wander the application would
 * mean a spent bearer token was the only thing ever standing between a stranger
 * and the investor records. So it goes to one page and no further.
 *
 * The password page itself calls `requireAdmin`, not this, or it would redirect
 * to itself for ever.
 */
export async function requirePasswordSet(): Promise<AdminIdentity> {
  const admin = await requireAdmin()

  const credential = await drizzleCredentialStore().findByEmail(admin.email)
  if (!credential || credential.passwordHash === null) redirect(PASSWORD_PATH)

  return admin
}

async function requireRole(role: PrivilegedRole): Promise<AdminIdentity> {
  const admin = await requirePasswordSet()
  if (admin.role !== role) {
    // BUILD_SPEC §22 AC19: a refused privileged action is logged, not silent.
    await audit({
      actor: { kind: 'user', id: admin.id, label: admin.email },
      entityType: 'access',
      entityId: admin.id,
      action: 'access.refused',
      metadata: { requiredRole: role, actualRole: admin.role },
    })
    redirect(NO_ACCESS_PATH)
  }
  return admin
}

/**
 * Owner only. Compliance approval (§8.2), service configuration, the OpenAI key
 * and operator invites all sit behind this. The operator never passes.
 */
export async function requireOwner(): Promise<AdminIdentity> {
  return requireRole('OWNER')
}

/**
 * Operator only — strictly. Used for the surfaces that are personal to the
 * operator: his onboarding, his display name, his contact method, his sending
 * account. The owner has full access to *records* (§2), but these are not
 * records; they are David's own setup, and the owner walking through them would
 * write his answers onto the wrong user row.
 *
 * Shared admin surfaces use `requireAdmin()`.
 */
export async function requireOperator(): Promise<AdminIdentity> {
  return requireRole('OPERATOR')
}

/**
 * Either role, but an operator who has not finished onboarding is sent back to
 * finish it. BUILD_SPEC §2.1 — "the first time David signs in, walk him through
 * a short setup rather than assuming details about him."
 *
 * Call this from admin pages that are not the onboarding flow itself.
 */
export async function requireOnboardedAdmin(): Promise<AdminIdentity> {
  const admin = await requirePasswordSet()
  if (admin.role !== 'OPERATOR') return admin

  const snapshot = await readOnboardingSnapshot(admin.id)
  if (!isOnboardingComplete(snapshot)) redirect('/admin/onboarding')

  return admin
}
