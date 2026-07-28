/**
 * Every verification in this repository, in one command.
 *
 * There are twenty-three `verify:*` scripts. Between them they drive a real
 * browser, a real Postgres, a real object-store socket, a real `pg_restore` and
 * two real servers under two different base paths — and **nothing ran them**.
 * They were wired into `package.json` and left there, which is a state that
 * degrades quietly: a script nobody runs is a script that stops working without
 * anybody finding out, and the ones here are the only proof this application has
 * for a dozen claims that no unit test can reach.
 *
 * A previous entry recorded why this was not written as a one-liner:
 *
 *   > *"There is no command that runs every verification in turn, and with
 *   > twenty-three of them there probably should be — but several need a built
 *   > application and one needs an object store, so an honest `verify:all` is a
 *   > piece of work rather than a line."*
 *
 * That is what this is, and the four things that make it honest are below. (One
 * detail in that note has since stopped being true: `verify:object-store` runs
 * against `FakeS3`, a real socket that verifies every signature, and needs no
 * bucket and no credentials. Nothing here requires an external service.)
 *
 * ---
 *
 * **1. Serially, and that is not a performance oversight.** Every one of these
 * scripts seeds fixtures into the *same* database and deletes them by prefix
 * afterwards. Two running at once would interleave their fixtures and delete
 * each other's — and the failures that produced would be intermittent, which is
 * the worst kind. Three of them additionally bind a fixed port. So: one at a
 * time, in a declared order, with the fast ones first so a broken repository
 * says so in thirty seconds rather than in thirty minutes.
 *
 * **2. It builds once, rather than five times.** Five of these start a server
 * from `.next`, and each would otherwise want its own build. This checks for a
 * build up front and produces one if there is none — and it deliberately does
 * **not** rebuild when one already exists, because a stale build is the caller's
 * decision to make and silently discarding one they were mid-way through
 * examining is not this script's business. It says which it did.
 *
 * **3. A prerequisite is proved by using it, never by looking for it.** The
 * first version of the browser check compared `chromium.executablePath()` against
 * the filesystem and declared Chromium missing on a machine where all four
 * browser scripts then ran perfectly by hand — a check that guesses turns a
 * working run into a skip. The camera check has the same shape and a sharper
 * edge: `typeof navigator.mediaDevices.getUserMedia` is `function` in the very
 * browser that throws on every call. So the browser is launched and the camera is
 * opened, and the answers are the real ones.
 *
 * **4. Nothing is skipped silently.** A prerequisite that is missing produces a
 * named skip with the reason and the fix, the skipped script is listed in the
 * summary, and the exit code is **still zero only if nothing failed and nothing
 * was skipped**. A run that quietly covered eighteen of twenty-three and printed
 * a green total is precisely the shape this repository has been caught by
 * repeatedly, and it would be worse here than anywhere else — this is the
 * command somebody runs before a release.
 *
 *   pnpm verify:all              every verification
 *   pnpm verify:all media qa     only the ones whose name contains one of these
 */

import 'dotenv/config'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

/** What a script needs before it can run at all. */
type Prerequisite =
  /** Starts a server from `.next`. */
  | 'BUILD'
  /** Drives Chromium through Playwright. */
  | 'BROWSER'
  /**
   * Needs a browser that can actually capture, which is **not** the same as
   * needing a browser.
   *
   * Playwright launches `chrome-headless-shell` in headless mode. It exposes
   * `navigator.mediaDevices.getUserMedia` — so a check for the API's presence
   * passes — and every call to it throws `NotSupportedError: Not supported`,
   * because the shell has no capture backend and
   * `--use-fake-device-for-media-stream` does not give it one. The full Chromium
   * build has one and returns a synthetic stream.
   *
   * That cost this repository a confusing half-hour twice: `verify:recorder`
   * timed out waiting for a *Start recording* button that could never appear,
   * and `verify:viewport` reported one failure out of 532 with the detail
   * `NotSupportedError: Not supported`, which reads like the application
   * refusing rather than the browser being unable. Both are green under a full
   * Chromium. So it is checked, up front, by making the call.
   */
  | 'CAMERA'
  /** Shells out to `pg_dump` and `pg_restore`. */
  | 'PG_TOOLS'

interface Verification {
  /** The `package.json` script, without the `verify:` prefix. */
  name: string
  /** What it proves. One line, for the summary. */
  proves: string
  needs?: readonly Prerequisite[]
}

