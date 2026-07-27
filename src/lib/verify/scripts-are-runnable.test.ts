import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Every verification script has a way to run it, and the way is written down.
 *
 * Six did not. `verify-qa.ts`, `verify-register.ts`, `verify-updates.ts`,
 * `verify-certificate.ts`, `verify-rounds.ts` and `verify-export.ts` — 259
 * checks between them, against a real Postgres, covering the shared Q&A's
 * anonymisation, the register's isolation, a targeted update's audience, the
 * certificate lifecycle, the rule that a passed deadline closes nothing, and the
 * export's decimals — had **no entry in `package.json` from the day they were
 * written.**
 *
 * They were not broken. Every one of them passes. They were simply invisible:
 * `pnpm run` did not list them, `DEPLOYMENT.md` did not name them, and the only
 * record that they exist at all was a line in each file's own docstring. Four
 * PROGRESS.md entries cite `pnpm verify:qa` as evidence for a claim, and until
 * this test was written that command did not exist.
 *
 * That is the same family as the three defects before it — a check that would
 * pass if the thing it names were absent — taken one level out. These were
 * checks that could not fail, because nothing ran them.
 *
 * The rule is mechanical, so it is enforced mechanically rather than by
 * remembering: a script in `scripts/` whose name begins `verify-` must have a
 * `package.json` script that runs it. Adding the seventh one without an entry
 * now fails the suite.
 */

const root = process.cwd()

interface PackageJson {
  scripts: Record<string, string>
}

const pkg: PackageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))

function verificationScripts(): string[] {
  return readdirSync(join(root, 'scripts'))
    .filter((name) => name.startsWith('verify-') && name.endsWith('.ts'))
    .sort()
}

describe('every verification script is runnable through pnpm', () => {
  it('finds the scripts at all, so an empty directory cannot pass this', () => {
    expect(verificationScripts().length).toBeGreaterThan(20)
  })

  it.each(verificationScripts())('%s has a package.json entry', (file) => {
    const runners = Object.entries(pkg.scripts).filter(([, command]) =>
      command.includes(`scripts/${file}`),
    )

    expect(
      runners.length,
      `No package.json script runs scripts/${file}. Add one — a verification ` +
        `nobody can invoke is a verification that never runs.`,
    ).toBeGreaterThan(0)
  })

  it('names each one after the file it runs, so the list stays readable', () => {
    const odd: string[] = []
    for (const [name, command] of Object.entries(pkg.scripts)) {
      const match = /^tsx scripts\/verify-(.+)\.ts$/.exec(command)
      if (!match) continue
      if (!name.startsWith('verify:')) odd.push(`${name} -> ${command}`)
    }
    expect(odd).toEqual([])
  })

  it('runs each script from exactly one entry, so there is one name to cite', () => {
    const duplicated: string[] = []
    for (const file of verificationScripts()) {
      const runners = Object.entries(pkg.scripts).filter(([, command]) =>
        command.includes(`scripts/${file}`),
      )
      if (runners.length > 1) duplicated.push(`${file}: ${runners.map(([n]) => n).join(', ')}`)
    }
    expect(duplicated).toEqual([])
  })
})
