import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  EMAIL_VARIABLES,
  EMAIL_VARIABLE_NAMES,
  formatDeadline,
  isEmailFlag,
  isEmailVariable,
  REQUIRED_EMAIL_VARIABLES,
  resolveEmailVariables,
  type RecipientVariableInput,
  type SenderDefaults,
} from './variables'

const recipient = (overrides: Partial<RecipientVariableInput> = {}): RecipientVariableInput => ({
  offerId: 'offer_1',
  recipientName: 'Alex Fournier',
  recipientEmail: 'alex@example.com',
  proposedAmountUsd: '5000.00',
  spvPercentage: '16.666667',
  indirectPercentage: '5.000000',
  responseDeadline: '2026-08-10',
  portalLink: 'https://spv.flipit.com/portal/claim/abc',
  ...overrides,
})

const defaults = (overrides: Partial<SenderDefaults> = {}): SenderDefaults => ({
  defaultSenderName: 'David Serene',
  defaultSenderEmail: 'serenedavid@gmail.com',
  defaultSenderPhone: '+66 81 234 5678',
  authenticatedSenderEmail: 'serenedavid@gmail.com',
  contactMethod: 'PHONE',
  operatorContactValuePresent: true,
  decimalPlaces: 3,
  verificationLink: 'https://spv.flipit.com/verify',
  ...overrides,
})

describe('the declared variable set', () => {
  it('declares every BUILD_SPEC §11.1 variable', () => {
    for (const name of [
      'recipient_name',
      'investment_amount',
      'spv_percentage',
      'indirect_flipit_percentage',
      'response_deadline',
      'secure_portal_link',
      'sender_name',
      'sender_email',
      'sender_phone',
    ]) {
      expect(isEmailVariable(name)).toBe(true)
    }
  })

  it('declares personal_line and use_of_funds as optional', () => {
    expect(EMAIL_VARIABLES.personal_line.optional).toBe(true)
    expect(EMAIL_VARIABLES.use_of_funds.optional).toBe(true)
    expect(REQUIRED_EMAIL_VARIABLES).not.toContain('personal_line')
    expect(REQUIRED_EMAIL_VARIABLES).not.toContain('use_of_funds')
  })

  it('treats sender_phone as optional and everything else in §11.1 as required', () => {
    expect(EMAIL_VARIABLES.sender_phone.optional).toBe(true)
    expect(REQUIRED_EMAIL_VARIABLES).toContain('sender_name')
    expect(REQUIRED_EMAIL_VARIABLES).toContain('sender_email')
    expect(REQUIRED_EMAIL_VARIABLES).toContain('recipient_name')
  })

  it('keeps flags and variables in separate namespaces', () => {
    for (const name of EMAIL_VARIABLE_NAMES) {
      expect(isEmailFlag(name)).toBe(false)
    }
    expect(isEmailVariable('contact_phone')).toBe(false)
    expect(isEmailFlag('contact_phone')).toBe(true)
  })

  it('has a declaration for every declared name', () => {
    for (const name of EMAIL_VARIABLE_NAMES) {
      expect(EMAIL_VARIABLES[name].name).toBe(name)
      expect(EMAIL_VARIABLES[name].chain.length).toBeGreaterThan(0)
    }
  })
})

