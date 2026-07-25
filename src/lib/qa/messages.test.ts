import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { EMAIL_TEMPLATE_KINDS } from '@/lib/email/templates'
import { buildAnswerReply, buildQuestionNotification, escapeHtml } from './messages'

/**
 * The two Q&A emails. BUILD_SPEC §6.7.1, §6.7.2, §6.7.6, §11.5.
 */

const notification = () =>
  buildQuestionNotification({
    askerName: 'Jane Example',
    askerEmail: 'jane@example.com',
    questionBody: 'What happens if the round does not fill?',
    offerSummary: '$5,000.00 for 16.667% of the SPV, deadline 2026-08-10, currently invitation sent',
    queueLink: 'https://spv.flipit.com/questions',
  })

const reply = () =>
  buildAnswerReply({
    recipientName: 'Jane Example',
    questionOriginal: 'What happens if the round does not fill?',
    answer: 'The SPV does not proceed and nothing is drawn down.\n\nYour response stays open.',
    portalLink: 'https://spv.flipit.com/portal',
    senderName: 'David Serene',
    senderEmail: 'david@flipit.com',
    verificationLink: 'https://spv.flipit.com/verify',
  })

describe('the new-question notification (§6.7.1)', () => {
  it('names who asked, because it goes to the operator', () => {
    const message = notification()
    expect(message.text).toContain('Jane Example')
    expect(message.text).toContain('jane@example.com')
  })

  it('keeps the question out of the subject line', () => {
    // Subjects appear on a lock screen. An investor's question can carry their
    // own figures, and a phone notification is not a private channel.
    const message = notification()
    expect(message.subject).not.toContain('round does not fill')
    expect(message.subject).toBe('New investor question from Jane Example')
  })

  it('carries a link to the queue rather than an answer form', () => {
    expect(notification().text).toContain('https://spv.flipit.com/questions')
  })

  it('says plainly that nothing has gone to the investor yet', () => {
    const message = notification()
    expect(message.text).toContain('Your answer only reaches them when you press send')
    expect(message.html).toContain('press send')
  })

  it('says so honestly when there is no offer on the account', () => {
    const message = buildQuestionNotification({
      askerName: 'Jane Example',
      askerEmail: 'jane@example.com',
      questionBody: 'Anything yet?',
      offerSummary: null,
      queueLink: 'https://spv.flipit.com/questions',
    })
    expect(message.text).toContain('No offer is recorded against this account yet.')
  })
})

describe('the reply to the asker (§6.7.2)', () => {
  it('quotes the question back so the reply stands alone', () => {
    expect(reply().text).toContain('What happens if the round does not fill?')
  })

  it('carries the answer, with its paragraphs intact in both parts', () => {
    const message = reply()
    expect(message.text).toContain('The SPV does not proceed')
    expect(message.text).toContain('Your response stays open.')
    expect(message.html).toContain('The SPV does not proceed')
    expect(message.html).toContain('Your response stays open.')
  })

  it('restates none of the offer terms', () => {
    // Whatever the operator wrote is what goes. This function adds no figures
    // of its own; an email that repeats the terms is a second communication
    // of the offer.
    const message = reply()
    expect(message.text).not.toMatch(/\$\s?\d/)
    expect(message.text).not.toMatch(/\d\s?%/)
    expect(message.html).not.toMatch(/\$\s?\d/)
  })

  it('links the portal rather than minting a claim link', () => {
    const message = reply()
    expect(message.text).toContain('https://spv.flipit.com/portal')
    expect(message.text).not.toContain('/portal/claim')
  })

  it('carries the anti-phishing line and the bank-details warning (§15.1)', () => {
    const message = reply()
    expect(message.text).toContain('https://spv.flipit.com/verify')
    expect(message.text).toContain('never email you a change of bank details')
    expect(message.html).toContain('never email you a change of bank details')
  })

  it('has a text part carrying the same information as the HTML part (§11.5)', () => {
    const message = reply()
    for (const fragment of [
      'Jane Example',
      'What happens if the round does not fill?',
      'The SPV does not proceed',
      'David Serene',
      'david@flipit.com',
    ]) {
      expect(message.text, fragment).toContain(fragment)
      expect(message.html, fragment).toContain(escapeHtml(fragment))
    }
  })

  it('is a 600px table layout with inline styles (§11.5)', () => {
    const { html } = reply()
    expect(html).toContain('max-width:600px')
    expect(html).toContain('role="presentation"')
    expect(html).not.toContain('<style')
    expect(html).not.toContain('class=')
  })
})

describe('escaping', () => {
  it('neutralises markup typed by a human', () => {
    const message = buildAnswerReply({
      recipientName: '<script>alert(1)</script>',
      questionOriginal: 'a & b',
      answer: '"quoted" and <b>bold</b>',
      portalLink: 'https://spv.flipit.com/portal',
      senderName: 'David',
      senderEmail: 'david@flipit.com',
      verificationLink: 'https://spv.flipit.com/verify',
    })

    expect(message.html).not.toContain('<script>')
    expect(message.html).toContain('&lt;script&gt;')
    expect(message.html).toContain('a &amp; b')
    expect(message.html).not.toContain('<b>bold</b>')
  })
})

describe('these are not compliance-approved templates (§6.7.6)', () => {
  it('is not registered in the approved template registry', () => {
    // §6.7.6: a private answer is "ordinary correspondence" and is not gated;
    // the operator notification is internal mail. Registering either would
    // mean a word changed in an internal notification voids the approval that
    // lets invitations go out.
    expect(EMAIL_TEMPLATE_KINDS).toEqual(['INVITATION', 'REMINDER'])
  })

  it('does not import the template hashing machinery', () => {
    const source = readFileSync(join(process.cwd(), 'src/lib/qa/messages.ts'), 'utf8')
    expect(source).not.toContain('hashTemplateSource')
    expect(source).not.toContain('templateSource')
  })
})
