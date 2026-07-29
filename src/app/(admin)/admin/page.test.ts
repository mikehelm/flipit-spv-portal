import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const PAGE = join(process.cwd(), 'src/app/(admin)/admin/page.tsx')
const GUIDE = join(process.cwd(), 'src/components/admin/guided-start.tsx')

function source(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

describe('the role-aware Start page', () => {
  it('shows one recommended action before secondary work', () => {
    const guide = source(GUIDE)
    expect(guide).toContain('Recommended now')
    expect(guide).toContain('David’s next step')
    expect(guide).toContain('Mike’s decisions')
    expect(guide).toContain('Safe test guide')
    expect(guide).toContain('Completed and later work')
    expect(guide.indexOf('Recommended now')).toBeLessThan(
      guide.indexOf('Completed and later work'),
    )
  })

  it('uses one compact three-stage progress strip', () => {
    const guide = source(GUIDE)
    expect(guide).toContain('aria-label="Round progress"')
    expect(guide).toContain("['Prepare', prepare]")
    expect(guide).toContain("['Invite', invite]")
    expect(guide).toContain("['Follow up', followUp]")
  })

  it('does not make Mike’s sending credential David’s task', () => {
    const guide = source(GUIDE)
    expect(guide).toContain("onboarding.nextStep === 'SENDING_ACCOUNT'")
    expect(guide).toContain('That credential belongs to Mike.')
    expect(guide).toContain('Continue with the email review')
  })

  it('derives decisions and setup from current data', () => {
    const page = source(PAGE)
    const guide = source(GUIDE)
    expect(page).toContain('countPendingAccessRequests()')
    expect(page).toContain('countSubmittedEmailReviewProposals()')
    expect(guide).toContain('onboarding.complete')
    expect(guide).toContain('pendingAccessRequests + submittedProposals')
  })
})

describe('quiet system information', () => {
  it('shows a warning only when a person is needed', () => {
    const page = source(PAGE)
    expect(page).toContain('alert.needsAPerson > 0')
    expect(page).toMatch(/\)\s*:\s*null\}/)
    expect(page).toContain('readUnattendedAlert()')
    expect(page).not.toContain('buildHealthReport')
  })

  it('keeps setup and diagnostics behind one disclosure', () => {
    const page = source(PAGE)
    expect(page.indexOf('<GuidedStart')).toBeLessThan(page.indexOf('<details'))
    expect(page).toContain('Setup, completed work and system details')
    expect(page).toContain('href="/more"')
    expect(page).toContain('href="/health"')
    expect(page).not.toContain('MailConnectionPanel')
    expect(page).not.toContain('SecretState')
  })

  it('is recalculated on every load', () => {
    expect(source(PAGE)).toContain("export const dynamic = 'force-dynamic'")
  })
})
