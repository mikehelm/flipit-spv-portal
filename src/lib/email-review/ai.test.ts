import { describe, expect, it } from 'vitest'
import { buildEmailReviewPrompt } from './ai'
import {
  EMAIL_REVIEW_MODEL,
  MAX_EMAIL_REVIEW_OUTPUT_TOKENS,
  MAX_EMAIL_REVIEW_QUESTION_LENGTH,
} from './model'

describe('the email-review AI boundary', () => {
  it('uses the named quality-first OpenAI model with bounded input and output', () => {
    expect(EMAIL_REVIEW_MODEL).toBe('gpt-5.6-sol')
    expect(MAX_EMAIL_REVIEW_QUESTION_LENGTH).toBe(2_000)
    expect(MAX_EMAIL_REVIEW_OUTPUT_TOKENS).toBe(1_200)
  })

  it('sends the full evidence record for a whole-document question', () => {
    const built = buildEmailReviewPrompt('Which reasons are not recorded?')
    expect(built.scope).toBe('DOCUMENT')
    expect(built.scopeLabel).toBe('Entire document')
    expect(built.prompt).toContain('HI Mike,')
    expect(built.prompt).toContain('Private invitation to participate in Flipit')
    expect(built.prompt).toContain('"evidenceLabel": "UNVERIFIED"')
    expect(built.prompt).toContain('Which reasons are not recorded?')
  })

  it('uses the actual current send source when the stored wording has changed', () => {
    const built = buildEmailReviewPrompt(
      'What is live now?',
      undefined,
      'Subject: A newly promoted exact invitation',
    )
    expect(built.prompt).toContain('Subject: A newly promoted exact invitation')
    expect(built.prompt).not.toContain(
      '"currentEmail": "Subject: Private invitation to participate in Flipit',
    )
  })

  it('sends only the selected clause when the user asks from a clause', () => {
    const built = buildEmailReviewPrompt(
      'What do we actually know about this change?',
      'david-role',
    )
    expect(built.scope).toBe('CLAUSE')
    expect(built.scopeLabel).toBe('David’s role and authority')
    expect(built.prompt).toContain('"evidenceLabel": "UNVERIFIED"')
    expect(built.prompt).toContain('Reason not recorded anywhere.')
    expect(built.prompt).not.toContain('Please find below the email')
    expect(built.prompt).not.toContain('"clause": "Payment-instruction warning"')
  })

  it('refuses a client-invented clause id', () => {
    expect(() => buildEmailReviewPrompt('Explain this.', 'invented-clause')).toThrow(
      'Unknown email-review clause.',
    )
  })
})
