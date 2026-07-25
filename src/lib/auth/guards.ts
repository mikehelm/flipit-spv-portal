import { redirect } from 'next/navigation'
import { audit } from '@/lib/audit'
import type { PrivilegedRole } from '@/lib/roles'
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

/** The signed-in administrator, or null. Never throws, never redirects. */
export async function currentAdmin(): Promise<AdminIdentity | null> {
  const user = await readAdminSessionUser()
  if (!user) return null

  const decision = evaluateAllowlist(user.email)
  if (!decision.allowed) return null

  return {
    id: user.id,
    email: decision.email,
    name: user.displayName ?? user.name ?? null,
    role: decision.role,
  }
}

/** Signed in as either privileged role. Redirects to sign-in if not. */
export async function requireAdmin(): Promise<AdminIdentity> {
  const admin = await currentAdmin()
  if (!admin) redirect(SIGN_IN_PATH)
  return admin
}

async function requireRole(role: PrivilegedRole): Promise<AdminIdentity> {
  const admin = await requireAdmin()
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
  const admin = await requireAdmin()
  if (admin.role !== 'OPERATOR') return admin

  const snapshot = await readOnboardingSnapshot(admin.id)
  if (!isOnboardingComplete(snapshot)) redirect('/admin/onboarding')

  return admin
}
