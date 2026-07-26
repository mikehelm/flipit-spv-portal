import { describe, expect, it } from 'vitest'
import {
  buildEmailChangeConfirmation,
  buildEmailChangeNotice,
  EMAIL_CHANGE_CONFIRM_SUBJECT,
  EMAIL_CHANGE_CONFIRM_UNREQUESTED_LINE,
  EMAIL_CHANGE_NOTICE_SUBJECT,
} from './email-change-email'

/**
 * The two messages a contact-address change produces. BUILD_SPEC §13, §15.1.
 *
 * The tests that matter here are the negative ones. Both messages go to
 * mailboxes this application has a reason to be careful about — one that has
 * not been verified as belonging to anybody, and one that may no longer be in
 * the right hands — so what these must *not* carry is the whole subject.
 */

const CONFIRM_LINK = 'https://spv.flipit.com/portal/email-change/abc123token'
const VERIFY_LINK = 'https://spv.flipit.com/verify'

/**
 * The words that would mean the terms of the offer had leaked into a message
 * that must not carry them.
 *
 * "Investor" and "portal" are deliberately not on the list: they appear in the
 * masthead and in the sentence saying what the link is for, and neither names a
 * record, a person or a figure.
 */
const TERMS_OF_THE_OFFER = [
  'offer',
  'round',
  'amount',
  'usd',
  'deadline',
  'subscription',
  'allocation',
  'certificate',
  'commitment',
  'percentage',
  'invitation',
]

/** The visible words, with the markup and its stylesheet taken out. */
function prose(message: { subject: string; html: string; text: string }): string {
  const visible = message.html
    .replace(/<style[\s\S]*?<\/style>/g, ' ')
    .replace(/<[^>]*>/g, ' ')
  return `${message.subject} ${visible} ${message.text}`.toLowerCase()
}

/** Anything that reads as money or a percentage, in either part. */
function figuresIn(message: { subject: string; html: string; text: string }): string[] {
  const body = prose(message)
  return [
    ...(body.match(/[$£€]\s?\d/g) ?? []),
    ...(body.match(/\d[\d,]*\.\d{2}\b/g) ?? []),
    ...(body.match(/\d+(\.\d+)?\s?%/g) ?? []),
  ]
}

describe('the confirmation, to the new address', () => {
  const message = buildEmailChangeConfirmation(CONFIRM_LINK, VERIFY_LINK, 60)

  it('carries the link in both parts', () => {
    expect(message.html).toContain(CONFIRM_LINK)
    expect(message.text).toContain(CONFIRM_LINK)
  })

  it('carries the same information in text as in HTML', () => {
    // §11.5's rule, applied to a transactional message: the plain-text part is
    // not a courtesy, it is the version some people will read.
    for (const fragment of [
      CONFIRM_LINK,
      VERIFY_LINK,
      EMAIL_CHANGE_CONFIRM_UNREQUESTED_LINE,
      'expires in 60 minutes',
    ]) {
      expect(message.text, fragment).toContain(fragment)
    }
  })

  it('says plainly that doing nothing is the right answer', () => {
    // The line that matters most. Somebody who did not ask for this received it
    // because a stranger typed their address, and the true and useful thing to
    // tell them is that ignoring it costs them nothing.
    expect(message.text).toContain('If you did not ask for this, do nothing.')
    expect(message.html).toContain('If you did not ask for this, do nothing.')
  })

  it('states how long the link lasts', () => {
    expect(message.text).toContain('works once')
    expect(message.text).toContain('60 minutes')
  })

  it('carries the anti-phishing route and the bank-details line', () => {
    for (const part of [message.html, message.text]) {
      expect(part).toContain(VERIFY_LINK)
      expect(part).toContain('We will never email you a change of bank details.')
    }
  })

  it('reveals nothing about the record', () => {
    // The address has not been verified. Until the link is opened, this
    // application has no reason to believe it belongs to the investor — so a
    // name, a figure or a deadline in here would be the terms of a private
    // securities offer landing in a stranger's mailbox on the strength of a
    // typo.
    //
    // "Investor portal" survives, in the masthead and in the sentence saying
    // what the link is for. It is not possible to ask somebody to confirm an
    // address without saying what it is for, and it names no record, no person
    // and no figure.
    for (const word of TERMS_OF_THE_OFFER) {
      expect(prose(message), word).not.toContain(word)
    }
    expect(figuresIn(message)).toEqual([])
  })

  it('has no parameter through which a figure or a name could arrive', () => {
    expect(buildEmailChangeConfirmation.length).toBe(3)
  })

  it('escapes a link so it cannot break out of the attribute', () => {
    const nasty = buildEmailChangeConfirmation(
      'https://spv.flipit.com/x"><script>alert(1)</script>',
      VERIFY_LINK,
      60,
    )
    expect(nasty.html).not.toContain('<script>')
    expect(nasty.html).toContain('&lt;script&gt;')
  })

  it('has a subject that says what it is without saying what it is about', () => {
    expect(EMAIL_CHANGE_CONFIRM_SUBJECT).toContain('Confirm')
    expect(EMAIL_CHANGE_CONFIRM_SUBJECT.toLowerCase()).not.toContain('invest')
  })
})

