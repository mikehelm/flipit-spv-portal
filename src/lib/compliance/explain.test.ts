import { describe, expect, it } from 'vitest'
import { explainJurisdictionBlock, NOT_LEGAL_ADVICE, shortBlockReason } from './explain'

/**
 * BUILD_SPEC §8.3 — what David sees when a recipient is blocked.
 *
 * These assert the substance the spec asks for, not the exact prose. The
 * wording can be improved; the four things it has to say cannot be dropped.
 */

describe('the US explanation', () => {
  const explanation = explainJurisdictionBlock({
    code: 'US',
    recipientName: 'Hank Example',
    approvedJurisdictions: ['AU', 'FR', 'GB', 'TH'],
  })

  it('names the person and says they are held, not sent', () => {
    expect(explanation.headline).toMatch(/Hank Example/)
    expect(explanation.headline).toMatch(/held/i)
  })

  it('says the rest of the round is unaffected', () => {
    const body = explanation.paragraphs.join(' ')
    expect(body).toMatch(/every other recipient is (completely )?unaffected/i)
  })

  it('explains that a non-US offering generally depends on remaining non-US', () => {
    const body = explanation.paragraphs.join(' ')
    expect(body).toMatch(/outside the United States/i)
    expect(body).toMatch(/changes the analysis/i)
  })

  it('says the amount does not create an exemption', () => {
    const body = explanation.paragraphs.join(' ')
    expect(body).toMatch(/small offering is still an offering/i)
  })

  it('says exactly what unblocking requires — a recorded reference', () => {
    const steps = explanation.unblockingRequires.join(' ')
    expect(steps).toMatch(/record/i)
    expect(steps).toMatch(/reference/i)
    expect(steps).toMatch(/this person only|this recipient/i)
  })

  it('says no blanket unblock exists', () => {
    const steps = explanation.unblockingRequires.join(' ')
    expect(steps).toMatch(/unblocks a jurisdiction for\s+everybody at once/i)
  })

  it('makes clear the app is not giving legal advice and is refusing to guess', () => {
    expect(explanation.notLegalAdvice).toBe(NOT_LEGAL_ADVICE)
    expect(NOT_LEGAL_ADVICE).toMatch(/does not give legal advice/i)
    expect(NOT_LEGAL_ADVICE).toMatch(/declining to guess/i)
  })

  it('makes the §8.3 recommendation — send to the rest, hold this one', () => {
    expect(explanation.recommendation).toMatch(/hold this one person/i)
  })
})

describe('other jurisdictions', () => {
  it('does not reuse the US reasoning for Thailand', () => {
    const explanation = explainJurisdictionBlock({
      code: 'TH',
      recipientName: 'Somchai',
      approvedJurisdictions: ['GB', 'AU'],
    })
    expect(explanation.paragraphs.join(' ')).not.toMatch(/United States/)
    expect(explanation.headline).toMatch(/Thailand \(TH\)/)
  })

  it('lists what the approval actually covers', () => {
    const explanation = explainJurisdictionBlock({
      code: 'TH',
      approvedJurisdictions: ['GB', 'AU'],
    })
    expect(explanation.paragraphs.join(' ')).toMatch(/GB, AU/)
  })

  it('says so plainly when the approval clears nothing', () => {
    const explanation = explainJurisdictionBlock({ code: 'TH', approvedJurisdictions: [] })
    expect(explanation.paragraphs.join(' ')).toMatch(/no jurisdictions at all/)
  })

  it('still carries the disclaimer and the unblocking steps', () => {
    const explanation = explainJurisdictionBlock({ code: 'FR' })
    expect(explanation.notLegalAdvice).toBe(NOT_LEGAL_ADVICE)
    expect(explanation.unblockingRequires.length).toBeGreaterThan(0)
  })

  it('handles a missing jurisdiction without pretending to know the country', () => {
    const explanation = explainJurisdictionBlock({ code: '', recipientName: 'Nobody' })
    expect(explanation.headline).toMatch(/no usable jurisdiction/i)
    expect(explanation.unblockingRequires.join(' ')).toMatch(/two-letter country code/i)
  })

  it('works without a recipient name', () => {
    const explanation = explainJurisdictionBlock({ code: 'US' })
    expect(explanation.headline).toMatch(/^This recipient/)
  })
})

describe('shortBlockReason', () => {
  it('names the country, the list, and that the block is individual', () => {
    const reason = shortBlockReason('US', ['GB', 'AU'])
    expect(reason).toMatch(/United States \(US\)/)
    expect(reason).toMatch(/GB, AU/)
    expect(reason).toMatch(/every other recipient is unaffected/i)
  })

  it('is specific when there is no jurisdiction at all', () => {
    expect(shortBlockReason('', ['GB'])).toMatch(/No valid jurisdiction/)
  })

  it('says the list is empty rather than printing nothing', () => {
    expect(shortBlockReason('US', [])).toMatch(/the list is empty/)
  })
})
