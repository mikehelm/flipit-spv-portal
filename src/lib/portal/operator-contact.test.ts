import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  OPERATOR_CONTACT_COPY,
  OPERATOR_CONTACT_SAFETY,
  operatorContact,
  type OperatorContactInput,
} from './operator-contact'

/**
 * The route to the operator from a working portal. BUILD_SPEC §2.1, §13.
 *
 * §2.1's WhatsApp option promises *"a `wa.me` link in the portal"*, and
 * `whatsappLink()` was written in WP2 with nothing importing it. This is the
 * test for the caller it was waiting for.
 */

const EMAIL = 'serenedavid@gmail.com'
const NUMBER = '+66 81 234 5678'

function input(over: Partial<OperatorContactInput> = {}): OperatorContactInput {
  return { method: 'WHATSAPP', value: NUMBER, email: EMAIL, ...over }
}

describe('the WhatsApp choice', () => {
  it('produces the wa.me link §2.1 promises', () => {
    expect(operatorContact(input())).toEqual({
      kind: 'WHATSAPP',
      display: NUMBER,
      href: 'https://wa.me/66812345678',
    })
  })

  it('shows the number as the operator typed it, and links it as wa.me wants it', () => {
    // Two different things. An investor reads a number with spaces in it; the
    // link takes digits only, no plus, no separators.
    const contact = operatorContact(input({ value: '(020) 7946 0958' }))
    expect(contact?.display).toBe('(020) 7946 0958')
    expect(contact?.href).toBe('https://wa.me/02079460958')
  })
})

describe('the phone choice', () => {
  it('produces a tel: link', () => {
    expect(operatorContact(input({ method: 'PHONE' }))).toEqual({
      kind: 'PHONE',
      display: NUMBER,
      href: 'tel:+66812345678',
    })
  })

  it('keeps the leading plus, which is what makes an international number dial', () => {
    expect(operatorContact(input({ method: 'PHONE', value: '+44 20 7946 0958' }))?.href).toBe(
      'tel:+442079460958',
    )
  })
})

describe('the email-only choice', () => {
  it('still produces a route', () => {
    // §2.1's third option removes the phone line from the *email template*. It
    // does not mean the investor is left with nowhere to write — §13 asks for a
    // route unconditionally.
    expect(operatorContact(input({ method: 'EMAIL_ONLY', value: null }))).toEqual({
      kind: 'EMAIL',
      display: EMAIL,
      href: `mailto:${EMAIL}`,
    })
  })

  it('ignores a number left behind by an earlier choice', () => {
    // Switching from phone to email-only nulls the value, but a stale row
    // should not resurrect a number the operator chose to stop giving out.
    const contact = operatorContact(input({ method: 'EMAIL_ONLY', value: NUMBER }))
    expect(contact?.kind).toBe('EMAIL')
    expect(contact?.display).toBe(EMAIL)
    expect(contact?.href).not.toContain('wa.me')
    expect(contact?.href).not.toContain('tel:')
  })
})

describe('when the configuration is incomplete', () => {
  it('falls back to the address when no method has been chosen', () => {
    expect(operatorContact(input({ method: null, value: null }))?.kind).toBe('EMAIL')
  })

  it('falls back to the address when the number is missing', () => {
    for (const value of [null, '', '   ']) {
      expect(operatorContact(input({ value }))?.kind, JSON.stringify(value)).toBe('EMAIL')
    }
  })

  it('falls back to the address when the number could not be dialled', () => {
    // A `tel:` or `wa.me` link that does nothing is worse than an email
    // address, because it looks like it worked.
    for (const value of ['12345', 'call me', '+', 'ext. 4021', '0123456789012345678']) {
      expect(operatorContact(input({ value }))?.kind, value).toBe('EMAIL')
    }
  })

  it('returns nothing at all when nothing is configured', () => {
    // The same rule as `contact.ts`: never invent. The page renders no section
    // rather than a route that is not one.
    expect(operatorContact({ method: null, value: null, email: null })).toBe(null)
    expect(operatorContact({ method: 'WHATSAPP', value: null, email: '  ' })).toBe(null)
    expect(operatorContact({ method: 'PHONE', value: 'not a number', email: '' })).toBe(null)
  })
})

describe('the copy', () => {
  it('has a line for every kind', () => {
    for (const kind of ['WHATSAPP', 'PHONE', 'EMAIL'] as const) {
      expect(OPERATOR_CONTACT_COPY[kind].length).toBeGreaterThan(20)
      expect(OPERATOR_CONTACT_COPY[kind]).toMatch(/ $/)
    }
  })

  it('names nobody', () => {
    // The route makes the name unnecessary, and a hard-coded first name goes
    // wrong quietly on the day somebody else is answering — the same reason
    // "David" came out of the notice pages.
    for (const line of Object.values(OPERATOR_CONTACT_COPY)) {
      expect(line).not.toMatch(/David|Michael/)
    }
  })

  it('promises no reply time', () => {
    for (const line of Object.values(OPERATOR_CONTACT_COPY)) {
      expect(line.toLowerCase()).not.toMatch(/within|hours|24|same day|promptly|guarantee/)
    }
  })

  it('carries the payment-details warning §15.1 asks for', () => {
    // A private channel is where a request to change bank details would arrive.
    expect(OPERATOR_CONTACT_SAFETY.toLowerCase()).toContain('never ask you for payment')
    expect(OPERATOR_CONTACT_SAFETY.toLowerCase()).toContain('change of bank details')
  })
})

describe('what the function cannot be given', () => {
  it('takes nothing belonging to an investor', () => {
    // §15. There is no field on the input through which an account, an offer or
    // another investor could arrive — which is what makes "this cannot leak"
    // a fact about the type rather than a promise about the caller.
    const source = readFileSync(
      join(process.cwd(), 'src/lib/portal/operator-contact.ts'),
      'utf8',
    )
    const shape = source.slice(
      source.indexOf('export interface OperatorContactInput'),
      source.indexOf('function clean'),
    )
    expect(shape).not.toMatch(/account|investor|offer|recipient/i)
    expect(source).not.toContain("from '@/db'")
  })

  it('is rendered only where the investor can see their record', () => {
    const page = readFileSync(join(process.cwd(), 'src/app/portal/page.tsx'), 'utf8')
    expect(page).toContain('view.operatorContact')
    // An external link opens in a new tab and must carry the opener guard.
    expect(page).toContain("rel: 'noopener noreferrer'")
  })
})
