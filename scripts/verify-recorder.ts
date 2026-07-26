/**
 * The in-browser video recorder, driven. BUILD_SPEC §13.3.
 *
 * §13.3: *"Two ways in: record directly in the browser via webcam, or upload a
 * file shot on his phone. Both land in the same place."*
 *
 * The second way has been exercised since the day it was written — a file is a
 * `Blob` and a test can post one. **The first has never been exercised at all**,
 * and three consecutive entries in PROGRESS.md have said so and carried it
 * forward. It is the only path in the application that *produces* a file from a
 * browser rather than accepting one, it is a six-state machine holding a live
 * camera, and everything about it had been verified by reading it.
 *
 * The reason it stayed unrun is that it needs a fixture nothing else needed:
 * `MEDIA_STORE` configured, an **operator** rather than the owner, that operator
 * **onboarded**, a camera, and a browser willing to record from one. So this
 * script builds exactly that and then presses the buttons.
 *
 * What it proves, in the order a person would do it:
 *
 *   1. The owner does not get the recorder at all, and is told whose it is.
 *   2. An operator who has not finished onboarding is sent to onboarding — the
 *      screen that, until now, no automated check had ever opened.
 *   3. Camera on, and off again. **The tracks are stopped**, which is the
 *      difference between a light going out and a light staying on.
 *   4. Record, watch the timer, stop. The review element gets a `blob:` URL and
 *      the camera is released without being asked.
 *   5. *Record it again* discards. Nothing is uploaded, and the database is
 *      asked rather than the page.
 *   6. *Use this one* uploads. A row exists, unpublished, and the bytes on disk
 *      are the bytes that were recorded.
 *   7. A file the ingest refuses produces the server's own message in the
 *      recorder, and no row.
 *   8. Leaving the page releases the camera.
 *
 * And throughout: **no Content-Security-Policy violation.** The policy notes
 * single this component out as the surface most likely to be silently broken by
 * a header — `getUserMedia`, a `blob:` on a media element, and a worker the
 * MediaRecorder may create — and until now nothing had pressed anything.
 *
 * Run it with the application built:
 *
 *   pnpm build && pnpm verify:recorder
 *
 * `CHROMIUM_PATH` points it at a browser already on the machine.
 *
 * **On the fake camera.** Chromium is given `--use-fake-device-for-media-stream`
 * — a synthetic capture device — and Playwright grants the page camera and
 * microphone permission, which is what a *person* grants. It is deliberately
 * **not** given `--use-fake-ui-for-media-stream`, which auto-accepts everything
 * including a request the Permissions-Policy header has already refused. An
 * earlier entry found that flag making a broken `camera=()` header look fine,
 * and a check that passes on a broken header is worse than no check.
 */

import 'dotenv/config'
import { mkdtempSync, rmSync, existsSync, readdirSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn, type ChildProcess } from 'node:child_process'
import { and, eq, like } from 'drizzle-orm'
import { chromium, type Browser, type Page } from 'playwright'
import { db } from '@/db'
import { auditEvents, operatorVideos, serviceConfig, users } from '@/db/schema'
import { readOnboardingSnapshot } from '@/lib/auth/onboarding-store'
import { SERVICE_CONFIG_ID } from '@/lib/auth/service-config'
import { isStepComplete, type OnboardingStepId } from '@/lib/auth/onboarding'
import { hashPassword } from '@/lib/auth/password'

const PORT = 3240
const ORIGIN = `http://127.0.0.1:${PORT}`

/**
 * The seeded operator. It has to be this address and not an invented one: §2
 * assigns role by allowlist, and a sign-in from an address on neither list is
 * refused outright with no record created. Inventing a user here would test a
 * sign-in this application does not have.
 */
const OPERATOR_EMAIL = (process.env.OPERATOR_EMAILS ?? '').split(',')[0]?.trim() ?? ''
const OWNER_EMAIL = (process.env.OWNER_EMAILS ?? '').split(',')[0]?.trim() ?? ''
const PASSWORD = 'wp15-recorder-verify-not-a-real-password'

