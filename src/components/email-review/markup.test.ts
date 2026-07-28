import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { EMAIL_REVIEW_CLAUSES } from '@/lib/email-review/document'
import type { EmailDiffUnit } from '@/lib/email-review/segments'
import {
  buildPassageAnnotation,
  circlePath,
  handSeed,
  markPassage,
  MAX_ALIGNED_WORDS,
  noise,
  recordedText,
  tiePath,
} from './markup'

/**
 * The paper view's two claims that a screenshot cannot check.
 *
 * 1. A pencil mark points at the words that actually moved.
 * 2. The balloon never puts a reason where none was recorded.
 *
 * The second is the one worth a test file of its own: the rationale record
 * stores the sentence "Reason not recorded anywhere." for six clauses, and a
 * component that renders `clause.reason` into a box headed "Recorded reason"
 * would present all six as explained.
 */

function unit(partial: Partial<EmailDiffUnit>): EmailDiffUnit {
  return {
    id: 'change-01',
    kind: 'CHANGED',
    original: [],
    current: [],
    clauseIds: [],
    editableSectionId: null,
    ...partial,
  }
}

function joined(tokens: ReadonlyArray<{ text: string; state: string }>, state: string) {
  return tokens
    .filter((token) => token.state === state)
    .map((token) => token.text)
    .join('|')
}

describe('word marks', () => {
  it('strikes only the words that left and underlines only the words that arrived', () => {
    const marks = markPassage(
      'The majority shareholder of Flipit Hong Kong is Mike Helm.',
      'The majority shareholder of Flipit Global Limited is Mike Helm.',
    )

    expect(joined(marks.original, 'removed')).toBe('Hong Kong')
    expect(joined(marks.current, 'added')).toBe('Global Limited')

    // Nothing is lost or duplicated on the way through the aligner.
    expect(marks.original.map((token) => token.text).join('')).toBe(
      'The majority shareholder of Flipit Hong Kong is Mike Helm.',
    )
    expect(marks.current.map((token) => token.text).join('')).toBe(
      'The majority shareholder of Flipit Global Limited is Mike Helm.',
    )
  })

  it('marks a whole passage when one side has no counterpart', () => {
    const added = markPassage('', 'A new paragraph.')
    expect(added.original).toEqual([])
    expect(added.current).toEqual([{ text: 'A new paragraph.', state: 'added' }])

    const removed = markPassage('An old paragraph.', '')
    expect(removed.current).toEqual([])
    expect(removed.original).toEqual([
      { text: 'An old paragraph.', state: 'removed' },
    ])
  })

  it('never draws a stroke through a paragraph break', () => {
    const marks = markPassage('alpha bravo\n\ncharlie delta', 'echo foxtrot\n\ngolf hotel')
    for (const token of [...marks.original, ...marks.current]) {
      if (token.text.includes('\n')) expect(token.state).toBe('same')
    }
  })

  it('falls back to marking the whole passage past the alignment limit', () => {
    const long = Array.from({ length: MAX_ALIGNED_WORDS + 1 }, (_, i) => `w${i}`).join(' ')
    const marks = markPassage(long, `${long} tail`)
    expect(marks.original).toHaveLength(1)
    expect(marks.original[0].state).toBe('removed')
    expect(marks.current).toHaveLength(1)
    expect(marks.current[0].state).toBe('added')
  })

  it('leaves an unchanged passage unmarked', () => {
    const same = 'Kind regards,'
    const marks = markPassage(same, same)
    expect(marks.original.every((token) => token.state === 'same')).toBe(true)
    expect(marks.current.every((token) => token.state === 'same')).toBe(true)
  })
})

describe('the balloon is not allowed to invent a reason', () => {
  it('turns the recorded placeholder back into an absence', () => {
    expect(recordedText('Reason not recorded anywhere.')).toBeNull()
    expect(recordedText('   ')).toBeNull()
    expect(recordedText(null)).toBeNull()
    expect(recordedText('BUILD_SPEC.md §11.1.')).toBe('BUILD_SPEC.md §11.1.')
  })

  it('reports every UNVERIFIED clause in the real record as unverified', () => {
    const unverified = EMAIL_REVIEW_CLAUSES.filter(
      (clause) => clause.evidenceKind === 'UNVERIFIED',
    )
    expect(unverified.length).toBeGreaterThan(0)

    for (const clause of unverified) {
      const annotation = buildPassageAnnotation(
        unit({ clauseIds: [clause.id] }),
        EMAIL_REVIEW_CLAUSES,
      )
      expect(annotation.unverified).toBe(true)
      expect(annotation.entries).toHaveLength(1)
      expect(annotation.entries[0].reason).toBeNull()
      expect(annotation.entries[0].evidence).toBeNull()
    }
  })

  it('keeps the reason and the evidence where one was actually recorded', () => {
    const clause = EMAIL_REVIEW_CLAUSES.find((entry) => entry.id === 'greeting')
    expect(clause?.evidenceKind).toBe('SPEC')

    const annotation = buildPassageAnnotation(
      unit({ clauseIds: ['greeting'] }),
      EMAIL_REVIEW_CLAUSES,
    )
    expect(annotation.unverified).toBe(false)
    expect(annotation.entries[0].reason).toBe(clause?.reason)
    expect(annotation.entries[0].evidence).toBe(clause?.evidence)
  })

  it('treats a passage with no recorded clause as unverified rather than explained', () => {
    const annotation = buildPassageAnnotation(
      unit({ kind: 'ADDED', current: ['Something new.'] }),
      EMAIL_REVIEW_CLAUSES,
    )
    expect(annotation.entries).toEqual([])
    expect(annotation.unverified).toBe(true)
    expect(annotation.status).toBe('Added')
    expect(annotation.title).toBe('Something new.')
  })
})