/**
 * Ordered deliberately: the ones that need no build and no browser first, so a
 * repository that is broken in an ordinary way fails fast; then the object
 * store, the restore, and the four browser-driven scripts last, which are the
 * slow ones.
 *
 * `acceptance` is not here. It prints the §22 table rather than checking
 * anything, and a command that runs every *verification* should not also print a
 * document. `pnpm acceptance` remains its own thing.
 */
const VERIFICATIONS: readonly Verification[] = [
  { name: 'reminders', proves: 'the reminder window, the cap and the lock' },
  { name: 'rounds', proves: 'a round’s modes, and that no deadline closes anything on its own' },
  { name: 'register', proves: 'the interest register’s computed order and its isolation' },
  { name: 'qa', proves: 'the Q&A anonymisation rule, with a second investor present' },
  { name: 'updates', proves: 'an update reaching a portal, and the notification that follows' },
  { name: 'certificate', proves: 'the participation certificate, rendered and read back' },
  { name: 'acknowledgements', proves: 'the acknowledgement wording and what it records' },
  { name: 'email-change', proves: 'an investor changing their address, both halves of it' },
  { name: 'lifecycle', proves: 'suspension, closure and read-only sign-in' },
  { name: 'erasure', proves: 'an investor erased, with a second investor present and untouched' },
  { name: 'export', proves: 'the CSV and XLSX exports, and that no secret is in one' },
  { name: 'documents', proves: 'a document package issued, served and revoked' },
  { name: 'roadmap', proves: 'the portal roadmap tiles' },
  { name: '2fa', proves: 'the second factor, enrolled and demanded' },
  { name: 'health', proves: 'the health endpoint, present and absent' },
  { name: 'media', proves: 'ingest, metadata stripping and serving, against a real store' },
  { name: 'object-store', proves: 'the S3 client against a real socket that verifies signatures' },
  { name: 'restore', proves: 'a dump restored into a scratch database and read back', needs: ['PG_TOOLS'] },
  { name: 'memory', proves: 'what the server holds after a long run', needs: ['BUILD'] },
  { name: 'deployment', proves: 'every route, link and header under a base path', needs: ['BUILD'] },
  { name: 'account-access', proves: 'who can reach what, driven in a browser', needs: ['BUILD', 'BROWSER'] },
  { name: 'uploads', proves: 'every upload limit, from a browser, at its real size', needs: ['BUILD', 'BROWSER'] },
  { name: 'erasure-bytes', proves: 'an erasure destroying real bytes, pressed in a browser', needs: ['BUILD', 'BROWSER'] },
  { name: 'recorder', proves: 'the video recorder, recording and playing back', needs: ['BUILD', 'BROWSER', 'CAMERA'] },
  { name: 'viewport', proves: 'every screen at 375px, in a real browser', needs: ['BUILD', 'BROWSER', 'CAMERA'] },
  // Last, and that is not cosmetic. It runs other verifications with the code
  // deliberately broken, so those runs *fail on purpose* — and a script that
  // fails part way through may not reach its own cleanup, leaving fixture rows
  // in the database. Every script clears its own prefix on the way in, so
  // residue in front of a script that has not run yet is the only way that can
  // bite. Running this after all of them means there is never one in front.
  { name: 'mutants', proves: 'that the checks fail when the claims they check stop being true' },
]

interface Outcome {
  name: string
  status: 'passed' | 'failed' | 'skipped'
  /** The script's own `N passed, M failed` line, when it printed one. */
  tally: string
  reason: string
  seconds: number
}

// ---------------------------------------------------------------------------

