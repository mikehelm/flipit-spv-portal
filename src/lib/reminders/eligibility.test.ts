import { describe, expect, it } from 'vitest'
import {
  evaluateEligibility,
  isEligible,
  type ReminderCandidate,
  type ReminderContext,
} from './eligibility'

/**
 * BUILD_SPEC §6.5. This is the one place in the application that sends without
 * a human pressing send, so every constraint in §6.5 has a test here and each
 * of them must fail loudly if somebody later weakens it.
 */

function candidate(overrides: Partial<ReminderCandidate> = {}): ReminderCandidate {
  return {
    offerId: 'offer-1',
    accountStatus: 'ACTIVE',
    responseChoice: 'NO_RESPONSE',
    blocked: false,
    emailStatus: 'SENT',
    responseDeadline: '2026-08-10',
    remindersSent: 0,
    ...overrides,
  }
}

function context(overrides: Partial<ReminderContext> = {}): ReminderContext {
  return {
    serviceMode: 'ACTIVE',
    scheduleEnabled: true,
    maxPerRecipient: 2,
    today: '2026-08-01',
    ...overrides,
  }
}

describe('the ordinary case', () => {
  it('chases a non-responder with an invitation and time left', () => {
    expect(isEligible(candidate(), context())).toBe(true)
  })
})

describe('a responder is never chased (§6.5)', () => {
  it('refuses every recorded response', () => {
    for (const choice of ['INTERESTED', 'NOT_INTERESTED', 'QUESTION'] as const) {
      const decision = evaluateEligibility(candidate({ responseChoice: choice }), context())
      expect(decision.eligible, choice).toBe(false)
      if (decision.eligible) throw new Error('unreachable')
      expect(decision.reason).toBe('ALREADY_RESPONDED')
    }
  })

  it('reports the response as the reason ahead of anything else', () => {
    // Somebody who answered, in a read-only service, past their deadline. The
    // useful sentence is "they answered".
    const decision = evaluateEligibility(
      candidate({ responseChoice: 'INTERESTED', responseDeadline: '2020-01-01' }),
      context({ serviceMode: 'READ_ONLY' }),
    )
    expect(decision.eligible).toBe(false)
    if (decision.eligible) throw new Error('unreachable')
    expect(decision.reason).toBe('ALREADY_RESPONDED')
  })
})

describe('only invited and active accounts (§6.5)', () => {
  it('chases invited and active', () => {
    expect(isEligible(candidate({ accountStatus: 'INVITED' }), context())).toBe(true)
    expect(isEligible(candidate({ accountStatus: 'ACTIVE' }), context())).toBe(true)
  })

  it('never chases suspended, closed or archived', () => {
    for (const status of ['SUSPENDED', 'CLOSED', 'ARCHIVED'] as const) {
      const decision = evaluateEligibility(candidate({ accountStatus: status }), context())
      expect(decision.eligible, status).toBe(false)
      if (decision.eligible) throw new Error('unreachable')
      expect(decision.reason).toBe('ACCOUNT_NOT_INVITED_OR_ACTIVE')
    }
  })
})

describe('a blocked offer is never chased (§6.5)', () => {
  it('refuses a blocked offer', () => {
    const decision = evaluateEligibility(candidate({ blocked: true }), context())
    expect(decision.eligible).toBe(false)
    if (decision.eligible) throw new Error('unreachable')
    expect(decision.reason).toBe('OFFER_BLOCKED')
  })
})

describe('a reminder never precedes an invitation', () => {
  it('refuses an offer whose invitation has not been sent', () => {
    for (const status of ['DRAFT', 'FAILED', 'BLOCKED'] as const) {
      const decision = evaluateEligibility(candidate({ emailStatus: status }), context())
      expect(decision.eligible, status).toBe(false)
      if (decision.eligible) throw new Error('unreachable')
      expect(decision.reason).toBe('INVITATION_NEVER_SENT')
    }
  })
})

