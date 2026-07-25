/**
 * Whether the shared Q&A section exists for investors at all. BUILD_SPEC
 * §6.7.5.
 *
 * The reasoning in the spec: *"A shared Q&A implies other recipients exist. It
 * names nobody, but the inference is there."* So there is an owner-level
 * switch — visible during the raise, or hidden until the round closes — and
 * when it is hidden, **publishing still works and simply queues entries for
 * later.** Nothing is lost by publishing early into a hidden section; the
 * entries appear the moment the round closes.
 *
 * Pure. This decides visibility only; it never decides whether a mutation is
 * allowed, and it is not an access control — `portalAccess` is.
 */

import type { PortalAccess } from '@/lib/portal/access'

export type SharedQaState =
  /** Shown. The normal case: the switch defaults to visible. */
  | 'VISIBLE'
  /** Hidden by the owner's switch, with the round still open. Entries queue. */
  | 'QUEUED_UNTIL_ROUND_CLOSES'
  /** Hidden because this visitor cannot see the portal at all. */
  | 'NO_ACCESS'

export interface SharedQaInput {
  /** `service_config.qa_visible_during_raise`. Owner-only to change. */
  qaVisibleDuringRaise: boolean
  /** The investor's own round has closed (§6.6 — an explicit act, never a date). */
  roundClosed: boolean
  access: PortalAccess
}

export function sharedQaState(input: SharedQaInput): SharedQaState {
  if (input.access.capability === 'NONE') return 'NO_ACCESS'
  if (input.qaVisibleDuringRaise) return 'VISIBLE'
  if (input.roundClosed) return 'VISIBLE'
  return 'QUEUED_UNTIL_ROUND_CLOSES'
}

export function sharedQaVisible(input: SharedQaInput): boolean {
  return sharedQaState(input) === 'VISIBLE'
}

/**
 * Whether this visitor may ask a new question.
 *
 * `FULL` only. A read-only portal already tells the investor that "responses
 * and messages are not being accepted at this time", and accepting a question
 * into a queue nobody is going to answer would make that sentence false.
 *
 * A closed or suspended account cannot reach the page at all, so this is not
 * the thing standing between them and the form — `portalAccess` is. This
 * decides the read-only case, which is the one where the page renders and the
 * form should not.
 */
export function canAskQuestion(access: PortalAccess): boolean {
  return access.capability === 'FULL'
}

/**
 * An investor can always read their own previous questions and the answers to
 * them, in any state where they can read anything. §7 read-only is explicitly
 * "view and download"; their own correspondence is part of their record.
 */
export function canReadOwnQuestions(access: PortalAccess): boolean {
  return access.capability === 'FULL' || access.capability === 'READ_ONLY'
}

/**
 * What the operator is told when he publishes into a hidden section. Not an
 * error — the publication is real and recorded; it is simply not yet visible.
 */
export const QUEUED_PUBLICATION_NOTICE =
  'The shared Q&A is currently hidden from investors until the round closes, so this entry is ' +
  'published but not yet visible to anyone. It will appear when the round is closed. The ' +
  'private answer to the person who asked is unaffected.'
