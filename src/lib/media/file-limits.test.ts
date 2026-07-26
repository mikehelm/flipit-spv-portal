import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { inspect } from '@/lib/media/ingest'
import {
  MAX_DOCUMENT_BYTES,
  MAX_IMAGE_BYTES,
  maxBytesFor,
  megabytes,
  tooLargeMessage,
} from '@/lib/media/formats'
import { MAX_FILE_BYTES, importTooLargeMessage } from '@/lib/import/limits'

/**
 * One limit, one sentence, and no form that posts a file without knowing it.
 *
 * The previous entry in PROGRESS.md found that a file over the **server action**
 * body limit produced a 500 and *nothing at all on the screen*, and raised the
 * limit above every limit in `formats.ts` so that the application's own refusal
 * would be reached. That fixed the advertised limits. It left a narrower gap
 * open, and this file is about that gap:
 *
 *   `MAX_DOCUMENT_BYTES` is 20 MB. The server action body limit is 24 MB. A
 *   file picker will hand a browser a 200 MB file. **Between 24 MB and whatever
 *   the disk holds, the refusal was still silent** — the body is rejected by the
 *   framework before the action runs, so the action's careful sentence is never
 *   written, `useActionState` never receives a new state, and the form sits
 *   there looking unpressed.
 *
 * The fix is a size check in the browser, which means the browser needs the
 * number and the words. Both now live in modules a client component can import,
 * and these tests hold three claims about that:
 *
 *   1. The two sides say the same sentence, because it is the same function.
 *   2. Every form carrying a file input declares which limit applies.
 *   3. The import wizard, which posts a file to an action without going through
 *      `ActionForm`, checks the size before it builds the body.
 *
 * (2) and (3) read source, because what they assert is that a *future* form
 * cannot be added without the guard — which is a claim about the code, not
 * about a rendered page. What is actually served is proved by
 * `pnpm verify:uploads`, in a browser, with real files of real sizes.
 */

const root = process.cwd()

function read(relative: string): string {
  return readFileSync(join(root, relative), 'utf8')
}

/** Comments explain what the code avoids; they must not satisfy a check for it. */
function withoutComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

function walk(relative: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(join(root, relative))) {
    const path = `${relative}/${entry}`
    if (statSync(join(root, path)).isDirectory()) out.push(...walk(path))
    else if (path.endsWith('.tsx')) out.push(path)
  }
  return out
}

describe('the refusal a person reads is the same on both sides of the wire', () => {
  it('the server returns exactly what the browser would have shown', () => {
    const oversize = MAX_DOCUMENT_BYTES + 1
    const result = inspect('document', new Uint8Array(oversize))

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('TOO_LARGE')
    expect(result.message).toBe(tooLargeMessage('document', oversize))
  })

  it('and for an image too', () => {
    const oversize = MAX_IMAGE_BYTES + 1
    const result = inspect('image', new Uint8Array(oversize))

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.message).toBe(tooLargeMessage('image', oversize))
  })

  it('names both numbers, and the file first', () => {
    const message = tooLargeMessage('document', 30 * 1024 * 1024)

    expect(message).toContain('30 MB')
    expect(message).toContain('20 MB')
    expect(message.indexOf('30 MB')).toBeLessThan(message.indexOf('20 MB'))
    // Nothing was stored, and it says so — the sentence has to answer "did some
    // of it get through?" as well as "why".
    expect(message).toContain('Nothing was stored')
  })

  it('reports one decimal place, so 1.5 MB is not rounded up to 2 MB', () => {
    expect(megabytes(1.5 * 1024 * 1024)).toBe('1.5 MB')
    expect(megabytes(MAX_DOCUMENT_BYTES)).toBe('20 MB')
  })

  it('the import limit has one number and one sentence as well', () => {
    // The action's schema, the reader and the wizard's prose all held their own
    // copy of "5 MB" before `limits.ts` existed, in three different sentences.
    for (const file of [
      'src/actions/import.ts',
      'src/lib/import/table.ts',
      'src/app/(admin)/import/import-wizard.tsx',
    ]) {
      const code = withoutComments(read(file))
      expect(code, `${file} still repeats the limit`).toContain('MAX_FILE_BYTES')
      expect(code, `${file} still writes the number out`).not.toMatch(/5 \* 1024 \* 1024/)
      expect(code, `${file} still writes the words out`).not.toMatch(/larger than 5 MB/)
    }

    expect(importTooLargeMessage(MAX_FILE_BYTES + 1)).toContain('5 MB')
  })
})

