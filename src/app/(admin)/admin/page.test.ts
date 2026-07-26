import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * The overview's health banner.
 *
 * A page in the navigation is enough to find and not enough to notice. This is
 * the line that catches an eye — and it is the only place in the application
 * that says anything at all about whether the parts that run on their own are
 * running.
 *
 * Two rules are pinned here, and both are about restraint rather than function.
 * It must not say anything when nothing is wrong, because a banner that is
 * always there is a banner nobody reads on the day it matters. And it must not
 * pay for the full health report, because this is the page people land on.
 */

const PAGE = join(process.cwd(), 'src/app/(admin)/admin/page.tsx')

function code(): string {
  return readFileSync(PAGE, 'utf8')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

describe('the banner', () => {
  it('shows only when something needs a person', () => {
    const body = code()
    expect(body).toContain('alert.needsAPerson > 0')
    // The healthy branch renders nothing at all.
    const banner = body.slice(
      body.indexOf('{alert.needsAPerson > 0 ?'),
      body.indexOf('<div className="grid grid-cols-1 gap-4'),
    )
    expect(banner).toMatch(/\)\s*:\s*null\}/)
  })

  it('links to the page that says which and what to do', () => {
    expect(code()).toContain('href="/health"')
  })

  it('names no recipient and no count of anything but findings', () => {
    const body = code()
    expect(body).not.toContain('recipientEmail')
    expect(body).not.toContain('investorAccounts')
  })
})

describe('what it costs', () => {
  it('reads the cheap subset, not the whole report', () => {
    // `buildHealthReport` reads every template, evaluates the eligibility of
    // every queued reminder — a query per offer — and loads the round summary.
    // That is the right cost for the health page and the wrong cost for this
    // one.
    const body = code()
    expect(body).toContain('readUnattendedAlert()')
    expect(body).not.toContain('buildHealthReport')
    expect(body).not.toContain('gatherFacts')
  })

  it('is worked out on every load rather than cached', () => {
    expect(code()).toContain("export const dynamic = 'force-dynamic'")
  })
})

describe('there is always a way through to the health page', () => {
  it('even when the banner is silent', () => {
    // Otherwise "no banner" would be ambiguous between nothing wrong and
    // nothing checked.
    const body = code()
    const card = body.slice(body.indexOf('<Card title="System health">'))
    expect(card).toContain('href="/health"')
    expect(card).toContain('Nothing needs you')
  })
})
