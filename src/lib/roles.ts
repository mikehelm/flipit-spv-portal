import { env } from './env'

/**
 * A role that may **act** — write, send, approve, advance a status.
 *
 * The name is load-bearing and the omission is deliberate: `VIEWER` is not in
 * this union and must never be added to it. Around forty call sites take a
 * `PrivilegedRole` and every one of them stands in front of a mutation.
 * Widening this type is precisely how a read-only role silently becomes a
 * writing one, so `roles.test.ts` asserts its members by name.
 */
export type PrivilegedRole = 'OWNER' | 'OPERATOR'

/**
 * Every role that may sign in on the admin side, including the one that may
 * only look.
 *
 * **`VIEWER` can see and cannot do.** Investor names, the four amounts,
 * documents, the conversation thread and status history — the same records the
 * operator reads. It cannot send, approve, advance, answer, publish, import,
 * export, configure, invite, or reach the audit log.
 *
 * The reason it is a separate type rather than a third member of
 * `PrivilegedRole` is the whole security design. Adding a value to an enum that
 * forty guards already consult would have opened forty doors at once, silently,
 * and each would have had to be closed again by hand. This way nothing opens
 * until a page deliberately asks for `requireReader()`.
 */
export type AdminRole = PrivilegedRole | 'VIEWER'

/**
 * Role is assigned by email address against an allowlist. BUILD_SPEC §2.
 *
 * The important behaviour is the negative one: an address on no list gets
 * `null`, and the sign-in callback rejects it outright. No user row is created,
 * no session is issued, nothing is written. A Google account existing is not a
 * reason to let it in.
 *
 * **Order is precedence, and it runs from most capable to least.** Owner wins
 * over operator, and both win over viewer. An address that appears on two lists
 * is a misconfiguration, and resolving it downward would quietly demote
 * somebody out of their own application. Resolving it *upward* past viewer is
 * the same argument in reverse: somebody listed as both operator and viewer
 * needs to work, and the viewer entry is the stray one.
 */
export function resolveRole(email: string | null | undefined): AdminRole | null {
  if (!email) return null
  const normalised = email.trim().toLowerCase()
  if (normalised === '') return null

  const config = env()
  if (config.ownerEmails.includes(normalised)) return 'OWNER'
  if (config.operatorEmails.includes(normalised)) return 'OPERATOR'
  if (config.viewerEmails.includes(normalised)) return 'VIEWER'
  return null
}

export function isOwner(role: string | null | undefined): boolean {
  return role === 'OWNER'
}

export function isOperator(role: string | null | undefined): boolean {
  return role === 'OPERATOR'
}

export function isViewer(role: string | null | undefined): boolean {
  return role === 'VIEWER'
}

/**
 * May this role change anything?
 *
 * The single question every mutation guard reduces to, in one place, expressed
 * as an allowlist rather than as `!isViewer(role)`. A fourth role added later
 * gets no capability by accident — it fails closed, which is the only
 * acceptable default in an application that sends securities solicitations.
 */
export function canAct(role: string | null | undefined): role is PrivilegedRole {
  return role === 'OWNER' || role === 'OPERATOR'
}

/** Any role that may sign in to the admin side, viewer included. */
export function isAdminRole(role: string | null | undefined): role is AdminRole {
  return canAct(role) || isViewer(role)
}

/**
 * Either privileged role. Investors are never included, and neither is a
 * viewer — this is the "may act" question under its older name, kept because
 * existing callers use it and its meaning has not changed.
 */
export function isPrivileged(role: string | null | undefined): boolean {
  return canAct(role)
}

/** What each role is called on screen. */
export const ROLE_LABELS: Record<AdminRole, string> = {
  OWNER: 'Owner',
  OPERATOR: 'Operator',
  VIEWER: 'Read-only',
}

/**
 * The line a viewer sees on every admin screen.
 *
 * Stated plainly rather than discovered by pressing something. A person given
 * oversight of a securities raise needs to know the shape of their own access
 * before they act on what they are looking at — including that somebody can see
 * they looked.
 */
export const VIEWER_BANNER =
  'You have read-only access. You can see every investor record, the amounts, the ' +
  'documents and the conversation, and you cannot change any of it — anything that ' +
  'would write, send or approve is refused. Your sign-in is recorded, as everyone\u2019s is.'
