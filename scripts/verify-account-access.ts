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
  accountStatusEvents,
  auditEvents,
  conversationMessages,
  documentPackages,
  emailChangeRequests,
  emailSnapshots,
  fundsReceipts,
  interestRegisterEntries,
  investorAccounts,
  investorResponses,
  offerStatusEvents,
  offers,
  operatorInvites,
  participationCertificates,
  qaEntries,
  qaThreadMessages,
  recipients,
  rounds,
  sessions,
  users,
} from '@/db/schema'
import { ERASED_STORAGE_KEY, pseudonymEmail } from '@/lib/erasure/plan'
import { newStorageKey } from '@/lib/media/store'
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

/** The operator, so the erasure section can be checked absent for that role. */
const OPERATOR_EMAIL = (process.env.OPERATOR_EMAILS ?? '').split(',')[0]?.trim() ?? ''

/** Fixtures for the erasure journey, all prefixed so cleanup can find them. */
const ERASURE_PREFIX = 'AccessVerifyErasure'

/**
 * The sixteen lines the erasure card can draw, and a **different** number
 * against every one of them.
 *
 * The point of the distinct numbers is the only thing this can prove that a
 * unit test cannot. `erasureLines()` in `investors/page.tsx` is sixteen
 * hand-written pairs of a sentence and a field name, and the failure available
 * to it is not a crash but a *swap* — `documentPackages` drawn against
 * "certificates blanked", `qaEntries` against "follow-up messages". Every count
 * is then a real number computed by a real query and every sentence is true of
 * something; it is simply true of the wrong thing. On a fixture where the rows
 * are one of each, or three of two kinds, that swap renders identically and no
 * assertion anywhere can see it.
 *
 * So the fixture holds one row of one kind, two of another, and so on to
 * sixteen, and the screen is read for all sixteen sentences with their numbers
 * attached. Any permutation of the labels moves at least two numbers.
 *
 * The values are not arbitrary where the schema has an opinion. `register
 * entries` is 1 because `interest_register_entries.account_id` is unique;
 * `recipients` is 2 and `offers` is 5 because `offers_recipient_idx` is unique,
 * so two offers carry a recipient and three carry none; `bank references` is 3
 * because `funds_receipts.offer_id` is unique and there are five offers. The
 * ceiling on the other thirteen is nothing but this list.
 *
 * `stored files` is 7 = the four document packages plus three of the six
 * certificates, which are the certificates given a storage key. That is also
 * what makes the *first* phase of the journey possible: a record with stored
 * files and no media store configured is the one state in which the card
 * refuses to offer the form at all.
 */
const ERASURE_COUNTS: readonly { readonly label: string; readonly n: number }[] = [
  { label: 'offers, whose figures stay', n: 5 },
  { label: 'stored files destroyed outright', n: 7 },
  { label: 'document records redacted', n: 4 },
  { label: 'conversation messages redacted', n: 9 },
  { label: 'emails as sent, redacted', n: 8 },
  { label: 'questions redacted and unpublished', n: 10 },
  { label: 'follow-up messages on those questions', n: 11 },
  { label: 'response messages cleared', n: 12 },
  { label: 'bank references redacted', n: 3 },
  { label: 'certificates blanked', n: 6 },
  { label: 'imported recipient rows pseudonymised', n: 2 },
  { label: 'status-change reasons redacted', n: 13 },
  { label: 'stage-change notes cleared', n: 14 },
  { label: 'address-change requests pseudonymised', n: 15 },
  { label: 'register entries with their reason cleared', n: 1 },
  { label: 'audit rows relabelled — none removed', n: 16 },
]

/** How many of the six certificates carry a storage key. */
const CERTIFICATES_WITH_A_STORED_FILE = 3

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
/**
 * One investor holding a different number of rows of each of sixteen kinds.
 *
 * Every number here comes from `ERASURE_COUNTS` rather than from a literal, so
 * the list a reader checks the screen against and the list the database is
 * built from cannot drift apart. What is *not* shared is the sentence: those
 * are typed out in `ERASURE_COUNTS` and read off the screen, and neither side
 * imports `erasureLines()`. A test that took its expected wording from the code
 * under test would pass a relabelling, which is the whole failure being hunted.
 */
