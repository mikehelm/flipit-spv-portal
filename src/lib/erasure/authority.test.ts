import { describe, expect, it } from 'vitest'
import {
  ERASURE_ACTIONS,
  authorizeErasureAction,
  canErase,
  erasureActionLabel,
} from './authority'

describe('who may erase an investor', () => {
  it('the owner may, for every action', () => {
    for (const action of ERASURE_ACTIONS) {
      const decision = authorizeErasureAction('OWNER', action)
      expect(decision.allowed).toBe(true)
    }
  })

  it('the operator may not, for every action', () => {
    /*
     * Enumerated rather than spot-checked. A future action added to the union
     * without a thought about who may run it fails here rather than shipping.
     */
    for (const action of ERASURE_ACTIONS) {
      const decision = authorizeErasureAction('OPERATOR', action)
      expect(decision.allowed, `an operator was allowed to ${action}`).toBe(false)
      if (decision.allowed) return
      expect(decision.reason).toBe('NOT_OWNER')
    }
  })

  it('previewing is owner-only too, not merely erasing', () => {
    // A preview counts rows and names nobody, so it leaks nothing the investors
    // screen does not already show. It is owner-only because it is the first
    // half of a decision only the owner can take.
    const decision = authorizeErasureAction('OPERATOR', 'PREVIEW')
    expect(decision.allowed).toBe(false)
  })

  it('nobody signed in may not, and is told to sign in rather than told they lack a role', () => {
    for (const role of [null, undefined] as const) {
      const decision = authorizeErasureAction(role, 'ERASE')
      expect(decision.allowed).toBe(false)
      if (decision.allowed) return
      expect(decision.reason).toBe('NOT_SIGNED_IN')
      expect(decision.message).toContain('Sign in first')
    }
  })

  it('a viewer is not an owner', () => {
    // VIEWER never reaches a privileged action anyway — `currentAdmin()` returns
    // null for one — but the rule must not depend on that being true elsewhere.
    expect(canErase('OPERATOR')).toBe(false)
    expect(canErase(null)).toBe(false)
    expect(canErase('OWNER')).toBe(true)
  })
})

describe('the refusal explains itself', () => {
  it('names the owner, and says why this one is not the operator’s', () => {
    const decision = authorizeErasureAction('OPERATOR', 'ERASE')
    expect(decision.allowed).toBe(false)
    if (decision.allowed) return
    expect(decision.message).toContain('Michael Helm')
    expect(decision.message).toContain('both can be undone; this one cannot')
    // The operator is told this is normal. A refusal that reads like an
    // accusation is a refusal somebody works around next time.
    expect(decision.message).toContain('not a mark against you')
  })

  it('every action has a label that finishes the sentence "you cannot …"', () => {
    for (const action of ERASURE_ACTIONS) {
      const label = erasureActionLabel(action)
      expect(label.length).toBeGreaterThan(10)
      expect(label[0]).toBe(label[0].toLowerCase())
    }
  })

  it('the message never says what would have been erased', () => {
    // A refusal that reported "this would remove 4 offers" would be a read the
    // caller was not entitled to, delivered by the refusal itself.
    for (const action of ERASURE_ACTIONS) {
      const decision = authorizeErasureAction('OPERATOR', action)
      expect(decision.allowed).toBe(false)
      if (decision.allowed) return
      expect(decision.message).not.toMatch(/\d+ (offer|message|row)/)
    }
  })
})