describe('the notice, to the address being replaced', () => {
  const CONTACT = 'serenedavid@gmail.com'
  const message = buildEmailChangeNotice(CONTACT, VERIFY_LINK)

  it('says what happened', () => {
    expect(message.subject).toBe(EMAIL_CHANGE_NOTICE_SUBJECT)
    expect(message.text).toContain('has been changed')
  })

  it('never names the new address', () => {
    // The address the record moved to now belongs to whoever performed the
    // change. This message goes to a mailbox that may have been taken over, and
    // printing the attacker's address in it is a second fact for free.
    //
    // The function has no parameter for it, which is what makes this hold.
    expect(buildEmailChangeNotice.length).toBe(2)
    const body = `${message.html} ${message.text}`
    expect(body).not.toMatch(/new address is|changed to|now uses [\w.+-]+@/i)
  })

  it('offers a person rather than a link', () => {
    // There is deliberately no "undo" link. An undo link in a mailbox is a
    // credential, and this is exactly the message sent when a mailbox may no
    // longer be in the right hands.
    expect(message.text).toContain(`Write to ${CONTACT}`)
    expect(message.text).toContain('only by a person')
    expect(message.html).toContain(`mailto:${CONTACT}`)
    expect(message.html).not.toMatch(/href="https?:\/\/[^"]*undo/i)
  })

  it('names no route at all when nothing is configured', () => {
    // The same rule as `contact.ts`: an absent address is better than an
    // invented one or a sentence naming somebody the reader cannot reach.
    for (const empty of [null, '', '   ']) {
      const bare = buildEmailChangeNotice(empty, VERIFY_LINK)
      expect(bare.html).not.toContain('mailto:')
      expect(bare.text).toContain('reply to the last message you had from us')
      expect(bare.text).not.toContain('undefined')
      expect(bare.text).not.toContain('null')
    }
  })

  it('reveals nothing about the record', () => {
    for (const word of TERMS_OF_THE_OFFER) {
      expect(prose(message), word).not.toContain(word)
    }
    expect(figuresIn(message)).toEqual([])
  })

  it('carries the anti-phishing route', () => {
    for (const part of [message.html, message.text]) {
      expect(part).toContain(VERIFY_LINK)
      expect(part).toContain('We will never email you a change of bank details.')
    }
  })

  it('escapes a contact address rather than trusting it', () => {
    const nasty = buildEmailChangeNotice('a"><script>alert(1)</script>@x.com', VERIFY_LINK)
    expect(nasty.html).not.toContain('<script>')
  })
})

describe('both messages', () => {
  it('are legible with images blocked, because there are none', () => {
    for (const message of [
      buildEmailChangeConfirmation(CONFIRM_LINK, VERIFY_LINK, 60),
      buildEmailChangeNotice('someone@example.com', VERIFY_LINK),
    ]) {
      expect(message.html).not.toContain('<img')
      expect(message.html).toContain('max-width:600px')
      expect(message.html).toContain('<table')
      expect(message.text.trim().length).toBeGreaterThan(120)
    }
  })

  it('have distinct subjects, so the two cannot be mistaken for each other', () => {
    expect(EMAIL_CHANGE_CONFIRM_SUBJECT).not.toBe(EMAIL_CHANGE_NOTICE_SUBJECT)
  })
})