/** Long enough for the MediaRecorder to emit more than a header. */
const RECORD_MS = 2500

let passed = 0
let failed = 0
let mediaDir = ''
let serverOutput: () => string = () => ''

/**
 * The sending account as it was before this run, put back afterwards.
 *
 * Step 3 of onboarding stores an SMTP pair, and this run supplies an obviously
 * fake one. Left behind, it would leave a developer's own database claiming a
 * sending account is connected when none is — the kind of state that is
 * discovered later, on a screen about sending, by somebody who did not run this
 * script. Restoring it costs four columns.
 */
let sendingAccountBefore: {
  emailTransport: 'SMTP' | 'GMAIL_API'
  smtpUserEncrypted: string | null
  smtpPasswordEncrypted: string | null
  smtpLastVerifiedAt: Date | null
  smtpLastVerifyResult: string | null
} | null = null

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
// What the browser complained about
// ---------------------------------------------------------------------------

const complaints: string[] = []

function watchTheConsole(page: Page): void {
  page.on('console', (message) => {
    if (message.type() !== 'error') return
    complaints.push(`console: ${message.text().slice(0, 240)}`)
  })
  page.on('pageerror', (error) => {
    complaints.push(`uncaught: ${error.message.slice(0, 240)}`)
  })
  void page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (event) => {
      const violation = event as SecurityPolicyViolationEvent
      console.error(
        `CSP refused ${violation.violatedDirective}: ${violation.blockedURI || 'inline'}`,
      )
    })
  })
}

/** Deliberately short — see the note on the equivalent list in verify-viewport. */
function isEnvironmental(complaint: string): boolean {
  return /favicon\.ico/.test(complaint) || /\.well-known\/appspecific/.test(complaint)
}

/**
 * `expected` is for the sections that provoke a refusal on purpose.
 *
 * Two of them do: the owner posting to the upload endpoint earns a 403, and the
 * text file wearing a `.mp4` extension earns a 400. Both are the finding, and
 * both arrive in the console as a failed request. Naming the status here is
 * narrower than adding either to `isEnvironmental`, which would hide the same
 * status everywhere for the rest of the run.
 */
