import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * The accessibility rules that can be checked by reading the source.
 *
 * CODEX_TASKS WP18: *"WCAG AA contrast, checking `--dim` on `--bg`
 * specifically. Keyboard navigation and focus states throughout."*
 *
 * Contrast is arithmetic and lives in `brand.contrast.test.ts`. Layout at
 * 375px is geometry and lives in `scripts/verify-viewport.ts`, which renders
 * the real pages in a real browser. What is left is the handful of rules that
 * are broken by a specific string appearing in a file, and those are here —
 * because they are the ones that get reintroduced by somebody copying a class
 * list from the screen next door, which is exactly how six of the seven
 * suppressed focus rings this package removed got there.
 */

function walk(dir: string, ext: string[]): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry)
    if (statSync(p).isDirectory()) out.push(...walk(p, ext))
    else if (ext.some((e) => p.endsWith(e))) out.push(p)
  }
  return out
}

const screens = ['src/app', 'src/components'].flatMap((d) => walk(d, ['.tsx']))

function read(file: string): string {
  return readFileSync(file, 'utf8')
}

/**
 * Several of these checks look for a word that must not appear in a class
 * list. Every file here also *documents* the rule it obeys, in prose that uses
 * the same words — so comments are stripped first, or the most carefully
 * written file in the tree is the one that fails.
 */
function code(file: string): string {
  return read(file)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
}

describe('keyboard focus is never suppressed', () => {
  it('no control removes the focus outline', () => {
    // `focus:outline-none` next to `focus:border-orange` leaves a
    // colour-only focus indicator, which fails WCAG 1.4.1 and 2.4.7. Two of
    // the seven that were here were on the investor's own portal: the box
    // they type their response into, and the box they ask a question in.
    const offenders = screens.filter((f) => /outline-none/.test(code(f)))
    expect(offenders).toEqual([])
  })

  it('the global focus ring is declared once and uses an accent that is visible', () => {
    const css = read('src/app/globals.css')
    expect(css).toMatch(/:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--color-orange\)/)
    expect(css).toMatch(/outline-offset/)
  })

  it('there is a skip link, and it has somewhere to land on every page', () => {
    const layout = read('src/app/layout.tsx')
    expect(layout).toContain('class="skip-link"'.replace('class=', 'className='))
    expect(layout).toContain('href="#main"')

    // Every page that renders its own `<main>` must carry the target id, or
    // the skip link silently does nothing on that page.
    const withMain = screens.filter((f) => read(f).includes('<main'))
    expect(withMain.length).toBeGreaterThan(0)
    for (const file of withMain) {
      expect(read(file), `${file} has a <main> without id="main"`).toMatch(
        /<main[^>]*id="main"/,
      )
    }
  })
})

describe('touch targets', () => {
  it('no interactive element is set below 44px', () => {
    // WCAG 2.5.8 asks for 24px and 2.5.5 for 44px; §13.2's "excellent at
    // 375px" is a phone held in one hand, so this build takes the larger one.
    // `min-h-9` is 36px and was on twelve links, including the investor's
    // certificate download.
    const offenders: string[] = []
    for (const file of screens) {
      for (const m of read(file).matchAll(/min-h-(\d+)\b/g)) {
        if (Number(m[1]) < 11) offenders.push(`${file}: ${m[0]}`)
      }
    }
    expect(offenders).toEqual([])
  })
})

describe('layout that cannot shrink', () => {
  it('every grid declares a base column count', () => {
    /**
     * A `grid` with no `grid-cols-*` gets one implicit column sized to
     * `auto`, which is `max-content` — so the column is as wide as its widest
     * child wants to be, and a `<select>` whose longest option is long pushes
     * the whole document sideways. Tailwind's `grid-cols-1` is
     * `repeat(1, minmax(0, 1fr))`, and the `minmax(0, ...)` is the part that
     * lets the child shrink.
     *
     * This is not theoretical. The audit log's filter form was a bare `grid`,
     * and it was fine until the audit log had a longer action name in it —
     * at which point the page scrolled sideways at 375px on a screen the
     * owner reads. Twenty grids across the application had the same shape.
     *
     * A prefixed `sm:grid-cols-2` does not satisfy this: below the `sm`
     * breakpoint, which is where §13.2 says to look first, it does nothing.
     */
    const offenders: string[] = []
    for (const file of screens) {
      for (const m of code(file).matchAll(/className="([^"{}]*)"/g)) {
        const tokens = m[1].split(/\s+/)
        if (!tokens.includes('grid')) continue
        if (tokens.some((t) => /^grid-cols-\S+$/.test(t))) continue
        offenders.push(`${file}: class="${m[1]}"`)
      }
    }
    expect(offenders).toEqual([])
  })
})

describe('the page renders at the width of the device', () => {
  it('the viewport is declared, and zoom is not capped', () => {
    const layout = read('src/app/layout.tsx')
    expect(layout).toMatch(/width:\s*'device-width'/)
    expect(layout).toMatch(/initialScale:\s*1/)

    // WCAG 1.4.4. A page carrying somebody's investment figures is not one to
    // disable pinch-zoom on.
    expect(layout).not.toMatch(/maximumScale|userScalable/)
  })
})

describe('motion', () => {
  it('reduced motion is honoured', () => {
    expect(read('src/app/globals.css')).toContain('prefers-reduced-motion: reduce')
  })

  it('the brand mark does not move — §13.2 asks for restraint structurally', () => {
    const curl = code('src/components/page-curl.tsx')
    expect(curl).not.toMatch(/animate|transition|keyframes|transform/)
    // It carries no meaning, so it is hidden from assistive technology rather
    // than described.
    expect(curl).toContain('aria-hidden="true"')
    expect(curl).toContain('focusable="false"')
  })
})

describe('language and document structure', () => {
  it('the document declares its language', () => {
    expect(read('src/app/layout.tsx')).toMatch(/<html lang="en"/)
  })

  it('the admin shell has header and main landmarks', () => {
    const shell = read('src/app/(admin)/layout.tsx')
    expect(shell).toContain('<header>')
    expect(shell).toContain('<main id="main"')
  })
})
