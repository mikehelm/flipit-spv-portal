import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CHROMIUM_CANDIDATES, chooseChromium, fallbackChromium } from './chromium'
import { existsInCode } from './source'

/**
 * Which Chromium the browser-driven checks launch, and the rule that there is
 * one answer rather than five.
 *
 * The defect this covers is not a wrong branch. It is a **correct** branch,
 * written twice, in two of the five scripts that needed it — so
 * `verify:account-access` and `verify:erasure-bytes` ran on a machine where
 * `verify:uploads`, `verify:viewport` and `verify:recorder` died with
 * "Executable doesn't exist", and `verify:all` reported the browser as
 * unavailable and skipped them without anybody being told the fix was already
 * in the repository.
 *
 * So the last test in this file is the one that matters most: it is the only
 * thing preventing the sixth copy.
 */

const root = process.cwd()
const never = () => false
const always = () => true

describe('an explicit CHROMIUM_PATH', () => {
  it('is used when it is there, and nothing else is consulted', () => {
    const chosen = chooseChromium({ CHROMIUM_PATH: '/somewhere/chrome' }, always)
    expect(chosen).toEqual({ kind: 'EXPLICIT', executablePath: '/somewhere/chrome' })
  })

  it('is a refusal when it is not there, never a fallback', () => {
    /*
     * Somebody who set the variable has said *which* browser to use. Quietly
     * using a different one makes the check pass while measuring something
     * else — and the reason the variable exists at all is `verify:recorder`,
     * where a headless shell and a full Chromium give different answers about
     * whether a camera opens.
     */
    const chosen = chooseChromium({ CHROMIUM_PATH: '/gone/chrome' }, never)
    expect(chosen.kind).toBe('EXPLICIT_MISSING')
    expect(chosen.kind === 'EXPLICIT_MISSING' && chosen.detail).toContain('/gone/chrome')
  })

  it('and whitespace is not a path', () => {
    expect(chooseChromium({ CHROMIUM_PATH: '   ' }, never).kind).toBe('PINNED')
  })

  it('and neither is an empty string, which is what an unset shell variable gives', () => {
    expect(chooseChromium({ CHROMIUM_PATH: '' }, never).kind).toBe('PINNED')
  })
})

describe('with nothing set', () => {
  it("Playwright's own pinned build is tried first", () => {
    expect(chooseChromium({}, always).kind).toBe('PINNED')
  })

  it('and the choice does not depend on the filesystem, because it must be launched to know', () => {
    /*
     * `verify-all` used to check `chromium.executablePath()` against the disk
     * and was wrong in the direction that matters: it declared Chromium missing
     * and skipped four scripts that then ran perfectly by hand, because
     * Playwright launches the headless *shell* in headless mode and that is a
     * different binary at a different path.
     */
    expect(chooseChromium({}, never)).toEqual(chooseChromium({}, always))
  })
})

describe('after the pinned build has refused to launch', () => {
  it('the first candidate that is on the disk is used', () => {
    const chosen = fallbackChromium((path) => path === '/usr/bin/chromium')
    expect(chosen.kind === 'CANDIDATE' && chosen.executablePath).toBe('/usr/bin/chromium')
  })

  it('in the declared order, so a full Chromium beats a distribution one', () => {
    const chosen = fallbackChromium(always)
    expect(chosen.kind === 'CANDIDATE' && chosen.executablePath).toBe(CHROMIUM_CANDIDATES[0])
  })

  it('and it says which one it fell back to', () => {
    // Silence here would mean a run measuring a different browser from the one
    // somebody thinks they are measuring.
    const chosen = fallbackChromium(always)
    expect(chosen.kind === 'CANDIDATE' && chosen.note).toContain(CHROMIUM_CANDIDATES[0])
  })

  it('and NONE when there is nothing, so the original error can be rethrown', () => {
    // Playwright's own message names the download command, which is the right
    // answer on the machine where downloading is possible. Replacing it would
    // take that away.
    expect(fallbackChromium(never).kind).toBe('NONE')
  })

  it('the candidate list is not empty, so an empty list cannot pass these', () => {
    expect(CHROMIUM_CANDIDATES.length).toBeGreaterThan(2)
  })
})

