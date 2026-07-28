/**
 * The three journeys that belong to an account rather than to a role, driven in
 * a real browser. BUILD_SPEC §2, §2.2.
 *
 * This script exists because of what it found the first time it was written.
 * Two infinite redirects were live in this application at once, and a unit
 * suite of 2,312 tests was green over both of them:
 *
 *   1. `/admin/password` redirected to `/admin/password`. The page rendered
 *      inside the admin shell, and the shell guards itself with
 *      `requireReader()`, which sends an account with no password to the
 *      password page — including a request for the password page. So **every**
 *      administrator redeeming their first setup link, the owner included,
 *      bounced for ever and could never choose a password in a browser. §2.2's
 *      "First run" is the only route by which a password enters this system.
 *   2. `/admin/no-access` redirected to `/admin/no-access`, because it guarded
 *      itself with `requireAdmin()` — the check that sends a viewer *to*
 *      `/admin/no-access`. The only role that would ever be sent there was the
 *      one role that could not read it. Each hop wrote an `access.refused`
 *      audit row: an unbounded write driven by one click.
 *
 * Neither is visible in a file. Each guard is correct where it is written, and
 * the fault is in the pairing of a page with the shell above it. A unit test can
 * now prove the property — `redirect-loops.test.ts` models the redirect graph
 * per account state — but a model is a model. This drives Chromium, follows
 * the redirects a browser actually follows, and types into the actual form.
 *
 * It also covers the third thing that was wrong and had no symptom at all:
 * `VIEWER_EMAILS` is documented as a one-line grant, and the seed created rows
 * for the two privileged lists only. An address added to it resolved to the
 * `VIEWER` role, passed the allowlist, reached the credential store, found no
 * row, and was refused with `INVALID_CREDENTIALS` — deliberately
 * indistinguishable from a wrong password. The role was complete in every other
 * respect and could not sign in at all.
 *
 * It creates its own accounts under an obvious address and removes them at the
 * end. Run it against a development database only, with the app built:
 *
 *   pnpm build && pnpm verify:account-access
 *
 * It sends no email. Nothing here touches the mail transport.
 */

import 'dotenv/config'
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { and, eq, inArray } from 'drizzle-orm'
import { chromium, type Browser, type Page } from 'playwright'
import { db } from '@/db'
import {
  auditEvents,
  emailReviewProposals,
  operatorInvites,
  sessions,
  users,
} from '@/db/schema'
import { issueAdminSetupLink } from '@/lib/auth/bootstrap'
import { hashPassword } from '@/lib/auth/password'
import { onScreen } from '@/lib/verify/page-text'

const PORT = 3213
const ORIGIN = `http://127.0.0.1:${PORT}`

/**
 * A viewer address that is nobody's. It is added to `VIEWER_EMAILS` for the
 * server this script starts and for no other process, so a run cannot grant
 * sight of the investor register to an address that outlives it.
 */
const VIEWER_EMAIL = 'verify-account-access@example.invalid'

/** An owner from the allowlist, whose password is reset and restored. */
const OWNER_EMAIL = (process.env.OWNER_EMAILS ?? '').split(',')[0]?.trim() ?? ''

const CHOSEN_PASSWORD = 'verify account access not a real password'

let passed = 0
let failed = 0
let serverOutput: () => string = () => ''

