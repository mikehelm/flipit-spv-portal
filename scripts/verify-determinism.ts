/**
 * Is a second run the same as the first?
 *
 * ## Why this exists
 *
 * `pnpm verify:all` failed **once**, in the middle of three runs that passed.
 * The cause was found — `verify:mutants` runs other verifications with the code
 * deliberately broken, those runs fail on purpose, a script that fails part way
 * through may not reach its own cleanup, and it was sitting in front of ten
 * scripts that had not run yet — and it was fixed by moving it last.
 *
 * The entry that recorded all that also recorded the uncomfortable part: ***it
 * was found by luck.*** One run in three. Nothing here runs anything twice, and
 * an ordering hazard that shows up a third of the time is invisible to a single
 * run. Four entries later, nothing measures it.
 *
 * This does, in two ways, because the flake had two halves.
 *
 * ## 1. Repeatability
 *
 * Every database-backed verification that needs no build and no browser, run
 * **twice, back to back**, with the two tallies compared. A script whose second
 * run differs from its first is either leaving something behind or depending on
 * something it did not create — and both are the shape of the defect that
 * produced the flake.
 *
 * A tally, not an exit code. `35 passed, 0 failed` twice is the claim; two runs
 * that both exit zero while checking different numbers of things is exactly what
 * a fixture leaking between runs looks like.
 *
 * ## 2. A run that never reached its cleanup
 *
 * The repair rests on a stated invariant: *every script clears its own prefix on
 * the way in, so residue only bites a script that has not run yet.* That
 * sentence is load-bearing — it is the entire reason moving one entry to the end
 * of a list is a sufficient fix — and **nothing tested it**.
 *
 * So: start a script, wait until it is demonstrably mid-run, `SIGKILL` it, and
 * run it again to completion. No cleanup ran, its rows are still in the
 * database, and the second run must pass anyway. A script that clears on the way
 * *out* only would fail here, and the ordering fix would be resting on
 * something untrue.
 *
 * `SIGKILL` rather than `SIGTERM` deliberately: a handler that tidies up on the
 * way down is a different mechanism, and this is testing the one the invariant
 * names.
 *
 *   pnpm verify:determinism
 */

import 'dotenv/config'
import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Which file a verification's name actually runs.
 *
 * Not `scripts/verify-<name>.ts`. The first draft assumed that and `verify:2fa`
 * — which runs `scripts/verify-second-factor.ts` — failed three checks with an
 * unreadable tally. The assumption was wrong about one of twenty-six, which is
 * the ratio that makes an assumption dangerous rather than obviously broken.
 *
 * `package.json` is where the mapping actually lives, so this reads it.
 */
const SCRIPTS = (
  JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')) as {
    scripts: Record<string, string>
  }
).scripts

function fileFor(name: string): string {
  const command = SCRIPTS[`verify:${name}`]
  const path = command ? /tsx (scripts\/[\w-]+\.ts)/.exec(command)?.[1] : undefined
  if (!path) throw new Error(`verify:${name} is not a tsx script in package.json`)
  return path
}

let passed = 0
let failed = 0

