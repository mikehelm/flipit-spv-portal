/**
 * Who may run an import.
 *
 * Server-side, on every action, without exception. The UI having hidden a
 * button is not an authorization check and is never treated as one.
 *
 * Sign-in itself belongs to WP2. This module does not build its own session
 * handling: it asks `currentAdmin()`, which re-resolves the role from the
 * allowlist on every request. If that returns nobody, the import REFUSES.
 * Failing closed is the only safe behaviour for a module that creates investor
 * records — an import that ran because authentication was not wired up would
 * be worse than one that does not run at all.
 *
 * The resolver is replaceable so tests can supply an actor without standing up
 * a session, and so the authentication layer can be swapped without this file
 * caring. It is never replaced at runtime by anything the browser sends.
 */

import type { PrivilegedRole } from '@/lib/roles'

export interface PrivilegedActor {
  userId: string
  email: string
  role: PrivilegedRole
  /** For the audit log's `actorLabel`. */
  label: string
}

export type PrivilegedActorResolver = () => Promise<PrivilegedActor | null>

let resolver: PrivilegedActorResolver | null = null

/**
 * Called once by the authentication layer at startup, e.g.
 * `registerPrivilegedActorResolver(async () => sessionToActor(await auth()))`.
 */
export function registerPrivilegedActorResolver(next: PrivilegedActorResolver): void {
  resolver = next
}

/** Test-only. */
export function clearPrivilegedActorResolver(): void {
  resolver = null
}

export type ImportAuthorizationCode = 'NOT_SIGNED_IN' | 'WRONG_ROLE'

export class ImportAuthorizationError extends Error {
  readonly code: ImportAuthorizationCode

  constructor(code: ImportAuthorizationCode, message: string) {
    super(message)
    this.name = 'ImportAuthorizationError'
    this.code = code
  }
}

/**
 * The operator uploads the list (BUILD_SPEC §3 step 5); the owner has full
 * access to everything (§2). Both may import. Nobody else can, and an
 * investor account is never a candidate — investors are not `users` at all.
 */
export async function requireImportActor(
  allowed: readonly PrivilegedRole[] = ['OWNER', 'OPERATOR'],
): Promise<PrivilegedActor> {
  const actor = await (resolver ? resolver() : resolveFromSession())
  if (!actor) {
    throw new ImportAuthorizationError('NOT_SIGNED_IN', 'You need to sign in to do this.')
  }
  if (!allowed.includes(actor.role)) {
    throw new ImportAuthorizationError(
      'WRONG_ROLE',
      'Your account does not have access to the recipient import.',
    )
  }
  return actor
}

/**
 * The default resolver: the signed-in admin, with the role re-derived from the
 * allowlist rather than read from the session. Imported lazily so this module
 * stays usable — and testable — without dragging the whole auth stack in.
 */
async function resolveFromSession(): Promise<PrivilegedActor | null> {
  const { currentAdmin } = await import('@/lib/auth/guards')
  const admin = await currentAdmin()
  if (!admin) return null

  // An account that has redeemed a setup link but not yet chosen a password
  // holds a session, and that session is enough to reach the password page and
  // nothing else (§2.2). Importing creates investor records, so it is firmly on
  // the "nothing else" side. The page guards redirect; this resolver returns
  // null instead, because a server action has nowhere to redirect to.
  const { drizzleCredentialStore } = await import('@/lib/auth/credential-store')
  const credential = await drizzleCredentialStore().findByEmail(admin.email)
  if (!credential || credential.passwordHash === null) return null

  return {
    userId: admin.id,
    email: admin.email,
    role: admin.role,
    label: admin.email,
  }
}
