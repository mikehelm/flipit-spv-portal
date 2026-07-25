import { describe, expect, it } from 'vitest'
import { hashTemplateSource } from '@/lib/crypto'
import { parseTemplate, referencedVariables, renderEmail } from '../render'
import {
  resolveEmailVariables,
  type RecipientVariableInput,
  type SenderDefaults,
} from '../variables'
import {
  EMAIL_TEMPLATE_KINDS,
  INVITATION_TEMPLATE,
  REMINDER_TEMPLATE,
  hashOf,
  templateSource,
} from './index'

const recipient: RecipientVariableInput = {
  offerId: 'offer_1',
  recipientName: 'Alex Fournier',
  recipientEmail: 'alex@example.com',
  proposedAmountUsd: '5000.00',
  spvPercentage: '16.666667',
  indirectPercentage: '5.000000',
  responseDeadline: '2026-08-10',
  portalLink: 'https://spv.flipit.com/portal/claim/abc123',
}

const senders: SenderDefaults = {
  defaultSenderName: 'David Serene',
  defaultSenderEmail: 'serenedavid@gmail.com',
  defaultSenderPhone: '+66 81 234 5678',
  authenticatedSenderEmail: 'serenedavid@gmail.com',
  contactMethod: 'PHONE',
  operatorContactValuePresent: true,
  decimalPlaces: 3,
  verificationLink: 'https://spv.flipit.com/verify',
}

/** Crude but sufficient: strip tags and entities to see what a human reads. */
function visibleText(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z]+;|&#\d+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

describe('both templates are well formed', () => {
  for (const kind of EMAIL_TEMPLATE_KINDS) {
    it(`${kind}: every part parses`, () => {
      const template = templateSource(kind)
      expect(() => parseTemplate(template.subject)).not.toThrow()
      expect(() => parseTemplate(template.htmlSource)).not.toThrow()
      expect(() => parseTemplate(template.textSource)).not.toThrow()
    })

    it(`${kind}: has a non-empty subject, HTML part and text part`, () => {
      const template = templateSource(kind)
      expect(template.subject.trim().length).toBeGreaterThan(0)
      expect(template.htmlSource.trim().length).toBeGreaterThan(0)
      // §11.5: "Plain-text multipart alternative is mandatory."
      expect(template.textSource.trim().length).toBeGreaterThan(200)
    })

    it(`${kind}: hashes its source, and the hash changes when one character does`, () => {
      const template = templateSource(kind)
      expect(template.hash).toBe(
        hashTemplateSource({
          subject: template.subject,
          htmlSource: template.htmlSource,
          textSource: template.textSource,
        }),
      )
      expect(template.hash).toHaveLength(64)

      const drifted = hashOf({
        subject: template.subject,
        htmlSource: template.htmlSource,
        textSource: `${template.textSource} `,
      })
      expect(drifted).not.toBe(template.hash)
    })
  }

  it('the two templates hash differently — separate approvals, §6.5', () => {
    expect(INVITATION_TEMPLATE.hash).not.toBe(REMINDER_TEMPLATE.hash)
  })
})

