import { describe, expect, it } from 'vitest'
import {
  authorizeComplianceAction,
  canManageCompliance,
  COMPLIANCE_ACTIONS,
} from './authority'

/** BUILD_SPEC §8.2 item 4 — "Approval is owner-only." */

describe('authorizeComplianceAction', () => {
  it('lets the owner do every one of them', () => {
    for (const action of COMPLIANCE_ACTIONS) {
      expect(authorizeComplianceAction('OWNER', action)).toEqual({
        allowed: true,
        role: 'OWNER',
      })
    }
  })

  it('refuses the operator every one of them — record, amend and void included', () => {
    for (const action of COMPLIANCE_ACTIONS) {
      const decision = authorizeComplianceAction('OPERATOR', action)
      expect(decision.allowed).toBe(false)
      if (decision.allowed) return
      expect(decision.reason).toBe('NOT_OWNER')
      expect(decision.message).toMatch(/Only the owner/)
      // The refusal names the action, so the operator is not left guessing.
      expect(decision.message.length).toBeGreaterThan(80)
    }
  })

  it('refuses the individual per-recipient clearance to the operator too', () => {
    // Where the spec is silent, the conservative option: clearing one person
    // against an approval reference is an approval decision, so it is owner
    // only. Otherwise it is a blanket unblock with extra steps.
    const decision = authorizeComplianceAction('OPERATOR', 'CLEAR_RECIPIENT')
    expect(decision.allowed).toBe(false)
  })

  it('refuses nobody-at-all as not signed in rather than as the wrong role', () => {
    for (const role of [null, undefined] as const) {
      const decision = authorizeComplianceAction(role, 'RECORD')
      expect(decision.allowed).toBe(false)
      if (decision.allowed) return
      expect(decision.reason).toBe('NOT_SIGNED_IN')
    }
  })

  it('never returns allowed for anything other than the literal string OWNER', () => {
    const impostors = ['owner', 'Owner', 'ADMIN', '', 'OWNER '] as unknown as Array<
      'OWNER' | 'OPERATOR'
    >
    for (const role of impostors) {
      expect(authorizeComplianceAction(role, 'RECORD').allowed).toBe(false)
    }
  })
})

describe('canManageCompliance', () => {
  it('is true only for the owner', () => {
    expect(canManageCompliance('OWNER')).toBe(true)
    expect(canManageCompliance('OPERATOR')).toBe(false)
    expect(canManageCompliance(null)).toBe(false)
    expect(canManageCompliance(undefined)).toBe(false)
  })
})