/**
 * The paper view shipped once with its CSS in a runtime
 * `<style dangerouslySetInnerHTML>` and its grid rows in `style={{ gridRow }}`.
 * Neither applied. `src/lib/security/csp.ts` sets `style-src 'self'`, which
 * refuses a `<style>` element without the nonce *and* every style attribute
 * parsed from markup, so the served page had the right CSS text sitting inert
 * in the DOM: the grid collapsed and the pencil marks, which need a positioned
 * container, rendered as solid black shapes across the header.
 *
 * The stylesheet is now a CSS Module, compiled at build time and served from
 * this origin. These are the checks that stop the old shape coming back — they
 * read source, because the thing they are guarding against renders perfectly in
 * a unit test and only fails behind a real policy.
 */
const FOLDER = 'src/components/email-review'

function components(): string[] {
  return readdirSync(FOLDER).filter((name) => name.endsWith('.tsx'))
}

function source(name: string): string {
  return readFileSync(join(FOLDER, name), 'utf8')
}

/**
 * These files document the rule they obey, in prose that quotes the exact
 * shape being banned. Comments are stripped first, or the file that explains
 * why there is no `style` attribute is the one that fails for having one.
 */
function code(name: string): string {
  return source(name)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

describe('nothing here is styled in a way the policy refuses', () => {
  it('renders no <style> element and no dangerouslySetInnerHTML', () => {
    const offenders = components().filter((name) =>
      /<style[\s>]|dangerouslySetInnerHTML/.test(code(name)),
    )
    expect(offenders).toEqual([])
  })

  it('carries no style attribute anywhere', () => {
    // `style={{…}}` on anything React renders on the server becomes
    // `style="…"` in the markup, which the policy drops silently and
    // `auditScreen` in `pnpm verify:viewport` fails on. Measured placement goes
    // through `element.style` after mount instead, which CSP does not govern.
    const offenders = components().filter((name) => /\sstyle=\{/.test(code(name)))
    expect(offenders).toEqual([])
  })

  it('takes its stylesheet from the compiled CSS Module', () => {
    const importers = components().filter((name) =>
      code(name).includes("from './paper.module.css'"),
    )
    expect(importers.sort()).toEqual([
      'annotation-balloon.tsx',
      'paper-review.tsx',
      'pencil.tsx',
    ])
  })

  it('names only classes the stylesheet actually defines', () => {
    // A CSS Module returns `undefined` for a name it does not have, and an
    // element with `className={undefined}` looks exactly like one whose rules
    // were refused — which is the failure this whole entry is about.
    const css = readFileSync(join(FOLDER, 'paper.module.css'), 'utf8')
    const defined = new Set(
      [...css.matchAll(/^\.([A-Za-z][\w-]*)/gm)].map((match) => match[1]),
    )
    const missing: string[] = []
    for (const name of components()) {
      for (const match of code(name).matchAll(/\bstyles\.([A-Za-z]\w*)/g)) {
        if (!defined.has(match[1])) missing.push(`${name}: styles.${match[1]}`)
      }
    }
    // The two applied by lookup rather than by name.
    for (const name of ['added', 'removed']) {
      if (!defined.has(name)) missing.push(`paper.module.css: .${name}`)
    }
    expect(missing).toEqual([])
  })

  it('draws every stroke with an explicit fill, not a stylesheet default', () => {
    // An SVG path with no fill declared is filled black. When the stylesheet
    // was refused, that is what covered the page.
    const pencil = code('pencil.tsx')
    expect(pencil).toContain("fill: 'none'")
    expect(pencil.match(/<path\b/g) ?? []).toHaveLength(
      (pencil.match(/\{\.\.\.pathProps\}/g) ?? []).length,
    )
  })
})

describe('the hand-drawn strokes are stable', () => {
  it('gives the same passage the same stroke every render', () => {
    // A path built from Math.random() renders differently on the server and in
    // the browser, which React reports as a hydration mismatch — and it would
    // move a reviewer's marks around between visits.
    const seed = handSeed('change-07-current')
    expect(circlePath(seed)).toBe(circlePath(seed))
    expect(tiePath(seed)).toBe(tiePath(seed))
    expect(circlePath(seed)).toMatch(/^M -?\d/)
  })

  it('gives different passages different strokes', () => {
    expect(circlePath(handSeed('change-01-current'))).not.toBe(
      circlePath(handSeed('change-02-current')),
    )
  })

  it('stays inside the unit interval', () => {
    for (let step = 0; step < 64; step += 1) {
      const value = noise(handSeed('change-03'), step)
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThan(1)
    }
  })
})
