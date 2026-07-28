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
const GUIDE = join(process.cwd(), 'src/components/admin/guided-start.tsx')

function code(): string {
  return readFileSync(PAGE, 'utf8')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

function guideCode(): string {
  return readFileSync(GUIDE, 'utf8')
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

  it('says what the findings are about, rather than a sentence typed here', () => {
    // It used to name the two rules of the day in prose — "the scheduled
    // reminder job, or a reminder a run took and never finished sending" —
    // which went silently false the moment a third rule joined the banner. A
    // hardcoded sentence has nothing to check it against.
    const body = code()
    expect(body).toContain('describeAreas(alert.areas)')
    expect(body).not.toMatch(/scheduled reminder job, or a reminder/)
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

describe('the guided start', () => {
  it('gives each admin role a different honest start', () => {
    const body = guideCode()
    expect(body).toContain("role === 'OPERATOR'")
    expect(body).toContain("role === 'OWNER'")
    expect(body).toContain('Safe test guide')
    expect(body).toContain('Mike’s decisions')
    expect(body).toContain('David’s next step')
    expect(body).toContain('Rehearse a proposal')
    expect(body).toContain('View as John Doe')
  })

  it('does not make Mike’s sending credential David’s task', () => {
    const body = guideCode()
    const page = code()
    expect(body).toContain("onboarding.nextStep === 'SENDING_ACCOUNT'")
    expect(body).toContain('That credential belongs to Mike.')
    expect(body).toContain("href: '/admin/email-review'")
    expect(body).toContain('Continue with the email review')
    expect(body).toContain("step.id !== 'SENDING_ACCOUNT'")
    expect(body).toContain('Review your remaining setup')
    expect(page).not.toContain('Change the sending account')
  })

  it('derives setup state from onboarding while leaving later work unclaimed', () => {
    const body = guideCode()
    expect(body).toContain('onboarding.complete')
    expect(body).toContain('onboarding.completedCount')
    expect(body).toContain('Ready does not mean reviewed or approved.')
    expect(body).toContain('no completion is assumed')
    expect(body).toContain('Investor rehearsal')
    expect(body).toContain('href="/portal/demo"')
    expect(body).toContain('status="Ready"')
    expect(body).not.toContain('This becomes available after setup')
  })

  it('handles the saved-but-not-finished edge without inventing an unfinished step', () => {
    const body = guideCode()
    expect(body).toContain('onboarding.canComplete')
    expect(body).toContain('One click left — confirm your setup is finished')
    expect(body).toContain("action: 'Finish setup'")
  })

  it('does not call an empty owner queue complete', () => {
    const body = guideCode()
    expect(body).toContain("pendingAccessRequests > 0 ? 'Needs you' : 'Ready'")
    expect(body).toContain("submittedProposals > 0 ? 'Needs you' : 'Ready'")
    expect(body).toContain(
      "<Status status={totalDecisions > 0 ? 'Needs you' : 'Ready'} />",
    )
  })

  it('uses only the four human task states and pairs each with a visible symbol', () => {
    const body = guideCode()
    expect(body).toContain(
      "type HumanStatus = 'Needs you' | 'Waiting' | 'Ready' | 'Complete'",
    )
    expect(body).toContain('STATUS_ICON')
  })

  it('derives Mike’s decisions from the two available pending counts', () => {
    const page = code()
    const body = guideCode()
    expect(page).toContain('countPendingAccessRequests()')
    expect(page).toContain('countSubmittedEmailReviewProposals()')
    expect(body).toContain('pendingAccessRequests + submittedProposals')
  })

  it('keeps the existing configuration below the guided layer in a quiet disclosure', () => {
    const body = code()
    expect(body.indexOf('<GuidedStart')).toBeLessThan(body.indexOf('<details'))
    expect(body).toContain('System and configuration details')
    expect(body).toContain('<MailConnectionPanel health={mail} />')
    expect(body).toContain('<Card title="System health">')
  })
})
