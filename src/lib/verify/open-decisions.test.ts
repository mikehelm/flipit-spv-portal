import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * `OPEN_DECISIONS.md` against the code it describes.
 *
 * **Why a document has a test.** Every check in this repository is held to
 * *"would this still pass if the thing it names were absent?"* — and
 * `OPEN_DECISIONS.md` was being held to nothing. It is the document Michael and
 * David act on. It was written before the build started, the build moved
 * underneath it for two days, and when somebody finally read it against the code
 * five of its statements were wrong: it described a list of approved countries
 * the application has never held, a privacy policy still to be drafted that was
 * already written, a deletion control that does not exist, and a hosting domain
 * contradicted seven lines below it.
 *
 * The lesson is the same one the rest of the repository has learnt repeatedly:
 * a claim nobody can see fail is a claim nobody should trust. So the *falsifiable*
 * statements in that document are pinned here. None of these is a check on the
 * application being correct — each is a check that a sentence written for a person
 * to act on is still true, and each failure message says which item to go and fix.
 *
 * A test that fails because somebody built the right thing is working. The fix is
 * to update the note, which is exactly the step that was being skipped.
 */

const root = process.cwd()
const openDecisions = readFileSync(join(root, 'OPEN_DECISIONS.md'), 'utf8')

/** Every application source file — not tests, not the verify scripts. */
function applicationSources(from: string, found: string[] = []): string[] {
  for (const entry of readdirSync(from)) {
    const path = join(from, entry)
    if (statSync(path).isDirectory()) {
      applicationSources(path, found)
    } else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) {
      found.push(path)
    }
  }
  return found
}

const sources = applicationSources(join(root, 'src')).map((path) => ({
  path: path.slice(root.length + 1),
  text: readFileSync(path, 'utf8'),
}))

describe('OPEN_DECISIONS item 12 — investor data cannot be deleted', () => {
  it('no application path deletes an investor account, an offer or a recipient', () => {
    /*
     * The document says, in item 12, that there is no deletion path at all — and
     * that the privacy policy's promise of erasure is therefore fulfilled by a
     * person against the database, with no written procedure.
     *
     * The day somebody builds one, this fails. That is the intent: the note is
     * the thing that then has to change, and it carries an external commitment
     * to investors, so it must not go stale silently a second time.
     */
    const offenders = sources
      .filter(({ text }) =>
        /db\s*\n?\s*\.delete\(\s*(investorAccounts|offers|recipients)\s*\)/.test(text),
      )
      .map(({ path }) => path)

    expect(
      offenders,
      'an investor-deletion path now exists — update OPEN_DECISIONS.md item 12, which says there is none',
    ).toEqual([])
  })

  it('and the privacy policy still makes the promise that item 12 is about', () => {
    // If the wording is ever narrowed — one of the three options item 12 offers —
    // this fails and sends whoever narrowed it to record the decision.
    const privacy = readFileSync(join(root, 'src/app/privacy/page.tsx'), 'utf8')
    expect(
      /ask for it to be deleted/.test(privacy),
      'the privacy policy no longer promises erasure — OPEN_DECISIONS.md item 12 is written around that sentence',
    ).toBe(true)
  })

  it('the document says so in as many words, so the two cannot drift apart quietly', () => {
    expect(openDecisions).toMatch(/### 12\./)
    expect(openDecisions).toContain('There is no way to delete an investor record')
  })
})

describe('OPEN_DECISIONS item 4 — there is no list of approved countries', () => {
  it('the seed ships an empty one', () => {
    // The item used to read as though the application already knew Australia,
    // England, France and Thailand. It knows nothing until the owner types it in
    // while recording the approval, and nothing sends before that.
    const seed = readFileSync(join(root, 'src/db/seed.ts'), 'utf8')
    expect(
      /approvedJurisdictions:\s*\[\s*\]/.test(seed),
      'the seed now ships approved countries — OPEN_DECISIONS.md item 4 says it ships none',
    ).toBe(true)
  })

  it('and no country list is hard-coded in the compliance code', () => {
    // A list in code would be a policy decision made by a build rather than by
    // the person who signs the approval.
    const compliance = sources.filter(({ path }) => path.startsWith('src/lib/compliance/'))
    expect(compliance.length).toBeGreaterThan(0)
    for (const { path, text } of compliance) {
      expect(
        /APPROVED_(JURISDICTIONS|COUNTRIES)\s*=/.test(text),
        `${path} declares a fixed approved-country list`,
      ).toBe(false)
    }
  })
})

describe('OPEN_DECISIONS — the settled list', () => {
  it('the superseded hosting domain is in no source file and in no environment example', () => {
    // `invest.flipit.com` was the answer in v2 and `spv.flipit.com` is the answer
    // now. The old one survives in two documents and must not come back into the
    // code, where a portal link built from the wrong domain dies on migration.
    const example = readFileSync(join(root, '.env.example'), 'utf8')
    expect(example).not.toContain('invest.flipit.com')
    for (const { path, text } of sources) {
      expect(text.includes('invest.flipit.com'), path).toBe(false)
    }
  })

  it('published Q&A is visible during an open round, which is what "from the start" means', () => {
    const schema = readFileSync(join(root, 'src/db/schema.ts'), 'utf8')
    expect(
      /qa_visible_during_raise'\)\.notNull\(\)\.default\(true\)/.test(schema),
      'the default changed — OPEN_DECISIONS.md says published Q&A is visible from the start',
    ).toBe(true)
  })

  it('the video is published by the operator and by nobody else', () => {
    // "previewed and published by him". The owner deliberately cannot do it for
    // him, which is a stronger statement than the settled list makes.
    const actions = readFileSync(join(root, 'src/actions/video.ts'), 'utf8')
    const publish = /export async function publishVideoAction[\s\S]*?\n}/.exec(actions)?.[0] ?? ''
    expect(publish, 'publishVideoAction was not found').not.toBe('')
    expect(publish).toContain('requireOperator()')
    expect(publish).not.toContain('requireAdmin()')
  })
})

describe('OPEN_DECISIONS item 3 — nothing sends without a recorded approval', () => {
  it('the gate refuses when there is none, before anything else is considered', () => {
    const gate = readFileSync(join(root, 'src/lib/compliance/gate.ts'), 'utf8')
    expect(gate).toContain("reason: 'NO_APPROVAL'")
    expect(gate).toContain("if (!approval || drift.state === 'NO_APPROVAL')")
  })

  it('and recording, amending or voiding one is owner-only', () => {
    // The operator can do none of the three — one of the twelve questions asked
    // of every change, restated here because item 3 is what tells Michael so.
    const authority = readFileSync(join(root, 'src/lib/compliance/authority.ts'), 'utf8')
    expect(authority).toContain("role === 'OWNER'")
    expect(authority).not.toMatch(/role === 'OPERATOR'\s*\)\s*return \{ allowed: true/)
  })
})
