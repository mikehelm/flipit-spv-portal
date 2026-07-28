/**
 * Which Chromium the browser-driven checks should launch.
 *
 * **This existed twice and was shared nowhere, so three of the twenty-three
 * verification commands could not be run on a machine where two of them could.**
 *
 * `verify-account-access.ts` and `verify-erasure-bytes.ts` each carried the same
 * fallback chain: honour `CHROMIUM_PATH`, then try Playwright's own pinned
 * build, and if that is absent walk a short list of the places a Chromium
 * usually is. `verify-uploads.ts`, `verify-viewport.ts` and `verify-recorder.ts`
 * honoured `CHROMIUM_PATH` and stopped there, so on any machine whose installed
 * Chromium is numbered differently from Playwright's pin they died with
 *
 *     Executable doesn't exist at .../chromium_headless_shell-1234/...
 *     Please run the following command to download new browsers
 *
 * — a download that is not always possible, is never quick, and was unnecessary,
 * because a perfectly good Chromium was on the disk the whole time. `verify-all`
 * held a fourth copy of the launch and would therefore report the browser as
 * unavailable and skip those scripts, which is the failure that script exists to
 * shout about.
 *
 * The same family as `scripts-are-runnable.test.ts`: a check that cannot fail
 * because nothing runs it. There the cause was a missing line in
 * `package.json`; here it is a fix that was written down twice and copied to
 * neither of the places that needed it.
 *
 * **This file holds the decision and launches nothing.** It takes an
 * environment and a way to ask whether a path exists, and returns which browser
 * to use and why — so every branch is testable without a browser, a download or
 * a machine in a particular state. `scripts/lib/browser.ts` does the launching.
 */

/**
 * The places a Chromium usually is, in the order to try them.
 *
 * The first is this repository's own sandbox convention — `PLAYWRIGHT_BROWSERS_PATH`
 * points at `/opt/pw-browsers` and the build inside it is not always the one
 * Playwright's version pins. The rest are the ordinary distribution paths.
 *
 * A full Chromium is preferred to a headless shell throughout: the shell has no
 * capture backend, which `verify:recorder` needs and `verify:all` reports on
 * separately.
 */
export const CHROMIUM_CANDIDATES = [
  '/opt/pw-browsers/chromium',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/usr/bin/google-chrome',
] as const

export type ChromiumChoice =
  /** `CHROMIUM_PATH` is set and the file is there. Nothing else is consulted. */
  | { kind: 'EXPLICIT'; executablePath: string }
  /** `CHROMIUM_PATH` is set and the file is not there. A refusal, not a fallback. */
  | { kind: 'EXPLICIT_MISSING'; executablePath: string; detail: string }
  /** Nothing is set. Try Playwright's own pinned build first. */
  | { kind: 'PINNED' }
  /** The pinned build would not launch; this one is on the disk. */
  | { kind: 'CANDIDATE'; executablePath: string; note: string }
  /** The pinned build would not launch and no candidate is there. */
  | { kind: 'NONE' }

/**
 * What to try first, before anything has been launched.
 *
 * An explicit path that is not there is a **refusal rather than a fallback**.
 * Somebody who set `CHROMIUM_PATH` has said which browser to use; quietly using
 * a different one would make the check pass while measuring something else, and
 * the whole reason the variable exists is `verify:recorder`, where a headless
 * shell and a full Chromium give different answers about the camera.
 */
export function chooseChromium(
  env: { CHROMIUM_PATH?: string | undefined },
  exists: (path: string) => boolean,
): ChromiumChoice {
  const explicit = env.CHROMIUM_PATH?.trim()
  if (explicit) {
    if (exists(explicit)) return { kind: 'EXPLICIT', executablePath: explicit }
    return {
      kind: 'EXPLICIT_MISSING',
      executablePath: explicit,
      detail: `CHROMIUM_PATH is set to ${explicit}, which is not there`,
    }
  }

  return { kind: 'PINNED' }
}

/**
 * What to try after Playwright's own build has refused to launch.
 *
 * Separate from the choice above because it is only reachable by having tried:
 * asking `chromium.executablePath()` and checking the filesystem was the
 * previous approach in `verify-all`, and it was wrong in the direction that
 * matters — it declared Chromium missing and skipped four scripts that then ran
 * perfectly by hand, because Playwright launches the *headless shell* in
 * headless mode and that is a different binary at a different path.
 *
 * So: launch, and only if that fails ask this.
 */
export function fallbackChromium(exists: (path: string) => boolean): ChromiumChoice {
  for (const candidate of CHROMIUM_CANDIDATES) {
    if (!exists(candidate)) continue
    return {
      kind: 'CANDIDATE',
      executablePath: candidate,
      note: `Playwright's own build is absent; using ${candidate}`,
    }
  }
  return { kind: 'NONE' }
}