function check(label: string, condition: boolean, detail?: string): void {
  if (condition) {
    passed += 1
    console.log(`  ok    ${label}`)
  } else {
    failed += 1
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

// ---------------------------------------------------------------------------
// The server
// ---------------------------------------------------------------------------

async function startServer(): Promise<ChildProcess> {
  const child = spawn('node_modules/.bin/next', ['start', '--port', String(PORT)], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(PORT),
      APP_URL: ORIGIN,
      BASE_PATH: '',
      // The grant, for this process only.
      VIEWER_EMAILS: VIEWER_EMAIL,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  })

  let output = ''
  child.stdout?.on('data', (b: Buffer) => (output += b.toString()))
  child.stderr?.on('data', (b: Buffer) => (output += b.toString()))
  serverOutput = () => output

  let exited = false
  child.on('exit', (code, signal) => {
    exited = true
    output += `\n[the server process exited: code=${code} signal=${signal}]\n`
  })

  const deadline = Date.now() + 60_000
  while (Date.now() < deadline) {
    if (exited) throw new Error(`The server exited before it was ready:\n${output}`)
    try {
      const response = await fetch(`${ORIGIN}/verify`)
      if (response.status < 500) return child
    } catch {
      // Not listening yet.
    }
    await new Promise((r) => setTimeout(r, 500))
  }

  child.kill('SIGTERM')
  throw new Error(`The server did not answer within 60 seconds:\n${output}`)
}

// ---------------------------------------------------------------------------
// The measurement that matters: did the browser settle?
// ---------------------------------------------------------------------------

/**
 * Ask for a path and report where the browser ended up.
 *
 * A loop shows up here as a navigation error rather than as a wrong URL:
 * Chromium gives up with `ERR_TOO_MANY_REDIRECTS` after twenty hops. That is
 * exactly the symptom a person would have met, so it is the symptom this
 * measures rather than counting 307s from outside.
 */
async function land(page: Page, path: string): Promise<string> {
  try {
    await page.goto(`${ORIGIN}${path}`, { waitUntil: 'domcontentloaded', timeout: 15_000 })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (/TOO_MANY_REDIRECTS/i.test(message)) return 'LOOP'
    throw error
  }
  return new URL(page.url()).pathname
}

async function signInWithPassword(page: Page, email: string, password: string) {
  await page.goto(`${ORIGIN}/signin`, { waitUntil: 'domcontentloaded' })
  await page.fill('input[name="email"]', email)
  await page.fill('input[name="password"]', password)
  await Promise.all([
    page.waitForLoadState('networkidle'),
    page.click('button[type="submit"]'),
  ])
}

// ---------------------------------------------------------------------------
// Journeys
// ---------------------------------------------------------------------------

/**
 * First run: redeem a setup link, land on the password page, choose a password,
 * and sign in with it. Every step of this was unreachable.
 */
async function firstRun(browser: Browser, email: string): Promise<void> {
  console.log(`\nFirst run — ${email}`)

  const context = await browser.newContext()
  const page = await context.newPage()

  const link = await issueAdminSetupLink(email)
  const token = new URL(link.url).searchParams.get('token') ?? ''

  const afterRedeem = await land(page, `/api/auth/setup?token=${encodeURIComponent(token)}`)
  check(
    'redeeming the setup link settles on a page',
    afterRedeem !== 'LOOP',
    'the browser gave up following redirects',
  )
  check(
    'and that page is where a password is chosen',
    afterRedeem === '/admin/password',
    `landed on ${afterRedeem}`,
  )

  const heading = await page.textContent('h1').catch(() => null)
  check(
    'the form offers a first password rather than a change',
    (heading ?? '').toLowerCase().includes('choose'),
    `heading was ${JSON.stringify(heading)}`,
  )
  check(
    'no current-password field, since there is no current password',
    (await page.locator('input[name="currentPassword"]').count()) === 0,
  )

  // The shell it renders in must not be the admin shell — that is what looped.
  check(
    'it does not render the admin navigation it cannot use',
    (await page.locator('nav[aria-label="Admin sections"]').count()) === 0,
  )

  await page.fill('input[name="newPassword"]', CHOSEN_PASSWORD)
  await page.fill('input[name="confirmation"]', CHOSEN_PASSWORD)
  // Scoped to the password form. The shell's sign-out control is also a submit
  // button and comes first in the document, so an unscoped click signs out —
  // which looks exactly like success, because both end at `/signin`. That is
  // how this check passed while writing no password at all.
  await Promise.all([
    page.waitForLoadState('networkidle'),
    page.click('form:has(input[name="newPassword"]) button[type="submit"]'),
  ])

  check(
    'choosing it signs every session out, as §2.2 requires',
    new URL(page.url()).pathname === '/signin',
    `landed on ${new URL(page.url()).pathname}`,
  )

  const stored = await db.query.users.findFirst({ where: eq(users.email, email) })
  check('and the verifier was actually written', stored?.passwordHash != null)

  await signInWithPassword(page, email, CHOSEN_PASSWORD)
  check(
    'the chosen password then signs in',
    new URL(page.url()).pathname === '/admin',
    `landed on ${new URL(page.url()).pathname}`,
  )

  await context.close()
}

/**
 * A read-only administrator: can sign in at all, can reach their own account,
 * is refused the owner's surfaces without spinning, and sees no more than §20
 * scope B allows.
 */
async function viewer(browser: Browser): Promise<void> {
  console.log(`\nRead-only administrator — ${VIEWER_EMAIL}`)

  const context = await browser.newContext()
  const page = await context.newPage()

  await signInWithPassword(page, VIEWER_EMAIL, CHOSEN_PASSWORD)
  check(
    'a viewer can sign in',
    new URL(page.url()).pathname === '/admin',
    `landed on ${new URL(page.url()).pathname}`,
  )

  const banner = await onScreen(page)
  check('and is told plainly that the session is read-only', banner.includes('read-only access'))

  // The refusal page — the second loop.
  const refused = await land(page, '/compliance')
  check(
    'an owner-only page refuses without spinning',
    refused !== 'LOOP',
    'the browser gave up following redirects',
  )
  check(
    'and the refusal lands on the page written for it',
    refused === '/admin/no-access',
    `landed on ${refused}`,
  )

  const refusalText = await onScreen(page)
  check(
    'which renders, and names the role correctly',
    refusalText.includes('read-only') && refusalText.includes(VIEWER_EMAIL),
  )

  // One click, one audit row. The loop wrote one per hop.
  const before = await db
    .select({ id: auditEvents.id })
    .from(auditEvents)
    .where(eq(auditEvents.action, 'access.refused'))
  await land(page, '/audit')
  const after = await db
    .select({ id: auditEvents.id })
    .from(auditEvents)
    .where(eq(auditEvents.action, 'access.refused'))
  check(
    'a refused request writes exactly one audit row',
    after.length - before.length === 1,
    `${after.length - before.length} rows`,
  )

  // The account's own surfaces, which were closed to this role.
  const security = await land(page, '/admin/security')
  check(
    'a viewer reaches their own two-factor page',
    security === '/admin/security',
    `landed on ${security}`,
  )
  check(
    'and it offers enrolment rather than a refusal',
    (await page.locator('form:has(input[name="code"]) button[type="submit"]').count()) +
      (await page.getByText('Set it up').count()) >
      0,
  )

  const password = await land(page, '/admin/password')
  check(
    'and their own password page',
    password === '/admin/password',
    `landed on ${password}`,
  )

  // The complete Graham rehearsal: the private comparison, one bounded AI
  // question, a browser-only practice proposal, and the synthetic investor
  // view. The proposal count is read before and after so a convincing UI card
  // cannot hide an accidental database write.
  const proposalsBefore = await db
    .select({ id: emailReviewProposals.id })
    .from(emailReviewProposals)
  const reviewWhere = await land(page, '/admin/email-review')
  const reviewText = await onScreen(page)
  check(
    'the private email review is open to a viewer',
    reviewWhere === '/admin/email-review',
    `landed on ${reviewWhere}`,
  )
  check(
    'and it clearly identifies Graham test mode',
    reviewText.includes('Graham test mode') && reviewText.includes('Guided review'),
  )

  await page.getByRole('button', { name: 'Ask AI', exact: true }).click()
  await page
    .locator('textarea[name="question"]')
    .fill('Explain this selected change and name anything that remains unverified.')
  await page.getByRole('button', { name: 'Ask about this change', exact: true }).click()
  await page.getByText(/Automated explanation/).waitFor({ timeout: 45_000 })
  check(
    'a viewer receives one selected-change AI explanation',
    (await page.getByText(/Automated explanation/).count()) === 1,
  )

  await page.getByRole('button', { name: 'Practice', exact: true }).first().click()
  await page
    .locator('textarea[name="proposedText"]')
    .fill('Synthetic browser-only wording for the read-only acceptance check.')
  await page
    .locator('textarea[name="reason"]')
    .fill('This synthetic explanation proves the practice workflow without saving.')
  await page
    .getByRole('button', { name: 'Try proposal — nothing saved', exact: true })
    .click()
  await page.getByTestId('practice-proposal').waitFor({ timeout: 10_000 })
  check(
    'the practice proposal appears in the current tab',
    (await page.getByTestId('practice-proposal').count()) === 1,
  )

  const proposalsAfter = await db
    .select({ id: emailReviewProposals.id })
    .from(emailReviewProposals)
  check(
    'and the practice proposal writes no database row',
    proposalsAfter.length === proposalsBefore.length,
    `${proposalsAfter.length - proposalsBefore.length} rows`,
  )

  await page.reload({ waitUntil: 'networkidle' })
  check(
    'reloading removes the practice proposal',
    (await page.getByTestId('practice-proposal').count()) === 0,
  )

  const demoWhere = await land(page, '/portal/demo')
  const demoText = await onScreen(page)
  check(
    'the synthetic John Doe investor view is open to a viewer',
    demoWhere === '/portal/demo' && demoText.includes('John Doe'),
    `landed on ${demoWhere}`,
  )

  // Scope B: the records are open, the levers are not.
  for (const [label, path] of [
    ['the investor register', '/investors'],
    ['the round', '/round'],
    ['the questions', '/questions'],
  ] as const) {
    const where = await land(page, path)
    check(`${label} is open to a viewer`, where === path, `landed on ${where}`)
  }

  for (const [label, path] of [
    ['the audit log', '/audit'],
    ['settings', '/admin/settings'],
    ['the compliance approval', '/compliance'],
    ['operator access', '/admin/invites'],
  ] as const) {
    const where = await land(page, path)
    check(
      `${label} is refused`,
      where === '/admin/no-access' || where === '/signin',
      `landed on ${where}`,
    )
  }

  // The import refuses in place rather than by redirect: `requireImportActor`
  // throws, and the page renders a refusal panel where the wizard would be.
  // So the check is what is on the page, not where the browser ended up — and
  // the refusal has to read as a refusal rather than as "you need to sign in",
  // which is what somebody already signed in used to be told.
  const importWhere = await land(page, '/import')
  const importText = await onScreen(page)
  check('the import renders in place', importWhere === '/import', `landed on ${importWhere}`)
  check('and shows a refusal instead of the wizard', importText.includes('Not available'))
  check(
    'which does not tell a signed-in person to sign in',
    !importText.includes('You need to sign in'),
    importText.slice(importText.indexOf('Not available'), importText.indexOf('Not available') + 160),
  )
  check(
    'and renders no upload control',
    (await page.locator('input[type="file"]').count()) === 0,
  )

  await context.close()
}

/** Every route a signed-out browser can ask for settles somewhere. */
async function signedOut(browser: Browser): Promise<void> {
  console.log('\nSigned out')

  const context = await browser.newContext()
  const page = await context.newPage()

  for (const path of [
    '/admin',
    '/admin/password',
    '/admin/no-access',
    '/admin/security',
    '/investors',
    '/compliance',
    '/signin/second-factor',
  ]) {
    const where = await land(page, path)
    check(`${path} settles`, where !== 'LOOP', 'the browser gave up following redirects')
    check(`${path} settles at the sign-in page`, where === '/signin', `landed on ${where}`)
  }

  await context.close()
}

// ---------------------------------------------------------------------------

/**
 * A Chromium Playwright will actually launch.
 *
 * Playwright pins a browser build to its own version, and a machine that has a
 * Chromium from a different pin — a shared image, a CI cache, a sandbox that
 * pre-installs one — fails with "Executable doesn't exist" and a suggestion to
 * download it, which is not always possible and is never quick. So an explicit
 * path is honoured first, then the pinned download, and only then does this
 * give up. It never downloads anything.
 *
 * `CHROMIUM_PATH` is the escape hatch. On a developer machine that has run
 * `pnpm exec playwright install`, nothing is set and the pinned build is used.
 */
async function launchBrowser(): Promise<Browser> {
  const explicit = process.env.CHROMIUM_PATH
  if (explicit) return chromium.launch({ executablePath: explicit })

  try {
    return await chromium.launch()
  } catch (error) {
    for (const candidate of [
      '/opt/pw-browsers/chromium',
      '/usr/bin/chromium',
      '/usr/bin/chromium-browser',
      '/usr/bin/google-chrome',
    ]) {
      if (!existsSync(candidate)) continue
      console.log(`  note  Playwright's own build is absent; using ${candidate}`)
      return chromium.launch({ executablePath: candidate })
    }
    throw error
  }
}

async function cleanUp(): Promise<void> {
  const row = await db.query.users.findFirst({ where: eq(users.email, VIEWER_EMAIL) })
  if (!row) return
  await db.delete(sessions).where(eq(sessions.userId, row.id))
  await db.delete(auditEvents).where(eq(auditEvents.actorUserId, row.id))
  await db.delete(operatorInvites).where(eq(operatorInvites.email, VIEWER_EMAIL))
  await db.delete(users).where(eq(users.id, row.id))
}

async function main(): Promise<void> {
  if (OWNER_EMAIL === '') {
    console.error('OWNER_EMAILS is empty, so there is no first run to verify.')
    process.exitCode = 1
    return
  }

  console.log('Account access — first run, the refusal page, and the read-only role')
  console.log(`  ${ORIGIN}\n`)

  await cleanUp()

  // The viewer row this script signs in as. Created here rather than by the
  // seed, because the seed reads the process's own VIEWER_EMAILS and this
  // address is granted only to the server started below.
  await db.insert(users).values({
    email: VIEWER_EMAIL,
    role: 'VIEWER',
    passwordHash: await hashPassword(CHOSEN_PASSWORD),
    passwordSetAt: new Date(),
  })

  // The owner's first run needs an account with no password. Whatever is there
  // now is put back at the end.
  const owner = await db.query.users.findFirst({ where: eq(users.email, OWNER_EMAIL) })
  if (!owner) {
    console.error(`No user row for ${OWNER_EMAIL}. Run \`pnpm db:seed\` first.`)
    process.exitCode = 1
    return
  }
  const restore = owner.passwordHash
  await db.update(users).set({ passwordHash: null }).where(eq(users.id, owner.id))

  const server = await startServer()
  let browser: Browser | null = null

  try {
    browser = await launchBrowser()
    await firstRun(browser, OWNER_EMAIL)
    await viewer(browser)
    await signedOut(browser)
  } finally {
    await browser?.close()
    try {
      process.kill(-server.pid!, 'SIGTERM')
    } catch {
      server.kill('SIGTERM')
    }

    await db.update(users).set({ passwordHash: restore }).where(eq(users.id, owner.id))
    await db
      .delete(operatorInvites)
      .where(
        and(eq(operatorInvites.email, OWNER_EMAIL), inArray(operatorInvites.email, [OWNER_EMAIL])),
      )
    await cleanUp()
  }

  console.log(`\n  ${passed} passed, ${failed} failed`)
  if (failed > 0) {
    console.log('\nThe server said:\n')
    console.log(serverOutput().split('\n').slice(-40).join('\n'))
    process.exitCode = 1
  }
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => process.exit())
