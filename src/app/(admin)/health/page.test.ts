import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * The health page. BUILD_SPEC §2 (access), §15.1 (indexing).
 *
 * The judgement it renders is tested in `src/lib/health/rules.test.ts` and the
 * command that prints the same thing is tested by `pnpm verify:health`. What is
 * left for this file is the page itself: that it is guarded, that it is
 * read-only, and that it does not become a second route to an action.
 *
 * Read-only matters more here than it looks. This page names, in every finding,
 * the page that fixes the thing — and the obvious next step is a button that
 * saves the trip. That button would be a second path into an action with a
 * different set of checks in front of it, which is how the two eventually
 * disagree. The rule is easier to keep than to recover, so it is pinned.
 */

const PAGE = join(process.cwd(), 'src/app/(admin)/health/page.tsx')

function source(): string {
  return readFileSync(PAGE, 'utf8')
}

function code(): string {
  return source()
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

describe('access', () => {
  it('is refused to anybody who is not an onboarded admin', () => {
    const body = code()
    expect(body).toContain('requireOnboardedAdmin()')
    // Before anything is read. A guard after the query has already run the query.
    const guardAt = body.indexOf('await requireOnboardedAdmin()')
    const reportAt = body.indexOf('await buildHealthReport()')
    expect(guardAt).toBeGreaterThan(-1)
    expect(reportAt).toBeGreaterThan(guardAt)
  })

  it('is not indexable', () => {
    expect(code()).toMatch(/robots:\s*\{\s*index:\s*false/)
  })

  it('is worked out on every request rather than cached', () => {
    // A cached health page is a page that can tell you everything is fine
    // because it was, an hour ago.
    expect(code()).toContain("export const dynamic = 'force-dynamic'")
  })
})

describe('it reports and never acts', () => {
  it('has no form and no server action', () => {
    const body = code()
    expect(body).not.toContain('<form')
    expect(body).not.toContain('action=')
    expect(body).not.toContain("'use server'")
    expect(body).not.toContain('ActionForm')
  })

  it('never writes to the database', () => {
    const body = code()
    for (const verb of ['.insert(', '.update(', '.delete(', "from '@/db'"]) {
      expect(body, verb).not.toContain(verb)
    }
  })

  it('never sends', () => {
    const body = code()
    expect(body).not.toContain('sendOneEmail')
    expect(body).not.toContain('runDueReminders')
    expect(body).not.toContain('sendRoundDigest')
  })

  it('reaches the findings only through the shared rules', () => {
    // Not by asking the database its own questions. Two sets of rules that
    // mostly agree is worse than one.
    const body = code()
    expect(body).toContain("from '@/lib/health/report'")
    expect(body).not.toContain('drizzle-orm')
  })
})

describe('what it shows', () => {
  it('puts the things that need a person first', () => {
    // The rendered order, not the order of the label lookup.
    const body = code()
    expect(body.indexOf('Needs you</h2>')).toBeGreaterThan(-1)
    expect(body.indexOf('Needs you</h2>')).toBeLessThan(body.indexOf('Worth knowing</h2>'))
    expect(body.indexOf('Worth knowing</h2>')).toBeLessThan(body.indexOf('Checked, and fine'))
  })

  it('lists what was checked and found fine, rather than omitting it', () => {
    // A page that shows nothing when all is well is indistinguishable from a
    // page that failed to look.
    const body = code()
    expect(body).toContain("severity === 'OK'")
    expect(body).toContain('Checked, and fine')
  })

  it('shows the remedy for anything that is not fine', () => {
    expect(code()).toContain('finding.remedy')
  })

  it('says when it was read', () => {
    expect(code()).toContain('report.at')
  })
})
