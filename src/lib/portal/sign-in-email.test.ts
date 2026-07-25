import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  buildSignInEmail,
  SIGN_IN_EMAIL_LEAD,
  SIGN_IN_EMAIL_SUBJECT,
  SIGN_IN_EMAIL_UNREQUESTED_LINE,
} from './sign-in-email'

/**
 * The email carrying a sign-in link. BUILD_SPEC §4.1, §15.1.
 *
 * The link was minted, hashed and stored from WP8 onwards and never sent, so
 * every returning investor was told *"a sign-in link is on its way"* and
 * received nothing. This is the message that makes that sentence true.
 *
 * The first test is the structural one and the important one: the function
 * takes two links and a duration, so there is nothing about the offer to leak.
 */

const LINK = 'https://spv.flipit.com/portal/claim/a-token'
const VERIFY = 'https://spv.flipit.com/verify'

const message = () => buildSignInEmail(LINK, VERIFY, 45)

function visible(html: string): string {
  return html
    .replace(/<(style|script|head)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z]+;|&#\d+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

describe('it cannot carry anything about the offer', () => {
  it('takes two links and a duration, and nothing else', () => {
    // A parameter for the name, the amount, the round or the deadline is how
    // this rule gets broken. There is none, and this is what fails if one is
    // added.
    expect(buildSignInEmail.length).toBe(3)
  })

  it('is byte-identical for every investor asking at the same moment', () => {
    // Only the link differs, and the link is the message.
    const one = buildSignInEmail(LINK, VERIFY, 45)
    const two = buildSignInEmail(LINK, VERIFY, 45)
    expect(one).toEqual(two)
  })

  it('contains no amount and no percentage', () => {
    const { html, text, subject } = message()

    for (const part of [visible(html), text, subject]) {
      const withoutLinks = part.replace(/https?:\/\/\S+/g, '')
      expect(withoutLinks).not.toMatch(/[$£€]\s?\d/)
      expect(withoutLinks).not.toMatch(/%/)
      expect(withoutLinks).not.toMatch(/\bUSD\b/)
      expect(withoutLinks).not.toMatch(/\b\d[\d,]*\.\d{2}\b/)
    }
  })

  it('names no investor and no round', () => {
    const { html, text } = message()
    for (const part of [visible(html), text]) {
      // The links are stripped first — the deployment's own hostname is
      // `spv.flipit.com`, and matching on it would be matching on the domain
      // rather than on anything the copy says.
      const words = part.replace(/https?:\/\/\S+/g, '')
      expect(words).not.toMatch(/\bDear\b/)
      expect(words).not.toMatch(/allocation|deadline|invitation|\bSPV\b/i)
    }
  })

  it('carries no digit at all outside the links and the expiry', () => {
    const { text } = message()
    const stripped = text
      .replace(/https?:\/\/\S+/g, '')
      .replace(/-{3,}/g, '')
      .replace(/45 minutes/g, '')
    expect(stripped).not.toMatch(/\d/)
  })
})

describe('what it does say', () => {
  it('says somebody asked, rather than asserting the recipient did', () => {
    // An unrequested sign-in email is what an attempt on somebody's account
    // looks like from the inside. "You asked for this" would be a false
    // statement in exactly the case that matters.
    expect(SIGN_IN_EMAIL_LEAD).toContain('Somebody asked')
    expect(SIGN_IN_EMAIL_LEAD).toContain('If that was you')
  })

  it('tells the recipient that ignoring it is safe', () => {
    const { text, html } = message()
    expect(SIGN_IN_EMAIL_UNREQUESTED_LINE).toContain('you can ignore this email')
    expect(text).toContain(SIGN_IN_EMAIL_UNREQUESTED_LINE)
    expect(visible(html)).toContain('you can ignore this email')
  })

  it('states the expiry plainly, so a cold link reads as expected', () => {
    const { text } = message()
    expect(text).toContain('works once and expires in 45 minutes')
  })

  it('carries the anti-phishing line and the bank-details warning (§15.1)', () => {
    const { text, html } = message()
    for (const part of [text, visible(html)]) {
      expect(part).toContain('never email you a change of bank details')
      expect(part).toContain(VERIFY)
    }
  })

  it('has a text part carrying the same information as the HTML part (§11.5)', () => {
    const { text, html } = message()
    for (const fragment of [SIGN_IN_EMAIL_LEAD, LINK, VERIFY]) {
      expect(text, fragment).toContain(fragment)
      expect(html, fragment).toContain(fragment)
    }
  })

  it('is a 600px table layout with inline styles and no classes', () => {
    const { html } = message()
    expect(html).toContain('max-width:600px')
    expect(html).toContain('role="presentation"')
    expect(html).not.toContain('<style')
    expect(html).not.toContain('class=')
  })

  it('shows the link as text too, for a client that strips the anchor', () => {
    const { html } = message()
    expect(html).toContain('copy this address into your browser')
  })

  it('does not name the sign-in email in the subject line of a lock screen', () => {
    expect(SIGN_IN_EMAIL_SUBJECT).not.toMatch(/\d/)
    expect(SIGN_IN_EMAIL_SUBJECT).not.toMatch(/invitation|offer|allocation/i)
  })
})

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8')

function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

describe('the delivery path', () => {
  it('cannot be pointed at an address the request supplied', () => {
    // This is the one email an unauthenticated stranger can cause to be sent.
    // The only thing between that and an open relay is that the address is
    // looked up from the account id and is never a parameter.
    const source = withoutComments(read('src/lib/portal/send-sign-in-link.ts'))
    expect(source).toContain('db.query.investorAccounts.findFirst')
    expect(source).toContain('to: account.email')
    expect(source).not.toMatch(/\bemail\s*:\s*string/)
    expect(source).not.toMatch(/\bto\s*:\s*input\./)
  })

  it('goes through the one gated sender and constructs no transport', () => {
    const source = withoutComments(read('src/lib/portal/send-sign-in-link.ts'))
    expect(source).toContain('sendOneEmail(')
    expect(source).not.toContain('nodemailer')
    expect(source).not.toContain('getTransport(')
  })

  it('never puts the token or the address in the audit log', () => {
    const source = withoutComments(read('src/lib/portal/send-sign-in-link.ts'))
    for (const block of source.match(/metadata:\s*\{[\s\S]*?\n\s*\}/g) ?? []) {
      expect(block).not.toMatch(/token|email|address|html|text|subject/i)
    }
  })

  it('runs after the response, so the send cannot be timed', () => {
    // `requestSignInLink` pads every path to a fixed floor so a known address
    // cannot be told from an unknown one. Awaiting an SMTP round trip in the
    // action would undo all of it — the issued path would take seconds and the
    // others would not, which is louder than the signal just closed.
    const action = withoutComments(read('src/actions/portal.ts'))
    expect(action).toContain("import { after } from 'next/server'")
    expect(action).toContain('after(async () => {')

    const start = action.indexOf('export async function requestSignInLinkAction(')
    const rest = action.slice(start)
    const end = rest.indexOf('\nexport ', 1)
    const body = end === -1 ? rest : rest.slice(0, end)

    // The delivery has to sit inside the `after` callback. Awaiting it in the
    // action body directly is the mistake this guards against.
    const afterAt = body.indexOf('after(async () => {')
    const deliverAt = body.indexOf('deliverSignInLink(')
    expect(afterAt).toBeGreaterThan(-1)
    expect(deliverAt).toBeGreaterThan(afterAt)

    const beforeAfter = body.slice(0, afterAt)
    expect(beforeAfter).not.toContain('deliverSignInLink(')

    // And it still returns exactly one sentence, whatever happened.
    const returns = body.match(/^\s*return .*$/gm) ?? []
    expect(returns).toHaveLength(1)
    expect(returns[0]).toContain('SIGN_IN_ACCEPTED_MESSAGE')
  })

  it('is not registered for compliance approval, and does not hash a template', () => {
    // §8.2's approval covers the invitation and the reminder. Registering an
    // operational sign-in email would mean one word changed here voids the
    // approval that lets invitations go out.
    const source = withoutComments(read('src/lib/portal/sign-in-email.ts'))
    expect(source).not.toContain('hashTemplateSource')
    expect(source).not.toContain('templateKind')
    expect(source).not.toContain("from '@/db'")
  })
})