function run(script: string): Promise<{ code: number; output: string }> {
  return new Promise((resolve) => {
    const child = spawn('pnpm', ['run', script], {
      cwd: process.cwd(),
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let output = ''
    const collect = (chunk: Buffer) => {
      const text = chunk.toString()
      output += text
      // Passed straight through. A command that runs for half an hour behind a
      // spinner is a command people stop running.
      process.stdout.write(text)
    }
    child.stdout.on('data', collect)
    child.stderr.on('data', collect)

    child.on('close', (code) => resolve({ code: code ?? 1, output }))
  })
}

/** The `N passed, M failed` line these scripts all end with, if it is there. */
function tallyOf(output: string): string {
  const lines = output.trim().split('\n')
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const match = /(\d+) passed, (\d+) failed/.exec(lines[i]!)
    if (match) return `${match[1]} passed, ${match[2]} failed`
  }
  return ''
}

/**
 * Whether a browser can be launched — asked by launching one.
 *
 * The first version of this checked `chromium.executablePath()` against the
 * filesystem, and it was **wrong in the direction that matters**: it declared
 * Chromium missing and skipped four scripts that then ran perfectly when invoked
 * by hand. Playwright launches the *headless shell* in headless mode, which is a
 * different binary at a different path, and `executablePath()` names neither
 * reliably once `PLAYWRIGHT_BROWSERS_PATH` or a channel is in play.
 *
 * A prerequisite check that guesses is worse than no check: it turns a run that
 * would have succeeded into a skip, and a skip here is the thing this script
 * shouts about. So it does what the scripts themselves do — launch, and close.
 * A second or so, and the answer is the real one.
 */
async function browserPrerequisites(): Promise<{
  browser: { ok: boolean; detail: string }
  camera: { ok: boolean; detail: string }
}> {
  /*
   * Through the same launcher the scripts use, which is the point.
   *
   * This used to hold a fourth copy of the launch, honouring `CHROMIUM_PATH`
   * and nothing else — so on a machine whose Chromium is numbered differently
   * from Playwright's pin it reported the browser as unavailable and skipped
   * four scripts that `launchChromium` would have run. A preflight that
   * disagrees with the thing it is gating is worse than no preflight.
   */
  try {
    const { launchChromium } = await import('./lib/browser')
    const browser = await launchChromium({
      // The same synthetic device `verify:recorder` asks for, and deliberately
      // NOT `--use-fake-ui-for-media-stream`, which auto-accepts a request a
      // Permissions-Policy header has already refused.
      args: ['--use-fake-device-for-media-stream'],
    })
    const version = browser.version()

    /*
     * The capture call, on a secure origin, without a server.
     *
     * `getUserMedia` is unavailable outside a secure context, and `localhost` is
     * one — so the page is navigated there and every request is fulfilled from
     * memory. Asking `typeof navigator.mediaDevices.getUserMedia` would not do:
     * the headless shell reports a function and throws on every call.
     */
    let camera: { ok: boolean; detail: string }
    try {
      const context = await browser.newContext()
      await context.grantPermissions(['camera', 'microphone'], { origin: 'http://localhost' })
      const page = await context.newPage()
      await page.route('**/*', (route) =>
        route.fulfill({ body: '<html></html>', contentType: 'text/html' }),
      )
      await page.goto('http://localhost/')
      const outcome = await page.evaluate(async () => {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ video: true })
          for (const track of stream.getTracks()) track.stop()
          return 'ok'
        } catch (error) {
          return error instanceof Error ? `${error.name}: ${error.message}` : String(error)
        }
      })
      await context.close()
      camera =
        outcome === 'ok'
          ? { ok: true, detail: 'a synthetic camera opens' }
          : {
              ok: false,
              detail:
                `this browser cannot capture (${outcome}) — Playwright's headless shell has no ` +
                'capture backend; set CHROMIUM_PATH to a full Chromium build',
            }
    } catch (error) {
      camera = {
        ok: false,
        detail: `the camera could not be tested (${error instanceof Error ? error.message.split('\n')[0] : String(error)})`,
      }
    }

    await browser.close()
    return { browser: { ok: true, detail: `Chromium ${version} launches` }, camera }
  } catch (error) {
    const message = error instanceof Error ? error.message.split('\n')[0] : String(error)
    const detail = `Chromium will not launch (${message}) — try \`pnpm exec playwright install chromium\`, or set CHROMIUM_PATH`
    return { browser: { ok: false, detail }, camera: { ok: false, detail } }
  }
}

function havePgTools(): Promise<{ ok: boolean; detail: string }> {
  return new Promise((resolve) => {
    const child = spawn('pg_restore', ['--version'], { stdio: 'ignore' })
    child.on('error', () =>
      resolve({
        ok: false,
        detail: 'pg_restore is not on PATH — install the PostgreSQL client tools',
      }),
    )
    child.on('close', (code) =>
      resolve(
        code === 0
          ? { ok: true, detail: 'pg_restore is on PATH' }
          : { ok: false, detail: `pg_restore exited ${code}` },
      ),
    )
  })
}

// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const filters = process.argv.slice(2).filter((argument) => !argument.startsWith('-'))
  const selected = VERIFICATIONS.filter(
    (verification) =>
      filters.length === 0 || filters.some((filter) => verification.name.includes(filter)),
  )

  if (selected.length === 0) {
    console.log(`\nNothing matched ${filters.join(', ')}. The names are:\n`)
    for (const verification of VERIFICATIONS) console.log(`  ${verification.name}`)
    process.exitCode = 1
    return
  }

  console.log('\nEvery verification, one at a time\n')
  if (filters.length > 0) {
    console.log(`  Filtered to: ${selected.map((s) => s.name).join(', ')}\n`)
  }

  // -- prerequisites, once, up front ---------------------------------------

  const wanted = new Set(selected.flatMap((verification) => verification.needs ?? []))
  const available = new Map<Prerequisite, { ok: boolean; detail: string }>()

  if (wanted.has('BUILD')) {
    const built = existsSync(join(process.cwd(), '.next', 'BUILD_ID'))
    if (built) {
      console.log('  build      using the existing .next — delete it to force a fresh one')
      available.set('BUILD', { ok: true, detail: 'existing .next' })
    } else {
      console.log('  build      no .next — building once, for the five scripts that need one')
      const { code } = await run('build')
      available.set('BUILD', {
        ok: code === 0,
        detail: code === 0 ? 'built here' : `pnpm build exited ${code}`,
      })
    }
  }

  if (wanted.has('BROWSER') || wanted.has('CAMERA')) {
    const { browser, camera } = await browserPrerequisites()
    console.log(`  browser    ${browser.detail}`)
    console.log(`  camera     ${camera.detail}`)
    available.set('BROWSER', browser)
    available.set('CAMERA', camera)
  }

  if (wanted.has('PG_TOOLS')) {
    const tools = await havePgTools()
    console.log(`  pg tools   ${tools.detail}`)
    available.set('PG_TOOLS', tools)
  }

  console.log('')

  // -- the run --------------------------------------------------------------

  const outcomes: Outcome[] = []

  for (const verification of selected) {
    const missing = (verification.needs ?? []).filter(
      (need) => available.get(need)?.ok !== true,
    )

    if (missing.length > 0) {
      const reason = missing
        .map((need) => available.get(need)?.detail ?? `${need} is unavailable`)
        .join('; ')
      console.log(`\n━━ verify:${verification.name} — SKIPPED — ${reason}\n`)
      outcomes.push({
        name: verification.name,
        status: 'skipped',
        tally: '',
        reason,
        seconds: 0,
      })
      continue
    }

    console.log(`\n━━ verify:${verification.name} — ${verification.proves}\n`)
    const startedAt = process.hrtime.bigint()
    const { code, output } = await run(`verify:${verification.name}`)
    const seconds = Number(process.hrtime.bigint() - startedAt) / 1e9

    outcomes.push({
      name: verification.name,
      status: code === 0 ? 'passed' : 'failed',
      tally: tallyOf(output),
      reason: code === 0 ? '' : `exited ${code}`,
      seconds,
    })
  }

  // -- the summary ----------------------------------------------------------

  console.log('\n\n════════════════════════════════════════════════════════════')
  console.log('Every verification\n')

  const width = Math.max(...outcomes.map((outcome) => outcome.name.length))
  for (const outcome of outcomes) {
    const label =
      outcome.status === 'passed' ? 'ok   ' : outcome.status === 'failed' ? 'FAIL ' : 'SKIP '
    const detail =
      outcome.status === 'skipped'
        ? outcome.reason
        : `${outcome.tally || 'no tally printed'}${outcome.reason ? ` — ${outcome.reason}` : ''}`
    console.log(
      `  ${label} ${outcome.name.padEnd(width)}  ${`${outcome.seconds.toFixed(0)}s`.padStart(5)}  ${detail}`,
    )
  }

  const failed = outcomes.filter((outcome) => outcome.status === 'failed')
  const skipped = outcomes.filter((outcome) => outcome.status === 'skipped')
  const passed = outcomes.filter((outcome) => outcome.status === 'passed')

  const total = outcomes.reduce((sum, outcome) => sum + outcome.seconds, 0)
  console.log(
    `\n  ${passed.length} passed, ${failed.length} failed, ${skipped.length} skipped` +
      ` — ${Math.round(total / 60)} minutes\n`,
  )

  /**
   * A skip is not a pass.
   *
   * The temptation is to exit zero when nothing actually failed, and it is the
   * wrong call for the one command somebody runs before a release: a machine
   * without Chromium would report success while four of the scripts — including
   * every screen at 375px — never ran. The summary above names each skip and its
   * fix; the exit code refuses to call the run complete.
   */
  if (failed.length > 0 || skipped.length > 0) {
    if (skipped.length > 0 && failed.length === 0) {
      console.log('  Nothing failed, but the run was not complete. Each skip is named above.\n')
    }
    process.exitCode = 1
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