async function seedErasureFixture(): Promise<{
  account: { id: string }
  investorEmail: string
  offer: { id: string }
}> {
  const want = (label: string): number => {
    const row = ERASURE_COUNTS.find((entry) => entry.label === label)
    if (!row) throw new Error(`No expected count declared for “${label}”.`)
    return row.n
  }
  const times = (n: number): number[] => Array.from({ length: n }, (_, index) => index)

  const [round] = await db
    .insert(rounds)
    .values({
      name: `${ERASURE_PREFIX} round`,
      aggregateTargetUsd: '250000.00',
      flipitShare: '30.000000',
    })
    .returning()

  const investorEmail = `${ERASURE_PREFIX}-target@example.invalid`

  const [account] = await db
    .insert(investorAccounts)
    .values({ email: investorEmail, name: `${ERASURE_PREFIX} Target`, status: 'ACTIVE' })
    .returning()

  // `offers_recipient_idx` is unique, so a recipient carries at most one offer.
  // Two recipients and five offers is therefore three offers with none — which
  // is an ordinary state (an account claimed without an import behind it) and
  // the only way these two counts can differ.
  const recipientRows = await db
    .insert(recipients)
    .values(
      times(want('imported recipient rows pseudonymised')).map((index) => ({
        roundId: round!.id,
        name: `${ERASURE_PREFIX} Target ${index}`,
        email: `${ERASURE_PREFIX}-target-${index}@example.invalid`,
        jurisdiction: 'GB',
        internalNotes: `Wants the short version. Row ${index}.`,
      })),
    )
    .returning()

  const offerRows = await db
    .insert(offers)
    .values(
      times(want('offers, whose figures stay')).map((index) => ({
        roundId: round!.id,
        accountId: account!.id,
        recipientId: recipientRows[index]?.id ?? null,
        proposedAmountUsd: `${10000 + index}.00`,
        spvPercentage: '1.000000',
        indirectPercentage: '0.300000',
        responseDeadline: '2026-09-01',
        responseNote: `Offer ${index}: yes, from the erasure screen fixture.`,
      })),
    )
    .returning()

  /** Round-robin across the offers, so no count is trapped by a unique index. */
  const onOffer = (index: number): string => offerRows[index % offerRows.length]!.id

  await db.insert(accountStatusEvents).values(
    times(want('status-change reasons redacted')).map((index) => ({
      accountId: account!.id,
      fromStatus: 'INVITED' as const,
      toStatus: 'ACTIVE' as const,
      reason: `Status reason ${index} from the erasure screen fixture.`,
    })),
  )

  await db.insert(offerStatusEvents).values(
    times(want('stage-change notes cleared')).map((index) => ({
      offerId: onOffer(index),
      fromStage: 'INVITATION_SENT' as const,
      toStage: 'RESPONSE_RECORDED' as const,
      reason: `Stage reason ${index} from the erasure screen fixture.`,
      internalNote: `Internal note ${index} from the erasure screen fixture.`,
    })),
  )

  await db.insert(emailSnapshots).values(
    times(want('emails as sent, redacted')).map((index) => ({
      offerId: onOffer(index),
      kind: 'INVITATION' as const,
      subject: `Snapshot ${index} from the erasure screen fixture`,
      htmlBody: `<p>Snapshot ${index}.</p>`,
      textBody: `Snapshot ${index}.`,
      fromAddress: 'serenedavid@example.invalid',
      fromName: 'David Serene',
      toAddress: investorEmail,
      templateHash: 'b'.repeat(64),
    })),
  )

  await db.insert(conversationMessages).values(
    times(want('conversation messages redacted')).map((index) => ({
      accountId: account!.id,
      offerId: onOffer(index),
      direction: index % 2 === 1 ? ('FROM_OPERATOR' as const) : ('FROM_INVESTOR' as const),
      body: `Message ${index} from the erasure screen fixture.`,
    })),
  )

  await db.insert(investorResponses).values(
    times(want('response messages cleared')).map((index) => ({
      offerId: onOffer(index),
      choice: 'INTERESTED' as const,
      message: `Response ${index} from the erasure screen fixture.`,
    })),
  )

  await db.insert(emailChangeRequests).values(
    times(want('address-change requests pseudonymised')).map((index) => ({
      accountId: account!.id,
      newEmail: `${ERASURE_PREFIX}-new-${index}@example.invalid`,
      previousEmail: investorEmail,
      tokenHash: `${ERASURE_PREFIX}-change-${index}`,
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    })),
  )

  // `funds_receipts.offer_id` is unique, so this one is capped by the offers.
  await db.insert(fundsReceipts).values(
    times(want('bank references redacted')).map((index) => ({
      offerId: offerRows[index]!.id,
      amount: '1000.00',
      currency: 'USD',
      valueDate: '2026-07-20',
      reference: `SWIFT ref ${index} from the erasure screen fixture`,
    })),
  )

  await db.insert(documentPackages).values(
    times(want('document records redacted')).map((index) => ({
      offerId: onOffer(index),
      title: `Subscription agreement ${index}`,
      description: `Document ${index} from the erasure screen fixture.`,
      storageKey: newStorageKey('doc'),
      contentType: 'application/pdf',
      sizeBytes: 1024 + index,
    })),
  )

  // Only some of the certificates carry a stored file, which is the ordinary
  // state — a certificate is regenerated from `data` and normally stores
  // nothing. It also makes "stored files" a number that is neither the
  // documents nor the certificates.
  await db.insert(participationCertificates).values(
    times(want('certificates blanked')).map((index) => ({
      offerId: onOffer(index),
      version: index + 1,
      storageKey: index < CERTIFICATES_WITH_A_STORED_FILE ? newStorageKey('doc') : null,
      data: { name: `${ERASURE_PREFIX} Target`, amountUsd: '10000.00' },
    })),
  )

  const entryRows = await db
    .insert(qaEntries)
    .values(
      times(want('questions redacted and unpublished')).map((index) => ({
        askedByAccountId: account!.id,
        offerId: onOffer(index),
        questionOriginal: `Question ${index} from the erasure screen fixture.`,
        questionPublic: `Question ${index}?`,
        answer: 'When David presses the button.',
        isPublished: true,
        publishedAt: new Date(),
      })),
    )
    .returning()

  await db.insert(qaThreadMessages).values(
    times(want('follow-up messages on those questions')).map((index) => ({
      entryId: entryRows[index % entryRows.length]!.id,
      direction: 'FROM_INVESTOR' as const,
      body: `Follow-up ${index} from the erasure screen fixture.`,
    })),
  )

  // Unique per account, so this one can only ever be 1.
  await db.insert(interestRegisterEntries).values(
    times(want('register entries with their reason cleared')).map(() => ({
      accountId: account!.id,
      joinedAt: new Date(),
      indicativeAmountUsd: '25000.00',
      overrideReason: 'Asked to be first and David agreed.',
    })),
  )

  await db.insert(auditEvents).values(
    times(want('audit rows relabelled — none removed')).map((index) => ({
      actorAccountId: account!.id,
      actorLabel: investorEmail,
      entityType: 'portal',
      entityId: account!.id,
      action: 'portal.signed_in',
      metadata: { method: 'link', index },
    })),
  )

  return { account: account!, investorEmail, offer: offerRows[0]! }
}

