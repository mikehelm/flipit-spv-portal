import { describe, expect, it } from 'vitest'
import {
  buildTimeline,
  NOT_YET_REACHED,
  OFFER_STAGES,
  PAYMENT_SAFETY_NOTICE,
  showsPaymentSafetyNotice,
  type OfferStage,
} from './timeline'

const FACTS = {
  sentOn: '25 July 2026',
  responseChoice: 'INTERESTED' as const,
  respondedOn: '26 July 2026',
  responseDeadline: '10 August 2026',
  committedAmount: 'USD 5,000.00',
  acceptedAmount: 'USD 5,000.00',
  spvPercentage: '16.667%',
  paymentInstructionsIssuedOn: '1 August 2026',
  fundsCurrency: 'USD',
  fundsAmount: '5,000.00',
  fundsValueDate: '5 August 2026',
  fundsReference: 'FLIP-0001',
}

describe('the eight steps — §5', () => {
  it('always returns all eight, in order', () => {
    const steps = buildTimeline('INVITATION_SENT')
    expect(steps).toHaveLength(8)
    expect(steps.map((step) => step.stage)).toEqual([...OFFER_STAGES])
    expect(steps.map((step) => step.number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
  })

  it('marks earlier steps done, this one current and the rest ahead', () => {
    const steps = buildTimeline('COMMITMENT_AGREED', FACTS)
    expect(steps.slice(0, 3).every((step) => step.state === 'DONE')).toBe(true)
    expect(steps[3]!.state).toBe('CURRENT')
    expect(steps.slice(4).every((step) => step.state === 'AHEAD')).toBe(true)
  })

  it('gives every step an explanation, at every stage — §5', () => {
    for (const stage of OFFER_STAGES) {
      for (const step of buildTimeline(stage, FACTS)) {
        expect(step.explanation.trim().length).toBeGreaterThan(20)
        expect(step.label.trim().length).toBeGreaterThan(0)
      }
    }
  })

  it('shows the last step as current when everything is done', () => {
    const steps = buildTimeline('COMPLETED', FACTS)
    expect(steps[7]!.state).toBe('CURRENT')
    expect(steps.filter((step) => step.state === 'AHEAD')).toHaveLength(0)
  })
})

describe('a step not yet reached shows no detail at all', () => {
  it('uses the standard sentence and nothing else', () => {
    const steps = buildTimeline('INVITATION_SENT', FACTS)
    for (const step of steps.slice(1)) {
      expect(step.explanation).toBe(NOT_YET_REACHED)
    }
  })

  it('leaks no figure, date or reference into a step still ahead', () => {
    const steps = buildTimeline('INVITATION_SENT', FACTS)
    const ahead = steps.filter((step) => step.state === 'AHEAD')
    const text = ahead.map((step) => step.explanation).join(' ')

    for (const value of ['5,000.00', '16.667', 'FLIP-0001', '5 August 2026', '1 August 2026']) {
      expect(text).not.toContain(value)
    }
  })

  it('never renders an empty slot where a fact would go', () => {
    // The failure this guards: "sent on ." or "receipt of  on ." — a sentence
    // built from a template with the values missing.
    for (const stage of OFFER_STAGES) {
      for (const step of buildTimeline(stage, {})) {
        expect(step.explanation).not.toMatch(/\s\./)
        expect(step.explanation).not.toMatch(/\s{2,}/)
        expect(step.explanation).not.toMatch(/(undefined|null|NaN)/)
        expect(step.explanation).not.toMatch(/:\s*$/)
      }
    }
  })

  it('writes a complete sentence when a fact is genuinely absent', () => {
    const [first] = buildTimeline('INVITATION_SENT', {})
    expect(first!.explanation).toBe('Your personalised invitation was sent.')
  })
})

describe('nothing in the timeline reveals another investor — §15', () => {
  it('holds for every stage, with every fact populated', () => {
    for (const stage of OFFER_STAGES) {
      const text = buildTimeline(stage, FACTS)
        .map((step) => `${step.label} ${step.explanation}`)
        .join(' ')

      expect(text).not.toMatch(/other investor|another investor|participants|investors/i)
      expect(text).not.toMatch(/\bposition\b|\brank\b|\bqueue\b|\bwaitlist\b/i)
      expect(text).not.toMatch(/total raised|aggregate|out of \d/i)
    }
  })
})

describe('the payment-safety notice — §5, PORTAL_COPY', () => {
  it('appears from step 6 onward and not before', () => {
    const expected: Record<OfferStage, boolean> = {
      INVITATION_SENT: false,
      RESPONSE_RECORDED: false,
      DOCUMENTS_ISSUED: false,
      COMMITMENT_AGREED: false,
      ALLOCATION_ACCEPTED: false,
      PAYMENT_INSTRUCTIONS_ISSUED: true,
      FUNDS_RECEIVED: true,
      COMPLETED: true,
    }
    for (const stage of OFFER_STAGES) {
      expect(showsPaymentSafetyNotice(stage)).toBe(expected[stage])
    }
  })

  it('tells the investor to confirm by voice, not by reply', () => {
    expect(PAYMENT_SAFETY_NOTICE).toMatch(/never email you a change of bank details/i)
    expect(PAYMENT_SAFETY_NOTICE).toMatch(/by voice/i)
  })
})

describe('the response wording', () => {
  it('reflects the choice the investor actually made', () => {
    const interested = buildTimeline('RESPONSE_RECORDED', {
      responseChoice: 'INTERESTED',
      respondedOn: '26 July 2026',
    })
    expect(interested[1]!.explanation).toMatch(/interested in receiving the formal/i)

    const declined = buildTimeline('RESPONSE_RECORDED', {
      responseChoice: 'NOT_INTERESTED',
      respondedOn: '26 July 2026',
    })
    expect(declined[1]!.explanation).toMatch(/not interested at this time/i)
  })

  it('mentions the deadline only when there is one', () => {
    const withDeadline = buildTimeline('RESPONSE_RECORDED', {
      responseChoice: 'INTERESTED',
      responseDeadline: '10 August 2026',
    })
    expect(withDeadline[1]!.explanation).toContain('10 August 2026')

    const without = buildTimeline('RESPONSE_RECORDED', { responseChoice: 'INTERESTED' })
    expect(without[1]!.explanation).not.toMatch(/change this until/i)
  })
})
