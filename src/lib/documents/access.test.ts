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

  /** The issue action alone, so an assertion about it cannot pass on another. */
  function issueOnly(source: string): string {
    return source.slice(
      source.indexOf('export async function issueDocumentAction'),
      source.indexOf('export async function correctDocumentAction'),
    )
  }

  it('exactly one file issues a document, and it needs an explicit confirmation', () => {
    const writers = walk('src')
      .filter((file) => !file.endsWith('.test.ts'))
      .filter((file) => /\.(insert|update|delete)\(documentPackages\)/.test(code(file)))

    /*
     * Two files, and the second one is an exception rather than a widening.
     *
     * `erasure/erase.ts` writes to this table because OPEN_DECISIONS item 12
     * made it the one place allowed to: an erasure has to reach the title, the
     * description and the storage key of a signed subscription agreement, and
     * there is no pseudonymising the bytes themselves. What it must *not* be
     * able to do is anything a document writer does — issue one, withdraw one,
     * supersede one or add one. That is asserted below rather than assumed, so
     * this list cannot quietly become a third writer's doorway.
     */
    expect(writers.sort()).toEqual(['src/actions/documents.ts', 'src/lib/erasure/erase.ts'])

    const erasure = code('src/lib/erasure/erase.ts')
    expect(erasure).not.toMatch(/\.insert\(documentPackages\)/)
    expect(erasure).not.toMatch(/\.delete\(documentPackages\)/)
    // It changes no document's lifecycle: not issued, not withdrawn, not
    // superseded. A document that existed still existed, at its own version.
    expect(erasure).not.toMatch(/issuedAt:/)
    expect(erasure).not.toMatch(/supersededAt:/)
    // And it only ever redacts, using the shared markers.
    const documentWrite = erasure.slice(
      erasure.indexOf('.update(documentPackages)'),
      erasure.indexOf('.update(participationCertificates)'),
    )
    expect(documentWrite).toContain('ERASED_MARKER')
    expect(documentWrite).toContain('ERASED_STORAGE_KEY')

    const source = code('src/actions/documents.ts')
    expect(source).toContain("formData.get('confirm') !== 'ISSUE'")

    /**
     * Three occurrences of `issuedAt: null`, not two, since corrections
     * landed: an upload, **a correction**, and a withdrawal. The third is the
     * reason for the widening rather than a concession to it — a corrected
     * version arriving already issued would put an unchecked file on the
     * investor's portal the moment it was uploaded, which is the exact failure
     * the gap between uploading and issuing exists to prevent. The assertion
     * below pins it inside the correction action, so the count cannot be
     * satisfied by three ordinary uploads.
     */
    expect(source.match(/issuedAt: null/g)?.length).toBe(3)

    const correction = source.slice(source.indexOf('export async function correctDocumentAction'))
    expect(correction).toContain('issuedAt: null')
    expect(correction).not.toMatch(/issuedAt:\s*new Date/)
    /**
     * Still exactly one place that puts a date on one.
     *
     * The pattern gained a leading `[{,]` because `supersededAt: issuedAt }`
     * now ends in the same three tokens the old one matched — a false positive
     * on a substring, not a second writer. Requiring the shorthand to start at
     * a property boundary is a narrower expression of the same rule, and the
     * assertion above it pins the one writer by name.
     */
    expect(source.match(/[{,]\s*issuedAt,?\s*\}/g)?.length).toBe(1)
    expect(issueOnly(source)).toContain('.set({ issuedAt })')
  })

  /**
   * Superseding is the other half of issuing, and must not become a third way
   * to change what an investor is holding.
   */
  it('a document is only ever superseded by issuing its replacement', () => {
    const source = code('src/actions/documents.ts')

    expect(source.match(/supersededAt: issuedAt/g)?.length).toBe(1)
    const issue = source.slice(
      source.indexOf('export async function issueDocumentAction'),
      source.indexOf('export async function correctDocumentAction'),
    )
    expect(issue).toContain('supersededAt: issuedAt')
    // Both statements in one transaction, so there is no window in which both
    // versions are current or neither is.
    expect(issue).toContain('db.transaction(')

    // Clearing it happens once, in withdrawal, which is issuing's inverse.
    expect(source.match(/supersededAt: null/g)?.length).toBe(1)
    const withdraw = source.slice(source.indexOf('export async function withdrawDocumentAction'))
    expect(withdraw).toContain('supersededAt: null')
    expect(withdraw).toContain('db.transaction(')
  })

  it('the correction rules live in one tested module, not inside the mutation', () => {
    const source = code('src/actions/documents.ts')

    expect(source).toContain('whyNotCorrectable(')
    expect(source).toContain('correctionRefusalMessage(')
    expect(source).toContain('nextVersion(')
    // No second copy of a rule. A version number is never computed inline.
    expect(source).not.toMatch(/version:\s*\w+\.version\s*\+\s*1/)
  })

  it('a correction is still one document, on one offer, for one person', () => {
    const source = code('src/actions/documents.ts')
    const correction = source.slice(source.indexOf('export async function correctDocumentAction'))

    // It inherits the predecessor's offer rather than accepting one, so a
    // correction cannot move a document onto somebody else's record.
    expect(correction).toContain('offerId: predecessor.offerId')
    expect(correction).not.toMatch(/formData\.get\('offerId'\)/)
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