/**
 * The erasure screen, driven in a browser. OPEN_DECISIONS.md item 12.
 *
 * **This screen had never been rendered when it was written.** Every claim
 * about it was proved at the source or in a unit test: that the action refuses
 * an operator, that the confirmation is compared case-insensitively, that the
 * counts are computed on the server. All true, and none of them is the question
 * a person asks, which is *does the page come up and does the button work*.
 *
 * `verify:erasure` drives the service against a real database and cannot answer
 * that either — it never renders anything. So this is where the two halves meet:
 * a real server, a real browser, a real form, and the database read back
 * afterwards.
 *
 * Four things, in the order they would bite:
 *
 *   1. The page renders at all for an owner, with the section on it.
 *   2. The counts on it are the real ones, not placeholders — **all sixteen of
 *      them, each against a different number**. See `ERASURE_COUNTS`.
 *   3. The wrong address refuses, and refuses *visibly* — a destructive form
 *      that silently does nothing is the worst outcome available here.
 *   4. The right address erases, and the row afterwards proves it.
 *
 * And the fifth, which is a claim about somebody who is not the owner: the
 * section is **absent** for an operator, not disabled.
 *
 * ---
 *
 * **It runs in two phases, and the first one is a refusal.** The fixture is
 * seeded holding stored files, and no media store is configured for the server
 * this script starts — which is the state `previewErasure` calls `blockedBy`.
 * A blocked card draws the count list and then a notice *instead of* the form,
 * so phase one is where the sixteen sentences are read and where that notice is
 * seen on a screen for the first time. Phase two takes the storage keys away —
 * the same thing an erasure does to them — and the form appears.
 *
 * That ordering is not a convenience. `blockedBy` is computed from the media
 * store, which is process-wide, so the only way to render both branches without
 * standing up a second server is to change the record between them.
 */