describe('there is one launcher, not five', () => {

  /**
   * The scripts, as written.
   *
   * Every rule below asks its question through `existsInCode`, never with a
   * plain regex over the text. `verify-mutants.ts` holds broken code as
   * **strings** — including `chromium.launch({})` — and pastes it into other
   * files to check that somebody notices. It runs none of it. A guard that read
   * those strings would report the very check that proves the guard works,
   * which is how a rule gets switched off.
   *
   * Blanking the strings outright is the wrong fix here and was tried: two of
   * these three rules look for an **import**, and a module specifier is a
   * string. `from 'playwright'` becomes unfindable, every file is skipped, and
   * the rule passes over nothing at all — which is worse than what it replaced.
   * Hence the control below, and hence `existsInCode`, which asks whether the
   * match *starts* in code.
   */
  function scriptSources(): Array<{ name: string; source: string }> {
    const out: Array<{ name: string; source: string }> = []
    for (const name of readdirSync(join(root, 'scripts'))) {
      if (!name.endsWith('.ts')) continue
      out.push({ name, source: readFileSync(join(root, 'scripts', name), 'utf8') })
    }
    for (const name of readdirSync(join(root, 'scripts/lib'))) {
      if (!name.endsWith('.ts')) continue
      out.push({
        name: `lib/${name}`,
        source: readFileSync(join(root, 'scripts/lib', name), 'utf8'),
      })
    }
    return out
  }

  it('finds the scripts at all, so an empty directory cannot pass this', () => {
    expect(scriptSources().length).toBeGreaterThan(20)
  })

  it('only scripts/lib/browser.ts calls chromium.launch', () => {
    /*
     * **This is the whole package.** The ladder was correct in the two scripts
     * that had it and absent from the three that did not, and nothing anywhere
     * said so — three of the twenty-three verification commands were simply
     * unrunnable on this machine, and `verify:all` skipped them and called that
     * a prerequisite problem.
     *
     * A sixth script launching its own browser now fails the suite.
     */
    for (const { name, source } of scriptSources()) {
      if (name === 'lib/browser.ts') continue
      expect(
        existsInCode(source, /chromium\.launch\(/),
        `${name} launches its own browser — use launchChromium()`,
      ).toBe(false)
    }
  })

  it('and no script reads CHROMIUM_PATH for itself', () => {
    // Reading it is deciding which browser to use, and two places deciding that
    // is how the repository got here.
    for (const { name, source } of scriptSources()) {
      if (name === 'lib/browser.ts') continue
      expect(
        existsInCode(source, /process\.env\.CHROMIUM_PATH/),
        `${name} reads CHROMIUM_PATH — the launcher does that`,
      ).toBe(false)
    }
  })

  it('finds the browser-driven scripts at all — the control on the rule below', () => {
    /*
     * The rule below is `if it imports playwright, it must use launchChromium`,
     * and a version of it that finds no importer passes over nothing while
     * reading exactly like a clean repository. That is not hypothetical: this
     * file briefly read the scripts with their string contents blanked, which
     * turned every `from 'playwright'` into `from ''` and skipped all five.
     */
    const importers = scriptSources().filter(({ source }) => existsInCode(source, /from 'playwright'/))
    expect(importers.length).toBeGreaterThanOrEqual(5)
    expect(importers.map(({ name }) => name)).toContain('lib/browser.ts')
  })

  it('and every script that drives a browser goes through the launcher', () => {
    for (const { name, source } of scriptSources()) {
      if (name === 'lib/browser.ts') continue
      if (!existsInCode(source, /from 'playwright'/)) continue
      expect(
        existsInCode(source, /launchChromium/),
        `${name} imports playwright without using launchChromium`,
      ).toBe(true)
    }
  })
})
