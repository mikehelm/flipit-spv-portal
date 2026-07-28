/**
 * Launching a Chromium that is actually on this machine.
 *
 * The decision is in `src/lib/verify/chromium.ts` and is tested there without a
 * browser. This is the twelve lines that act on it, and it is the only place in
 * the repository that calls `chromium.launch`. There is a test enforcing that,
 * because the defect being fixed is precisely a fix that was written twice and
 * copied to neither of the three places that needed it.
 *
 * It never downloads anything. A machine with no usable Chromium gets the error
 * Playwright itself produced, unchanged, so the suggestion to run
 * `pnpm exec playwright install` is still there for the machine where that is
 * the right answer.
 */

import { existsSync } from 'node:fs'
import { chromium, type Browser, type LaunchOptions } from 'playwright'
import { chooseChromium, fallbackChromium } from '@/lib/verify/chromium'

/** Whether a browser could be launched at all, and which one. Never throws. */
export interface BrowserAvailability {
  ok: boolean
  detail: string
}

/**
 * `options` is each script's own — the synthetic capture device that
 * `verify:recorder` and `verify:viewport` need, and nothing for the rest. An
 * `executablePath` in it is overridden: choosing the browser is this function's
 * job, and two places deciding it is how the repository got here.
 */
export async function launchChromium(options: LaunchOptions = {}): Promise<Browser> {
  const { executablePath: _ignored, ...rest } = options

  const chosen = chooseChromium({ CHROMIUM_PATH: process.env.CHROMIUM_PATH }, existsSync)

  if (chosen.kind === 'EXPLICIT_MISSING') throw new Error(chosen.detail)
  if (chosen.kind === 'EXPLICIT') {
    return chromium.launch({ ...rest, executablePath: chosen.executablePath })
  }

  try {
    return await chromium.launch(rest)
  } catch (error) {
    const fallback = fallbackChromium(existsSync)
    if (fallback.kind !== 'CANDIDATE') throw error
    console.log(`  note  ${fallback.note}`)
    return chromium.launch({ ...rest, executablePath: fallback.executablePath })
  }
}

/**
 * The same question `verify:all` asks before it decides whether to skip the
 * browser-driven scripts — answered the same way they answer it, by launching.
 *
 * A prerequisite check that guesses is worse than no check: it turns a run that
 * would have succeeded into a skip, and a skip is the thing `verify:all` exists
 * to shout about. Sharing the launcher is what keeps the preflight and the
 * scripts from disagreeing, which is exactly what they did.
 */
export async function chromiumAvailability(
  options: LaunchOptions = {},
): Promise<{ browser: Browser | null; availability: BrowserAvailability }> {
  try {
    const browser = await launchChromium(options)
    return {
      browser,
      availability: { ok: true, detail: `Chromium ${browser.version()} launches` },
    }
  } catch (error) {
    return {
      browser: null,
      availability: {
        ok: false,
        detail: error instanceof Error ? error.message.split('\n')[0]! : String(error),
      },
    }
  }
}
