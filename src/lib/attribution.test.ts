import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ATTRIBUTION_TEXT, safeAttributionHref } from './attribution'

/**
 * The maker's credit — BUILD_SPEC §13.2.
 *
 * Most of §13.2's paragraph about this is about restraint, and restraint is
 * hard to test. One sentence is not:
 *
 *   *"It does not appear inside the invitation email or on the participation
 *   certificate. Those are formal instruments about someone's money, and a
 *   maker's credit does not belong on either."*
 *
 * That is the test that matters, and it is written against the rendered output
 * rather than against the intent of whoever wrote the template.
 */

/**
 * Comments are stripped before scanning. Every one of these files documents
 * the rule it obeys — the invitation says in its own header that it carries no
 * maker's credit — and a test that read the comments would fail on the files
 * that are most careful about it.
 */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

function walk(dir: string): string[] {

  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry)
    if (statSync(p).isDirectory()) out.push(...walk(p))
    else if (p.endsWith('.ts') || p.endsWith('.tsx')) out.push(p)
  }
  return out
}

describe('the credit never reaches a formal instrument', () => {
  it('is absent from every email template, in both parts', () => {
    for (const file of walk('src/lib/email/templates').filter((f) => !f.endsWith('.test.ts'))) {
      const source = withoutComments(readFileSync(file, 'utf8'))
      // The text itself, and the words on their own in case somebody splits it
      // across a template literal.
      expect(source).not.toContain(ATTRIBUTION_TEXT)
      expect(source).not.toMatch(/Make with Mike/i)
    }
  })

  it('is absent from the participation certificate', () => {
    for (const file of walk('src/lib/certificate').filter((f) => !f.endsWith('.test.ts'))) {
      expect(withoutComments(readFileSync(file, 'utf8'))).not.toMatch(/Make with Mike/i)
    }
  })

  it('has no configuration that could put it on either', () => {
    // Two switches, named for the two surfaces §13.2 allows. If a third ever
    // appears this fails, and whoever adds it has to justify it here.
    const schema = readFileSync('src/db/schema.ts', 'utf8')
    const columns = [...schema.matchAll(/attribution[A-Za-z]*:/g)].map((m) => m[0])
    expect(columns.sort()).toEqual([
      'attributionOnAdmin:',
      'attributionOnPortal:',
      'attributionUrl:',
    ])
  })

  it('the footer that carries it is rendered on exactly two surfaces', () => {
    const users = walk('src/app').filter((f) =>
      readFileSync(f, 'utf8').includes('<SiteFooter'),
    )
    expect(users.sort()).toEqual(['src/app/(admin)/layout.tsx', 'src/app/portal/page.tsx'])
  })
})

describe('the optional link', () => {
  it('accepts http and https', () => {
    expect(safeAttributionHref('https://makewithmike.com')).toBe('https://makewithmike.com/')
    expect(safeAttributionHref('http://example.com/x')).toBe('http://example.com/x')
  })

  it('drops anything else rather than rendering it', () => {
    // This string reaches an anchor on a page an investor is reading, so the
    // check is a permit-list rather than a block-list.
    expect(safeAttributionHref('javascript:alert(1)')).toBeNull()
    expect(safeAttributionHref('data:text/html,<script>')).toBeNull()
    expect(safeAttributionHref('/relative/path')).toBeNull()
    expect(safeAttributionHref('makewithmike.com')).toBeNull()
    expect(safeAttributionHref('')).toBeNull()
    expect(safeAttributionHref('   ')).toBeNull()
    expect(safeAttributionHref(null)).toBeNull()
  })

  it('is never styled to draw the eye', () => {
    const footer = readFileSync('src/components/site-footer.tsx', 'utf8')
    const anchor = footer.slice(footer.indexOf('<a'), footer.indexOf('</a>'))

    // §13.2: "no colour". The credit is `--muted`, the dimmest text token, and
    // the anchor takes the same one rather than a link colour.
    expect(anchor).toContain('text-muted')
    expect(anchor).not.toMatch(/text-orange|text-ok|font-bold|font-semibold/)

    // "opening in a new tab" — and a new tab without `noopener` hands the
    // opened page a reference back to a portal session.
    expect(anchor).toContain('target="_blank"')
    expect(anchor).toContain('noopener')
  })
})
