import { resolveRole, type AdminRole } from '@/lib/roles'

/**
 * The allowlist gate. BUILD_SPEC §2, §2.2, §22 AC18.
 *
 * "There is no self-registration of any kind: an address that is not on the
 * allowlist and does not hold an investor account cannot sign in, and no record
 * is created for it."
 *
 * Pure and dependency-free apart from the allowlist, so the decision can be
 * tested exhaustively. It answers one question — may this address hold a
 * privileged role — and deliberately not "is this the right password", which is
 * `credentials.ts` and has to fail identically whichever of the two is wrong.
 *
 * Investors never come through here. They are `investor_accounts`, not `users`,
 * and sign in with an emailed single-use link (§4.1, WP8).
 */

export type SignInDenialReason =
  /** No address was supplied at all. */
  | 'MISSING_EMAIL'
  /** A real address that is simply not ours. */
  | 'NOT_ALLOWLISTED'

export type AllowlistDecision =
  | { allowed: true; email: string; role: AdminRole }
  | { allowed: false; email: string | null; reason: SignInDenialReason }

export function normaliseEmail(email: string | null | undefined): string | null {
  if (typeof email !== 'string') return null
  const trimmed = email.trim().toLowerCase()
  return trimmed === '' ? null : trimmed
}

export function evaluateAllowlist(email: string | null | undefined): AllowlistDecision {
  const normalised = normaliseEmail(email)
  if (normalised === null) {
    return { allowed: false, email: null, reason: 'MISSING_EMAIL' }
  }

  const role = resolveRole(normalised)
  if (role === null) {
    return { allowed: false, email: normalised, reason: 'NOT_ALLOWLISTED' }
  }

  return { allowed: true, email: normalised, role }
}

export function isAllowlisted(email: string | null | undefined): boolean {
  return evaluateAllowlist(email).allowed
}
