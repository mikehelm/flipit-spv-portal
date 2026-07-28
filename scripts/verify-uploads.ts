/**
 * Every file input in the application, driven with files of real sizes.
 * BUILD_SPEC §5 status 3, §9.1, §13.2.
 *
 * The last entry in PROGRESS.md found that a 3 MB image posted through a server
 * action produced `Body exceeded 1 MB limit`, a 500, and **nothing whatever on
 * the screen**. It raised `serverActions.bodySizeLimit` to 24 MB — above every
 * limit the application advertises — and proved it on the media library. Its
 * first Uncertain item said the more consequential path had not been driven:
 *
 *   *"The document upload has still never actually been driven with a real PDF
 *   over 1 MB. The limit was proved on the image path, which shares the
 *   mechanism but not the screen. The documents panel is the more consequential
 *   of the two — it is where a securities document is issued — and the fix is
 *   believed rather than seen there."*
 *
 * So this drives it. And doing so exposed the narrower version of the same bug,
 * which no limit in the application could reach:
 *
 *   **20 MB is the document limit. 24 MB is the body limit. A file picker hands
 *   the browser whatever is on the disk.** A 30 MB PDF is refused by the
 *   framework before the action runs, so the action's own sentence is never
 *   written, `useActionState` receives no new state, and the form sits there
 *   looking as though the button had not been pressed — the exact behaviour the
 *   last entry fixed, for the range of sizes it could not raise the limit past.
 *
 * The fix is a size check in the browser, saying the same sentence the server
 * would have said (`tooLargeMessage`, one function, both sides). This script
 * drives four sizes on each screen and asserts, for every one, both what the
 * operator is told and whether anything was sent:
 *
 *   3 MB           accepted. Three times the default body limit.
 *   20 MB less 1   accepted. **The largest file the panel promises**, and the
 *                  size that proves the previous entry's fix: a body this big
 *                  could not reach the action before it.
 *   21 MB          refused, and **nothing is posted** — the guard uses the
 *                  application's limit, not the framework's, so an over-limit
 *                  file never leaves the machine.
 *   30 MB          refused, and nothing is posted. This is the band that used
 *                  to do nothing visible at all.
 *
 * "Nothing was sent" is asserted by counting the browser's own POSTs, because
 * the claim is that the body was never built — and a server that never received
 * one cannot tell that apart from a network failure.
 *
 * The server's refusal of the same over-limit bytes is deliberately no longer
 * reachable from these screens. It is held by `inspect` in
 * `file-limits.test.ts` and by `pnpm verify:documents`, which calls `ingest`
 * against a real store.
 *
 * Run it with the application built:
 *
 *   pnpm build && pnpm verify:uploads
 *
 * `CHROMIUM_PATH` points it at a browser already on the machine.
 *
 * Fixtures are built **inside the page** with `DataTransfer`, for the reason the
 * recorder's own oversize checks give: pushing 30 MB from Node to Chromium over
 * CDP takes a minute and proves nothing the in-page version does not. The 3 MB
 * one is rebuilt in Node as well, byte for byte, so that what landed on disk can
 * be compared with what was chosen.
 */

import 'dotenv/config'
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { eq, like } from 'drizzle-orm'
import { type Browser, type Page } from 'playwright'
import { launchChromium } from './lib/browser'
import { db } from '@/db'
import { documentPackages, investorAccounts, mediaAssets, offers, rounds, users } from '@/db/schema'
import { hashPassword } from '@/lib/auth/password'
import { importTooLargeMessage, MAX_FILE_BYTES } from '@/lib/import/limits'
import { MAX_DOCUMENT_BYTES, MAX_IMAGE_BYTES, tooLargeMessage } from '@/lib/media/formats'

const PORT = 3242
const ORIGIN = `http://127.0.0.1:${PORT}`
const PREFIX = 'uploads-verify'
const PASSWORD = 'uploads-verify-not-a-real-password'
const OWNER_EMAIL = (process.env.OWNER_EMAILS ?? '').split(',')[0]?.trim() ?? ''

/**
 * A size comfortably above the server action body limit in `next.config.ts`,
 * and below any limit a person's disk imposes. Nothing in the application
 * accepts a file this big, which is the point: the browser has to say so.
 */
