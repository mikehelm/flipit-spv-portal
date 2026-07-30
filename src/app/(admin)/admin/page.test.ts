import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const PAGE = join(process.cwd(), 'src/app/(admin)/admin/page.tsx')
const GUIDE = join(process.cwd(), 'src/components/admin/guided-start.tsx')
const INVESTOR_LIST = join(
  process.cwd(),
  'src/components/admin/investor-list-overview.tsx',
)
const DRAFT_FORM = join(
  process.cwd(),
  'src/app/(admin)/recipients/[offerId]/parts.tsx',
)
const DRAFT_ACTION = join(process.cwd(), 'src/actions/recipient-draft.ts')
const INVESTOR_RECORD = join(
  process.cwd(),
  'src/app/(admin)/recipients/[offerId]/page.tsx',
)

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

  it('puts the editable investor list immediately after the guided start', () => {
    const page = source(PAGE)
    const list = source(INVESTOR_LIST)
    expect(page).toContain('loadBatchContext()')
    expect(page.indexOf('<GuidedStart')).toBeLessThan(
      page.indexOf('<InvestorListOverview'),
    )
    expect(list).toContain('Check the investor details')
    expect(list).toContain('Open all investors')
    expect(list).toContain('#draft-invitation-details')
    expect(list).toContain('bg-white text-[#1d1d1f]')
    expect(list).toContain("text-[#d70015]")
    expect(list).toContain('role="tooltip"')
    expect(list).toContain('BUILD_SPEC §8.2 · not legal advice')
    expect(list).toContain('BUILD_SPEC §6.6')
  })

  it('confirms changes and records before, after and the reason', () => {
    const form = source(DRAFT_FORM)
    const action = source(DRAFT_ACTION)
    const record = source(INVESTOR_RECORD)
    expect(form).toContain('Confirm and save changes')
    expect(form).toContain('name="confirmed"')
    expect(form).toContain('name="changeReason"')
    expect(action).toContain('Confirm the changes before saving.')
    expect(action).toContain('before,')
    expect(action).toContain('after,')
    expect(action).toContain("action: 'recipient.draft_updated'")
    expect(record).toContain('Confirmed change history')
    expect(record).toContain('change.before[field]')
    expect(record).toContain('change.after[field]')
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
