/**
 * Who may do what to a Q&A entry. BUILD_SPEC §6.7.
 *
 * §6.7 is written throughout as David's surface — "David sees a queue", "David
 * can edit the question wording", "David can seed it himself". David is the
 * operator. The owner has full access to records (§2), so both privileged roles
 * pass here.
 *
 * The one Q&A control that is **owner-only** is the §6.7.5 visibility switch,
 * and it deliberately does not live in this file: it is a field on
 * `service_config`, written only by the owner-only settings action. Putting it
 * here alongside the operator's actions would put it one role check away from
 * the operator, and the same reasoning keeps the compliance approval off the
 * settings page.
 *
 * Note what is NOT gated on the owner: publishing. §6.7.6 says a published
 * answer "carries the same weight as the invitation itself", which reads like
 * an argument for owner approval — but the spec answers its own question in the
 * next sentence: *"The publish dialog says so, once, in one line."* A notice,
 * not a gate. Inventing an approval step here would be inventing a rule about
 * sending, which the task file forbids.
 *
 * Pure. The server action calls this, then writes the audit entry and refuses.
 */

import type { PrivilegedRole } from '@/lib/roles'

export type QaAction =
  | 'VIEW_QUEUE'
  | 'ANSWER'
  | 'PUBLISH'
  | 'UNPUBLISH'
  | 'EDIT_PUBLISHED'
  | 'ORDER'
  | 'CREATE_SEEDED'
  | 'SEND_REPLY'

export const QA_ACTIONS: readonly QaAction[] = [
  'VIEW_QUEUE',
  'ANSWER',
  'PUBLISH',
  'UNPUBLISH',
  'EDIT_PUBLISHED',
  'ORDER',
  'CREATE_SEEDED',
  'SEND_REPLY',
] as const

const ACTION_LABEL: Readonly<Record<QaAction, string>> = {
  VIEW_QUEUE: 'see the questions queue',
  ANSWER: 'answer a question',
  PUBLISH: 'publish an answer to the shared Q&A',
  UNPUBLISH: 'unpublish a shared Q&A entry',
  EDIT_PUBLISHED: 'edit a published Q&A entry',
  ORDER: 'pin or reorder the shared Q&A',
  CREATE_SEEDED: 'write a Q&A entry directly',
  SEND_REPLY: 'send the answer to the person who asked',
}

export function qaActionLabel(action: QaAction): string {
  return ACTION_LABEL[action]
}

export type QaAuthorityDecision =
  | { allowed: true; role: PrivilegedRole }
  | {
      allowed: false
      reason: 'NOT_SIGNED_IN'
      /** Specific. Never "something went wrong". */
      message: string
    }

export function authorizeQaAction(
  role: PrivilegedRole | null | undefined,
  action: QaAction,
): QaAuthorityDecision {
  if (role === 'OWNER' || role === 'OPERATOR') return { allowed: true, role }

  return {
    allowed: false,
    reason: 'NOT_SIGNED_IN',
    message:
      `You are not signed in as an administrator, so you cannot ${ACTION_LABEL[action]}. ` +
      'Sign in first. Nothing has been changed.',
  }
}

/** True for either privileged role. For a caller that only needs a boolean. */
export function canManageQa(role: PrivilegedRole | null | undefined): boolean {
  return role === 'OWNER' || role === 'OPERATOR'
}
