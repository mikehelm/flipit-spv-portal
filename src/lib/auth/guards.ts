import { redirect } from 'next/navigation'
import { audit } from '@/lib/audit'
import { canAct, isViewer, type AdminRole, type PrivilegedRole } from '@/lib/roles'
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
  role: AdminRole
}

/**
 * An identity that may act, narrowed at the type level.
 *
 * `currentAdmin()` returns this rather than `AdminIdentity`, which means the
 * compiler — not a comment, and not a reviewer's attention — is what stops a
 * viewer reaching the forty call sites that take a `PrivilegedRole`. Adding a
 * fourth role later produces type errors at exactly the places that need
 * looking at, which is the behaviour worth having.
 */
export type ActingAdmin = AdminIdentity & { role: PrivilegedRole }

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

/**
 * Whoever is signed in on the admin side, viewer included. Never throws, never
 * redirects.
 *
 * **Almost nothing should call this.** It is the primitive the two functions
 * below are built from, and it is the only one that will hand back a `VIEWER`.
 * If you are about to call it in order to decide whether somebody may do
 * something, you want `currentAdmin()` instead.
 */
export async function currentIdentity(): Promise<AdminIdentity | null> {
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
 * The signed-in administrator **who may act**, or null.
 *
 * A viewer gets `null` here, and that is the single most important line in the
 * role design rather than an implementation detail.
 *
 * When `VIEWER` was added, around forty existing call sites already asked this
 * question — every server action, every mutating route, the import path. Had
 * this function returned a viewer, all forty would have admitted one at once,
 * silently, and each would have had to be found and closed again by hand. One
 * missed call site is an outsider advancing an investor's status or sending a
 * securities invitation.
 *
 * So the widening happened in the other direction. Every existing caller keeps
 * the exact behaviour it had, a viewer is simply nobody to all of them, and
 * read access is granted one page at a time by deliberately asking for
 * `requireReader()`. Nothing opened by default. `guards.test.ts` asserts this
 * function cannot return a viewer.
 */
export async function currentAdmin(): Promise<ActingAdmin | null> {
  const identity = await currentIdentity()
  if (!identity) return null
  if (!canAct(identity.role)) return null
  return { ...identity, role: identity.role }
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
export async function requireAdmin(): Promise<ActingAdmin> {
  const admin = await currentAdmin()
  if (admin) return admin

  // A viewer is signed in and simply may not be here. Sending them to the
  // sign-in page would be a lie — they are signed in — and would read as the
  // application being broken. They get the refusal page, and the attempt is
  // logged, because §22 AC19 wants a refused privileged action recorded.
  const identity = await currentIdentity()
  if (identity && isViewer(identity.role)) {
    await audit({
      actor: { kind: 'user', id: identity.id, label: identity.email },
      entityType: 'access',
      entityId: identity.id,
      action: 'access.refused',
      metadata: { requiredRole: 'ACTOR', actualRole: identity.role },
    })
    redirect(NO_ACCESS_PATH)
  }

  if (await pendingSecondFactorAdmin()) redirect(SECOND_FACTOR_PATH)
  redirect(SIGN_IN_PATH)
}

/**
 * Signed in as anybody who may **read** — owner, operator or viewer.
 *
 * The opt-in half of the role. A page calling this is stating that everything
 * on it is safe for a read-only administrator, and that every control it
 * renders is either absent for a viewer or refused server-side by the action
 * behind it.
 *
 * Read access is not the same as an empty page: `canAct(identity.role)` is what
 * a page uses to decide whether to render a button at all. Hiding the button is
 * courtesy; the action's own guard is the control.
 */
export async function requireReader(): Promise<AdminIdentity> {
  const identity = await currentIdentity()
  if (identity) {
    const credential = await drizzleCredentialStore().findByEmail(identity.email)
    if (!credential || credential.passwordHash === null) redirect(PASSWORD_PATH)
    return identity
  }

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
export async function requirePasswordSet(): Promise<ActingAdmin> {
  const admin = await requireAdmin()

  const credential = await drizzleCredentialStore().findByEmail(admin.email)
  if (!credential || credential.passwordHash === null) redirect(PASSWORD_PATH)

  return admin
}

async function requireRole(role: PrivilegedRole): Promise<ActingAdmin> {
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
export async function requireOwner(): Promise<ActingAdmin> {
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
export async function requireOperator(): Promise<ActingAdmin> {
  return requireRole('OPERATOR')
}

/**
 * Either role, but an operator who has not finished onboarding is sent back to
 * finish it. BUILD_SPEC §2.1 — "the first time David signs in, walk him through
 * a short setup rather than assuming details about him."
 *
 * Call this from admin pages that are not the onboarding flow itself.
 */
export async function requireOnboardedAdmin(): Promise<ActingAdmin> {
  const admin = await requirePasswordSet()
  if (admin.role !== 'OPERATOR') return admin

  const snapshot = await readOnboardingSnapshot(admin.id)
  if (!isOnboardingComplete(snapshot)) redirect('/admin/onboarding')

  return admin
}