function check(label: string, condition: boolean, detail?: string): void {
  if (condition) {
    passed += 1
    console.log(`  ok    ${label}`)
  } else {
    failed += 1
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

/**
 * The scripts run twice.
 *
 * Every verification that touches the database and needs neither a build nor a
 * browser. The build-and-browser ones are excluded for time, not because they
 * are exempt — each takes between fourteen and eighty seconds, and doubling all
 * five would put this command past four minutes and out of the habit of being
 * run. **That is a bounded gap and it is stated rather than implied.**
 */
const REPEATED = [
  'reminders',
  'rounds',
  'register',
  'qa',
  'updates',
  'certificate',
  'acknowledgements',
  'email-change',
  'lifecycle',
  'erasure',
  'export',
  'documents',
  'roadmap',
  '2fa',
] as const

/**
 * The scripts interrupted.
 *
 * Five, chosen for the shape of what they leave behind rather than for
 * coverage: two investors and a shared page (`qa`), an erasure with a
 * neighbour (`erasure`), an account moving through three states
 * (`lifecycle`), an issued package (`documents`), and a feed with targeted
 * rows in it (`updates`).
 */
const INTERRUPTED = ['qa', 'updates', 'lifecycle', 'documents', 'erasure'] as const

interface Run {
  code: number
  out: string
}

function runToCompletion(name: string): Promise<Run> {
  return new Promise((resolve) => {
    const child = spawn('pnpm', ['tsx', fileFor(name)], {
      cwd: process.cwd(),
      env: process.env,
    })
    let out = ''
    child.stdout.on('data', (chunk: Buffer) => (out += chunk.toString()))
    child.stderr.on('data', (chunk: Buffer) => (out += chunk.toString()))
    child.on('close', (code) => resolve({ code: code ?? 1, out }))
  })
}

/**
 * Start a script and kill it, hard, once it is demonstrably mid-run.
 *
 * "Demonstrably" is the whole difficulty. A fixed delay either kills a script
 * that has not started writing yet — proving nothing, since there is no residue
 * — or lands after a fast one has already finished and cleaned up. So it waits
 * for the script's **own output** to show that it has begun checking things, and
 * kills on the line after that.
 *
 * Returns how much output it had produced, so a run that was killed before it
 * started can be told apart from one that was killed in the middle.
 */
function runAndKill(name: string): Promise<{ lines: number; killed: boolean }> {
  return new Promise((resolve) => {
    const child = spawn('pnpm', ['tsx', fileFor(name)], {
      cwd: process.cwd(),
      env: process.env,
      detached: true,
    })

    let out = ''
    let killed = false
    const stop = (): void => {
      if (killed) return
      killed = true
      // The whole group: `pnpm` spawns `tsx`, and killing the parent alone
      // leaves the child running against the database this is about to reuse.
      try {
        process.kill(-child.pid!, 'SIGKILL')
      } catch {
        child.kill('SIGKILL')
      }
    }

    child.stdout.on('data', (chunk: Buffer) => {
      out += chunk.toString()
      // Three `ok` lines means fixtures are written and checks are running.
      if ((out.match(/ {2}ok {4}/g) ?? []).length >= 3) stop()
    })
    child.stderr.on('data', (chunk: Buffer) => (out += chunk.toString()))

    // A ceiling, so a script that never prints cannot hang this.
    const ceiling = setTimeout(stop, 30_000)

    child.on('close', () => {
      clearTimeout(ceiling)
      resolve({ lines: (out.match(/ {2}ok {4}/g) ?? []).length, killed })
    })
  })
}

/** `35 passed, 0 failed` — the line every verification ends with. */
function tallyOf(out: string): string | null {
  const match = /(\d+) passed, (\d+) failed/.exec(out.split('\n').slice(-6).join('\n'))
  return match ? `${match[1]} passed, ${match[2]} failed` : null
}

/**
 * A filter, so one verification can be asked about on its own.
 *
 * `pnpm verify:determinism qa` is fifteen seconds where the whole command is
 * five minutes. That matters for one caller in particular: `verify:mutants`
 * breaks a script's entry-time cleanup and asks whether this notices, and a
 * mutation that costs five minutes is a mutation somebody deletes.
 */
const only = process.argv.slice(2).filter((argument) => !argument.startsWith('-'))
const wanted = (name: string): boolean => only.length === 0 || only.includes(name)

async function main(): Promise<void> {
  console.log('\nIs a second run the same as the first?\n')

  console.log('Twice, back to back')

  for (const name of REPEATED.filter(wanted)) {
    const first = await runToCompletion(name)
    const second = await runToCompletion(name)

    const firstTally = tallyOf(first.out)
    const secondTally = tallyOf(second.out)

    // The control on this whole section: a script whose tally cannot be read
    // would compare `null` against `null` and report agreement.
    check(`${name}: both runs reported a tally`, firstTally !== null && secondTally !== null)

    check(
      `${name}: the second run checks what the first did`,
      firstTally !== null && firstTally === secondTally,
      `${firstTally ?? 'unreadable'} then ${secondTally ?? 'unreadable'}`,
    )
    check(
      `${name}: and both passed`,
      first.code === 0 && second.code === 0,
      `exit ${first.code} then ${second.code}`,
    )
  }

  console.log('\nA run that never reached its cleanup')

  for (const name of INTERRUPTED.filter(wanted)) {
    const interrupted = await runAndKill(name)

    // Killed after it started writing, or the rest of this proves nothing: a
    // script killed before its first fixture leaves no residue to survive.
    check(
      `${name}: was killed mid-run, with fixtures already written`,
      interrupted.killed && interrupted.lines >= 3,
      `${interrupted.lines} checks had run`,
    )

    const after = await runToCompletion(name)
    check(
      `${name}: runs clean over its own leftovers`,
      after.code === 0,
      tallyOf(after.out) ?? `exit ${after.code}`,
    )
  }

  // A filter that matched nothing would otherwise print `0 passed, 0 failed`
  // and exit zero, which is a clean bill of health for a run that did not
  // happen. Every other vacuity in this repository was found the hard way.
  if (passed + failed === 0) {
    console.log(`\n  FAIL  nothing matched ${only.join(', ')}. The names are:`)
    console.log(`        ${[...new Set([...REPEATED, ...INTERRUPTED])].join(', ')}\n`)
    process.exitCode = 1
    return
  }

  console.log(`\n${passed} passed, ${failed} failed\n`)
  if (failed > 0) process.exitCode = 1
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => process.exit())
