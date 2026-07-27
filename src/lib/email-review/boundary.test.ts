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
  it('guards both the page and the server action as acting administrators', () => {
    expect(read('src/app/(admin)/admin/email-review/page.tsx')).toContain(
      'requireAdmin()',
    )
    expect(read('src/actions/email-review.ts')).toContain('requireAdmin()')
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

  it('offers the page to Mike and David, never to a viewer', () => {
    const nav = read('src/components/admin/admin-nav.tsx')
    const item = nav.slice(
      nav.indexOf("href: '/admin/email-review'"),
      nav.indexOf("href: '/admin/email-review'") + 180,
    )
    expect(item).toContain("roles: ['OWNER', 'OPERATOR']")
    expect(item).not.toContain('VIEWER')
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