const OVER_THE_BODY_LIMIT = 30 * 1024 * 1024

let passed = 0
let failed = 0
let mediaDir = ''
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

function isEnvironmental(complaint: string): boolean {
  return /favicon\.ico/.test(complaint) || /\.well-known\/appspecific/.test(complaint)
}

function checkNothingWasRefused(label: string, from = 0): void {
  const heard = complaints.slice(from).filter((c) => !isEnvironmental(c))
  const csp = heard.filter((c) => /CSP refused|Content Security Policy/i.test(c))
  check(`${label}: no Content-Security-Policy violation`, csp.length === 0, csp.slice(0, 3).join(' | '))
  check(
    `${label}: the browser complains about nothing else`,
    heard.length === csp.length,
    heard.filter((c) => !csp.includes(c)).slice(0, 3).join(' | '),
  )
}

/**
 * How many POSTs the page has made.
 *
 * A server action is a POST to the current URL carrying a `Next-Action` header,
 * so counting POSTs is how "nothing was sent" is asserted. It is deliberately
 * the browser's own count and not the server's log: the claim is that the body
 * was never built, and a server that never received one cannot tell the
 * difference between that and a network failure.
 */
let posts = 0

function watchTheRequests(page: Page): void {
  page.on('request', (request) => {
    if (request.method() === 'POST') posts += 1
  })
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/**
 * A PDF of an exact size, and one Node and the browser can both produce.
 *
 * Every byte is ASCII, so length in characters is length in bytes. The padding
 * is a PDF comment, which is legal anywhere and ignored by every reader — the
 * file has a real header, a real object and a real trailer, because `ingest`
 * identifies a file from its own bytes and a buffer of zeroes is not a PDF.
 */
const PDF_HEAD = '%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\n% '
const PDF_TAIL = '\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n'

function pdfOfSize(bytes: number, marker: string): string {
  const head = `${PDF_HEAD}${marker} `
  const pad = bytes - head.length - PDF_TAIL.length
  if (pad < 0) throw new Error(`${bytes} bytes is too small for a PDF with that marker`)
  return head + 'A'.repeat(pad) + PDF_TAIL
}

/**
 * Puts a file of the given size on a file input, built in the page.
 *
 * `change` is dispatched because the input may have a listener — the import
 * wizard's does — and because that is what choosing a file does.
 */
async function chooseFile(
  page: Page,
  selector: string,
  spec: { bytes: number; filename: string; type: string; head: string; tail: string },
): Promise<number> {
  return page.evaluate(
    ({ selector, bytes, filename, type, head, tail }) => {
      const pad = bytes - head.length - tail.length
      // Built in chunks: one 30-million-character `repeat` is fine, but joining
      // it to the head and tail as a single immutable string three times over
      // is not, and this is the shape that stays cheap if the size grows.
      const parts: BlobPart[] = [head]
      const chunk = 'A'.repeat(1024 * 1024)
      let remaining = pad
      while (remaining > 0) {
        parts.push(remaining >= chunk.length ? chunk : 'A'.repeat(remaining))
        remaining -= Math.min(remaining, chunk.length)
      }
      parts.push(tail)

      const file = new File(parts, filename, { type })
      const input = document.querySelector(selector) as HTMLInputElement | null
      if (!input) throw new Error(`no input matched ${selector}`)

      const transfer = new DataTransfer()
      transfer.items.add(file)
      input.files = transfer.files
      input.dispatchEvent(new Event('change', { bubbles: true }))
      return file.size
    },
    { selector, ...spec },
  )
}

/** Opens every `<details>` between an element and the document, so it is usable. */
async function reveal(page: Page, elementId: string): Promise<void> {
  await page.evaluate((id) => {
    let node = document.getElementById(id)?.parentElement ?? null
    while (node) {
      if (node.tagName === 'DETAILS') (node as HTMLDetailsElement).open = true
      node = node.parentElement
    }
  }, elementId)
}

async function cleanUp(): Promise<void> {
  const accounts = await db
    .select({ id: investorAccounts.id })
    .from(investorAccounts)
    .where(like(investorAccounts.email, `${PREFIX}%`))

  for (const account of accounts) {
    const theirOffers = await db
      .select({ id: offers.id })
      .from(offers)
      .where(eq(offers.accountId, account.id))
    for (const offer of theirOffers) {
      await db.delete(documentPackages).where(eq(documentPackages.offerId, offer.id))
      await db.delete(offers).where(eq(offers.id, offer.id))
    }
    await db.delete(investorAccounts).where(eq(investorAccounts.id, account.id))
  }

  await db.delete(rounds).where(like(rounds.name, `${PREFIX}%`))
  await db.delete(mediaAssets).where(like(mediaAssets.name, `${PREFIX}%`))

  if (mediaDir && existsSync(mediaDir)) rmSync(mediaDir, { recursive: true, force: true })
}

async function seed(): Promise<{ offerId: string; accountId: string }> {
  const [round] = await db
    .insert(rounds)
    .values({
      name: `${PREFIX} round`,
      aggregateTargetUsd: '30000.00',
      flipitShare: '0.300000',
    })
    .returning()

  const [account] = await db
    .insert(investorAccounts)
    .values({
      name: 'Rosalind Ashworth-Pike',
      email: `${PREFIX}@example.test`,
      status: 'ACTIVE',
    })
    .returning()

  const [offer] = await db
    .insert(offers)
    .values({
      roundId: round!.id,
      accountId: account!.id,
      proposedAmountUsd: '12500.00',
      spvPercentage: '41.666667',
      indirectPercentage: '12.500000',
      responseDeadline: '2026-12-31',
    })
    .returning()

  const hash = await hashPassword(PASSWORD)
  await db
    .update(users)
    .set({ passwordHash: hash, passwordSetAt: new Date(), passwordChangedAt: new Date() })
    .where(eq(users.email, OWNER_EMAIL))

  return { offerId: offer!.id, accountId: account!.id }
}

function storedFiles(): string[] {
  return existsSync(mediaDir) ? readdirSync(mediaDir) : []
}

async function documentsOn(offerId: string) {
  return db.select().from(documentPackages).where(eq(documentPackages.offerId, offerId))
}

async function startServer(): Promise<ChildProcess> {
  const child = spawn('node_modules/.bin/next', ['start', '--port', String(PORT)], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(PORT),
      APP_URL: ORIGIN,
      BASE_PATH: '',
      MEDIA_STORE: 'filesystem',
      MEDIA_DIR: mediaDir,
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
    output += `\n[the server exited: code=${code} signal=${signal}]\n`
  })

  const deadline = Date.now() + 60_000
  while (Date.now() < deadline) {
    if (exited) throw new Error(`The server exited before it was ready:\n${output}`)
    try {
      const response = await fetch(`${ORIGIN}/signin`)
      if (response.status < 500) return child
    } catch {
      // Not listening yet.
    }
    await new Promise((r) => setTimeout(r, 400))
  }
  child.kill('SIGTERM')
  throw new Error(`The server did not answer within 60 seconds:\n${output}`)
}

