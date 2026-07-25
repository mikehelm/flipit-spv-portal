import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import { brand, PALETTE_CORRECTIONS } from './brand'

/**
 * "The §13.2 palette applied consistently." — CODEX_TASKS, WP18.
 *
 * Before this package the palette was applied by copying hex strings: six
 * hundred and forty-two literals across forty-four files, nineteen of them
 * colours that appear nowhere in §13.2's table. Consistency of that kind is a
 * claim that decays the first time somebody types a digit wrong, and it is
 * unfalsifiable by reading — nobody diffs six hundred hex strings.
 *
 * So this is the check. Three assertions, and between them a colour cannot
 * enter a screen without being named, and cannot be named without appearing in
 * the contrast table next door.
 */

const SCREEN_ROOTS = ['src/app', 'src/components']
const THEME_FILE = 'src/app/globals.css'

function walk(dir: string, exts: string[]): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry)
    if (statSync(p).isDirectory()) out.push(...walk(p, exts))
    else if (exts.some((e) => entry.endsWith(e))) out.push(p)
  }
  return out
}

function screenFiles(): string[] {
  return SCREEN_ROOTS.flatMap((root) => walk(root, ['.ts', '.tsx']))
}

describe('the palette is declared once', () => {
  it('every token in the Tailwind theme has the same value in brand.ts', () => {
    const css = readFileSync(THEME_FILE, 'utf8')
    const theme = css.slice(css.indexOf('@theme'), css.indexOf('\n}', css.indexOf('@theme')))

    const declared = new Map<string, string>()
    for (const m of theme.matchAll(/--color-([a-z0-9-]+):\s*(#[0-9a-fA-F]{3,8})\s*;/g)) {
      declared.set(m[1], m[2].toLowerCase())
    }

    // `ftext` rather than `text` because Tailwind reserves `text-*` sizing.
    const cssNameFor: Record<string, string> = {
      text: 'ftext',
      orangeSoft: 'orange-soft',
      warnSurface: 'warn-surface',
      warnSoft: 'warn-soft',
    }

    const mismatches: string[] = []
    for (const [key, value] of Object.entries(brand)) {
      if (!value.startsWith('#')) continue // --line is rgba, declared in :root
      const cssName = cssNameFor[key] ?? key
      const declaredValue = declared.get(cssName)
      if (declaredValue !== value.toLowerCase()) {
        mismatches.push(`brand.${key} = ${value} but --color-${cssName} = ${declaredValue}`)
      }
      declared.delete(cssName)
    }

    expect(mismatches).toEqual([])

    // And nothing declared in CSS that TypeScript does not know about, which
    // would be a colour the contrast test never sees.
    expect([...declared.keys()]).toEqual([])
  })

  it('no screen contains a hex colour literal', () => {
    const offenders: string[] = []
    for (const file of screenFiles()) {
      const source = readFileSync(file, 'utf8')
      for (const m of source.matchAll(/#[0-9a-fA-F]{6}\b/g)) {
        offenders.push(`${relative(process.cwd(), file)}: ${m[0]}`)
      }
    }

    // The failure message is the point: it should name the file and the colour
    // so the fix is obvious without opening anything.
    expect(offenders).toEqual([])
  })

  it('the retired colours are gone from the screens, not merely renamed', () => {
    const sources = screenFiles().map((f) => readFileSync(f, 'utf8'))
    const theme = readFileSync(THEME_FILE, 'utf8')

    for (const correction of PALETTE_CORRECTIONS) {
      expect(sources.some((s) => s.includes(correction.was))).toBe(false)
      expect(theme.includes(correction.was)).toBe(false)
    }
  })
})

describe('the email templates and the certificate are excluded on purpose', () => {
  /**
   * §11.5 asks the invitation for a *light* body, and §8.2 hashes the template
   * — restyling one would break an approval that has already been recorded.
   * This test exists so that the exclusion reads as a decision rather than an
   * oversight when someone later finds hex literals there.
   */
  it('still holds its own palette, and this is deliberate', () => {
    const invitation = readFileSync('src/lib/email/templates/invitation.ts', 'utf8')
    expect(invitation).toMatch(/#[0-9a-fA-F]{6}/)
    expect(SCREEN_ROOTS.some((r) => 'src/lib/email/templates/invitation.ts'.startsWith(r))).toBe(
      false,
    )
  })
})