describe('no JavaScript number touches money or a percentage', () => {
  it('contains no numeric coercion anywhere in the module', () => {
    const source = readFileSync(new URL('./variables.ts', import.meta.url), 'utf8')
    const stripped = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    expect(stripped).not.toMatch(/\bNumber\s*\(/)
    expect(stripped).not.toMatch(/\bparseFloat\s*\(/)
    expect(stripped).not.toMatch(/\bparseInt\s*\(/)
    expect(stripped).not.toMatch(/\.toNumber\s*\(/)
    expect(stripped).not.toMatch(/\bMath\./)
  })

  it('formats an amount from its string form without losing precision', () => {
    const context = resolveEmailVariables(
      recipient({ proposedAmountUsd: '1234567.89' }),
      defaults(),
    )
    expect(context.variables.investment_amount).toBe('1,234,567.89')
  })

  it('rounds percentages for display only, at the configured precision', () => {
    const three = resolveEmailVariables(recipient(), defaults({ decimalPlaces: 3 }))
    expect(three.variables.spv_percentage).toBe('16.667')

    const six = resolveEmailVariables(recipient(), defaults({ decimalPlaces: 6 }))
    expect(six.variables.spv_percentage).toBe('16.666667')
  })

  it('keeps the configured precision so figures in one panel line up', () => {
    // Not trimmed to "5". Two figures shown side by side at different
    // precisions read as a mistake in a document about someone's money.
    const context = resolveEmailVariables(
      recipient({ indirectPercentage: '5.000000' }),
      defaults(),
    )
    expect(context.variables.indirect_flipit_percentage).toBe('5.000')
  })
})

describe('formatDeadline', () => {
  it('renders an ISO date as a written date', () => {
    expect(formatDeadline('2026-08-10')).toBe('10 August 2026')
    expect(formatDeadline('2026-01-01')).toBe('1 January 2026')
    expect(formatDeadline('2026-12-31')).toBe('31 December 2026')
  })

  it('refuses anything that is not an ISO date', () => {
    expect(() => formatDeadline('10/08/2026')).toThrow(/ISO date/)
    expect(() => formatDeadline('2026-08-10T00:00:00Z')).toThrow(/ISO date/)
    expect(() => formatDeadline('')).toThrow(/ISO date/)
  })

  it('refuses an impossible month or day', () => {
    expect(() => formatDeadline('2026-13-01')).toThrow(/month/)
    expect(() => formatDeadline('2026-08-32')).toThrow(/day/)
  })
})

describe('the §11.2 fallback chain', () => {
  it('prefers the per-row value over the configured default', () => {
    const context = resolveEmailVariables(
      recipient({
        rowSenderName: 'Row Name',
        rowSenderEmail: 'row@example.com',
        rowSenderPhone: '+1 555 0100',
      }),
      defaults(),
    )
    expect(context.variables.sender_name).toBe('Row Name')
    expect(context.variables.sender_email).toBe('row@example.com')
    expect(context.variables.sender_phone).toBe('+1 555 0100')
    expect(context.sources.sender_email).toBe('ROW')
  })

  it('falls back to the service config default', () => {
    const context = resolveEmailVariables(recipient(), defaults())
    expect(context.variables.sender_email).toBe('serenedavid@gmail.com')
    expect(context.sources.sender_email).toBe('SERVICE_CONFIG')
    expect(context.sources.sender_phone).toBe('SERVICE_CONFIG')
  })

  it('falls back to the authenticated address for sender_email only', () => {
    const context = resolveEmailVariables(
      recipient(),
      defaults({
        defaultSenderEmail: null,
        defaultSenderName: null,
        defaultSenderPhone: null,
        authenticatedSenderEmail: 'authenticated@gmail.com',
      }),
    )
    expect(context.variables.sender_email).toBe('authenticated@gmail.com')
    expect(context.sources.sender_email).toBe('AUTHENTICATED_ADDRESS')

    // The authenticated address is not a source for the other two.
    expect(context.variables.sender_name).toBeNull()
    expect(context.variables.sender_phone).toBeNull()
  })

  it('gives sender_phone no automatic fallback — AC21', () => {
    const context = resolveEmailVariables(
      recipient(),
      defaults({ defaultSenderPhone: null }),
    )
    expect(context.variables.sender_phone).toBeNull()
    expect(context.sources.sender_phone).toBe('ABSENT')
    expect(context.notes.sender_phone).toMatch(/no automatic fallback|onboarding/i)
  })

  it('does not use the operator onboarding number as a silent third source', () => {
    const context = resolveEmailVariables(
      recipient(),
      defaults({ defaultSenderPhone: null, operatorContactValuePresent: true }),
    )
    expect(context.variables.sender_phone).toBeNull()
    expect(context.notes.sender_phone).toMatch(/onboarding/i)
  })

  it('treats a whitespace-only value as absent rather than as a value', () => {
    const context = resolveEmailVariables(
      recipient({ rowSenderPhone: '   ' }),
      defaults({ defaultSenderPhone: '+66 81 234 5678' }),
    )
    expect(context.variables.sender_phone).toBe('+66 81 234 5678')
  })
})

describe('the operator contact method', () => {
  it('removes the phone entirely for EMAIL_ONLY, even when a default exists', () => {
    const context = resolveEmailVariables(
      recipient({ rowSenderPhone: '+1 555 0100' }),
      defaults({ contactMethod: 'EMAIL_ONLY' }),
    )
    expect(context.variables.sender_phone).toBeNull()
    expect(context.flags.contact_phone).toBe(false)
    expect(context.flags.contact_whatsapp).toBe(false)
    // Absent, not blank, and not a problem.
    expect(context.notes.sender_phone).toBeUndefined()
  })

  it('sets exactly one contact flag', () => {
    const phone = resolveEmailVariables(recipient(), defaults({ contactMethod: 'PHONE' }))
    expect(phone.flags).toEqual({ contact_phone: true, contact_whatsapp: false })

    const whatsapp = resolveEmailVariables(
      recipient(),
      defaults({ contactMethod: 'WHATSAPP' }),
    )
    expect(whatsapp.flags).toEqual({ contact_phone: false, contact_whatsapp: true })
  })

<<<<<<< HEAD
  it('keeps the flag set when the number is missing, so pre-flight blocks — AC21', () => {
    // If the flag switched off whenever the value was absent, the phone line
    // would quietly vanish and a missing sender_phone would never be caught.
=======
  it('keeps the flag set when the number is missing, so pre-flight sees it — AC21', () => {
    // The label never renders alone, because the email never renders at all:
    // the flag stays true, {{sender_phone}} is referenced inside a live block,
    // and rendering fails by name. Dropping the flag here would send a
    // contact-less email quietly, which is the failure AC21 is written against.
>>>>>>> c6e37a5734f287d0afb3f54a476fe6c0a2537a19
    const context = resolveEmailVariables(
      recipient(),
      defaults({ contactMethod: 'PHONE', defaultSenderPhone: null }),
    )
    expect(context.flags.contact_phone).toBe(true)
    expect(context.variables.sender_phone).toBeNull()
<<<<<<< HEAD
=======
    expect(context.notes.sender_phone).toBeDefined()
>>>>>>> c6e37a5734f287d0afb3f54a476fe6c0a2537a19
  })

  it('says so plainly, and blocks, when the operator has not chosen a method', () => {
    const context = resolveEmailVariables(
      recipient(),
      // A configured number is deliberately not enough on its own: without a
      // chosen method there is no correct label for it.
      defaults({ contactMethod: null, defaultSenderPhone: '+66 81 234 5678' }),
    )
    expect(context.notes.sender_phone).toMatch(/contact method/i)
    expect(context.variables.sender_phone).toBeNull()
    expect(context.flags.contact_phone).toBe(true)
  })
})

describe('the optional per-recipient copy', () => {
  it('resolves personal_line and use_of_funds when supplied', () => {
    const context = resolveEmailVariables(
      recipient({ personalLine: 'Good to speak last week.', useOfFunds: 'Launch and growth.' }),
      defaults(),
    )
    expect(context.variables.personal_line).toBe('Good to speak last week.')
    expect(context.variables.use_of_funds).toBe('Launch and growth.')
  })

  it('leaves them absent with no note when not supplied', () => {
    const context = resolveEmailVariables(recipient(), defaults())
    expect(context.variables.personal_line).toBeNull()
    expect(context.variables.use_of_funds).toBeNull()
    expect(context.notes.personal_line).toBeUndefined()
    expect(context.notes.use_of_funds).toBeUndefined()
  })
})
