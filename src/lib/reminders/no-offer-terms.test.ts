import { describe, expect, it } from 'vitest'
import { REMINDER_TEMPLATE, INVITATION_TEMPLATE } from '@/lib/email/templates'
import { renderEmail } from '@/lib/email/render'
import type { SenderDefaults } from '@/lib/email/variables'
import {
  assertNoOfferTerms,
  checkNoOfferTerms,
  findForbiddenVariables,
  findLiteralFigures,
  FORBIDDEN_IN_REMINDER,
  ReminderCarriesOfferTermsError,
  visibleText,
} from './no-offer-terms'

/**
 * BUILD_SPEC §6.5: *"**It contains no offer terms, amounts, or percentages** —
 * those live in the portal, which is where the investor should be looking
 * anyway."*
 *
 * WP4 tests the built-in template. This tests the gate that runs against
 * whatever is actually about to be sent, because a stored template row can
 * replace the built-in one and is edited by a person in a hurry.
 */

const defaults: SenderDefaults = {
  defaultSenderName: 'David Serene',
  defaultSenderEmail: 'david@flipit.com',
  defaultSenderPhone: '+44 7700 900000',
  authenticatedSenderEmail: 'david@flipit.com',
  contactMethod: 'PHONE',
  operatorContactValuePresent: true,
  decimalPlaces: 3,
  verificationLink: 'https://spv.flipit.com/verify',
}

const recipient = {
  offerId: 'offer-1',
  recipientName: 'Alex Fenwick',
  recipientEmail: 'alex@example.com',
  proposedAmountUsd: '5000.00',
  spvPercentage: '16.666667',
  indirectPercentage: '5.000000',
  responseDeadline: '2026-03-10',
  portalLink: 'https://spv.flipit.com/portal/claim/abc',
  rowSenderName: null,
  rowSenderEmail: null,
  rowSenderPhone: null,
}

const renderReminder = () => renderEmail(REMINDER_TEMPLATE, recipient, defaults)

describe('the built-in reminder passes its own gate', () => {
  it('carries no offer terms', () => {
    const check = checkNoOfferTerms({
      template: REMINDER_TEMPLATE,
      rendered: renderReminder(),
    })
    expect(check.findings).toEqual([])
    expect(check.clean).toBe(true)
  })

  it('still carries the deadline, which is the one thing it is for', () => {
    // The literal patterns must not be so broad that they catch the date. A
    // deadline renders as "10 March 2026" — no symbol, no separator, no
    // decimal point.
    expect(renderReminder().text).toContain('10 March 2026')
  })

  it('still carries the portal link', () => {
    expect(renderReminder().text).toContain(recipient.portalLink)
  })
})

describe('the invitation deliberately fails it', () => {
  it('is caught, which is what proves the gate does anything', () => {
    // The invitation carries the figures on purpose. If this passed, the check
    // would be measuring nothing.
    const rendered = renderEmail(INVITATION_TEMPLATE, recipient, defaults)
    const check = checkNoOfferTerms({ template: INVITATION_TEMPLATE, rendered })
    expect(check.clean).toBe(false)
    expect(check.findings.some((finding) => finding.kind === 'VARIABLE')).toBe(true)
    expect(check.findings.some((finding) => finding.kind === 'LITERAL')).toBe(true)
  })
})

describe('the structural check — which variables the source references', () => {
  it.each([...FORBIDDEN_IN_REMINDER])('catches {{%s}}', (name) => {
    const findings = findForbiddenVariables({
      subject: 'A reminder',
      htmlSource: `<p>{{${name}}}</p>`,
      textSource: 'Nothing here.',
    })
    expect(findings).toEqual([{ kind: 'VARIABLE', detail: name, part: 'html' }])
  })

  it('names the three figures §6.5 lists, plus the two free-text fields', () => {
    expect([...FORBIDDEN_IN_REMINDER]).toEqual([
      'investment_amount',
      'spv_percentage',
      'indirect_flipit_percentage',
      'use_of_funds',
      'personal_line',
    ])
  })

  it('leaves the deadline, the link and the sender alone', () => {
    const findings = findForbiddenVariables({
      subject: '{{recipient_name}}',
      htmlSource: '<p>{{response_deadline}} {{secure_portal_link}} {{sender_name}}</p>',
      textSource: '{{sender_email}} {{sender_phone}} {{verification_link}}',
    })
    expect(findings).toEqual([])
  })
})

describe('the literal check — figures written into the copy', () => {
  it('catches a hard-coded amount that references no variable at all', () => {
    const findings = findLiteralFigures({
      subject: 'A reminder',
      html: '<p>Your USD 5,000 allocation is waiting.</p>',
      text: 'Your USD 5,000 allocation is waiting.',
    })
    expect(findings.length).toBeGreaterThan(0)
    expect(findings.some((finding) => finding.detail === 'a currency code')).toBe(true)
    expect(findings.some((finding) => finding.detail === 'a grouped figure')).toBe(true)
  })

  it('catches a per-cent sign in the copy', () => {
    const findings = findLiteralFigures({
      subject: 'A reminder',
      html: '<p>Your 5% share.</p>',
      text: 'Your 5% share.',
    })
    expect(findings.some((finding) => finding.detail === 'a per-cent sign')).toBe(true)
  })

  it('does not fire on layout — width:100% is not a percentage in the copy', () => {
    const findings = findLiteralFigures({
      subject: 'A reminder',
      html: '<table width="100%" style="width:100%;color:#1b1d33;"><tr><td>Please respond by 10 March 2026.</td></tr></table>',
      text: 'Please respond by 10 March 2026.',
    })
    expect(findings).toEqual([])
  })

  it('strips style and script blocks before looking', () => {
    expect(visibleText('<style>.a{width:100%}</style><p>Hello</p>')).toBe('Hello')
    expect(visibleText('<!-- 5% --><p>Hello</p>')).toBe('Hello')
  })
})

describe('the gate refuses rather than returning false', () => {
  it('throws, and names what it found and what to do', () => {
    let thrown: unknown
    try {
      assertNoOfferTerms({
        template: {
          subject: 'A reminder',
          htmlSource: '<p>{{investment_amount}}</p>',
          textSource: '{{investment_amount}}',
        },
        rendered: { subject: 'A reminder', html: '<p>USD 5,000</p>', text: 'USD 5,000' },
      })
    } catch (error) {
      thrown = error
    }

    expect(thrown).toBeInstanceOf(ReminderCarriesOfferTermsError)
    const error = thrown as ReminderCarriesOfferTermsError
    expect(error.message).toContain('investment_amount')
    expect(error.message).toContain('§6.5')
    expect(error.message).not.toMatch(/something went wrong/i)
    expect(error.findings.length).toBeGreaterThan(1)
  })

  it('is silent when there is nothing to report', () => {
    expect(() =>
      assertNoOfferTerms({ template: REMINDER_TEMPLATE, rendered: renderReminder() }),
    ).not.toThrow()
  })
})