describe('the cap is hard (§6.5 — "Never more.")', () => {
  it('allows reminders up to the cap', () => {
    expect(isEligible(candidate({ remindersSent: 0 }), context({ maxPerRecipient: 2 }))).toBe(true)
    expect(isEligible(candidate({ remindersSent: 1 }), context({ maxPerRecipient: 2 }))).toBe(true)
  })

  it('refuses the one that would exceed it', () => {
    const decision = evaluateEligibility(
      candidate({ remindersSent: 2 }),
      context({ maxPerRecipient: 2 }),
    )
    expect(decision.eligible).toBe(false)
    if (decision.eligible) throw new Error('unreachable')
    expect(decision.reason).toBe('CAP_REACHED')
  })

  it('refuses everything when the cap is zero', () => {
    expect(isEligible(candidate(), context({ maxPerRecipient: 0 }))).toBe(false)
  })

  it('holds even when everything else is perfect and the deadline is far off', () => {
    expect(
      isEligible(
        candidate({ remindersSent: 5, responseDeadline: '2099-01-01' }),
        context({ maxPerRecipient: 2 }),
      ),
    ).toBe(false)
  })
})

describe('the deadline', () => {
  it('still chases on the deadline day itself', () => {
    // A deadline is a date and the edge resolves in the investor's favour: the
    // tenth is open all through the tenth.
    expect(
      isEligible(candidate({ responseDeadline: '2026-08-01' }), context({ today: '2026-08-01' })),
    ).toBe(true)
  })

  it('stops the day after', () => {
    const decision = evaluateEligibility(
      candidate({ responseDeadline: '2026-07-31' }),
      context({ today: '2026-08-01' }),
    )
    expect(decision.eligible).toBe(false)
    if (decision.eligible) throw new Error('unreachable')
    expect(decision.reason).toBe('DEADLINE_PASSED')
  })
})

describe('nothing sends outside active service mode (§6.5)', () => {
  it('refuses in every non-active mode', () => {
    for (const mode of ['READ_ONLY', 'SUNSET', 'DISABLED'] as const) {
      const decision = evaluateEligibility(candidate(), context({ serviceMode: mode }))
      expect(decision.eligible, mode).toBe(false)
      if (decision.eligible) throw new Error('unreachable')
      expect(decision.reason).toBe('SERVICE_MODE_NOT_ACTIVE')
    }
  })

  it('sends only in active', () => {
    expect(isEligible(candidate(), context({ serviceMode: 'ACTIVE' }))).toBe(true)
  })
})

describe('the schedule switch', () => {
  it('refuses everything when reminders are switched off for the round', () => {
    const decision = evaluateEligibility(candidate(), context({ scheduleEnabled: false }))
    expect(decision.eligible).toBe(false)
    if (decision.eligible) throw new Error('unreachable')
    expect(decision.reason).toBe('SCHEDULE_DISABLED')
  })
})

describe('every refusal explains itself', () => {
  it('never returns an empty or generic message', () => {
    const cases: Array<Partial<ReminderCandidate>> = [
      { responseChoice: 'INTERESTED' },
      { accountStatus: 'CLOSED' },
      { blocked: true },
      { emailStatus: 'DRAFT' },
      { remindersSent: 9 },
      { responseDeadline: '2000-01-01' },
    ]

    for (const overrides of cases) {
      const decision = evaluateEligibility(candidate(overrides), context())
      expect(decision.eligible).toBe(false)
      if (decision.eligible) throw new Error('unreachable')
      expect(decision.message.length).toBeGreaterThan(40)
      expect(decision.message).not.toMatch(/something went wrong|not eligible\.?$/i)
    }
  })
})

describe('the function has no way to be talked round', () => {
  it('exposes no override, force or skip parameter', () => {
    // A reminder is the one unattended sender. An "ignore the cap just this
    // once" argument is how a hard limit becomes a soft one.
    expect(evaluateEligibility.length).toBe(2)
    const source = evaluateEligibility.toString()
    expect(source).not.toMatch(/force|override|bypass|ignoreCap|skipChecks/i)
  })
})