function stopServer(child: ChildProcess): void {
  if (child.pid === undefined) return
  try {
    process.kill(-child.pid, 'SIGTERM')
  } catch {
    child.kill('SIGTERM')
  }
}

/** Waits for a form to say something, whichever way it went. */
async function noticeIn(page: Page, formSelector: string): Promise<string> {
  const form = page.locator(formSelector)
  await form.locator('[role="alert"], [role="status"]').first().waitFor({ timeout: 30_000 })
  return (await form.locator('[role="alert"], [role="status"]').first().innerText()).trim()
}

// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  if (!OWNER_EMAIL) {
    console.log('  FAIL  OWNER_EMAILS is empty — nothing can sign in')
    process.exitCode = 1
    return
  }

  mediaDir = mkdtempSync(join(tmpdir(), 'spv-verify-uploads-'))
  console.log(`\nEvery file input, at real sizes\n  store: ${mediaDir}\n`)

  await cleanUp()
  mediaDir = mkdtempSync(join(tmpdir(), 'spv-verify-uploads-'))
  const { offerId } = await seed()

  const server = await startServer()
  let browser: Browser | undefined

  try {
    browser = await launchChromium()
    const context = await browser.newContext()
    const page = await context.newPage()
    watchTheConsole(page)
    watchTheRequests(page)

    await page.goto(`${ORIGIN}/signin`, { waitUntil: 'networkidle' })
    await page.fill('input[name="email"]', OWNER_EMAIL)
    await page.fill('input[name="password"]', PASSWORD)
    await page.click('button[type="submit"]')
    await page.waitForURL(/\/admin/, { timeout: 20_000 })
    check('the owner is signed in', page.url().includes('/admin'), page.url())

    const fileId = `file-${offerId}`
    // An attribute selector, not `#id`: the offer id is a UUID and may begin
    // with a digit, which is not a valid CSS identifier.
    const fileSelector = `[id="${fileId}"]`
    const formSelector = `form:has(${fileSelector})`

    // -- §5: a real PDF over 1 MB, on the screen that issues securities ----
    console.log('\n§5 — a 3 MB PDF through the documents panel')
    let mark = complaints.length

    await page.goto(`${ORIGIN}/investors`, { waitUntil: 'networkidle' })
    await reveal(page, fileId)
    check('the documents panel is on the investor’s record', await page.locator(fileSelector).count() === 1)

    const THREE_MB = 3 * 1024 * 1024
    const marker = `${PREFIX} subscription agreement`
    const chosenSize = await chooseFile(page, fileSelector, {
      bytes: THREE_MB,
      filename: 'subscription-agreement.pdf',
      type: 'application/pdf',
      head: `${PDF_HEAD}${marker} `,
      tail: PDF_TAIL,
    })
    check('a 3 MB PDF is on the input', chosenSize === THREE_MB, String(chosenSize))

    await page.fill(`[id="title-${offerId}"]`, `${PREFIX} Subscription agreement`)
    const postsBefore3MB = posts
    await page.locator(formSelector).getByRole('button', { name: 'Upload' }).click()

    const uploadNotice = await noticeIn(page, formSelector)
    check(
      'it is accepted, and the screen says it is not yet issued',
      /not yet issued/i.test(uploadNotice),
      uploadNotice.slice(0, 160),
    )
    check('and it was actually posted', posts > postsBefore3MB)

    const afterUpload = await documentsOn(offerId)
    check('one document is on the record', afterUpload.length === 1, String(afterUpload.length))
    check(
      'recorded at its full size — not truncated at 1 MB',
      afterUpload[0]?.sizeBytes === THREE_MB,
      String(afterUpload[0]?.sizeBytes),
    )
    check('and identified as a PDF from its own bytes', afterUpload[0]?.contentType === 'application/pdf')
    check('and not issued', afterUpload[0]?.issuedAt === null)

    const onDisk = readFileSync(join(mediaDir, afterUpload[0]!.storageKey))
    check(
      'the bytes on disk are the bytes that were chosen — a legal instrument is not rewritten',
      onDisk.length === THREE_MB && onDisk.toString('latin1') === pdfOfSize(THREE_MB, marker),
      `${onDisk.length} bytes on disk`,
    )

    // The server said nothing about a body it could not read.
    check(
      'the server log has no “Body exceeded” line',
      !/Body exceeded/i.test(serverOutput()),
      serverOutput().split('\n').filter((l) => /Body exceeded/i.test(l))[0] ?? '',
    )
    checkNothingWasRefused('the 3 MB upload', mark)

    /**
     * -- §5: the largest document the panel promises to take ---------------
     *
     * This is the check the previous entry's fix actually rests on, and it is
     * the one that had never been run anywhere. The panel says *"PDF only, up
     * to 20 MB"*. Under the old 1 MB server action body limit, and under the
     * default one, a body this size never reached the action at all — so the
     * sentence on the screen was a promise the application could not keep, and
     * keeping it silently was the bug.
     *
     * A byte under the limit, so it is the largest file the promise covers.
     */
    console.log('\n§5 — 20 MB less one byte: the largest document the panel promises')
    mark = complaints.length

    await page.reload({ waitUntil: 'networkidle' })
    await reveal(page, fileId)

    const AT_THE_LIMIT = MAX_DOCUMENT_BYTES - 1
    const bigMarker = `${PREFIX} scanned execution copy`
    await chooseFile(page, fileSelector, {
      bytes: AT_THE_LIMIT,
      filename: 'execution-copy.pdf',
      type: 'application/pdf',
      head: `${PDF_HEAD}${bigMarker} `,
      tail: PDF_TAIL,
    })
    await page.fill(`[id="title-${offerId}"]`, `${PREFIX} Execution copy`)
    const postsBeforeAtLimit = posts
    await page.locator(formSelector).getByRole('button', { name: 'Upload' }).click()

    const atLimitNotice = await noticeIn(page, formSelector)
    check(
      'the advertised limit is reachable — the promise on the screen is kept',
      /not yet issued/i.test(atLimitNotice),
      atLimitNotice.slice(0, 200),
    )
    check('a body of nearly 20 MB did cross the wire', posts > postsBeforeAtLimit)

    const atLimitRows = await documentsOn(offerId)
    const biggest = atLimitRows.find((row) => row.sizeBytes === AT_THE_LIMIT)
    check('and every byte of it was stored', biggest !== undefined, `${atLimitRows.length} rows`)
    if (biggest) {
      const bigOnDisk = readFileSync(join(mediaDir, biggest.storageKey))
      check(
        'byte for byte, at the limit as well as at 3 MB',
        bigOnDisk.length === AT_THE_LIMIT &&
          bigOnDisk.toString('latin1') === pdfOfSize(AT_THE_LIMIT, bigMarker),
        `${bigOnDisk.length} bytes`,
      )
    }
    check('and no “Body exceeded” for it', !/Body exceeded/i.test(serverOutput()))
    checkNothingWasRefused('the 20 MB upload', mark)

    /**
     * -- §5: over the document limit ---------------------------------------
     *
     * The guard uses the **application's** limit, not the framework's body
     * limit, so this never leaves the machine — which is why the check below
     * asserts no POST rather than one. See the Decisions note in PROGRESS.md:
     * refusing at 20 MB in the browser is the conservative reading, and the
     * server's own refusal of the same bytes is held by `inspect` in
     * `file-limits.test.ts` and by `pnpm verify:documents`, which calls `ingest`
     * directly.
     */
    console.log('\n§5 — 21 MB: over the limit the panel advertises')
    mark = complaints.length

    await page.reload({ waitUntil: 'networkidle' })
    await reveal(page, fileId)

    const OVER_DOCUMENT_LIMIT = MAX_DOCUMENT_BYTES + 1024 * 1024
    await chooseFile(page, fileSelector, {
      bytes: OVER_DOCUMENT_LIMIT,
      filename: 'far-too-long.pdf',
      type: 'application/pdf',
      head: `${PDF_HEAD}oversized `,
      tail: PDF_TAIL,
    })
    await page.fill(`[id="title-${offerId}"]`, `${PREFIX} Oversized`)
    const documentsBefore21MB = (await documentsOn(offerId)).length
    const postsBefore21MB = posts
    await page.locator(formSelector).getByRole('button', { name: 'Upload' }).click()

    const refusal = await noticeIn(page, formSelector)
    check(
      'the application’s own sentence, naming both numbers',
      refusal.includes(tooLargeMessage('document', OVER_DOCUMENT_LIMIT)),
      refusal.slice(0, 200),
    )
    check(
      'and 21 MB never left the machine — the operator does not wait to be refused',
      posts === postsBefore21MB,
      `${posts - postsBefore21MB} POSTs`,
    )
    check(
      'no document was created',
      (await documentsOn(offerId)).length === documentsBefore21MB,
    )
    check('still no “Body exceeded” in the log', !/Body exceeded/i.test(serverOutput()))
    checkNothingWasRefused('the 21 MB refusal', mark)

    // -- §5: over the body limit — the BROWSER refuses ---------------------
    console.log('\n§5 — 30 MB: above the body limit, where the refusal used to be silent')
    mark = complaints.length

    await page.reload({ waitUntil: 'networkidle' })
    await reveal(page, fileId)

    await chooseFile(page, fileSelector, {
      bytes: OVER_THE_BODY_LIMIT,
      filename: 'enormous.pdf',
      type: 'application/pdf',
      head: `${PDF_HEAD}enormous `,
      tail: PDF_TAIL,
    })
    await page.fill(`[id="title-${offerId}"]`, `${PREFIX} Enormous`)
    const postsBefore30MB = posts
    await page.locator(formSelector).getByRole('button', { name: 'Upload' }).click()

    const stopped = await noticeIn(page, formSelector)
    check(
      'the same sentence, in the same place — the operator cannot tell which side refused',
      stopped.includes(tooLargeMessage('document', OVER_THE_BODY_LIMIT)),
      stopped.slice(0, 200),
    )
    check('and it says the file was not sent', /not sent/i.test(stopped), stopped.slice(0, 200))
    check(
      'NOTHING was posted — the body was never built',
      posts === postsBefore30MB,
      `${posts - postsBefore30MB} POSTs`,
    )
    check('no document was created', (await documentsOn(offerId)).length === documentsBefore21MB)
    check(
      'nothing more is in the store',
      storedFiles().length === documentsBefore21MB,
      storedFiles().join(', '),
    )
    check('and the log still has no “Body exceeded”', !/Body exceeded/i.test(serverOutput()))
    checkNothingWasRefused('the 30 MB refusal', mark)

    // A smaller file after a refusal still works: the guard is not sticky.
    console.log('\nAnd the operator can recover from it')
    const TWO_MB = 2 * 1024 * 1024
    await chooseFile(page, fileSelector, {
      bytes: TWO_MB,
      filename: 'second.pdf',
      type: 'application/pdf',
      head: `${PDF_HEAD}second `,
      tail: PDF_TAIL,
    })
    await page.fill(`[id="title-${offerId}"]`, `${PREFIX} Second agreement`)
    await page.locator(formSelector).getByRole('button', { name: 'Upload' }).click()
    const recovered = await noticeIn(page, formSelector)
    check(
      'choosing a smaller file and pressing again uploads it',
      /not yet issued/i.test(recovered),
      recovered.slice(0, 160),
    )
    check(
      'one more document than before the two refusals',
      (await documentsOn(offerId)).length === documentsBefore21MB + 1,
    )

    // -- §13.2: the media library -----------------------------------------
    console.log('\n§13.2 — the media library, both bands')
    mark = complaints.length

    await page.goto(`${ORIGIN}/admin/media`, { waitUntil: 'networkidle' })
    const imageForm = 'form:has(#file)'

    const OVER_IMAGE_LIMIT = MAX_IMAGE_BYTES + 1024 * 1024
    await page.fill('input[name="name"]', `${PREFIX} oversized image`)
    await chooseFile(page, '#file', {
      bytes: OVER_IMAGE_LIMIT,
      filename: 'big.png',
      type: 'image/png',
      // A real PNG signature, so the refusal is about size and not the format.
      head: '\x89PNG\r\n\x1a\n',
      tail: '',
    })
    const postsBeforeImage = posts
    await page.locator(imageForm).getByRole('button', { name: 'Upload it' }).click()
    const imageRefusal = await noticeIn(page, imageForm)
    check(
      '6 MB: refused, naming both numbers',
      imageRefusal.includes(tooLargeMessage('image', OVER_IMAGE_LIMIT)),
      imageRefusal.slice(0, 200),
    )
    check(
      'and refused here, at the library’s own 5 MB — not by the framework at 24',
      posts === postsBeforeImage,
      `${posts - postsBeforeImage} POSTs`,
    )

    await page.reload({ waitUntil: 'networkidle' })
    await page.fill('input[name="name"]', `${PREFIX} enormous image`)
    await chooseFile(page, '#file', {
      bytes: OVER_THE_BODY_LIMIT,
      filename: 'enormous.png',
      type: 'image/png',
      head: '\x89PNG\r\n\x1a\n',
      tail: '',
    })
    const postsBeforeBigImage = posts
    await page.locator(imageForm).getByRole('button', { name: 'Upload it' }).click()
    const imageStopped = await noticeIn(page, imageForm)
    check(
      '30 MB: the same sentence again, at six times the limit',
      imageStopped.includes(tooLargeMessage('image', OVER_THE_BODY_LIMIT)),
      imageStopped.slice(0, 200),
    )
    check('and posted nothing', posts === postsBeforeBigImage, `${posts - postsBeforeBigImage} POSTs`)

    const images = await db
      .select({ id: mediaAssets.id })
      .from(mediaAssets)
      .where(like(mediaAssets.name, `${PREFIX}%`))
    check('neither is in the library', images.length === 0, String(images.length))
    checkNothingWasRefused('the media library', mark)

    // -- §9.1: the import wizard ------------------------------------------
    console.log('\n§9.1 — the import wizard, which posts a file without an ActionForm')
    mark = complaints.length

    await page.goto(`${ORIGIN}/import`, { waitUntil: 'networkidle' })
    const CSV_HEAD = 'name,email,amount\n'
    const CSV_ROW = 'Padding Person,padding@example.test,1000\n'

    const OVER_IMPORT_LIMIT = MAX_FILE_BYTES + 1024 * 1024
    await chooseFile(page, 'input[type="file"]', {
      bytes: OVER_IMPORT_LIMIT,
      filename: 'register.csv',
      type: 'text/csv',
      head: CSV_HEAD + CSV_ROW,
      tail: '\n',
    })
    const postsBeforeImport = posts
    await page.getByRole('button', { name: /Read the file/ }).click()
    await page.locator('[role="alert"]').first().waitFor({ timeout: 30_000 })
    const importRefusal = (await page.locator('[role="alert"]').first().innerText()).trim()
    check(
      '6 MB: refused before it is read, naming both numbers',
      importRefusal.includes(importTooLargeMessage(OVER_IMPORT_LIMIT)),
      importRefusal.slice(0, 200),
    )
    check(
      'and the wizard is still on step 1, with the file still chosen',
      (await page.locator('input[type="file"]').count()) === 1,
    )
    check(
      'nothing was posted for it either — the guard is before the body',
      posts === postsBeforeImport,
      `${posts - postsBeforeImport} POSTs`,
    )

    await page.reload({ waitUntil: 'networkidle' })
    await chooseFile(page, 'input[type="file"]', {
      bytes: OVER_THE_BODY_LIMIT,
      filename: 'enormous.csv',
      type: 'text/csv',
      head: CSV_HEAD + CSV_ROW,
      tail: '\n',
    })
    const postsBeforeBigImport = posts
    await page.getByRole('button', { name: /Read the file/ }).click()
    await page.locator('[role="alert"]').first().waitFor({ timeout: 30_000 })
    const bigImportRefusal = (await page.locator('[role="alert"]').first().innerText()).trim()
    check(
      '30 MB: the same sentence, and the wizard survives it',
      bigImportRefusal.includes(importTooLargeMessage(OVER_THE_BODY_LIMIT)),
      bigImportRefusal.slice(0, 200),
    )
    check('and nothing was posted', posts === postsBeforeBigImport)
    check(
      'the operator is not sent to an error page',
      page.url().includes('/import'),
      page.url(),
    )
    checkNothingWasRefused('the import wizard', mark)

    // -- Nothing was logged that should not be ----------------------------
    console.log('\nThe log')
    const log = serverOutput()
    check('no “Body exceeded” anywhere in the run', !/Body exceeded/i.test(log))
    check('no password in it', !log.includes(PASSWORD))
    // A file's own bytes would show up as a run of the padding character.
    check('no uploaded content in it', !/A{200}/.test(log))
    check('no unhandled rejection', !/UnhandledPromiseRejection/i.test(log))
  } finally {
    await browser?.close()
    stopServer(server)
    await cleanUp()
  }

  console.log(`\n${passed} passed, ${failed} failed`)
  if (failed > 0) {
    console.log('\nServer output:\n' + serverOutput().split('\n').slice(-40).join('\n'))
    process.exitCode = 1
  }
}

main()
  .catch((error) => {
    console.error(error)
    console.error('\nServer output:\n' + serverOutput().split('\n').slice(-40).join('\n'))
    process.exitCode = 1
  })
  .finally(() => process.exit(process.exitCode ?? 0))
