import { env } from './env'

export type PrivilegedRole = 'OWNER' | 'OPERATOR'

/**
 * Role is assigned by email address against an allowlist. BUILD_SPEC §2.
 *
 * The important behaviour is the negative one: an address on neither list gets
 * `null`, and the sign-in callback rejects it outright. No user row is created,
 * no session is issued, nothing is written. A Google account existing is not a
 * reason to let it in.
 *
 * Owner wins if an address somehow appears on both lists — the more capable
 * role is the one the person actually needs, and a misconfiguration should not
 * quietly demote the owner out of their own application.
 */
export function resolveRole(email: string | null | undefined): PrivilegedRole | null {
  if (!email) return null
  const normalised = email.trim().toLowerCase()
  if (normalised === '') return null

  const config = env()
  if (config.ownerEmails.includes(normalised)) return 'OWNER'
  if (config.operatorEmails.includes(normalised)) return 'OPERATOR'
  return null
}

export function isOwner(role: string | null | undefined): boolean {
  return role === 'OWNER'
}

export function isOperator(role: string | null | undefined): boolean {
  return role === 'OPERATOR'
}

/** Either privileged role. Investors are never included. */
export function isPrivileged(role: string | null | undefined): boolean {
  return isOwner(role) || isOperator(role)
}
