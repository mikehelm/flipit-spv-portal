/**
 * Who may erase an investor, and who may look at what an erasure would do.
 *
 * OPEN_DECISIONS.md item 12 calls this "a *destructive* path in the one system
 * where that word matters most", and the shape of the rule follows from that
 * sentence rather than from anywhere in the spec, which is silent. Where the
 * spec is silent, take the conservative option.
 *
 * So:
 *
 *   - **Erasing is owner-only.** The same rule as the compliance approval, for
 *     the same reason: the account that runs the round is deliberately not the
 *     account that can unmake its record. David can suspend and close, which
 *     is reversible and is process management. He cannot erase.
 *   - **Previewing is owner-only too.** A preview counts rows and names
 *     nothing, so it leaks no more than the investors screen already shows an
 *     operator — but a preview is the first half of a decision only the owner
 *     can take, and an operator reading "this would erase 4 offers and 11
 *     messages" is being invited to ask for something they cannot have. It
 *     costs nothing to keep both on the same side of the line.
 *
 * Pure, like `compliance/authority.ts`, so the rule can be tested without a
 * session, a database or a running application. The action calls this and then
 * does the two things a pure function cannot: write the audit entry, and
 * refuse.
 */

import type { PrivilegedRole } from '@/lib/roles'

export type ErasureAction = 'PREVIEW' | 'ERASE'

export const ERASURE_ACTIONS: readonly ErasureAction[] = ['PREVIEW', 'ERASE'] as const

const ACTION_LABEL: Readonly<Record<ErasureAction, string>> = {
  PREVIEW: 'see what erasing an investor’s record would remove',
  ERASE: 'erase an investor’s personal data',
}

export function erasureActionLabel(action: ErasureAction): string {
  return ACTION_LABEL[action]
}

export type ErasureAuthorityDecision =
  | { allowed: true; role: 'OWNER' }
  | {
      allowed: false
      reason: 'NOT_SIGNED_IN' | 'NOT_OWNER'
      /** Specific. Names who may do it and why the caller may not. */
      message: string
    }

export function authorizeErasureAction(
  role: PrivilegedRole | null | undefined,
  action: ErasureAction,
): ErasureAuthorityDecision {
  if (role === 'OWNER') return { allowed: true, role: 'OWNER' }

  if (role !== 'OPERATOR') {
    return {
      allowed: false,
      reason: 'NOT_SIGNED_IN',
      message:
        `You are not signed in as an administrator, so you cannot ${ACTION_LABEL[action]}. ` +
        'Sign in first. Nothing has been changed.',
    }
  }

  return {
    allowed: false,
    reason: 'NOT_OWNER',
    message:
      `Only the owner can ${ACTION_LABEL[action]}. Suspending and closing an account are ` +
      'yours to do and both can be undone; this one cannot, so it sits with Michael Helm ' +
      'alongside the compliance approval. Ask him. This attempt has been written to the ' +
      'audit log, which is normal and not a mark against you.',
  }
}

/** True only for the owner. Used where a boolean is all the caller needs. */
export function canErase(role: PrivilegedRole | null | undefined): boolean {
  return role === 'OWNER'
}