async function erasureScreen(browser: Browser): Promise<void> {
  console.log('\nThe erasure screen, in a browser')

  const { account, investorEmail, offer } = await seedErasureFixture()

  const context = await browser.newContext()
  const page = await context.newPage()
  await signInWithPassword(page, OWNER_EMAIL, CHOSEN_PASSWORD)

  const landed = await land(page, '/investors')
  check('the owner reaches the investors screen', landed === '/investors', `landed on ${landed}`)

  const text = await onScreen(page)
  check('the erasure section is on the page', text.includes('Erase their personal data'))

  /*
   * The section is a `<details>` and it starts closed, so everything below has
   * to open it — and open it *again* after every submit, because a server
   * action re-renders the card and the element goes back to closed. The first
   * version of this check read the page without opening anything and passed on
   * the summary alone; the second submitted into a collapsed form. Both are the
   * reason this helper exists rather than three inline clicks.
   */
  const section = page.locator('details', { hasText: 'Erase their personal data' }).first()

  async function openSection(expect: 'a form' | 'no form' = 'a form'): Promise<string> {
    if (!(await section.evaluate((node) => (node as HTMLDetailsElement).open))) {
      await section.locator('summary').click()
    }
    if (expect === 'a form') {
      await section.locator('form input[name="confirmation"]').waitFor({ state: 'visible' })
    } else {
      // A blocked card has no form to wait for, so the wait is for the thing it
      // has instead. Waiting for nothing at all would read the card mid-render.
      await section.locator('[role="alert"], .notice, li').first().waitFor({ state: 'visible' })
    }
    return (await section.innerText()).replace(/\s+/g, ' ')
  }

  // ---- phase one: blocked, because the record holds stored files -----------
  const blocked = await openSection('no form')
  check(
    'opened, it says what erasing is and is not',
    /cannot be undone/.test(blocked) && /not the same as closing an account/.test(blocked),
    blocked.slice(0, 300),
  )

  /*
   * All sixteen sentences, each with its own number.
   *
   * Read `ERASURE_COUNTS` for why the numbers are all different. The failure
   * this catches and no unit test can is a label drawn against the wrong field:
   * every count is then a real number and every sentence is true of something.
   */
  let sentencesWrong = 0
  for (const row of ERASURE_COUNTS) {
    const wanted = `${row.n} ${row.label}`
    if (blocked.includes(wanted)) continue
    sentencesWrong += 1
    check(`the card says “${wanted}”`, false, blocked.slice(0, 900))
  }
  check(
    `all sixteen count lines are on the screen, each with its own number`,
    sentencesWrong === 0,
    `${sentencesWrong} of ${ERASURE_COUNTS.length} were wrong or missing`,
  )
  check(
    'and the numbers really are all different, so a swapped label cannot pass',
    new Set(ERASURE_COUNTS.map((row) => row.n)).size === ERASURE_COUNTS.length,
  )

  /*
   * The refusal, on a screen.
   *
   * `previewErasure` sets `blockedBy` when the record holds stored files and no
   * media store is configured, and `verify:erasure` proves the service returns
   * it. Until now nothing had ever *rendered* it: the `<Notice>` that replaces
   * the whole form in that state had never been on a page. A destructive form
   * that appears when the bytes cannot be destroyed would be the worst of the
   * available bugs here, and it was one component branch away.
   */
  check(
    'a record holding stored files, with no media store, says so on the screen',
    /no media store is configured/.test(blocked) && /cannot be destroyed/.test(blocked),
    blocked.slice(0, 600),
  )
  check(
    'and offers no form at all — not a disabled one',
    (await section.locator('input[name="confirmation"]').count()) === 0 &&
      (await section.locator('input[name="acknowledged"]').count()) === 0,
  )
  check(
    'and names the variable to set rather than only refusing',
    /MEDIA_STORE/.test(blocked),
    blocked.slice(0, 600),
  )

  /*
   * ---- phase two: the storage keys go, and the form comes back ------------
   *
   * This is the same edit an erasure makes to these two columns, done by hand
   * so that the rest of the journey can run on a server that has no media
   * store. Everything else about the record is untouched, so the fifteen other
   * counts below are unchanged.
   */
  const offerIdsForFixture = (
    await db.select({ id: offers.id }).from(offers).where(eq(offers.accountId, account.id))
  ).map((row) => row.id)
  await db
    .update(documentPackages)
    .set({ storageKey: ERASED_STORAGE_KEY })
    .where(inArray(documentPackages.offerId, offerIdsForFixture))
  await db
    .update(participationCertificates)
    .set({ storageKey: null })
    .where(inArray(participationCertificates.offerId, offerIdsForFixture))

  await land(page, '/investors')
  const opened = await openSection()
  check(
    'with no stored files left, the refusal is gone and the form is offered',
    !/no media store is configured/.test(opened) &&
      (await section.locator('input[name="confirmation"]').count()) === 1,
    opened.slice(0, 400),
  )
  check(
    'the stored-files line goes with them, rather than reading zero',
    !/stored files destroyed outright/.test(opened),
    opened.slice(0, 400),
  )
  check(
    'and the other fifteen counts are exactly as they were',
    ERASURE_COUNTS.filter((row) => row.label !== 'stored files destroyed outright').every((row) =>
      opened.includes(`${row.n} ${row.label}`),
    ),
    opened.slice(0, 900),
  )
  check(
    'and there is no reason box, which is the deliberate part',
    (await section.locator('textarea').count()) === 0,
  )

  /*
   * Submit, and wait for the banner the action is expected to produce.
   *
   * `waitForLoadState('networkidle')` is not enough and the first version of
   * this used it: a server action does not navigate, so on a page that is
   * already idle the wait resolves before the action has run and the next
   * assertion reads the screen as it was. The refusal happened to pass that way
   * and the success did not, which is the worst possible version of a race —
   * one that makes a failure look like a defect in the thing being tested.
   *
   * `ActionForm` renders `role="alert"` for a refusal and `role="status"` for a
   * success, so waiting for the specific one is both a wait and an assertion.
   */
  async function submit(address: string, expect: 'refused' | 'erased'): Promise<string> {
    await openSection()
    const form = section.locator('form')
    await form.locator('input[name="confirmation"]').fill(address)
    const acknowledge = form.locator('input[name="acknowledged"]')
    if (!(await acknowledge.isChecked())) await acknowledge.check()
    await form.locator('button[type="submit"]').click()

    // Scoped to this card. `page.locator(...).first()` picks the first banner in
    // the whole document, which on a page listing every investor is somebody
    // else's card — and it reads as a failure of the form under test.
    if (expect === 'refused') {
      const banner = section.locator('[role="alert"]').first()
      await banner.waitFor({ state: 'visible', timeout: 20_000 })
      return (await banner.innerText()).replace(/\s+/g, ' ')
    }

    // A success revalidates the page, so what to wait for is the *form going
    // away*, not a banner arriving. See the note below the call.
    await section
      .locator('input[name="confirmation"]')
      .waitFor({ state: 'detached', timeout: 20_000 })
    return ''
  }

  // ---- the wrong address --------------------------------------------------
  const afterWrong = await submit('somebody.else@example.invalid', 'refused')
  check(
    'a wrong address is refused, and says so on the screen',
    /does not match the account/.test(afterWrong),
    afterWrong.slice(0, 400),
  )

  const untouched = await db.query.investorAccounts.findFirst({
    where: eq(investorAccounts.id, account.id),
  })
  check('and the record is untouched', untouched?.email === investorEmail)

  // ---- the right address --------------------------------------------------
  await submit(investorEmail, 'erased')

  /*
   * **The success banner is not what is checked here, and that is a finding.**
   *
   * The action revalidates `/investors`, which re-renders this card into its
   * finished state and unmounts the form — and the `role="status"` banner with
   * it. So the sentence naming the pseudonym, which `DEPLOYMENT.md §12.2` tells
   * the owner to write down, was on screen for a fraction of a second and then
   * gone for ever. Nothing but a browser could have found that: every unit test
   * asserts on the returned `ActionState`, which was correct all along.
   *
   * The fix is that the finished state carries the pseudonym permanently, so it
   * is checked there instead — which is a better place for it than a banner.
   */
  const finished = page.locator('details', { hasText: 'Erase their personal data' }).first()
  const afterRight = (await finished.innerText()).replace(/\s+/g, ' ')
  check(
    'the finished card names the pseudonym, permanently rather than in a banner',
    /Erased investor [0-9a-f]{12}/.test(afterRight),
    afterRight.slice(0, 400),
  )
  check(
    'and does not repeat the erased address back',
    !afterRight.includes(investorEmail) && !afterRight.includes('Target'),
  )

  const erased = await db.query.investorAccounts.findFirst({
    where: eq(investorAccounts.id, account.id),
  })
  check('the row is erased in the database', erased?.email === pseudonymEmail(account.id))
  check('and archived', erased?.status === 'ARCHIVED')

  const bodies = await db
    .select({ body: conversationMessages.body })
    .from(conversationMessages)
    .where(eq(conversationMessages.accountId, account.id))
  const wantedMessages = ERASURE_COUNTS.find(
    (row) => row.label === 'conversation messages redacted',
  )!.n
  check(
    `all ${wantedMessages} messages are redacted, and every one of them`,
    bodies.length === wantedMessages && bodies.every((row) => !row.body.includes('fixture')),
    `${bodies.filter((row) => row.body.includes('fixture')).length} still hold the fixture text`,
  )

  /*
   * The free text everywhere else, swept the same way.
   *
   * The count list is a promise about sixteen kinds of row, and the journey has
   * so far read it on a screen and then checked one of the sixteen in the
   * database. These are the rest: every table the list names, asked whether any
   * row of it still carries the word the fixture wrote into its free text.
   *
   * `funds_receipts.reference` is deliberately in here. It is the one an
   * investor's bank statement identifies them by, and it is `notNull`, so it is
   * redacted rather than cleared — a sweep that only looked for nulls would
   * report it clean while it still read SWIFT REF TARGET.
   */
  const leftovers: string[] = []
  const sweep = async (name: string, rows: (string | null)[]): Promise<void> => {
    const dirty = rows.filter((value) => value !== null && value.includes('fixture')).length
    if (dirty > 0) leftovers.push(`${name} (${dirty})`)
  }
  await sweep(
    'account_status_events.reason',
    (
      await db
        .select({ v: accountStatusEvents.reason })
        .from(accountStatusEvents)
        .where(eq(accountStatusEvents.accountId, account.id))
    ).map((row) => row.v),
  )
  await sweep(
    'email_change_requests.new_email',
    (
      await db
        .select({ v: emailChangeRequests.newEmail })
        .from(emailChangeRequests)
        .where(eq(emailChangeRequests.accountId, account.id))
    ).map((row) => row.v),
  )
  await sweep(
    'qa_entries.question_original',
    (
      await db
        .select({ v: qaEntries.questionOriginal })
        .from(qaEntries)
        .where(eq(qaEntries.askedByAccountId, account.id))
    ).map((row) => row.v),
  )
  await sweep(
    'interest_register_entries.override_reason',
    (
      await db
        .select({ v: interestRegisterEntries.overrideReason })
        .from(interestRegisterEntries)
        .where(eq(interestRegisterEntries.accountId, account.id))
    ).map((row) => row.v),
  )
  for (const [name, rows] of [
    [
      'offer_status_events.reason',
      (
        await db
          .select({ v: offerStatusEvents.reason })
          .from(offerStatusEvents)
          .where(inArray(offerStatusEvents.offerId, offerIdsForFixture))
      ).map((row) => row.v),
    ],
    [
      'email_snapshots.subject',
      (
        await db
          .select({ v: emailSnapshots.subject })
          .from(emailSnapshots)
          .where(inArray(emailSnapshots.offerId, offerIdsForFixture))
      ).map((row) => row.v),
    ],
    [
      'investor_responses.message',
      (
        await db
          .select({ v: investorResponses.message })
          .from(investorResponses)
          .where(inArray(investorResponses.offerId, offerIdsForFixture))
      ).map((row) => row.v),
    ],
    [
      'funds_receipts.reference',
      (
        await db
          .select({ v: fundsReceipts.reference })
          .from(fundsReceipts)
          .where(inArray(fundsReceipts.offerId, offerIdsForFixture))
      ).map((row) => row.v),
    ],
    [
      'document_packages.description',
      (
        await db
          .select({ v: documentPackages.description })
          .from(documentPackages)
          .where(inArray(documentPackages.offerId, offerIdsForFixture))
      ).map((row) => row.v),
    ],
    [
      'offers.response_note',
      (
        await db
          .select({ v: offers.responseNote })
          .from(offers)
          .where(inArray(offers.id, offerIdsForFixture))
      ).map((row) => row.v),
    ],
  ] as [string, (string | null)[]][]) {
    await sweep(name, rows)
  }
  const threadBodies = await db
    .select({ v: qaThreadMessages.body })
    .from(qaThreadMessages)
    .innerJoin(qaEntries, eq(qaThreadMessages.entryId, qaEntries.id))
    .where(eq(qaEntries.askedByAccountId, account.id))
  await sweep(
    'qa_thread_messages.body',
    threadBodies.map((row) => row.v),
  )
  check(
    'and no free text the fixture wrote survives anywhere the count list names',
    leftovers.length === 0,
    leftovers.join(', '),
  )

  const stillThere = await db
    .select({ amount: offers.proposedAmountUsd })
    .from(offers)
    .where(eq(offers.id, offer.id))
  check('and the amount is exactly as it was', stillThere[0]?.amount === '10000.00')

  // Reload: the section now says it has already been done, rather than offering
  // to do it again.
  await land(page, '/investors')
  const reloadedSection = page
    .locator('details', { hasText: 'Erase their personal data' })
    .first()
  await reloadedSection.locator('summary').click()
  const reloaded = (await reloadedSection.innerText()).replace(/\s+/g, ' ')
  check(
    'a reload offers no form, and still names the pseudonym',
    /This record has been erased/.test(reloaded) &&
      /Erased investor [0-9a-f]{12}/.test(reloaded) &&
      (await reloadedSection.locator('input[name="confirmation"]').count()) === 0,
    reloaded.slice(0, 300),
  )

  await context.close()
}

