/**
 * The one irreversible act in this application, driven through a browser.
 *
 * BUILD_SPEC §12 · OPEN_DECISIONS item 12 · DEPLOYMENT.md §12.
 *
 * An erasure pseudonymises rows and destroys bytes. The rows can be argued
 * about — a name overwritten with a pseudonym is a decision somebody can
 * revisit — but `store.remove()` is not reversible in principle, and it runs
 * *before* the transaction, so it is the one step of this journey that has
 * already happened by the time anything else is decided.
 *
 * Two scripts have circled it and neither landed on it:
 *
 *   - `verify:erasure` destroys **one** real object under a real key, from
 *     Node, by calling `eraseAccount()` directly. That proves the service. It
 *     does not press a button.
 *   - `verify:account-access` presses the button, in Chromium, with two
 *     investors on the page — but it pins `MEDIA_STORE` empty and then takes
 *     the storage keys away by hand (`clearStoredFiles`) so the form will
 *     appear at all. **Every browser-driven erasure in this repository has
 *     therefore run against a record holding no bytes.** Its own entry in
 *     PROGRESS.md says so, four times over: *"the bytes are still never
 *     destroyed through a browser."*
 *
 * So the gap is not the service and not the screen. It is the join: the form
 * that a person actually submits, on a deployment that actually has somewhere
 * to delete from, against a record that actually holds files.
 *
 * Three things follow from that and none of them can be seen anywhere else:
 *
 *   1. **The unblocked card with stored files on it has never been rendered.**
 *      `verify:account-access` reads the "stored files destroyed outright" line
 *      only in the *blocked* state, and after the hand-clear it asserts the line
 *      is **absent**. The screen a real owner will read — the count present, the
 *      form offered — is a component branch nothing has drawn.
 *   2. **A refusal has never been asked whether it destroyed anything.** The
 *      confirmation check and the byte destruction are eleven lines apart in
 *      `src/actions/erasure.ts`, in the right order today. A wrong address that
 *      deletes a subscription agreement first and refuses second would pass
 *      every existing check in this repository, because no existing check has
 *      bytes to lose.
 *   3. **The neighbour's files have never been counted afterwards.** Isolation
 *      is proved for rows, column by column, by `verify:erasure`. The store is
 *      a flat namespace of unguessable keys with no notion of an owner, and a
 *      `remove()` loop given the wrong graph destroys another investor's
 *      documents with no error and no trace.
 *
 * It creates its own two investors, its own media store in a temporary
 * directory, and removes both at the end. It sends no email and touches no mail
 * transport. Run it against a development database only, with the app built:
 *
 *   pnpm build && pnpm verify:erasure-bytes
 */

import 'dotenv/config'
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { eq, inArray } from 'drizzle-orm'
import { type Browser, type Page } from 'playwright'
import { launchChromium } from './lib/browser'
import { db } from '@/db'
import { documentPackages, investorAccounts, offers, participationCertificates, users } from '@/db/schema'
import { ERASED_STORAGE_KEY, pseudonymEmail, pseudonymName } from '@/lib/erasure/plan'
import { mediaStore, resetMediaStoreCache, type MediaStore } from '@/lib/media/store'
import { resetEnvCache } from '@/lib/env'
import { hashPassword } from '@/lib/auth/password'
import { onScreen } from '@/lib/verify/page-text'
import {
  ERASURE_COUNTS,
  ERASURE_COUNTS_SECOND,
  removeErasureFixture,
  seedErasureFixture,
  storedKeysFor,
} from './lib/erasure-fixture'

const PORT = 3215
const ORIGIN = `http://127.0.0.1:${PORT}`

const OWNER_EMAIL = (process.env.OWNER_EMAILS ?? '').split(',')[0]?.trim() ?? ''
const CHOSEN_PASSWORD = 'verify erasure bytes not a real password'

/** The investor who is erased. Their bytes must all go. */
const TARGET_PREFIX = 'ErasureBytesTarget'

/**
 * The investor next to them, who is not erased.
 *
 * Their own round, so `removeErasureFixture` finds each fixture by its own rule
 * and neither can delete the other's rows.
 */
const NEIGHBOUR_PREFIX = 'ErasureBytesNeighbour'

/** How many stored files each fixture holds, from the tables themselves. */
const storedFilesOn = (counts: typeof ERASURE_COUNTS): number =>
  counts.find((row) => row.label === 'stored files destroyed outright')!.n

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
// The store
// ---------------------------------------------------------------------------

