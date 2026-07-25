import { describe, expect, it } from 'vitest'
import { QA_ACTIONS, authorizeQaAction, canManageQa, qaActionLabel } from './authority'

/**
 * BUILD_SPEC §6.7 is written as the operator's surface. The owner has full
 * access to records (§2), so both privileged roles pass.
 *
 * What must NOT be here is the §6.7.5 visibility switch — it is owner-only and
 * lives on the settings page, behind `requireOwner()`. The last test in this
 * file is the guard against somebody adding it.
 */

describe('who may work the Q&A', () => {
  it('lets the operator do every Q&A action', () => {
    for (const action of QA_ACTIONS) {
      expect(authorizeQaAction('OPERATOR', action).allowed, action).toBe(true)
    }
  })

  it('lets the owner do every Q&A action', () => {
    for (const action of QA_ACTIONS) {
      expect(authorizeQaAction('OWNER', action).allowed, action).toBe(true)
    }
  })

  it('refuses anyone who is not signed in as an administrator', () => {
    for (const role of [null, undefined] as const) {
      for (const action of QA_ACTIONS) {
        const decision = authorizeQaAction(role, action)
        expect(decision.allowed, action).toBe(false)
      }
    }
  })

  it('names the action in the refusal rather than saying "something went wrong"', () => {
    const decision = authorizeQaAction(null, 'PUBLISH')
    expect(decision.allowed).toBe(false)
    if (decision.allowed) throw new Error('unreachable')
    expect(decision.message).toContain('publish an answer to the shared Q&A')
    expect(decision.message).toContain('Nothing has been changed.')
  })

  it('has a label for every action', () => {
    for (const action of QA_ACTIONS) {
      expect(qaActionLabel(action).length, action).toBeGreaterThan(0)
    }
  })

  it('canManageQa agrees with authorizeQaAction', () => {
    expect(canManageQa('OWNER')).toBe(true)
    expect(canManageQa('OPERATOR')).toBe(true)
    expect(canManageQa(null)).toBe(false)
  })

  it('does not model the visibility switch as a Q&A action', () => {
    // §6.7.5 is owner-only and is a service_config field written by the
    // owner-only settings action. Adding it here would put it one role check
    // away from the operator, which is the same mistake the compliance
    // approval is deliberately kept off the settings page to avoid.
    expect(QA_ACTIONS).not.toContain('SET_VISIBILITY')
    expect(QA_ACTIONS.some((action) => /VISIB/i.test(action))).toBe(false)
  })
})