describe('no form posts a file without knowing the limit', () => {
  /**
   * Every `.tsx` holding an `input type="file"`, which is the complete list of
   * places a file enters this application from a browser.
   */
  const withFileInputs = walk('src')
    .filter((file) => !file.endsWith('.test.tsx'))
    .filter((file) => /type="file"/.test(withoutComments(read(file))))

  it('there are file inputs to check', () => {
    // If this drops to nothing the checks below pass vacuously, which is the
    // failure mode of every source-scanning test.
    expect(withFileInputs.length).toBeGreaterThanOrEqual(3)
  })

  it('every ActionForm containing one declares a fileKind', () => {
    const offenders: string[] = []
    let checked = 0

    for (const file of withFileInputs) {
      const code = withoutComments(read(file))

      // Walk to each file input and look backwards for the form it sits in.
      // Crude, and honest about being crude: an input whose nearest preceding
      // `<ActionForm` has already been closed is reported rather than skipped,
      // because a heuristic that silently passes is worse than one that
      // complains about a shape it cannot read.
      for (let at = code.indexOf('type="file"'); at !== -1; at = code.indexOf('type="file"', at + 1)) {
        const opens = code.lastIndexOf('<ActionForm', at)
        if (opens === -1) continue // Not in an ActionForm at all — see below.

        const between = code.slice(opens, at)
        if (between.includes('</ActionForm>')) {
          offenders.push(`${file}: a file input outside any ActionForm`)
          continue
        }

        const tag = code.slice(opens, code.indexOf('>', opens) + 1)
        checked += 1
        if (!tag.includes('fileKind')) {
          offenders.push(`${file}: ${tag.split('\n')[0]!.trim()} has no fileKind`)
        }
      }
    }

    expect(offenders, 'an ActionForm with a file input and no fileKind').toEqual([])
    // Three today: two on the documents panel, one in the media library.
    expect(checked).toBeGreaterThanOrEqual(3)
  })

  it('ActionForm refuses an oversized file before the body is built', () => {
    const code = withoutComments(read('src/components/admin/action-form.tsx'))

    expect(code).toContain('tooLargeMessage')
    expect(code).toContain('maxBytesFor')
    // `preventDefault` is the only thing that stops React posting the body.
    expect(code).toMatch(/preventDefault\(\)/)
    expect(code).toMatch(/input\[type="file"\]/)
    // Reads the size the browser reported. Deliberately not a substitute for
    // `ingest`, which reads the bytes.
    expect(code).toMatch(/file\.size > limit/)
  })

  it('the guard is a courtesy and the action is still the authority', () => {
    // Nothing in the panel or the library may talk itself out of posting for a
    // reason other than size — a client component deciding whether a document
    // is acceptable would be a control living in the browser.
    for (const file of [
      'src/app/(admin)/investors/documents-panel.tsx',
      'src/app/(admin)/admin/media/page.tsx',
    ]) {
      const code = withoutComments(read(file))
      expect(code).not.toMatch(/preventDefault/)
    }

    // And the actions still read the bytes themselves.
    expect(withoutComments(read('src/actions/documents.ts'))).toMatch(/ingest\('document'/)
    expect(withoutComments(read('src/actions/media.ts'))).toMatch(/ingest\('image'/)
  })

  it('the import wizard checks the size before it posts, on all three steps', () => {
    const code = withoutComments(read('src/app/(admin)/import/import-wizard.tsx'))

    expect(code).toContain('importTooLargeMessage')
    expect(code).toMatch(/file\.size > MAX_FILE_BYTES/)

    // All three steps post the file again, so all three go through the guard.
    const posts = code.match(/form\.set\('file', file\)/g) ?? []
    expect(posts.length).toBe(3)
    expect((code.match(/fileToPost\(\)/g) ?? []).length).toBe(3)
  })
})

describe('the three limits still cannot disagree', () => {
  /**
   * The relation the previous entry established, restated from the other end:
   * the browser guard is only reachable *because* every application limit is
   * below the body limit. If a limit in `formats.ts` were raised above it, the
   * silent 500 would come back for files the application says it accepts — and
   * the guard would refuse nothing, because it uses the application's number.
   */
  it('every media limit is below the server action body limit', () => {
    const config = read('next.config.ts')
    const body = Number(/bodySizeLimit: '(\d+)mb'/.exec(config)?.[1]) * 1024 * 1024

    expect(body).toBeGreaterThan(0)
    for (const kind of ['image', 'document'] as const) {
      expect(maxBytesFor(kind), `${kind} is above the body limit`).toBeLessThan(body)
    }
    expect(MAX_FILE_BYTES).toBeLessThan(body)
  })
})