/**
 * Bytes that say which key they were written under.
 *
 * Distinct content per key, so "the right file was destroyed" is a claim that
 * can fail. A store filled with one repeated byte string cannot tell a correct
 * erasure from one that deleted seven arbitrary objects and left seven others.
 */
function bytesFor(key: string): Uint8Array {
  return new TextEncoder().encode(`%PDF-1.4 stored object ${key}\n`)
}

/** Read a key back and say whether it holds exactly what was written under it. */
async function holdsItsOwnBytes(store: MediaStore, key: string): Promise<boolean> {
  const object = await store.get(key)
  if (!object) return false
  const wanted = bytesFor(key)
  if (object.bytes.byteLength !== wanted.byteLength) return false
  return object.bytes.every((byte, index) => byte === wanted[index])
}

// ---------------------------------------------------------------------------
// The server
// ---------------------------------------------------------------------------

async function startServer(mediaDirectory: string): Promise<ChildProcess> {
  const child = spawn('node_modules/.bin/next', ['start', '--port', String(PORT)], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(PORT),
      APP_URL: ORIGIN,
      BASE_PATH: '',
      /*
       * The opposite pin to `verify:account-access`, for the same reason it
       * pins the other way: the result must not depend on a line in `.env`
       * that this script does not own.
       *
       * There the empty value is what makes the *blocked* card appear. Here a
       * real store is the whole point — the server must be able to reach the
       * bytes, or the erasure refuses with MEDIA_STORE_UNREACHABLE and the
       * journey stops at a notice. The directory is created by this run and
       * removed at the end of it, so an inherited `MEDIA_DIR` pointing at a
       * developer's real library cannot be written into or deleted from.
       */
      MEDIA_STORE: 'filesystem',
      MEDIA_DIR: mediaDirectory,
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

/**
 * A Chromium Playwright will actually launch.
 *
 * The ladder this used to hold itself now lives in `scripts/lib/browser.ts`,
 * because it was here and in `verify:account-access` and in neither of the
 * three scripts that needed it.
 */
async function launchBrowser(): Promise<Browser> {
  return launchChromium()
}

async function signInWithPassword(page: Page, email: string, password: string): Promise<void> {
  await page.goto(`${ORIGIN}/signin`, { waitUntil: 'domcontentloaded' })
  await page.fill('input[name="email"]', email)
  await page.fill('input[name="password"]', password)
  await Promise.all([page.waitForLoadState('networkidle'), page.click('button[type="submit"]')])
}

// ---------------------------------------------------------------------------
// The journey
// ---------------------------------------------------------------------------

async function journey(browser: Browser, store: MediaStore): Promise<void> {
  const target = await seedErasureFixture(TARGET_PREFIX)
  const neighbour = await seedErasureFixture(NEIGHBOUR_PREFIX, ERASURE_COUNTS_SECOND)

  const targetKeys = await storedKeysFor(target.account.id)
  const neighbourKeys = await storedKeysFor(neighbour.account.id)

  console.log('\nThe store, before anything is pressed')

  check(
    `the record about to be erased holds ${storedFilesOn(ERASURE_COUNTS)} storage keys`,
    targetKeys.all.length === storedFilesOn(ERASURE_COUNTS),
    `${targetKeys.documents.length} documents + ${targetKeys.certificates.length} certificates`,
  )
  check(
    `the neighbour holds ${storedFilesOn(ERASURE_COUNTS_SECOND)}, which is a different number`,
    neighbourKeys.all.length === storedFilesOn(ERASURE_COUNTS_SECOND) &&
      neighbourKeys.all.length !== targetKeys.all.length,
    `${neighbourKeys.all.length}`,
  )
  check(
    'and no key belongs to both of them',
    new Set([...targetKeys.all, ...neighbourKeys.all]).size ===
      targetKeys.all.length + neighbourKeys.all.length,
  )

  for (const key of [...targetKeys.all, ...neighbourKeys.all]) {
    await store.put(key, bytesFor(key), 'application/pdf')
  }

  const beforeMissing: string[] = []
  for (const key of [...targetKeys.all, ...neighbourKeys.all]) {
    if (!(await holdsItsOwnBytes(store, key))) beforeMissing.push(key)
  }
  check(
    'every one of them names real bytes in a real store, and its own bytes',
    beforeMissing.length === 0,
    `${beforeMissing.length} were missing or held the wrong content`,
  )

  /*
   * The store, from the store's own side.
   *
   * `list()` is the only read here that does not start from a row. Everything
   * else asks "is the object this row names still there", which cannot see an
   * object that no row names — and after an erasure, an object whose row was
   * redacted but whose bytes survive is exactly that shape. The count is taken
   * now so it can be taken again afterwards and the difference read.
   */
  const listedBefore = await store.list(1000)
  check(
    'and the store lists them all, so a count taken from it means something',
    !listedBefore.truncated &&
      [...targetKeys.all, ...neighbourKeys.all].every((key) =>
        listedBefore.objects.some((object) => object.key === key),
      ),
    `${listedBefore.objects.length} objects listed, truncated=${listedBefore.truncated}`,
  )

  // -------------------------------------------------------------------------

  console.log('\nThe card, on a deployment that has somewhere to delete from')

  const context = await browser.newContext()
  const page = await context.newPage()
  await signInWithPassword(page, OWNER_EMAIL, CHOSEN_PASSWORD)

  await page.goto(`${ORIGIN}/investors`, { waitUntil: 'domcontentloaded', timeout: 15_000 })
  check(
    'the owner reaches the investors screen',
    new URL(page.url()).pathname === '/investors',
    `landed on ${new URL(page.url()).pathname}`,
  )

  /*
   * Scoped to one card by the name on it, never `.first()`. On a page that
   * lists every investor, `.first()` is somebody else's — and this page has two
   * fixtures on it deliberately.
   */
  const sectionOf = (name: string) =>
    page
      .locator('article')
      .filter({ hasText: name })
      .filter({ hasText: 'Erase their personal' })
      .locator('details', { hasText: 'Erase their personal data' })
      .first()

  const section = sectionOf(`${TARGET_PREFIX} Target`)
  const neighbourSection = sectionOf(`${NEIGHBOUR_PREFIX} Target`)

  /*
   * Open the card and wait for whichever of the two states it settles into.
   *
   * **Deliberately not a wait for the form.** The claim below is that the form
   * is offered at all, and a helper that waits only for the form turns the
   * failure of that claim into a thirty-second timeout and a stack trace — a
   * script that crashes instead of reporting. Waiting for *either* the
   * confirmation field or the notice that replaces it means a blocked card is
   * read and checked rather than hung on.
   */
  async function open(target: ReturnType<typeof sectionOf>): Promise<string> {
    if (!(await target.evaluate((node) => (node as HTMLDetailsElement).open))) {
      await target.locator('summary').click()
    }
    await target
      .locator('form input[name="confirmation"], [role="alert"], li')
      .first()
      .waitFor({ state: 'visible', timeout: 20_000 })
    return (await target.innerText()).replace(/\s+/g, ' ')
  }

  const opened = await open(section)

  /*
   * The state that has never been on a screen.
   *
   * `previewErasure` sets `blockedBy` only when the record holds stored files
   * **and** `mediaStore()` is null. Every browser-driven run so far has been in
   * one of the two states where that is not interesting: blocked, or unblocked
   * because the keys had been taken away. This is the third — files present,
   * store configured — and it is the one a real owner meets. The form must be
   * offered, and the count line must be on the card, because it is the sentence
   * warning them what cannot be undone.
   */
  const formOffered = (await section.locator('input[name="confirmation"]').count()) === 1
  check(
    'a record holding stored files, WITH a media store, is offered the form',
    formOffered && !/no media store is configured/.test(opened),
    opened.slice(0, 500),
  )
  check(
    `and the card says “${storedFilesOn(ERASURE_COUNTS)} stored files destroyed outright”`,
    opened.includes(`${storedFilesOn(ERASURE_COUNTS)} stored files destroyed outright`),
    opened.slice(0, 900),
  )
  check(
    'and it is the warning, not a line of statistics — it says the bytes go for good',
    /cannot be recovered|cannot be undone/.test(opened),
    opened.slice(0, 500),
  )

  const neighbourOpened = await open(neighbourSection)
  check(
    `the neighbour's card says “${storedFilesOn(ERASURE_COUNTS_SECOND)} stored files destroyed outright”, its own number`,
    neighbourOpened.includes(
      `${storedFilesOn(ERASURE_COUNTS_SECOND)} stored files destroyed outright`,
    ),
    neighbourOpened.slice(0, 900),
  )

  /*
   * Everything below presses a button that is not there if the card is blocked.
   *
   * Stopping here is the difference between a script that reports a failure and
   * one that reports a failure and then buries it under a Playwright timeout on
   * an element that was never going to appear. The check above has already
   * recorded what is wrong; the run is failed either way.
   */
  if (!formOffered) {
    console.log('\n  The form is not on the card, so the rest of this journey cannot run.')
    await context.close()
    return
  }

  // -------------------------------------------------------------------------

  console.log('\nA refusal, asked whether it destroyed anything')

  /**
   * Fill the form on one card, submit it, and report which of the two things
   * happened — rather than waiting for the one that was expected.
   *
   * A server action does not navigate, so `networkidle` on an already-idle page
   * resolves before the action has run and the next assertion reads the screen
   * as it was. What distinguishes the outcomes is that `ActionForm` renders
   * `role="alert"` for a refusal and unmounts the form on a success. So both are
   * watched at once.
   *
   * **Waiting for only the expected one is what this replaces, and the reason is
   * this script's own subject.** The interesting failure here is an erasure that
   * runs when it should have been refused. A `submit(…, 'refused')` that waits
   * for a banner then hangs for twenty seconds on an element that will never
   * appear and dies in Playwright — and the check immediately below it, the one
   * asking whether a refusal destroyed an investor's documents, never runs at
   * all. The worst outcome available to this file is a byte check that is
   * skipped by the very fault it exists to catch.
   *
   * After a successful erasure the card carries the pseudonym, so the locator
   * scoped to the fixture's name matches nothing — which is the same signal as
   * the form unmounting, and is read as one.
   */
  async function submit(
    target: ReturnType<typeof sectionOf>,
    address: string,
  ): Promise<{ outcome: 'refused' | 'erased' | 'neither'; text: string }> {
    /*
     * Reload first, and this is a finding rather than tidiness.
     *
     * `ActionForm` holds the previous outcome in `useActionState`, so a refusal
     * banner stays on the card until the *next* action returns and re-renders
     * it. Poll for a banner straight after the second submit and the banner
     * that is read is the first submit's — still visible, still saying the
     * address does not match, while the erasure it is being read as a verdict
     * on is still in flight. The first version of this check failed that way on
     * a run where the erasure was entirely correct, which is the worst kind of
     * false failure: it accuses the application of the thing the script exists
     * to find.
     *
     * A reload clears client state, so each submit is read against a card with
     * no previous verdict on it. What a person sees is unchanged and is worth
     * writing down: after typing the right address, the wrong-address refusal
     * is still on screen until the server answers.
     */
    await page.reload({ waitUntil: 'domcontentloaded' })
    await open(target)
    const form = target.locator('form')
    await form.locator('input[name="confirmation"]').fill(address)
    const acknowledge = form.locator('input[name="acknowledged"]')
    if (!(await acknowledge.isChecked())) await acknowledge.check()
    await form.locator('button[type="submit"]').click()

    const deadline = Date.now() + 20_000
    while (Date.now() < deadline) {
      const banner = target.locator('[role="alert"]').first()
      if (await banner.isVisible().catch(() => false)) {
        return { outcome: 'refused', text: (await banner.innerText()).replace(/\s+/g, ' ') }
      }
      if ((await target.locator('input[name="confirmation"]').count()) === 0) {
        return { outcome: 'erased', text: '' }
      }
      await new Promise((r) => setTimeout(r, 200))
    }
    return { outcome: 'neither', text: '' }
  }

  const refusal = await submit(section, 'somebody.else@example.invalid')
  check(
    'a wrong address is refused',
    refusal.outcome === 'refused' && /does not match the account/.test(refusal.text),
    refusal.outcome === 'erased'
      ? 'it was not refused — the form went away, which is what a completed erasure looks like'
      : refusal.text.slice(0, 300) || 'nothing settled within twenty seconds',
  )

  /*
   * **The check this script exists for, first half.**
   *
   * In `src/actions/erasure.ts` the confirmation comparison and the call to
   * `eraseAccount()` are eleven lines apart, and `eraseAccount()` destroys bytes
   * before it opens a transaction. Today the order is right. Nothing in this
   * repository could tell if it stopped being right, because every other check
   * of a refusal runs against a record with no bytes to lose — and a deletion
   * that happens before a refusal leaves a screen saying *"Nothing was
   * changed"* over an investor's destroyed subscription agreement.
   */
  const survivedRefusal: string[] = []
  for (const key of targetKeys.all) {
    if (!(await holdsItsOwnBytes(store, key))) survivedRefusal.push(key)
  }
  check(
    `and “nothing was changed” is true of the bytes: all ${targetKeys.all.length} are still there`,
    survivedRefusal.length === 0,
    `${survivedRefusal.length} were destroyed by a refusal`,
  )

  // -------------------------------------------------------------------------

  console.log('\nThe erasure itself')

  const erasure =
    refusal.outcome === 'erased'
      ? refusal
      : await submit(section, target.investorEmail)
  check(
    'the right address is accepted, and the form goes with the record',
    erasure.outcome === 'erased',
    erasure.text.slice(0, 300) || 'nothing settled within twenty seconds',
  )

  const finished = sectionOf(pseudonymName(target.account.id))
  const afterText = (await finished.innerText()).replace(/\s+/g, ' ')
  check(
    'the finished card names the pseudonym',
    /Erased investor [0-9a-f]{12}/.test(afterText),
    afterText.slice(0, 300),
  )

  const erased = await db.query.investorAccounts.findFirst({
    where: eq(investorAccounts.id, target.account.id),
  })
  check(
    'the row is erased in the database',
    erased?.email === pseudonymEmail(target.account.id),
  )

  /*
   * **The check this script exists for, second half.**
   *
   * `store.get()` on every key the record held. Not `stat()` and not the row:
   * the row is what an erasure is *allowed* to rewrite without touching a byte,
   * and the whole question here is whether the bytes went with it.
   */
  const stillThere: string[] = []
  for (const key of targetKeys.all) {
    if ((await store.get(key)) !== null) stillThere.push(key)
  }
  check(
    `all ${targetKeys.all.length} of the erased investor's stored files are gone from the store`,
    stillThere.length === 0,
    `${stillThere.length} survived`,
  )

  /*
   * The neighbour, byte for byte.
   *
   * The store is a flat namespace of unguessable keys and knows nothing about
   * who owns what. A `remove()` loop handed the wrong graph destroys another
   * investor's documents silently: no error, no audit row, and a screen that
   * says the erasure succeeded — because it did.
   */
  const neighbourLost: string[] = []
  for (const key of neighbourKeys.all) {
    if (!(await holdsItsOwnBytes(store, key))) neighbourLost.push(key)
  }
  check(
    `and all ${neighbourKeys.all.length} of the neighbour's are untouched, content included`,
    neighbourLost.length === 0,
    `${neighbourLost.length} were destroyed or altered`,
  )

  /*
   * The same claim from the store's side rather than from the rows'.
   *
   * A key redacted out of its row but left in the bucket is invisible to every
   * check above, and it is a retention failure rather than a tidiness one: an
   * investor who asked to be erased still has a signed agreement sitting in
   * object storage. `list()` is the only read that can see it.
   */
  const listedAfter = await store.list(1000)
  const orphans = listedAfter.objects
    .map((object) => object.key)
    .filter((key) => targetKeys.all.includes(key))
  check(
    'and the store itself lists none of them — no object outlives its row',
    !listedAfter.truncated && orphans.length === 0,
    `${orphans.length} orphaned objects, truncated=${listedAfter.truncated}`,
  )
  check(
    'while the neighbour’s objects are all still listed',
    neighbourKeys.all.every((key) => listedAfter.objects.some((object) => object.key === key)),
  )
  check(
    'and the store lost exactly the erased investor’s objects and no others',
    listedBefore.objects.length - listedAfter.objects.length === targetKeys.all.length,
    `${listedBefore.objects.length} before, ${listedAfter.objects.length} after`,
  )

  /*
   * The rows the keys came off, checked for the treatment the plan declares.
   *
   * `documentPackages.storageKey` is `notNull`, so it is overwritten with
   * `ERASED_STORAGE_KEY` — a value that names nothing and is skipped by
   * `readGraph`, which is what makes a second erasure a no-op rather than a
   * second delete. `participationCertificates.storageKey` is nullable and is
   * cleared. A row still carrying a live key after the bytes are gone is a
   * download that 404s for ever and a `media:check` that reports a fault.
   */
  const offerIds = (
    await db
      .select({ id: offers.id })
      .from(offers)
      .where(eq(offers.accountId, target.account.id))
  ).map((row) => row.id)

  const documentRows = await db
    .select({ key: documentPackages.storageKey })
    .from(documentPackages)
    .where(inArray(documentPackages.offerId, offerIds))
  check(
    'every document row now carries the erased marker rather than a live key',
    documentRows.length > 0 && documentRows.every((row) => row.key === ERASED_STORAGE_KEY),
    documentRows.map((row) => row.key).join(', '),
  )

  const certificateRows = await db
    .select({ key: participationCertificates.storageKey })
    .from(participationCertificates)
    .where(inArray(participationCertificates.offerId, offerIds))
  check(
    'and every certificate row has had its key cleared',
    certificateRows.length > 0 && certificateRows.every((row) => row.key === null),
    certificateRows.map((row) => row.key ?? 'null').join(', '),
  )

  /*
   * The neighbour's rows, which nothing has yet asked about on this page.
   *
   * Their bytes are proved present above. Their *rows* still naming those bytes
   * is the other half: a sweep that cleared every key in the two tables and
   * happened not to delete the objects would pass every check above and leave
   * the neighbour with documents nobody can download.
   */
  const neighbourAfter = await storedKeysFor(neighbour.account.id)
  check(
    `the neighbour's ${neighbourKeys.all.length} rows still name their own keys`,
    neighbourAfter.all.length === neighbourKeys.all.length &&
      neighbourAfter.all.every((key) => neighbourKeys.all.includes(key)),
    `${neighbourAfter.all.length} keys after`,
  )

  /*
   * Nothing on the finished page says another investor exists, which is rule 5
   * applied to the screen this journey ends on.
   */
  const wholePage = await onScreen(page)
  check(
    'and no part of the finished page repeats the erased address',
    !wholePage.includes(target.investorEmail),
  )

  await context.close()
}

// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  if (OWNER_EMAIL === '') {
    console.error('OWNER_EMAILS is empty, so there is no owner to sign in as.')
    process.exitCode = 1
    return
  }

  console.log('Erasure — the bytes, destroyed through a browser')
  console.log(`  ${ORIGIN}\n`)

  await removeErasureFixture(TARGET_PREFIX)
  await removeErasureFixture(NEIGHBOUR_PREFIX)

  const owner = await db.query.users.findFirst({ where: eq(users.email, OWNER_EMAIL) })
  if (!owner) {
    console.error(`No user row for ${OWNER_EMAIL}. Run \`pnpm db:seed\` first.`)
    process.exitCode = 1
    return
  }
  const restore = owner.passwordHash
  const restoreSetAt = owner.passwordSetAt
  await db
    .update(users)
    .set({ passwordHash: await hashPassword(CHOSEN_PASSWORD), passwordSetAt: new Date() })
    .where(eq(users.id, owner.id))

  /*
   * A store this run owns outright.
   *
   * `MEDIA_DIR` from `.env` could be a developer's real media library, and this
   * script writes into the store and then deletes from it. A temporary
   * directory removed at the end is the only version of that which is safe to
   * run twice.
   */
  const mediaDirectory = await mkdtemp(join(tmpdir(), 'erasure-bytes-'))
  const previousStore = process.env.MEDIA_STORE
  const previousDirectory = process.env.MEDIA_DIR
  process.env.MEDIA_STORE = 'filesystem'
  process.env.MEDIA_DIR = mediaDirectory
  resetEnvCache()
  resetMediaStoreCache()

  const store = mediaStore()
  if (!store) {
    console.error('A filesystem media store could not be configured for this run.')
    process.exitCode = 1
    return
  }

  let server: ChildProcess | null = null
  let browser: Browser | null = null
  try {
    server = await startServer(mediaDirectory)
    browser = await launchBrowser()
    await journey(browser, store)
  } finally {
    await browser?.close()
    if (server) {
      try {
        process.kill(-server.pid!, 'SIGTERM')
      } catch {
        server.kill('SIGTERM')
      }
    }

    await db
      .update(users)
      .set({ passwordHash: restore, passwordSetAt: restoreSetAt })
      .where(eq(users.id, owner.id))
    await removeErasureFixture(TARGET_PREFIX)
    await removeErasureFixture(NEIGHBOUR_PREFIX)
    await rm(mediaDirectory, { recursive: true, force: true })

    if (previousStore === undefined) delete process.env.MEDIA_STORE
    else process.env.MEDIA_STORE = previousStore
    if (previousDirectory === undefined) delete process.env.MEDIA_DIR
    else process.env.MEDIA_DIR = previousDirectory
    resetEnvCache()
    resetMediaStoreCache()
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
