import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { existsInCode } from './source'

/**
 * `verify:all` against the scripts it claims to run.
 *
 * The failure this exists for is a **silent** one, and it is the ordinary way a
 * runner like this rots: somebody adds `verify:whatever` to `package.json`,
 * `pnpm verify:whatever` works, and `pnpm verify:all` — the command run before a
 * release — never runs it and never says so. The total stays green and the
 * coverage quietly shrinks.
 *
 * So the list in `verify-all.ts` is asserted to be exactly the set of
 * `verify:*` scripts, in both directions, and the prerequisite flags are
 * asserted against what each script's source actually does. A new browser-driven
 * script that forgets `'BROWSER'` would be *run* on a machine without Chromium
 * and fail with a stack trace instead of a named skip, which is a smaller
 * problem than the first one and still not one anybody should have to diagnose.
 */

const root = process.cwd()
const runner = readFileSync(join(root, 'scripts/verify-all.ts'), 'utf8')
const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
  scripts: Record<string, string>
}

/** The declared table, read out of the source rather than imported. */
const declared = [...runner.matchAll(/\{ name: '([^']+)', proves: '([^']*)'(?:, needs: \[([^\]]*)\])? \}/g)].map(
  (match) => ({
    name: match[1]!,
    proves: match[2]!,
    needs: (match[3] ?? '')
      .split(',')
      .map((need) => need.trim().replace(/'/g, ''))
      .filter(Boolean),
  }),
)

/** Every `verify:*` in package.json, except the runner itself. */
const wired = Object.keys(packageJson.scripts)
  .filter((name) => name.startsWith('verify:') && name !== 'verify:all')
  .map((name) => name.slice('verify:'.length))

/**
 * A script's source, as written.
 *
 * The rules below ask what a script *does* — starts a server, drives a browser,
 * shells out to `pg_restore` — and each of them asks it through `existsInCode`,
 * not with a plain regex. `verify-mutants.ts` holds broken code as strings and
 * pastes it into other files; a plain regex read one of those strings and
 * concluded the mutation table drives a browser and had forgotten to declare
 * `'BROWSER'`.
 *
 * `codeWithoutStrings` is the wrong tool for these three, because every one of
 * them looks for an **import** and a module specifier *is* a string. Blanking
 * the quotes makes `from 'playwright'` unfindable in the files that really do
 * import it. `existsInCode` asks whether the match *starts* in code, which is
 * the actual question.
 */
function sourceOf(name: string): string {
  const command = packageJson.scripts[`verify:${name}`]!
  const path = /tsx (scripts\/[\w-]+\.ts)/.exec(command)![1]!
  return readFileSync(join(root, path), 'utf8')
}

describe('verify:all', () => {
  it('parsed its own table — the regex above is not silently matching nothing', () => {
    // Every check below is vacuous if this is empty, and a runner asserted
    // against an empty list is the exact shape of failure this file is about.
    expect(declared.length).toBeGreaterThan(20)
  })

  it('exists as a script', () => {
    expect(packageJson.scripts['verify:all']).toBe('tsx scripts/verify-all.ts')
  })

  it('runs every verification that is wired up', () => {
    const missing = wired.filter((name) => !declared.some((entry) => entry.name === name))
    expect(
      missing,
      `these are in package.json and would never be run by verify:all: ${missing.join(', ')}`,
    ).toEqual([])
  })

  it('and claims none that is not', () => {
    const invented = declared.filter((entry) => !wired.includes(entry.name))
    expect(invented.map((entry) => entry.name)).toEqual([])
  })

  it('names each one once', () => {
    expect(new Set(declared.map((entry) => entry.name)).size).toBe(declared.length)
  })

  it('and every one of them points at a file that is there', () => {
    for (const entry of declared) {
      const command = packageJson.scripts[`verify:${entry.name}`]!
      const path = /tsx (scripts\/[\w-]+\.ts)/.exec(command)?.[1]
      expect(path, `verify:${entry.name} is not a tsx script`).toBeDefined()
      expect(existsSync(join(root, path!)), path).toBe(true)
    }
  })

  it('says what each one proves, in the summary line', () => {
    for (const entry of declared) {
      expect(entry.proves.length, entry.name).toBeGreaterThan(10)
    }
  })

  // -------------------------------------------------------------------------
  // The prerequisite flags, against what the scripts actually do
  // -------------------------------------------------------------------------

  it('marks every script that starts a server as needing a build', () => {
    for (const entry of declared) {
      const source = sourceOf(entry.name)
      // Raw text, deliberately. The evidence that a script starts a server is
      // `spawn('node_modules/.bin/next', ['start', …])` — and the name of the
      // binary is a **string**. `existsInCode` is the right tool for an import
      // and the wrong one here: it reported that `verify:memory` starts no
      // server, because the only occurrence of `next` outside a comment is
      // inside the path it spawns.
      const startsAServer = /\[\s*'start'/.test(source) && /next/.test(source)
      expect(entry.needs.includes('BUILD'), `${entry.name}: BUILD flag`).toBe(startsAServer)
    }
  })

  it('marks every script that drives a browser as needing one', () => {
    for (const entry of declared) {
      const source = sourceOf(entry.name)
      const drivesABrowser = existsInCode(source, /from 'playwright'/)
      expect(entry.needs.includes('BROWSER'), `${entry.name}: BROWSER flag`).toBe(drivesABrowser)
    }
  })

  it('marks every script that opens a camera as needing one', () => {
    // Not the same flag as BROWSER, and the difference cost this repository a
    // confusing half-hour twice. Playwright's headless shell exposes
    // `getUserMedia` and throws `NotSupportedError` on every call, so
    // `verify:recorder` timed out on a button that could never appear and
    // `verify:viewport` reported a failure that read like the application
    // refusing rather than the browser being unable.
    for (const entry of declared) {
      const source = sourceOf(entry.name)
      // Raw text, and this one is weaker than it looks: `verify-recorder.ts`
      // mentions `getUserMedia` only in a comment, because the call itself
      // happens inside the *page* rather than in the script. The flag is
      // therefore justified by prose. Recorded rather than tightened — the
      // alternative is a hand-maintained list of which scripts need a camera,
      // which is the thing this audit exists to avoid.
      const opensACamera = /getUserMedia/.test(source)
      expect(entry.needs.includes('CAMERA'), `${entry.name}: CAMERA flag`).toBe(opensACamera)
    }
  })

  it('and a camera is proved by opening one, never by checking the API exists', () => {
    // `typeof navigator.mediaDevices.getUserMedia` is `function` in the shell
    // that cannot capture. Only the call tells them apart.
    // Comments explain what the code avoids; they must not trip a check for it.
    //
    // Stripped line by line rather than with a `/* … */` regex, because this
    // file contains the glob `'**/*'` — which holds a `/*` and would open a
    // comment that swallowed the call being looked for. Found by watching this
    // check fail on code that was correct.
    const code = runner
      .split('\n')
      .filter((line) => !/^\s*(\/\/|\/?\*)/.test(line))
      .join('\n')
    expect(code).toContain('getUserMedia({ video: true })')
    expect(code).not.toContain('typeof navigator.mediaDevices')
  })

  it('detects at least one script in each category — the control', () => {
    /*
     * Every rule above is an equality between a declared flag and a detector,
     * and a detector that matches nothing satisfies it for every script that
     * declares nothing. Three of these four went briefly quiet when the
     * detectors were switched to `existsInCode`, and they went quiet by
     * agreeing with a table that happened to be right.
     */
    const sources = declared.map((entry) => sourceOf(entry.name))
    expect(sources.filter((source) => /\[\s*'start'/.test(source) && /next/.test(source)).length).toBeGreaterThan(3)
    expect(sources.filter((source) => existsInCode(source, /from 'playwright'/)).length).toBeGreaterThan(3)
    expect(sources.filter((source) => /getUserMedia/.test(source)).length).toBeGreaterThan(0)
    expect(sources.filter((source) => existsInCode(source, /from '\.\/backup'/)).length).toBe(1)
  })

  it('marks the one that shells out to pg_restore', () => {
    for (const entry of declared) {
      const source = sourceOf(entry.name)
      // `backup.ts` is where `pg_dump` and `pg_restore` are spawned; a script
      // that imports from it inherits the requirement.
      const usesPgTools = existsInCode(source, /from '\.\/backup'/)
      expect(entry.needs.includes('PG_TOOLS'), `${entry.name}: PG_TOOLS flag`).toBe(usesPgTools)
    }
  })

  // -------------------------------------------------------------------------
  // The two decisions that make the runner honest
  // -------------------------------------------------------------------------

  it('a skip is not a pass', () => {
    // A machine without Chromium would otherwise report success while four
    // scripts — including every screen at 375px — never ran. This is the one
    // command somebody runs before a release.
    expect(runner).toContain('failed.length > 0 || skipped.length > 0')
  })

  it('and every skip is named with its reason', () => {
    expect(runner).toContain('SKIPPED')
    expect(runner).toContain('outcome.reason')
  })

  it('runs them one at a time, which is not an oversight', () => {
    // They seed fixtures into the same database and delete them by prefix. Two
    // at once would interleave and delete each other's, intermittently.
    expect(runner).not.toContain('Promise.all')
    expect(runner).toContain('for (const verification of selected)')
  })

  it('builds at most once', () => {
    // Five of them start a server. Each building its own would be five builds.
    expect((runner.match(/await run\('build'\)/g) ?? []).length).toBe(1)
  })

  // -------------------------------------------------------------------------
  // The failure that is a variable rather than a defect
  // -------------------------------------------------------------------------

  describe('the media store, which is reported up front and is not a prerequisite', () => {
    it('says which of the two states the run is in, before anything starts', () => {
      // A fresh clone has `MEDIA_STORE=""` — supported by the application, not
      // supported by a complete run. Discovering that from a FAIL seventy-nine
      // seconds into `verify:deployment` costs a diagnosis every time.
      expect(runner).toContain("process.env.MEDIA_STORE ?? ''")
      expect(runner).toContain('deployment and viewport will each')
      expect(runner).toContain('"filesystem"')
    })

    it('does not turn it into a prerequisite, because that would skip 700 checks to avoid two', () => {
      const declaredNeeds = [...runner.matchAll(/needs: \[([^\]]*)\]/g)].map((m) => m[1]!)
      for (const needs of declaredNeeds) expect(needs).not.toContain('MEDIA')
    })

    it('and the two scripts that need one are still exactly those two', () => {
      // If a third grows a store-dependent check, the sentence above becomes a
      // lie and this is what says so.
      const users = ['deployment', 'viewport', 'media', 'object-store', 'uploads', 'erasure-bytes']
        .filter((name) => existsSync(join(root, `scripts/verify-${name}.ts`)))
        .filter((name) => {
          const source = readFileSync(join(root, `scripts/verify-${name}.ts`), 'utf8')
          return /a media store is configured for this run/.test(source)
        })
      expect(users.sort()).toEqual(['deployment', 'viewport'])
    })

    it('.env.example says the same thing, for somebody who never reads the runner', () => {
      const example = readFileSync(join(root, '.env.example'), 'utf8')
      expect(example).toContain('NOT supported by a complete `pnpm verify:all`')
      expect(example).toContain('MEDIA_STORE="filesystem"')
    })
  })
})
