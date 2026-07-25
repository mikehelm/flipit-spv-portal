import { describe, expect, it } from 'vitest'
import {
  escapeHtml,
  parseTemplate,
  referencedVariables,
  renderEmail,
  renderPart,
  TemplateSyntaxError,
  UnresolvedVariableError,
  validateBatch,
} from './render'
import { INVITATION_TEMPLATE, REMINDER_TEMPLATE, templateSource } from './templates'
import {
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
  portalLink: 'https://spv.flipit.com/portal/claim/abc123',
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

const contextOf = (
  input: Partial<RecipientVariableInput> = {},
  senders: Partial<SenderDefaults> = {},
) => resolveEmailVariables(recipient(input), defaults(senders))

// ---------------------------------------------------------------------------

describe('parsing', () => {
  it('rejects a variable that is not declared', () => {
    expect(() => parseTemplate('Hello {{not_a_variable}}')).toThrow(TemplateSyntaxError)
    expect(() => parseTemplate('Hello {{not_a_variable}}')).toThrow(/not a declared/)
  })

  it('rejects a flag used as a value', () => {
    expect(() => parseTemplate('{{contact_phone}}')).toThrow(/is a condition, not a value/)
  })

  it('rejects an unclosed block', () => {
    expect(() => parseTemplate('{{#if contact_phone}}x')).toThrow(/never closed/)
  })

  it('rejects a stray closing tag', () => {
    expect(() => parseTemplate('x{{/if}}')).toThrow(/never opened/)
  })

  it('rejects a mismatched close', () => {
    expect(() => parseTemplate('{{#if contact_phone}}x{{/unless}}')).toThrow(/closed with/)
  })

  it('rejects an unknown block keyword', () => {
    expect(() => parseTemplate('{{#each x}}y{{/each}}')).toThrow(/Only .#if. and .#unless./)
  })

  it('rejects an empty tag', () => {
    expect(() => parseTemplate('a{{}}b')).toThrow(/Empty tag/)
  })

  it('supports nesting', () => {
    const nodes = parseTemplate(
      '{{#if contact_phone}}A{{#if sender_phone}}B{{/if}}C{{/if}}',
    )
    expect(nodes).toHaveLength(1)
    expect(nodes[0].type).toBe('if')
  })

  it('reports every variable a template can reference in any branch', () => {
    const found = referencedVariables(
      'Hi {{recipient_name}}{{#if contact_phone}} on {{sender_phone}}{{/if}}',
    )
    expect([...found].sort()).toEqual(['recipient_name', 'sender_phone'])
  })
})

describe('rendering', () => {
  it('substitutes declared variables', () => {
    const result = renderPart('Dear {{recipient_name}},', contextOf(), {
      escape: 'none',
      part: 'text',
    })
    expect(result.output).toBe('Dear Alex Fournier,')
    expect(result.unresolved).toEqual([])
  })

  it('escapes into HTML and does not escape into text', () => {
    const context = contextOf({ recipientName: 'Ben & Co <Ltd>' })

    expect(
      renderPart('{{recipient_name}}', context, { escape: 'html', part: 'html' }).output,
    ).toBe('Ben &amp; Co &lt;Ltd&gt;')

    expect(
      renderPart('{{recipient_name}}', context, { escape: 'none', part: 'text' }).output,
    ).toBe('Ben & Co <Ltd>')
  })

  it('escapes a quote so a value cannot break out of an attribute', () => {
    expect(escapeHtml('" onload="alert(1)')).toBe('&quot; onload=&quot;alert(1)')
  })

  it('drops a block whose condition is false', () => {
    const context = contextOf({}, { contactMethod: 'EMAIL_ONLY' })
    const result = renderPart(
      'A{{#if contact_phone}} Telephone {{sender_phone}}{{/if}}B',
      context,
      { escape: 'none', part: 'text' },
    )
    expect(result.output).toBe('AB')
    expect(result.unresolved).toEqual([])
  })

  it('honours #unless', () => {
    const context = contextOf({}, { contactMethod: 'EMAIL_ONLY' })
    const result = renderPart('{{#unless contact_phone}}no phone{{/unless}}', context, {
      escape: 'none',
      part: 'text',
    })
    expect(result.output).toBe('no phone')
  })

  it('removes the whole line a standalone block tag sits on', () => {
    const source = 'one\n{{#if contact_phone}}\ntwo\n{{/if}}\nthree\n'
    expect(
      renderPart(source, contextOf(), { escape: 'none', part: 'text' }).output,
    ).toBe('one\ntwo\nthree\n')
    expect(
      renderPart(source, contextOf({}, { contactMethod: 'EMAIL_ONLY' }), {
        escape: 'none',
        part: 'text',
      }).output,
    ).toBe('one\nthree\n')
  })

  it('reports an absent variable rather than substituting anything', () => {
    const context = contextOf({}, { defaultSenderPhone: null })
    const result = renderPart('Telephone {{sender_phone}}', context, {
      escape: 'none',
      part: 'text',
    })
    expect(result.output).toBe('Telephone ')
    expect(result.unresolved).toEqual([
      expect.objectContaining({ variable: 'sender_phone', part: 'text' }),
    ])
  })
})

describe('fail-loud rendering — BUILD_SPEC §11.4', () => {
  const template = {
    kind: 'INVITATION' as const,
    subject: 'Hello {{recipient_name}}',
    htmlSource: '<p>{{sender_name}} — {{sender_phone}}</p>',
    textSource: '{{sender_name}} — {{sender_phone}}',
    hash: 'test-hash',
    origin: 'BUILT_IN' as const,
  }

  it('throws when a variable cannot be resolved', () => {
    expect(() =>
      renderEmail(template, recipient(), defaults({ defaultSenderPhone: null })),
    ).toThrow(UnresolvedVariableError)
  })

  it('names the variable and the recipient in the message', () => {
    let message = ''
    try {
      renderEmail(template, recipient(), defaults({ defaultSenderPhone: null }))
    } catch (error) {
      message = (error as Error).message
    }
    expect(message).toContain('sender_phone')
    expect(message).toContain('Alex Fournier')
    expect(message).toContain('alex@example.com')
  })

  it('reports every unresolved variable and every part, not just the first', () => {
    try {
      renderEmail(
        template,
        recipient(),
        defaults({ defaultSenderPhone: null, defaultSenderName: null }),
      )
      throw new Error('should have thrown')
    } catch (error) {
      const unresolved = (error as UnresolvedVariableError).unresolved
      expect(unresolved.map((item) => item.variable).sort()).toEqual([
        'sender_name',
        'sender_name',
        'sender_phone',
        'sender_phone',
      ])
      expect(new Set(unresolved.map((item) => item.part))).toEqual(new Set(['html', 'text']))
    }
  })

  it('carries the resolution guidance into the error', () => {
    try {
      renderEmail(template, recipient(), defaults({ defaultSenderPhone: null }))
      throw new Error('should have thrown')
    } catch (error) {
      expect((error as Error).message).toMatch(/settings|upload/i)
    }
  })

  it('does not throw when the absent variable sits in a block that is dropped', () => {
    const conditional = {
      ...template,
      htmlSource: '<p>{{sender_name}}{{#if contact_phone}} {{sender_phone}}{{/if}}</p>',
      textSource: '{{sender_name}}{{#if contact_phone}} {{sender_phone}}{{/if}}',
    }
    const rendered = renderEmail(
      conditional,
      recipient(),
      defaults({ contactMethod: 'EMAIL_ONLY' }),
    )
    expect(rendered.text).toBe('David Serene')
    expect(rendered.html).not.toContain('sender_phone')
  })

  it('strips newlines from the subject so a value cannot inject a header', () => {
    const rendered = renderEmail(
      { ...template, htmlSource: 'x', textSource: 'x' },
      recipient({ recipientName: 'Alex\r\nBcc: someone@example.com' }),
      defaults(),
    )
    expect(rendered.subject).toBe('Hello Alex Bcc: someone@example.com')
    expect(rendered.subject).not.toContain('\n')
  })
})

describe('validateBatch — pre-flight, BUILD_SPEC §19 and AC21', () => {
  it('passes a clean batch', () => {
    const result = validateBatch(
      [recipient(), recipient({ offerId: 'offer_2', recipientEmail: 'b@example.com' })],
      defaults(),
    )
    expect(result.ok).toBe(true)
    expect(result.checked).toBe(2)
    expect(result.problems).toEqual([])
    expect(result.templateErrors).toEqual([])
  })

  it('catches a missing sender_phone with no configured default, before any send', () => {
    const result = validateBatch([recipient()], defaults({ defaultSenderPhone: null }))
    expect(result.ok).toBe(false)
    expect(result.problems.every((problem) => problem.variable === 'sender_phone')).toBe(true)
    expect(result.problems[0].note).toMatch(/settings|upload|onboarding/i)
  })

  it('reports every affected recipient at once rather than stopping at the first', () => {
    const result = validateBatch(
      [
        recipient({ offerId: 'a', recipientEmail: 'a@example.com' }),
        recipient({ offerId: 'b', recipientEmail: 'b@example.com' }),
        recipient({ offerId: 'c', recipientEmail: 'c@example.com' }),
      ],
      defaults({ defaultSenderPhone: null }),
    )
    expect(result.affectedOfferIds.sort()).toEqual(['a', 'b', 'c'])
    expect(result.checked).toBe(3)
  })

  it('names each recipient on their own problem so a batch is triageable', () => {
    const result = validateBatch(
      [
        recipient({ offerId: 'a', recipientName: 'Ann', recipientEmail: 'a@example.com' }),
        recipient({ offerId: 'b', recipientName: 'Ben', recipientEmail: 'b@example.com' }),
      ],
      defaults({ defaultSenderPhone: null }),
    )
    expect(new Set(result.problems.map((problem) => problem.recipientName))).toEqual(
      new Set(['Ann', 'Ben']),
    )
  })

  it('passes the same batch once the default is configured — email-only included', () => {
    expect(
      validateBatch([recipient()], defaults({ contactMethod: 'EMAIL_ONLY', defaultSenderPhone: null }))
        .ok,
    ).toBe(true)
  })

  it('reports a malformed deadline as a problem instead of throwing', () => {
    const result = validateBatch(
      [recipient({ responseDeadline: 'next Tuesday' })],
      defaults(),
    )
    expect(result.ok).toBe(false)
    expect(result.templateErrors.some((error) => /ISO date/.test(error.message))).toBe(true)
  })

  it('checks both templates by default', () => {
    const result = validateBatch([recipient()], defaults())
    expect(result.ok).toBe(true)
    const kinds = validateBatch([recipient()], defaults({ defaultSenderName: null })).problems.map(
      (problem) => problem.kind,
    )
    expect(new Set(kinds)).toEqual(new Set(['INVITATION', 'REMINDER']))
  })

  it('sends nothing and returns a plain value', () => {
    const result = validateBatch([], defaults())
    expect(result).toEqual({
      ok: true,
      checked: 0,
      problems: [],
      affectedOfferIds: [],
      templateErrors: [],
    })
  })
})

describe('the real templates render for a real recipient', () => {
  it('renders the invitation with every figure in both parts', () => {
    const rendered = renderEmail(INVITATION_TEMPLATE, recipient(), defaults())

    for (const fragment of ['Alex Fournier', '5,000.00', '16.667', '10 August 2026']) {
      expect(rendered.html).toContain(fragment)
      expect(rendered.text).toContain(fragment)
    }
    expect(rendered.subject).toBe('Private invitation to participate in Flipit')
    expect(rendered.templateHash).toBe(INVITATION_TEMPLATE.hash)
  })

  it('leaves no unrendered tag anywhere', () => {
    const rendered = renderEmail(INVITATION_TEMPLATE, recipient(), defaults())
    expect(rendered.html).not.toContain('{{')
    expect(rendered.text).not.toContain('{{')
    expect(rendered.subject).not.toContain('{{')
  })

  it('renders the phone line for PHONE and removes it for EMAIL_ONLY', () => {
    const phone = renderEmail(INVITATION_TEMPLATE, recipient(), defaults())
    expect(phone.text).toContain('Telephone +66 81 234 5678')

    const emailOnly = renderEmail(
      INVITATION_TEMPLATE,
      recipient(),
      defaults({ contactMethod: 'EMAIL_ONLY' }),
    )
    expect(emailOnly.text).not.toMatch(/Telephone|WhatsApp/)
    expect(emailOnly.html).not.toMatch(/Telephone|WhatsApp/)
  })

  it('renders a WhatsApp line rather than a telephone line', () => {
    const rendered = renderEmail(
      INVITATION_TEMPLATE,
      recipient(),
      defaults({ contactMethod: 'WHATSAPP' }),
    )
    expect(rendered.text).toContain('WhatsApp +66 81 234 5678')
    expect(rendered.text).not.toContain('Telephone')
  })

  it('includes the optional blocks only when supplied', () => {
    const without = renderEmail(INVITATION_TEMPLATE, recipient(), defaults())
    expect(without.text).not.toContain('USE OF FUNDS')

    const with_ = renderEmail(
      INVITATION_TEMPLATE,
      recipient({
        personalLine: 'Good to catch up last month.',
        useOfFunds: 'Commercial launch and user growth.',
      }),
      defaults(),
    )
    expect(with_.text).toContain('Good to catch up last month.')
    expect(with_.text).toContain('USE OF FUNDS')
    expect(with_.html).toContain('Commercial launch and user growth.')
  })

  it('renders the reminder', () => {
    const rendered = renderEmail(REMINDER_TEMPLATE, recipient(), defaults())
    expect(rendered.text).toContain('10 August 2026')
    expect(rendered.text).toContain('https://spv.flipit.com/portal/claim/abc123')
    expect(rendered.templateHash).toBe(templateSource('REMINDER').hash)
  })
})
