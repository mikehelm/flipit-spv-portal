import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * The root layout must not be able to fail, because the file that catches it
 * failing has never been rendered by anything.
 *
 * There are two error boundaries in this application. `error.tsx` renders
 * *inside* the root layout and catches everything the layout's children throw;
 * it is driven by `verify:viewport` against a real fault, and its behaviour is
 * measured. `global-error.tsx` replaces the whole document and catches a failure
 * **of the layout itself** — and nothing has ever rendered it, because as
 * written the root layout cannot throw.
 *
 * That is worth pinning rather than leaving to luck. `global-error.tsx`'s own
 * docstring says *"the realistic way to reach it is a failure in `env()` — the
 * boot-time validation the root layout's children depend on"*, and that is not
 * right: `env()` is called by the **children**, so a failure in it renders
 * `error.tsx`, which is measured, and not `global-error.tsx`, which is not. The
 * comment has been corrected; this test is the part that keeps it true.
 *
 * The rule: the root layout imports nothing that reads the environment, the
 * database, a cookie or a session. It is markup, a language attribute, a skip
 * link and a `viewport` object. If it ever grows a data read — a footer that
 * checks a service flag, a banner, a feature switch — the failure mode moves
 * from a screen that has been rendered under fault to a screen that has not, and
 * whoever makes that change should have to come here and think about it.
 *
 * Deliberately a check on the **imports** rather than on the rendered output. A
 * layout that reads nothing cannot throw for a reason a test would have to
 * simulate, and the import list is the thing a future change actually touches.
 */

const source = readFileSync(join(process.cwd(), 'src/app/layout.tsx'), 'utf8')

function importedModules(text: string): string[] {
  return [...text.matchAll(/^import\s[^'"]*from\s+['"]([^'"]+)['"]/gm)].map((m) => m[1])
}

describe('the root layout stays unable to fail', () => {
  it('reads the file at all, so a rename cannot make this vacuous', () => {
    expect(source).toContain('export default function RootLayout')
  })

  it('imports nothing from the application beyond its stylesheet', () => {
    const forbidden = importedModules(source).filter(
      (specifier) => specifier.startsWith('@/') || specifier.startsWith('../'),
    )
    expect(
      forbidden,
      'The root layout imported application code. Anything it reads can throw, ' +
        'and a throw here lands in global-error.tsx, which nothing has ever ' +
        'rendered. Put the read in a child, where error.tsx catches it and ' +
        'verify:viewport measures it.',
    ).toEqual([])
  })

  it('calls nothing that reads the environment, the database or a request', () => {
    for (const call of ['env(', 'db.', 'cookies(', 'headers(', 'await ', 'readServiceConfig']) {
      expect(source, `the root layout contains ${call}`).not.toContain(call)
    }
  })

  it('is not an async component, so it cannot await anything either', () => {
    expect(source).not.toMatch(/export default async function RootLayout/)
  })
})