/**
 * The same screen, as the operator. The section is absent, not disabled.
 */
async function erasureIsAbsentForTheOperator(browser: Browser): Promise<void> {
  console.log('\nThe erasure screen, as the operator')

  if (OPERATOR_EMAIL === '') {
    check('OPERATOR_EMAILS is set, so there is an operator to check', false)
    return
  }

  const context = await browser.newContext()
  const page = await context.newPage()
  await signInWithPassword(page, OPERATOR_EMAIL, CHOSEN_PASSWORD)

  const landed = await land(page, '/investors')
  check('the operator reaches the investors screen', landed === '/investors', `landed on ${landed}`)

  const text = await onScreen(page)
  check(
    'and can still change somebody’s status, which is theirs to do',
    text.includes('Change their status'),
  )
  check(
    'but the erasure section is not on the page at all',
    !text.includes('Erase their personal data'),
  )
  check(
    'and there is no greyed-out control telling them what they cannot do',
    (await page.locator('input[name="acknowledged"]').count()) === 0,
  )

  await context.close()
}

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

/**
 * The erasure fixture, removed by round rather than by email prefix — after a
 * successful run the account no longer carries the prefix, which is the point.
 */
async function cleanUpErasureFixture(): Promise<void> {
  const roundRows = await db
    .select({ id: rounds.id })
    .from(rounds)
    .where(eq(rounds.name, `${ERASURE_PREFIX} round`))
  if (roundRows.length === 0) return
  const roundIds = roundRows.map((row) => row.id)

  const ownedOffers = await db
    .select({ id: offers.id, accountId: offers.accountId })
    .from(offers)
    .where(inArray(offers.roundId, roundIds))
  const offerIds = ownedOffers.map((row) => row.id)
  const accountIds = [...new Set(ownedOffers.map((row) => row.accountId))]

  if (offerIds.length > 0) {
    await db.delete(conversationMessages).where(inArray(conversationMessages.offerId, offerIds))
    // `qa_entries.offer_id` has no `onDelete`, so the offers cannot go first.
    // Everything else the fixture writes cascades from an offer or an account.
    await db.delete(qaEntries).where(inArray(qaEntries.offerId, offerIds))
    await db.delete(offers).where(inArray(offers.id, offerIds))
  }
  if (accountIds.length > 0) {
    await db.delete(conversationMessages).where(inArray(conversationMessages.accountId, accountIds))
    await db.delete(qaEntries).where(inArray(qaEntries.askedByAccountId, accountIds))
    await db.delete(auditEvents).where(inArray(auditEvents.actorAccountId, accountIds))
    await db.delete(auditEvents).where(inArray(auditEvents.entityId, accountIds))
    await db.delete(investorAccounts).where(inArray(investorAccounts.id, accountIds))
  }
  await db.delete(recipients).where(inArray(recipients.roundId, roundIds))
  await db.delete(rounds).where(inArray(rounds.id, roundIds))
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
  await cleanUpErasureFixture()
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

  // The operator signs in for one check — that the erasure section is absent
  // for that role. Their password is set here and put back at the end, exactly
  // as the owner's is.
  const operator = OPERATOR_EMAIL
    ? await db.query.users.findFirst({ where: eq(users.email, OPERATOR_EMAIL) })
    : undefined
  const restoreOperator = operator?.passwordHash ?? null
  if (operator) {
    await db
      .update(users)
      .set({ passwordHash: await hashPassword(CHOSEN_PASSWORD), passwordSetAt: new Date() })
      .where(eq(users.id, operator.id))
  }

  const server = await startServer()
  let browser: Browser | null = null

  try {
    browser = await launchBrowser()
    await firstRun(browser, OWNER_EMAIL)
    await viewer(browser)
    await erasureScreen(browser)
    await erasureIsAbsentForTheOperator(browser)
    await signedOut(browser)
  } finally {
    await browser?.close()
    try {
      process.kill(-server.pid!, 'SIGTERM')
    } catch {
      server.kill('SIGTERM')
    }

    await db.update(users).set({ passwordHash: restore }).where(eq(users.id, owner.id))
    if (operator) {
      await db
        .update(users)
        .set({ passwordHash: restoreOperator })
        .where(eq(users.id, operator.id))
    }
    await cleanUpErasureFixture()
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
