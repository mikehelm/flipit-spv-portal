/**
 * Who may touch a compliance approval.
 *
 * BUILD_SPEC §8.2 item 4: "**Approval is owner-only.** The operator cannot
 * record or amend it." §22 adds that a refused privileged action is logged
 * rather than silently ignored.
 *
 * This module is pure so the rule can be tested without a session, a database
 * or a running application. The server action calls it and then does the two
 * things a pure function cannot: write the audit entry, and refuse.
 *
 * Nothing here reads the UI. A hidden button is not an authorization check and
 * is never treated as one — see `src/actions/compliance.ts`, where every entry
 * point calls this first and no code path reaches a write without it.
 */

import type { PrivilegedRole } from '@/lib/roles'

export type ComplianceAction =
  | 'RECORD'
  | 'AMEND'
  | 'VOID'
  | 'CLEAR_RECIPIENT'
  | 'REVOKE_RECIPIENT_CLEARANCE'
  | 'RECHECK'

export const COMPLIANCE_ACTIONS: readonly ComplianceAction[] = [
  'RECORD',
  'AMEND',
  'VOID',
  'CLEAR_RECIPIENT',
  'REVOKE_RECIPIENT_CLEARANCE',
  'RECHECK',
] as const

const ACTION_LABEL: Readonly<Record<ComplianceAction, string>> = {
  RECORD: 'record a compliance approval',
  AMEND: 'amend a compliance approval',
  VOID: 'void a compliance approval',
  CLEAR_RECIPIENT: 'clear an individual recipient against an approval reference',
  REVOKE_RECIPIENT_CLEARANCE: 'withdraw an individual recipient clearance',
  RECHECK: 're-apply the jurisdiction gate to every offer',
}

export function complianceActionLabel(action: ComplianceAction): string {
  return ACTION_LABEL[action]
}

/**
 * Every one of these is owner-only, including the per-recipient clearance.
 *
 * The spec names recording and amending explicitly. It does not name the
 * individual clearance of §8.3 — but that clearance is an approval decision
 * wearing a smaller hat: it says a named person in an uncleared jurisdiction
 * may lawfully be sent to. Where the spec is silent, take the conservative
 * option; letting the operator clear recipients one at a time would be a
 * blanket unblock with extra steps.
 */
export type ComplianceAuthorityDecision =
  | { allowed: true; role: 'OWNER' }
  | {
      allowed: false
      reason: 'NOT_SIGNED_IN' | 'NOT_OWNER'
      /** Specific. Names who may do it and why the caller may not. */
      message: string
    }

export function authorizeComplianceAction(
  role: PrivilegedRole | null | undefined,
  action: ComplianceAction,
): ComplianceAuthorityDecision {
  if (role === 'OWNER') return { allowed: true, role: 'OWNER' }

  if (role !== 'OPERATOR') {
    return {
      allowed: false,
      reason: 'NOT_SIGNED_IN',
      message:
        `You are not signed in as an administrator, so you cannot ${ACTION_LABEL[action]}. ` +
        'Sign in first. Nothing has been changed and nothing has been recorded against ' +
        'this attempt beyond the audit entry.',
    }
  }

  return {
    allowed: false,
    reason: 'NOT_OWNER',
    message:
      `Only the owner can ${ACTION_LABEL[action]}. The compliance approval is what makes ` +
      'sending possible at all, so the account that sends is deliberately not the account ' +
      'that approves. Ask Michael Helm to record it. This attempt has been written to the ' +
      'audit log, which is normal and not a mark against you.',
  }
}

/** True only for the owner. Used where a boolean is all the caller needs. */
export function canManageCompliance(role: PrivilegedRole | null | undefined): boolean {
  return role === 'OWNER'
}

export class ComplianceAuthorityError extends Error {
  readonly reason: 'NOT_SIGNED_IN' | 'NOT_OWNER'
  readonly action: ComplianceAction

  constructor(decision: Extract<ComplianceAuthorityDecision, { allowed: false }>, action: ComplianceAction) {
    super(decision.message)
    this.name = 'ComplianceAuthorityError'
    this.reason = decision.reason
    this.action = action
  }
}
