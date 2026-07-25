import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  UPDATE_NOTIFICATION_LEAD,
  UPDATE_NOTIFICATION_SECURITY_LINE,
  UPDATE_NOTIFICATION_SUBJECT,
  buildUpdateNotification,
} from './notification'

/**
 * BUILD_SPEC §6: *"The notification email says only that an update is available
 * and links to the portal — **it carries no amounts, percentages, or personal
 * detail**."*
 *
 * The first test is the structural one and the important one: the function
 * takes two links and nothing else, so there is nothing to leak.
 */

const PORTAL = 'https://spv.flipit.com/portal'
const VERIFY = 'https://spv.flipit.com/verify'

const message = () => buildUpdateNotification(PORTAL, VERIFY)

describe('the notification cannot carry anything it should not', () => {
  it('takes exactly two arguments, both links', () => {
    // A parameter for the title, the body, the recipient's name or a figure is
    // how this rule gets broken. There is none, and this is what fails if one
    // is added.
    expect(buildUpdateNotification.length).toBe(2)
  })

  it('is byte-identical for every recipient', () => {
    // No name, no personalisation, no per-recipient token. An email that is the
    // same for everybody cannot leak anything about anybody.
    expect(buildUpdateNotification(PORTAL, VERIFY)).toEqual(buildUpdateNotification(PORTAL, VERIFY))
  })

  it('contains no amount and no percentage', () => {
    const { html, text, subject } = message()

    // The HTML is checked as the recipient reads it, with the markup removed.
    // Raw markup is full of `width:100%` and `#4a4d68`, which are layout, not
    // figures — scanning them would make this test pass or fail on CSS.
    const visibleHtml = html
      .replace(/<[^>]+>/g, ' ')
      .replace(/&[a-z]+;/g, ' ')
      .replace(/\s+/g, ' ')

    for (const part of [visibleHtml, text, subject]) {
      expect(part).not.toMatch(/[$£€]\s?\d/)
      expect(part).not.toMatch(/\d\s?%/)
      expect(part).not.toMatch(/\bUSD\b/)
      expect(part).not.toMatch(/\b\d[\d,]*\.\d{2}\b/)
    }

    // And the visible text carries no bare figure of any kind at all.
    expect(visibleHtml.replace(/https?:\/\/\S+/g, '')).not.toMatch(/\d/)
    expect(text.replace(/https?:\/\/\S+/g, '').replace(/-{3,}/g, '')).not.toMatch(/\d/)
  })

  it('does not name the update it is announcing', () => {
    // "says only that an update is available". Not which update, not its title.
    const { text, subject } = message()
    expect(subject).toBe(UPDATE_NOTIFICATION_SUBJECT)
    expect(text).toContain(UPDATE_NOTIFICATION_LEAD)
    expect(text).not.toMatch(/titled|entitled|regarding|about:/i)
  })

  it('says why the update itself is not in it', () => {
    expect(message().text).toContain(UPDATE_NOTIFICATION_SECURITY_LINE)
    expect(message().html).toContain('For your security')
  })

  it('links the portal, never a claim link', () => {
    const { text, html } = message()
    expect(text).toContain(PORTAL)
    expect(text).not.toContain('/portal/claim')
    expect(html).not.toContain('/portal/claim')
  })

  it('carries the anti-phishing line and the bank-details warning (§15.1)', () => {
    const { text, html } = message()
    expect(text).toContain(VERIFY)
    expect(text).toContain('never email you a change of bank details')
    expect(html).toContain('never email you a change of bank details')
  })

  it('has a text part carrying the same information as the HTML part (§11.5)', () => {
    const { text, html } = message()
    for (const fragment of [UPDATE_NOTIFICATION_LEAD, PORTAL, VERIFY]) {
      expect(text, fragment).toContain(fragment)
      expect(html, fragment).toContain(fragment)
    }
  })

  it('is a 600px table layout with inline styles', () => {
    const { html } = message()
    expect(html).toContain('max-width:600px')
    expect(html).toContain('role="presentation"')
    expect(html).not.toContain('<style')
    expect(html).not.toContain('class=')
  })
})

describe('the source itself cannot reach an update', () => {
  it('imports nothing that could hand it a title, a body or an account', () => {
    const source = readFileSync(join(process.cwd(), 'src/lib/updates/notification.ts'), 'utf8')
    expect(source).not.toContain("from '@/db'")
    expect(source).not.toContain('portalUpdates')
    expect(source).not.toContain('investorAccounts')
    expect(source).not.toContain('formatMoney')
    expect(source).not.toContain('formatPercentage')
  })
})