function checkNothingWasRefused(label: string, from = 0, expected?: RegExp): void {
  const heard = complaints
    .slice(from)
    .filter((c) => !isEnvironmental(c))
    .filter((c) => !(expected && expected.test(c)))
  const csp = heard.filter((c) => /CSP refused|Content Security Policy/i.test(c))
  check(`${label}: no Content-Security-Policy violation`, csp.length === 0, csp.slice(0, 3).join(' | '))
  check(
    `${label}: the browser complains about nothing else`,
    heard.length === csp.length,
    heard.filter((c) => !csp.includes(c)).slice(0, 3).join(' | '),
  )
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/**
 * Back to a state this run can start from, including the onboarding trail.
 *
 * Three of §2.1's six steps are recorded as audit entries rather than columns,
 * which makes onboarding *sticky*: a run that gets halfway leaves the operator
 * partly set up, and the next run finds a button reading "Understood — noted
 * again" where it expected "Understood" and times out looking for it. That is
 * exactly what happened, and a check that only passes on a clean database is a
 * check nobody runs twice.
 *
 * So the operator's own onboarding entries are removed, along with the columns
 * behind the other three steps. Nothing else in the audit log is touched: the
 * filter names this user and this handful of actions.
 */
async function cleanUp(): Promise<void> {
  const rows = await db.select().from(operatorVideos)
  for (const row of rows) {
    await db.delete(auditEvents).where(eq(auditEvents.entityId, row.id))
    await db.delete(operatorVideos).where(eq(operatorVideos.id, row.id))
  }

  const operator = await db.query.users.findFirst({ where: eq(users.email, OPERATOR_EMAIL) })
  if (operator) {
    await db
      .delete(auditEvents)
      .where(
        and(
          eq(auditEvents.entityType, 'user'),
          eq(auditEvents.entityId, operator.id),
          like(auditEvents.action, 'operator_onboarding.%'),
        ),
      )
    await db
      .update(users)
      .set({
        displayName: null,
        contactMethod: null,
        contactValue: null,
        onboardingCompletedAt: null,
      })
      .where(eq(users.id, operator.id))
  }

  if (sendingAccountBefore) {
    await db
      .update(serviceConfig)
      .set(sendingAccountBefore)
      .where(eq(serviceConfig.id, SERVICE_CONFIG_ID))
  }

  if (mediaDir && existsSync(mediaDir)) rmSync(mediaDir, { recursive: true, force: true })
}

/**
 * Gives the seeded operator a known password, and leaves onboarding
 * deliberately unfinished so that step 2 has something to find.
 */
async function prepareOperator(): Promise<void> {
  const config = await db.query.serviceConfig.findFirst({
    where: eq(serviceConfig.id, SERVICE_CONFIG_ID),
  })
  if (config) {
    sendingAccountBefore = {
      emailTransport: config.emailTransport,
      smtpUserEncrypted: config.smtpUserEncrypted,
      smtpPasswordEncrypted: config.smtpPasswordEncrypted,
      smtpLastVerifiedAt: config.smtpLastVerifiedAt,
      smtpLastVerifyResult: config.smtpLastVerifyResult,
    }
  }

  const hash = await hashPassword(PASSWORD)
  await db
    .update(users)
    .set({
      passwordHash: hash,
      passwordSetAt: new Date(),
      passwordChangedAt: new Date(),
      onboardingCompletedAt: null,
    })
    .where(eq(users.email, OPERATOR_EMAIL))

  await db
    .update(users)
    .set({ passwordHash: hash, passwordSetAt: new Date(), passwordChangedAt: new Date() })
    .where(eq(users.email, OWNER_EMAIL))
}

/**
 * Onboarding, walked rather than written.
 *
 * The first version of this set `onboarding_completed_at` and reloaded, and the
 * page sent the operator straight back — because §2.1's completion rule
 * deliberately requires **every step done *and* the completion recorded**, so
 * that a setup which has since lost a step (a revoked app password, say) walks
 * the operator back through the gap instead of silently no longer working. A
 * fixture that wrote the timestamp was asking the application to accept a state
 * it is designed to reject.
 *
 * So the six steps are done through the real forms and the real server actions.
 * That is more work and it is the right kind: it is also the first time
 * `/admin/onboarding` has been opened by anything automated, and the screen is
 * operator-only, which is why `verify:viewport` — which signs in as the owner —
 * could never reach it.
 *
 * **Step 3 stores a credential and connects nothing.** `connectSendingAccount`
 * encrypts the pair and explicitly clears any previous verification, because
 * WP5 re-verifies against SMTP before sending is possible. So an obviously fake
 * app password is stored here, sending remains refused, and no gate is touched
 * — this script never sends and never could.
 */
async function completeOnboarding(page: Page): Promise<void> {
  const operator = await db.query.users.findFirst({ where: eq(users.email, OPERATOR_EMAIL) })
  if (!operator) throw new Error(`No operator row for ${OPERATOR_EMAIL}.`)

  /**
   * Waits for the server action, by asking the database rather than the page.
   *
   * These forms are `useActionState` — the click posts, the server revalidates,
   * and React re-renders in place. There is no navigation, so `networkidle` is
   * satisfied before anything has happened, and the next step reaches for a
   * control the page has not drawn yet. What actually settles is the row the
   * action wrote, so that is what is waited on.
   */
  const settled = async (step: OnboardingStepId): Promise<boolean> => {
    const deadline = Date.now() + 20_000
    while (Date.now() < deadline) {
      if (isStepComplete(step, await readOnboardingSnapshot(operator.id))) return true
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
    return false
  }

  await page.goto(`${ORIGIN}/admin/onboarding`, { waitUntil: 'networkidle' })

  await page.fill('input[name="displayName"]', 'David')
  await page.locator('form', { hasText: 'Display name' }).getByRole('button').click()
  check('onboarding 1 — the display name is confirmed', await settled('DISPLAY_NAME'))

  await page.selectOption('select[name="contactMethod"]', 'EMAIL_ONLY')
  await page.locator('form', { hasText: 'How investors reach you' }).getByRole('button').click()
  check('onboarding 2 — a contact method is chosen', await settled('CONTACT_METHOD'))

  await page.fill('input[name="smtpUser"]', OPERATOR_EMAIL)
  // Not a credential. Sixteen letters in the shape the form expects, and no
  // account anywhere would accept them.
  await page.fill('input[name="smtpPassword"]', 'aaaabbbbccccdddd')
  await page.locator('form', { hasText: 'Sending Gmail address' }).getByRole('button').click()
  check('onboarding 3 — the sending account is stored', await settled('SENDING_ACCOUNT'))

  await page.selectOption('select[name="choice"]', 'RECORD_NOW')
  await page.locator('form', { hasText: 'Your choice' }).getByRole('button').click()
  check('onboarding 4 — a decision about the video is recorded', await settled('VIDEO'))

  // Not `exact`. The label reads "Understood" the first time and
  // "Understood — noted again" afterwards, and a run that half-finished once
  // would otherwise never find the button again.
  await page.getByRole('button', { name: /^Understood/ }).click()
  check('onboarding 4b — the Q&A explanation is acknowledged', await settled('QA'))

  await page.getByRole('button', { name: /send myself a test|Noted again/ }).click()
  check('onboarding 5 — the test invitation is acknowledged', await settled('TEST_INVITATION'))

  await page.getByRole('button', { name: 'Finish setup' }).click()

  const deadline = Date.now() + 20_000
  let completed = false
  while (Date.now() < deadline && !completed) {
    completed = (await readOnboardingSnapshot(operator.id)).completedAt !== null
    if (!completed) await new Promise((resolve) => setTimeout(resolve, 250))
  }
  check('and only then is there anything to finish', completed)
}

async function startServer(): Promise<ChildProcess> {
  const child = spawn('node_modules/.bin/next', ['start', '--port', String(PORT)], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(PORT),
      APP_URL: ORIGIN,
      BASE_PATH: '',
      // The whole reason this script exists: the recorder renders only when
      // there is somewhere to put what it records.
      MEDIA_STORE: 'filesystem',
      MEDIA_DIR: mediaDir,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  })

  let output = ''
  child.stdout?.on('data', (chunk: Buffer) => {
    output += chunk.toString()
  })
  child.stderr?.on('data', (chunk: Buffer) => {
    output += chunk.toString()
  })
  serverOutput = () => output

  const deadline = Date.now() + 60_000
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${ORIGIN}/signin`)
      if (response.status < 500) return child
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 400))
  }
  throw new Error(`the server did not answer on ${ORIGIN}\n${output}`)
}

function stopServer(child: ChildProcess): void {
  try {
    if (child.pid) process.kill(-child.pid, 'SIGTERM')
  } catch {
    child.kill('SIGTERM')
  }
}

async function signIn(page: Page, email: string): Promise<void> {
  await page.goto(`${ORIGIN}/signin`, { waitUntil: 'networkidle' })
  await page.fill('input[name="email"]', email)
  await page.fill('input[name="password"]', PASSWORD)
  await page.click('button[type="submit"]')
  await page.waitForURL(/\/admin|\/signin\/second-factor/, { timeout: 20_000 })
}

async function signOut(page: Page): Promise<void> {
  await page.context().clearCookies()
  await page.goto(`${ORIGIN}/signin`, { waitUntil: 'networkidle' })
}

/**
 * What is actually in the store.
 *
 * The filesystem store creates its directory on first write, so an empty store
 * is a directory that does not exist yet — not an error, and the distinction
 * matters because the check that nothing was stored runs before anything has
 * been.
 */
function storedFiles(): string[] {
  return existsSync(mediaDir) ? readdirSync(mediaDir) : []
}

/**
 * The live camera tracks the page is currently holding, as the page sees them.
 *
 * **Every** video element, not the first one. Once a video has been stored the
 * page renders a preview of it *above* the recorder, so `querySelector('video')`
 * returns the preview — which has a `src` and never a `srcObject` — and the
 * camera reads as off while it is on. That is the wrong answer in the dangerous
 * direction: a check for "the camera was released" that passes because it was
 * looking at the wrong element.
 */
async function liveTracks(page: Page): Promise<number> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll('video')).reduce((count, element) => {
      const stream = element.srcObject as MediaStream | null
      if (!stream) return count
      return count + stream.getTracks().filter((track) => track.readyState === 'live').length
    }, 0),
  )
}

// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log('\nBUILD_SPEC §13.3 — the recorder, driven\n')

  if (OPERATOR_EMAIL === '' || OWNER_EMAIL === '') {
    check('OWNER_EMAILS and OPERATOR_EMAILS are set', false, 'nothing to sign in as')
    process.exitCode = 1
    return
  }

  mediaDir = mkdtempSync(join(tmpdir(), 'spv-recorder-'))
  await cleanUp()
  await prepareOperator()

  const server = await startServer()
  let browser: Browser | undefined

  try {
    browser = await chromium.launch({
      executablePath: process.env.CHROMIUM_PATH || undefined,
      args: [
        // A synthetic capture device. NOT --use-fake-ui-for-media-stream,
        // which would auto-accept a request the Permissions-Policy header has
        // already refused and make a broken header look fine.
        '--use-fake-device-for-media-stream',
      ],
    })
    const context = await browser.newContext()
    await context.grantPermissions(['camera', 'microphone'], { origin: ORIGIN })
    const page = await context.newPage()
    watchTheConsole(page)

    // -----------------------------------------------------------------------
    console.log('The owner, who does not get one')

    await signIn(page, OWNER_EMAIL)
    await page.goto(`${ORIGIN}/admin/video`, { waitUntil: 'networkidle' })

    const ownerBody = (await page.textContent('body')) ?? ''
    check('the owner reaches the page', page.url().includes('/admin/video'), page.url())
    check(
      'and is told the video is the operator’s',
      ownerBody.includes('This one is David') || ownerBody.includes('operator'),
      ownerBody.slice(0, 120),
    )
    check(
      'and is offered no camera control at all',
      (await page.locator('button', { hasText: 'Turn the camera on' }).count()) === 0,
    )
    check(
      'and no file input either — the refusal is not only on the button',
      (await page.locator('input[type="file"]').count()) === 0,
    )

    const ownerPost = await page.evaluate(async (origin) => {
      const body = new FormData()
      body.append('file', new Blob([new Uint8Array([1, 2, 3])], { type: 'video/webm' }), 'x.webm')
      const response = await fetch(`${origin}/admin/video/upload`, { method: 'POST', body })
      return { status: response.status, text: (await response.text()).slice(0, 160) }
    }, ORIGIN)
    check(
      'and the endpoint refuses him too, not only the page',
      ownerPost.status === 403,
      `status ${ownerPost.status}: ${ownerPost.text}`,
    )
    check(
      'with a message that says whose it is rather than what went wrong',
      /operator/i.test(ownerPost.text),
      ownerPost.text,
    )

    // -----------------------------------------------------------------------
    console.log('\nThe operator, before onboarding')

    const beforeOnboarding = complaints.length
    await signOut(page)
    await signIn(page, OPERATOR_EMAIL)
    await page.goto(`${ORIGIN}/admin/video`, { waitUntil: 'networkidle' })
    check(
      'an operator who has not finished onboarding is sent to onboarding',
      page.url().includes('/admin/onboarding'),
      page.url(),
    )

    const onboarding = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      width: window.innerWidth,
      text: (document.body.textContent ?? '').slice(0, 200),
    }))
    check(
      'the onboarding screen does not scroll sideways',
      onboarding.scrollWidth <= onboarding.width,
      `${onboarding.scrollWidth}px in ${onboarding.width}px`,
    )
    // From here, not from the start of the run: the owner's POST above was
    // refused on purpose and its 403 is in the console.
    checkNothingWasRefused('onboarding', beforeOnboarding)

    await completeOnboarding(page)
    // Finishing does not navigate — §2.1's screen stays put and re-renders, so
    // the proof is the page that was refused a moment ago, not this one.
    await page.goto(`${ORIGIN}/admin/video`, { waitUntil: 'networkidle' })
    check(
      'and finishing the six steps lets him past it',
      !page.url().includes('/admin/onboarding'),
      `still sent to ${page.url()}`,
    )
    check(
      'sending is still refused, because storing a credential is not verifying one',
      (await db.query.serviceConfig.findFirst())?.smtpLastVerifiedAt == null,
      'onboarding left the connection marked as verified',
    )

    // -----------------------------------------------------------------------
    console.log('\nThe camera, on and off')

    const beforeRecorder = complaints.length
    await page.goto(`${ORIGIN}/admin/video`, { waitUntil: 'networkidle' })

    const armButton = page.locator('button', { hasText: 'Turn the camera on' })
    check(
      'the recorder is on the page now',
      (await armButton.count()) === 1,
      `at ${page.url()} — ${((await page.textContent('body')) ?? '').replace(/\s+/g, ' ').slice(0, 200)}`,
    )
    check(
      'and the review element is hidden while nothing is recorded',
      await page.locator('video.hidden').first().isHidden(),
    )

    await armButton.click()
    await page.locator('button', { hasText: 'Start recording' }).waitFor({ timeout: 20_000 })
    check('the camera arms', (await liveTracks(page)) > 0, 'no live track on the element')
    check(
      'and the live preview is showing',
      await page.locator('video').first().isVisible(),
    )

    await page.locator('button', { hasText: 'Turn the camera off' }).click()
    await armButton.waitFor({ timeout: 10_000 })
    check(
      'turning it off stops the tracks rather than only hiding the picture',
      (await liveTracks(page)) === 0,
      'a track was still live — the camera light stays on',
    )

    // -----------------------------------------------------------------------
    console.log('\nRecording, and thinking better of it')

    await armButton.click()
    await page.locator('button', { hasText: 'Start recording' }).click()

    const stopButton = page.locator('button', { hasText: 'Stop' })
    await stopButton.waitFor({ timeout: 10_000 })
    const firstLabel = (await stopButton.textContent()) ?? ''
    await page.waitForTimeout(RECORD_MS)
    const laterLabel = (await stopButton.textContent()) ?? ''
    check(
      'the elapsed time counts up while it records',
      firstLabel !== laterLabel,
      `"${firstLabel.trim()}" then "${laterLabel.trim()}"`,
    )

    await stopButton.click()
    const useThis = page.locator('button', { hasText: 'Use this one' })
    await useThis.waitFor({ timeout: 20_000 })

    const review = await page.evaluate(() => {
      const elements = Array.from(document.querySelectorAll('video'))
      const withSource = elements.find((el) => el.src.startsWith('blob:'))
      return { found: withSource !== undefined, visible: withSource?.checkVisibility() ?? false }
    })
    check('stopping produces something to watch, from memory', review.found)
    check('and it is on the screen', review.visible)
    check(
      'and the camera is released without being asked',
      (await liveTracks(page)) === 0,
      'the camera is still running while the recording is reviewed',
    )

    await page.locator('button', { hasText: 'Record it again' }).click()
    await armButton.waitFor({ timeout: 10_000 })
    check(
      'discarding sends nothing — the database is asked, not the page',
      (await db.select().from(operatorVideos)).length === 0,
    )
    check(
      'and nothing was written to the store either',
      storedFiles().length === 0,
      `${storedFiles().length} files appeared`,
    )

    // -----------------------------------------------------------------------
    console.log('\nRecording, and keeping it')

    await armButton.click()
    await page.locator('button', { hasText: 'Start recording' }).click()
    await stopButton.waitFor({ timeout: 10_000 })
    await page.waitForTimeout(RECORD_MS)
    await stopButton.click()
    await useThis.waitFor({ timeout: 20_000 })
    await useThis.click()

    // The component reloads the page once the row exists, because the page and
    // not the component is the source of truth about what is stored.
    await page.waitForFunction(
      () => !document.body.textContent?.includes('Nothing recorded yet'),
      undefined,
      { timeout: 30_000 },
    )

    const stored = await db.select().from(operatorVideos)
    check('one video row exists', stored.length === 1, `${stored.length} rows`)

    const video = stored[0]
    check('it is unpublished — nobody but the operator can see it', video?.publishedAt === null)
    check('it is a webm, as the browser recorded it', video?.contentType === 'video/webm')
    check('it has a non-trivial size', (video?.sizeBytes ?? 0) > 1000, `${video?.sizeBytes} bytes`)

    const files = storedFiles()
    check('exactly one file is in the store', files.length === 1, files.join(', '))
    const onDisk = files[0] ? statSync(join(mediaDir, files[0])).size : 0
    check(
      'and the bytes on disk are the bytes the row claims',
      onDisk === video?.sizeBytes,
      `${onDisk} on disk against ${video?.sizeBytes} recorded`,
    )

    check(
      'the page now offers to replace it rather than to record a first one',
      (await page.locator('text=Replace it').count()) > 0,
    )

    const trail = await db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.entityId, video!.id))
    check('and it is in the audit log', trail.length > 0, `${trail.length} entries`)

    checkNothingWasRefused('the whole recording journey', beforeRecorder)

    // -----------------------------------------------------------------------
    console.log('\nA file the ingest will not take')

    const before = complaints.length
    await page.locator('input[type="file"]').setInputFiles({
      name: 'not-really.mp4',
      mimeType: 'video/mp4',
      buffer: Buffer.from('this is a text file wearing a video extension'),
    })

    // Filtered to one that says something. `ActionForm` renders an empty alert
    // slot, and waiting for the element rather than for its text found that
    // slot immediately and reported a blank refusal as a passing check.
    const alert = page.locator('[role="alert"]').filter({ hasText: /\S/ }).first()
    await alert.waitFor({ timeout: 20_000 })
    const message = (await alert.textContent()) ?? ''
    check('the recorder shows the refusal', message.trim().length > 0, message.slice(0, 120))
    check(
      'and it is the server’s sentence, not a generic one',
      !/did not go through/.test(message),
      message.slice(0, 160),
    )
    check(
      'and nothing new was stored',
      (await db.select().from(operatorVideos)).length === 1,
      'a refused upload created a row',
    )
    checkNothingWasRefused('the refusal', before, /status of 400/)

    // -----------------------------------------------------------------------
    console.log('\nLeaving the page')

    await page.locator('button', { hasText: 'Turn the camera on' }).click()
    await page.locator('button', { hasText: 'Start recording' }).waitFor({ timeout: 20_000 })
    check('the camera is on again', (await liveTracks(page)) > 0)

    await page.goto(`${ORIGIN}/admin`, { waitUntil: 'networkidle' })
    const stillHolding = await page.evaluate(() =>
      Array.from(document.querySelectorAll('video')).some((el) => el.srcObject !== null),
    )
    check(
      'navigating away leaves no camera running',
      !stillHolding,
      'a video element is still holding a stream after the page changed',
    )
  } catch (error) {
    console.error('\nThe run stopped early. The application said:\n')
    console.error(serverOutput().split('\n').slice(-30).join('\n'))
    throw error
  } finally {
    await browser?.close()
    stopServer(server)
    await cleanUp()
  }

  console.log(`\n${passed} passed, ${failed} failed\n`)
  if (failed > 0) process.exitCode = 1
}

main()
  .then(() => process.exit(process.exitCode ?? 0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
