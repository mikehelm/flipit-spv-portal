import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { issuedOnly, mayDownloadDocument } from './access'

/**
 * BUILD_SPEC §5 status 3, §7, §13, §15.
 *
 * "Documents issued · Operator · Date, document list, download links."
 * "Investors must be able to download their own records … while in `read_only`
 *  or `sunset`."
 * Nothing reveals that another investor exists.
 */

const ISSUED = new Date('2026-07-20T10:00:00Z')

const theirs = {
  audience: 'INVESTOR' as const,
  issuedAt: ISSUED,
  belongsToRequester: true,
  portalReadable: true,
}

describe('mayDownloadDocument', () => {
  it('lets an investor download their own issued document', () => {
    expect(mayDownloadDocument(theirs)).toBe(true)
  })

  it('never lets an investor download a document that has not been issued', () => {
    expect(mayDownloadDocument({ ...theirs, issuedAt: null })).toBe(false)
  })

  it('never lets an investor download somebody else’s — issued or not', () => {
    expect(mayDownloadDocument({ ...theirs, belongsToRequester: false })).toBe(false)
    expect(
      mayDownloadDocument({ ...theirs, belongsToRequester: false, issuedAt: null }),
    ).toBe(false)
  })

  it('refuses anyone without a session', () => {
    expect(mayDownloadDocument({ ...theirs, audience: 'ANONYMOUS' })).toBe(false)
  })

  it('follows the portal shut — a suspended account or a disabled service takes it too', () => {
    expect(mayDownloadDocument({ ...theirs, portalReadable: false })).toBe(false)
  })

  it('stays available in read-only and sunset, because §7 says so', () => {
    // Both are `canView` — the rule is not reimplemented here, which is why
    // this passes the same input the portal page computes.
    expect(mayDownloadDocument({ ...theirs, portalReadable: true })).toBe(true)
  })

  it('lets the operator open an unissued document, which is how he checks it', () => {
    expect(
      mayDownloadDocument({
        audience: 'ADMIN',
        issuedAt: null,
        belongsToRequester: true,
        portalReadable: false,
      }),
    ).toBe(true)
  })

  it('has no override and no fourth audience', () => {
    const source = readFileSync(path.join(process.cwd(), 'src/lib/documents/access.ts'), 'utf8')

    expect(source).not.toMatch(/force|override|bypass|skipIssued|allowUnissued/i)
    const audiences = source.match(/'(INVESTOR|ADMIN|ANONYMOUS)'/g) ?? []
    expect(new Set(audiences).size).toBe(3)
  })
})

describe('issuedOnly', () => {
  it('drops everything that has not been issued', () => {
    const documents = [
      { id: 'a', issuedAt: ISSUED },
      { id: 'b', issuedAt: null },
      { id: 'c', issuedAt: ISSUED },
    ]

    expect(issuedOnly(documents).map((d) => d.id)).toEqual(['a', 'c'])
  })

  it('returns nothing rather than everything when nothing is issued', () => {
    expect(issuedOnly([{ id: 'a', issuedAt: null }])).toEqual([])
  })
})

// ---------------------------------------------------------------------------

const ROOT = process.cwd()

function read(relative: string): string {
  return readFileSync(path.join(ROOT, relative), 'utf8')
}

function code(relative: string): string {
  return read(relative)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
}

function walk(relative: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(path.join(ROOT, relative))) {
    const full = path.join(ROOT, relative, entry)
    if (statSync(full).isDirectory()) out.push(...walk(path.join(relative, entry)))
    else if (/\.(ts|tsx)$/.test(entry)) out.push(path.join(relative, entry))
  }
  return out
}

describe('the shape the rules depend on', () => {
  const investorRoute = 'src/app/portal/document/[documentId]/route.ts'
  const adminRoute = 'src/app/(admin)/investors/[offerId]/document/[documentId]/route.ts'

  it('the investor route compares the document’s owner against the session', () => {
    const source = code(investorRoute)

    expect(source).toContain('readInvestorAccount')
    expect(source).toContain('document.accountId === account.id')
    expect(source).toContain('mayDownloadDocument(')
    expect(source).toContain("audience: 'INVESTOR'")
    expect(source).not.toContain("audience: 'ADMIN'")
  })

  it('every refusal on both routes is the same 404 — never a 403', () => {
    for (const file of [investorRoute, adminRoute]) {
      const source = code(file)
      expect(source, file).not.toContain('403')
      expect(source, file).not.toContain('401')
      expect(source.match(/status: 404/g)?.length, file).toBe(1)
    }
  })

  it('neither route is indexable', () => {
    for (const file of [investorRoute, adminRoute]) {
      expect(read(file)).toContain('noindex')
    }
  })

  it('the investor list is joined on the account rather than filtered afterwards', () => {
    const source = code('src/lib/documents/data.ts')

    // `investorDocuments` must not select a document and then discard it: the
    // account is a join condition, so another investor's row is never read.
    const fn = source.slice(
      source.indexOf('export async function investorDocuments'),
      source.indexOf('export async function documentWithOwner'),
    )
    expect(fn).toContain('.innerJoin(offers, eq(documentPackages.offerId, offers.id))')
    expect(fn).toContain('eq(offers.accountId, accountId)')
    expect(fn).toContain('issuedOnly(')
  })

  it('exactly one file issues a document, and it needs an explicit confirmation', () => {
    const writers = walk('src')
      .filter((file) => !file.endsWith('.test.ts'))
      .filter((file) => /\.(insert|update|delete)\(documentPackages\)/.test(code(file)))

    expect(writers.sort()).toEqual(['src/actions/documents.ts'])

    const source = code('src/actions/documents.ts')
    expect(source).toContain("formData.get('confirm') !== 'ISSUE'")
    // Issuing is one statement. Uploading explicitly stores null.
    expect(source.match(/issuedAt: null/g)?.length).toBe(2) // upload, and withdraw
    expect(source.match(/issuedAt,?\s*\}/g)?.length).toBe(1)
  })

  it('an issued document cannot be deleted out from under the investor', () => {
    const source = code('src/actions/documents.ts')
    const remove = source.slice(source.indexOf('export async function removeDocumentAction'))

    expect(remove).toContain('if (document.issuedAt)')
    expect(remove).toContain('actionError(')
    // The delete comes after the refusal, not before it.
    expect(remove.indexOf('if (document.issuedAt)')).toBeLessThan(remove.indexOf('db.delete'))
  })

  it('a document is attached to one offer, and no action takes a list', () => {
    const source = code('src/actions/documents.ts')

    expect(source).not.toMatch(/offerIds|documentIds|forEach\(|issueMany|bulk/i)
    expect(source).toContain("optionalText(formData.get('offerId'))")
  })

  it('nothing in the documents module logs a file, a body or a key', () => {
    for (const file of walk('src/lib/documents')) {
      if (file.endsWith('.test.ts')) continue
      expect(read(file)).not.toMatch(/console\.(log|info|warn|error)/)
    }

    const source = code('src/actions/documents.ts')
    expect(source).not.toMatch(/metadata:\s*\{[^}]*(bytes|stored|file\.name)/)
  })
})