describe('the invitation — BUILD_SPEC §11.5', () => {
  const rendered = renderEmail(INVITATION_TEMPLATE, recipient, senders)

  it('is a table layout with inline styles and no stylesheet', () => {
    expect(INVITATION_TEMPLATE.htmlSource).toContain('<table')
    expect(INVITATION_TEMPLATE.htmlSource).not.toMatch(/<style[\s>]/i)
    expect(INVITATION_TEMPLATE.htmlSource).not.toMatch(/<link[^>]+stylesheet/i)
    expect(INVITATION_TEMPLATE.htmlSource).not.toMatch(/\sclass=/)
  })

  it('is capped at 600px', () => {
    expect(INVITATION_TEMPLATE.htmlSource).toContain('max-width:600px')
    expect(INVITATION_TEMPLATE.htmlSource).toContain('width="600"')
  })

  it('reads correctly with images blocked — it contains no images at all', () => {
    expect(INVITATION_TEMPLATE.htmlSource).not.toMatch(/<img[\s>]/i)
    expect(INVITATION_TEMPLATE.htmlSource).not.toMatch(/background-image/i)
    // The wordmark is live text, so the dark header still says FLIPIT.
    expect(visibleText(INVITATION_TEMPLATE.htmlSource)).toContain('FLIPIT')
  })

  it('carries no tracking pixel and no external request of any kind — §12', () => {
    const external = INVITATION_TEMPLATE.htmlSource.match(/https?:\/\/[^"'\s>]+/g) ?? []
    expect(external).toEqual([])
  })

  it('uses the FLIPIT dark header and light body', () => {
    expect(INVITATION_TEMPLATE.htmlSource).toContain('#070823')
    expect(INVITATION_TEMPLATE.htmlSource).toContain('background-color:#ffffff')
  })

  it('uses orange for the portal button and for nothing else', () => {
    const orange = INVITATION_TEMPLATE.htmlSource.match(/#F59A23/gi) ?? []
    // Exactly the two declarations on the one button cell: the bgcolor
    // attribute and the background-color style beside it.
    expect(orange).toHaveLength(2)

    const buttonCell = /bgcolor="#F59A23"[\s\S]{0,400}?<\/td>/.exec(
      INVITATION_TEMPLATE.htmlSource,
    )
    expect(buttonCell?.[0]).toContain('{{secure_portal_link}}')
  })

  it('has exactly one primary action, with no competing button', () => {
    const buttons = INVITATION_TEMPLATE.htmlSource.match(/bgcolor="#F59A23"/g) ?? []
    expect(buttons).toHaveLength(1)
  })

  it('puts the offer figures in a bordered panel that survives being read alone', () => {
    const panel = /border:2px solid[\s\S]*?assumes the SPV completes/.exec(
      INVITATION_TEMPLATE.htmlSource,
    )
    expect(panel).not.toBeNull()
    const source = panel![0]
    expect(source).toContain('{{investment_amount}}')
    expect(source).toContain('{{spv_percentage}}')
    expect(source).toContain('{{indirect_flipit_percentage}}')
    expect(source).toContain('{{response_deadline}}')
    // It repeats who it is for and carries its own caveat, because it gets
    // screenshotted and forwarded on its own.
    expect(source).toContain('{{recipient_name}}')
    expect(source).toContain('border:2px solid')
  })

  it('carries the same information in the text part as in the HTML part', () => {
    const html = visibleText(rendered.html)
    for (const fragment of [
      'Alex Fournier',
      'USD 5,000.00',
      '16.667',
      '10 August 2026',
      'https://spv.flipit.com/portal/claim/abc123',
      'David Serene',
      'serenedavid@gmail.com',
      '+66 81 234 5678',
    ]) {
      expect(html).toContain(fragment)
      expect(rendered.text).toContain(fragment)
    }
  })

  it('references the same variables in both parts', () => {
    expect([...referencedVariables(INVITATION_TEMPLATE.htmlSource)].sort()).toEqual(
      [...referencedVariables(INVITATION_TEMPLATE.textSource)].sort(),
    )
  })

  it('reproduces the approved copy from EMAIL_TEMPLATE.txt', () => {
    for (const sentence of [
      'A British Virgin Islands special purpose vehicle, or SPV, is being established to invest in Flipit Global Limited',
      'The SPV may acquire up to 30% of Flipit Global Limited for a total aggregate investment of USD 30,000.',
      'No payment is requested at this stage, and submitting a response does not create a binding investment commitment.',
      'If you decline or do not respond by the deadline, your proposed allocation may be offered to other eligible participants',
    ]) {
      expect(rendered.text).toContain(sentence)
      expect(visibleText(rendered.html)).toContain(sentence)
    }
  })

  it('carries the payment-details warning in both parts', () => {
    expect(visibleText(rendered.html).toLowerCase()).toContain(
      'we will never email you a change of bank details',
    )
    expect(rendered.text.toLowerCase()).toContain(
      'we will never email you a change of bank details',
    )
  })

  it('links the anti-phishing verification page from the footer — §15.1', () => {
    expect(rendered.text).toContain('https://spv.flipit.com/verify')
    expect(rendered.html).toContain('https://spv.flipit.com/verify')
  })

  it('does not present a response as a binding subscription — §8.2', () => {
    const text = rendered.text.toLowerCase()
    expect(text).toContain('does not create a binding investment commitment')
    expect(text).not.toMatch(/\byou agree to (subscribe|invest)\b/)
  })

  it('carries no "Made by Make with Mike" credit — §13.2', () => {
    expect(INVITATION_TEMPLATE.htmlSource).not.toMatch(/make with mike/i)
    expect(INVITATION_TEMPLATE.textSource).not.toMatch(/make with mike/i)
  })

  it('says nothing about any other investor — §35', () => {
    const text = `${rendered.text} ${visibleText(rendered.html)}`.toLowerCase()
    expect(text).not.toMatch(/other investors|remaining allocation|so far|round progress/)
  })
})

describe('the reminder — BUILD_SPEC §6.5', () => {
  const rendered = renderEmail(REMINDER_TEMPLATE, recipient, senders)

  it('is much shorter than the invitation', () => {
    expect(REMINDER_TEMPLATE.textSource.length).toBeLessThan(
      INVITATION_TEMPLATE.textSource.length / 2,
    )
  })

  it('references no offer-term variable in any part', () => {
    const forbidden = [
      'investment_amount',
      'spv_percentage',
      'indirect_flipit_percentage',
      'use_of_funds',
    ]
    const referenced = new Set([
      ...referencedVariables(REMINDER_TEMPLATE.subject),
      ...referencedVariables(REMINDER_TEMPLATE.htmlSource),
      ...referencedVariables(REMINDER_TEMPLATE.textSource),
    ])
    for (const name of forbidden) {
      expect([...referenced]).not.toContain(name)
    }
  })

  it('contains no amount, no currency and no percentage once rendered', () => {
    const bodies = [rendered.text, visibleText(rendered.html), rendered.subject]
    for (const body of bodies) {
      expect(body).not.toContain('%')
      expect(body).not.toMatch(/\bUSD\b/)
      expect(body).not.toContain('$')
      // No figure that could be an amount or a percentage. The rendered
      // deadline ("10 August 2026") is the only number allowed here.
      expect(body).not.toMatch(/\d[\d,]*\.\d\d/)
    }
  })

  it('carries the deadline and the portal link, which is the whole content', () => {
    expect(rendered.text).toContain('10 August 2026')
    expect(rendered.text).toContain('https://spv.flipit.com/portal/claim/abc123')
    expect(rendered.html).toContain('https://spv.flipit.com/portal/claim/abc123')
  })

  it('is 600px, table-based, image-free and orange only on the button', () => {
    expect(REMINDER_TEMPLATE.htmlSource).toContain('max-width:600px')
    expect(REMINDER_TEMPLATE.htmlSource).not.toMatch(/<img[\s>]/i)
    expect((REMINDER_TEMPLATE.htmlSource.match(/#F59A23/gi) ?? [])).toHaveLength(2)
  })

  it('has its own subject, distinct from the invitation', () => {
    expect(REMINDER_TEMPLATE.subject).not.toBe(INVITATION_TEMPLATE.subject)
  })

  it('drops the contact line for EMAIL_ONLY too', () => {
    const emailOnly = renderEmail(REMINDER_TEMPLATE, recipient, {
      ...senders,
      contactMethod: 'EMAIL_ONLY',
    })
    expect(emailOnly.text).not.toMatch(/Telephone|WhatsApp/)
  })
})

describe('the conditional blocks do not change the hash', () => {
  it('the same source hashes the same whatever the contact method is', () => {
    // §2.1: the compliance hash is computed over the template source INCLUDING
    // its conditional blocks, so a contact-method change cannot silently void
    // an approval. Rendering differs; the hash does not.
    const phone = renderEmail(INVITATION_TEMPLATE, recipient, senders)
    const emailOnly = renderEmail(INVITATION_TEMPLATE, recipient, {
      ...senders,
      contactMethod: 'EMAIL_ONLY',
    })
    expect(phone.text).not.toBe(emailOnly.text)
    expect(phone.templateHash).toBe(emailOnly.templateHash)
  })
})

describe('resolution and rendering agree about what is optional', () => {
  it('every variable the invitation references outside a conditional resolves', () => {
    const context = resolveEmailVariables(recipient, senders)
    const referenced = referencedVariables(INVITATION_TEMPLATE.htmlSource)
    for (const name of referenced) {
      if (name === 'sender_phone' || name === 'personal_line' || name === 'use_of_funds') {
        continue
      }
      expect(context.variables[name]).not.toBeNull()
    }
  })
})
