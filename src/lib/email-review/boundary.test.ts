import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

function read(relativePath: string): string {
  return readFileSync(join(process.cwd(), relativePath), 'utf8')
}

function filesUnder(relativePath: string): string[] {
  const root = join(process.cwd(), relativePath)
  const found: string[] = []
  for (const name of readdirSync(root)) {
    const absolute = join(root, name)
    const relative = join(relativePath, name)
    if (statSync(absolute).isDirectory()) found.push(...filesUnder(relative))
    else found.push(relative)
  }
  return found
}

describe('David’s private email-review boundary', () => {
  it('admits a reader to the page and AI while keeping proposal writes acting-admin only', () => {
    expect(read('src/app/(admin)/admin/email-review/page.tsx')).toContain(
      'requireReader()',
    )
    const action = read('src/actions/email-review.ts')
    const questionStart = action.indexOf('export async function askEmailReviewQuestionAction')
    const proposalStart = action.indexOf('export async function submitEmailReviewProposalAction')
    const question = action.slice(questionStart, proposalStart)
    const proposal = action.slice(proposalStart)
    expect(question).toContain('const admin = await requireReader()')
    expect(proposal).toContain('const admin = await requireAdmin()')
  })

  it('reserves proposal promotion for Mike and requires a fresh wording acknowledgement', () => {
    const action = read('src/actions/email-review.ts')
    const reviewStart = action.indexOf('export async function reviewEmailProposalAction')
    const review = action.slice(reviewStart)
    expect(review).toContain('const owner = await requireOwner()')
    expect(review).toContain("parsed.data.acknowledged !== 'on'")
    expect(review).toContain('live.hash !== proposal.baseTemplateHash')
    expect(review).toContain('hashOf(candidate) !== proposal.candidateTemplateHash')
    expect(review).toContain('approvalRequired: true')
  })

  it('offers the page to Mike, David and a read-only experience tester', () => {
    const nav = read('src/components/admin/admin-nav.tsx')
    const item = nav.slice(
      nav.indexOf("href: '/admin/email-review'"),
      nav.indexOf("href: '/admin/email-review'") + 180,
    )
    expect(item).toContain("roles: ['OWNER', 'OPERATOR', 'VIEWER']")
  })

  it('keeps a tester proposal in browser memory and off the persistence action', () => {
    const page = read('src/app/(admin)/admin/email-review/page.tsx')
    const workspace = read('src/components/email-review-workspace.tsx')
    const data = read('src/lib/email-review/data.ts')
    expect(page).toContain("testMode={admin.role === 'VIEWER'}")
    expect(workspace).toContain('data-testid="experience-test-mode"')
    expect(workspace).toContain('data-testid="practice-proposal"')
    expect(workspace).toContain('action={testMode ? undefined : proposalAction}')
    expect(workspace).toContain('onSubmit={testMode ? rehearseProposal : undefined}')
    expect(workspace).toContain('This exists only in this browser tab.')
    expect(data).toContain('eq(emailReviewProposals.createdById, admin.id)')
  })

  it('uses one review rail so the paired papers keep the available width', () => {
    const workspace = read('src/components/email-review-workspace.tsx')
    const paper = read('src/components/email-review/paper.module.css')
    expect(workspace).toContain(
      "type InspectorTab = 'CHANGES' | 'EVIDENCE' | 'AI' | 'PROPOSE' | 'REVIEW'",
    )
    expect(workspace).toContain('aria-label="Review tools"')
    expect(workspace).toContain("lg:grid-cols-[17rem_minmax(0,1fr)]")
    expect(workspace).not.toContain(
      'lg:grid-cols-[11rem_minmax(0,1fr)_18rem]',
    )
    expect(paper).toContain('clamp(1rem, 2vw, 2.5rem)')
    expect(paper).toContain(
      'padding: 0.75rem clamp(0.4rem, 1vw, 0.85rem) 1rem',
    )
  })

  it('puts no source email text in the reusable client JavaScript', () => {
    const workspace = read('src/components/email-review-workspace.tsx')
    expect(workspace).toContain('import type')
    expect(workspace).not.toContain('Please find below the email')
    expect(workspace).not.toContain('offers significant growth potential')
  })

  it('keeps every investor-facing route independent of the review record', () => {
    const investorFiles = filesUnder('src/app/portal')
    for (const file of investorFiles) {
      const contents = read(file)
      expect(contents, file).not.toMatch(
        /EMAIL_REVIEW_DOCUMENT|EMAIL_REVIEW_CLAUSES|email-review/,
      )
    }
  })

  it('disables provider storage and never logs the question or answer', () => {
    const provider = read('src/lib/email-review/ai.ts')
    const action = read('src/actions/email-review.ts')
    const metadataStart = action.indexOf('metadata: {')
    const metadataEnd = action.indexOf('},\n    })', metadataStart)
    const metadata = action.slice(metadataStart, metadataEnd)
    expect(provider).toContain('store: false')
    expect(provider).toContain("reasoning: { effort: 'high' }")
    expect(metadata).not.toContain('question')
    expect(metadata).not.toContain('answer')
  })
})
