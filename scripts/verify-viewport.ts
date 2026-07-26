/**
 * Every screen, rendered in a real browser at 375px. BUILD_SPEC §13.2, WP18.
 *
 * §13.2: *"**Mobile first.** These are personal contacts who will open the
 * email on a phone. Every screen must be excellent at 375px before it is
 * considered at all on desktop."*
 *
 * CODEX_TASKS makes that the acceptance condition: *"every investor-facing
 * screen is verified at 375px and contrast passes."* Contrast is arithmetic
 * and is checked in the unit suite. Layout is not — whether a table pushes the
 * page sideways depends on the font, the content and the box model, and no
 * amount of reading the class list will tell you. So this drives a real
 * Chromium at 375x812, signs in as both a real administrator and a real
 * investor, and measures.
 *
 * What it checks on each screen:
 *
 *   1. **No horizontal scroll.** `scrollWidth` must not exceed the viewport.
 *      This is the one that matters most: a page that scrolls sideways on a
 *      securities document can put a figure off the edge of the screen with
 *      nothing to indicate it is there.
 *   2. **Nothing overflows the viewport box.** Every element's right edge is
 *      inside 375px, and the offender is named when one is not.
 *   3. **Every interactive element is at least 44px high** — WCAG 2.5.5, and
 *      the size a thumb needs.
 *   4. **Computed contrast on real rendered text.** The palette test proves
 *      the tokens are sound; this proves the tokens are what actually landed,
 *      including anywhere a class was mistyped and silently produced nothing.
 *   5. **The skip link reaches the main landmark** from the keyboard.
 *   6. **Nothing the browser complains about**, and no Content-Security-Policy
 *      violation. Added later than the rest, and it found one on its first run.
 *      The policy in `next.config.ts` had been verified by fetching the headers
 *      and reading them, which proves a header is *sent* and says nothing about
 *      what it *blocks*. A CSP that refuses something returns no error status,
 *      changes no markup and leaves the page looking right with one thing on it
 *      silently not working. `curl` cannot hear that; a browser can, and one was
 *      already open here.
 *
 * It creates its own data under an obvious prefix and deletes it at the end.
 * Run it against a development database only, with the app built:
 *
 *   pnpm build && pnpm tsx scripts/verify-viewport.ts
 *
 * `CHROMIUM_PATH` points it at a browser already on the machine, for an image or
 * a container whose Chromium does not match Playwright's pinned build.
 */

import 'dotenv/config'
import { spawn, type ChildProcess } from 'node:child_process'
import { eq, inArray, like } from 'drizzle-orm'
import { chromium, type Browser, type Page } from 'playwright'
import { db } from '@/db'
import {
  auditEvents,
  investorAccounts,
  investorSessions,
  offers,
  portalTokens,
  recipients,
  reminderEvents,
  rounds,
  users,
} from '@/db/schema'
import { hashPassword } from '@/lib/auth/password'
import { issueToken } from '@/lib/crypto'
import { AA_LARGE, AA_TEXT, contrastRatio, reportRatio } from '@/lib/contrast'

const PREFIX = 'wp18-viewport'
const PORT = 3210
const ORIGIN = `http://127.0.0.1:${PORT}`

/** iPhone SE / iPhone 13 mini in portrait — the narrowest phone still in use. */
const VIEWPORT = { width: 375, height: 812 }

const ADMIN_EMAIL = 'mike@flipthepage.com'
const ADMIN_PASSWORD = 'wp18-verify-not-a-real-password'

let passed = 0
let failed = 0

/** Whatever the application has written to its own stdout, for a failure. */
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
// Measurements, run inside the page
// ---------------------------------------------------------------------------

interface Overflow {
  tag: string
  cls: string
  right: number
  text: string
}

interface SmallTarget {
  tag: string
  height: number
  text: string
}

interface TextSample {
  colour: string
  background: string
  fontSize: number
  bold: boolean
  text: string
}

/**
 * Everything measured in one pass inside the page.
 *
 * There is deliberately not a single named inner function in here. `tsx`
 * compiles this file with esbuild's `keepNames`, which wraps every named
 * function in a `__name(...)` helper — a helper that exists in this process
 * and does not exist in the browser. The serialised function then throws
 * `ReferenceError: __name is not defined` the moment it runs. So the
 * background walk is written inline, as a loop, rather than as a tidy helper.
 */
async function measure(page: Page) {
  return page.evaluate((width: number) => {
    const overflowing: Overflow[] = []
    const smallTargets: SmallTarget[] = []
    const samples: TextSample[] = []

    const bodyBackground = getComputedStyle(document.body).backgroundColor

    for (const el of Array.from(document.querySelectorAll('body *'))) {
      const style = getComputedStyle(el)
      if (style.display === 'none' || style.visibility === 'hidden') continue

      const rect = el.getBoundingClientRect()
      if (rect.width === 0 && rect.height === 0) continue

      // An element inside a deliberate horizontal scroller is not an
      // overflow. The admin navigation is one: a tab strip wider than the
      // screen that scrolls sideways within its own box is a normal phone
      // pattern, and it is the *document* scrolling sideways that hides a
      // figure off the edge of a securities page. That is checked separately,
      // on `scrollWidth`, and is not affected by this exemption.
      let inScroller = false
      let ancestor: Element | null = el.parentElement
      while (ancestor && ancestor !== document.body) {
        const overflowX = getComputedStyle(ancestor).overflowX
        if (overflowX === 'auto' || overflowX === 'scroll') {
          inScroller = true
          break
        }
        ancestor = ancestor.parentElement
      }

      // 1px of tolerance: sub-pixel rounding on a border is not an overflow.
      if (!inScroller && rect.right > width + 1) {
        overflowing.push({
          tag: el.tagName.toLowerCase(),
          cls: (el.getAttribute('class') ?? '').slice(0, 80),
          right: Math.round(rect.right),
          text: (el.textContent ?? '').trim().slice(0, 60),
        })
      }

      const interactive =
        el.tagName === 'A' ||
        el.tagName === 'BUTTON' ||
        el.tagName === 'SELECT' ||
        el.tagName === 'TEXTAREA' ||
        (el.tagName === 'INPUT' &&
          (el as HTMLInputElement).type !== 'hidden' &&
          (el as HTMLInputElement).type !== 'checkbox' &&
          (el as HTMLInputElement).type !== 'radio')

      // WCAG 2.5.5 exempts a target "in a sentence or [whose] size is
      // otherwise constrained by the line-height of non-target text". A link
      // inside a paragraph is that exception, and enlarging one would mean
      // padding a word until it broke the line it sits in. `display: inline`
      // is exactly the condition, so the rule applies to buttons and to links
      // that have been made into buttons, and not to prose.
      const inlineInProse = style.display === 'inline'

      // The skip link is off-screen until it is focused; measuring it in its
      // resting state measures nothing. Its behaviour is checked separately,
      // by pressing Tab.
      const isSkipLink = el.classList.contains('skip-link')

      if (interactive && !inlineInProse && !isSkipLink && rect.height > 0 && rect.height < 44) {
        smallTargets.push({
          tag: el.tagName.toLowerCase(),
          height: Math.round(rect.height),
          text: (el.textContent ?? '').trim().slice(0, 40),
        })
      }

      // Text nodes only. An element whose children carry the text would
      // otherwise be sampled with its container's colour rather than the
      // colour the words are actually painted in.
      let ownText = ''
      for (const node of Array.from(el.childNodes)) {
        if (node.nodeType === 3) ownText += node.textContent ?? ''
      }
      ownText = ownText.trim()
      if (ownText.length === 0) continue

      // The first ancestor with a non-transparent background is what a person
      // sees the text against. `backgroundColor` on the element itself is
      // `rgba(0, 0, 0, 0)` almost everywhere, which would make every pairing
      // look like text on black and every ratio look excellent.
      let background = bodyBackground
      let node: Element | null = el
      while (node) {
        const bg = getComputedStyle(node).backgroundColor
        if (bg && bg !== 'transparent' && bg.indexOf('rgba(0, 0, 0, 0)') !== 0) {
          background = bg
          break
        }
        node = node.parentElement
      }

      samples.push({
        colour: style.color,
        background,
        fontSize: Number.parseFloat(style.fontSize),
        bold: Number.parseInt(style.fontWeight, 10) >= 700,
        text: ownText.slice(0, 50),
      })
    }

    return {
      scrollWidth: document.documentElement.scrollWidth,
      overflowing: overflowing.slice(0, 8),
      smallTargets: smallTargets.slice(0, 8),
      samples,
    }
  }, VIEWPORT.width)
}

/** `rgb(r, g, b)` or `rgba(r, g, b, a)` as rendered by Chromium. */
function cssColourToHex(value: string): string | null {
  const m = value.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)/)
  if (!m) return null
  return (
    '#' +
    [m[1], m[2], m[3]]
      .map((n) => Number(n).toString(16).padStart(2, '0'))
      .join('')
  )
}

/**
 * Everything the browser complained about on the screen being audited.
 *
 * Filled by listeners attached once in `watchTheConsole`, and emptied before
 * each navigation. A Content-Security-Policy violation arrives twice and both
 * are kept: Chromium logs "Refused to …" as a console error, and the document
 * fires a `securitypolicyviolation` event naming the directive. The second is
 * the useful one, because it says *which* rule refused rather than leaving
 * somebody to read the policy and guess.
 */
const complaints: string[] = []

/**
 * Listen for what `curl` cannot hear.
 *
 * The policy in `next.config.ts` was added and checked by fetching headers and
 * reading them. That proves the header is *sent* and proves nothing about what
 * it *blocks*. A CSP that refuses something the application needs returns no
 * error status, fails no header check and changes no markup — the page renders
 * and one thing on it silently stops working. That failure mode is named in the
 * policy's own notes and could not be tested from there: `camera=(self)` rather
 * than `camera=()` is in that file precisely because the tidy-looking denial
 * breaks the video recorder with no visible sign.
 *
 * The screens are already being opened here. They may as well be listened to.
 */
function watchTheConsole(page: Page): void {
  page.on('console', (message) => {
    if (message.type() !== 'error') return
    complaints.push(`console: ${message.text().slice(0, 240)}`)
  })

  page.on('pageerror', (error) => {
    complaints.push(`uncaught: ${error.message.slice(0, 240)}`)
  })

  // Named directives, from the document itself. `addInitScript` runs before any
  // page script on every navigation, so a violation during hydration is caught
  // as well as one from a later interaction.
  void page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (event) => {
      const violation = event as SecurityPolicyViolationEvent
      console.error(
        `CSP refused ${violation.violatedDirective}: ${violation.blockedURI || 'inline'}`,
      )
    })
  })
}

/**
 * Complaints that belong to the environment rather than to the application.
 *
 * Deliberately short. A list like this is how a real fault gets ignored, so
 * each entry has to be something that cannot be the application's doing.
 */
function isEnvironmental(complaint: string): boolean {
  return (
    // No favicon is served, and the browser says so on every page.
    /favicon\.ico/.test(complaint) ||
    // Chromium's own devtools probe, absent in this build.
    /\.well-known\/appspecific/.test(complaint)
  )
}

async function auditScreen(page: Page, label: string, path: string): Promise<void> {
  complaints.length = 0

  const response = await page.goto(`${ORIGIN}${path}`, { waitUntil: 'networkidle' })
  const status = response?.status() ?? 0
  check(`${label}: loads (${status})`, status < 400, `${path} returned ${status}`)
  if (status >= 400) return

  const heard = complaints.filter((c) => !isEnvironmental(c))
  const csp = heard.filter((c) => /CSP refused|Content Security Policy/i.test(c))

  check(
    `${label}: no Content-Security-Policy violation`,
    csp.length === 0,
    csp.slice(0, 3).join(' | '),
  )
  check(
    `${label}: the browser complains about nothing else`,
    heard.length === csp.length,
    heard
      .filter((c) => !csp.includes(c))
      .slice(0, 3)
      .join(' | '),
  )

  const result = await measure(page)

  check(
    `${label}: no horizontal scroll at ${VIEWPORT.width}px`,
    result.scrollWidth <= VIEWPORT.width,
    `document scrollWidth ${result.scrollWidth}px`,
  )

  check(
    `${label}: nothing overflows the viewport`,
    result.overflowing.length === 0,
    result.overflowing
      .map((o) => `<${o.tag} class="${o.cls}"> right=${o.right}px "${o.text}"`)
      .join(' | '),
  )

  check(
    `${label}: every tap target is at least 44px`,
    result.smallTargets.length === 0,
    result.smallTargets.map((t) => `<${t.tag}> ${t.height}px "${t.text}"`).join(' | '),
  )

  // Contrast, on what the browser actually painted.
  const failures: string[] = []
  for (const sample of result.samples) {
    const fg = cssColourToHex(sample.colour)
    const bg = cssColourToHex(sample.background)
    if (!fg || !bg) continue

    // WCAG's own definition of large text: 18.66px bold, or 24px.
    const large = sample.fontSize >= 24 || (sample.bold && sample.fontSize >= 18.66)
    const required = large ? AA_LARGE : AA_TEXT

    if (contrastRatio(fg, bg) < required) {
      failures.push(
        `"${sample.text}" ${fg} on ${bg} = ${reportRatio(fg, bg)}:1, needs ${required}:1`,
      )
    }
  }

  check(
    `${label}: every rendered string meets AA`,
    failures.length === 0,
    failures.slice(0, 4).join(' | '),
  )
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

async function cleanUp(): Promise<void> {
  const accounts = await db
    .select({ id: investorAccounts.id })
    .from(investorAccounts)
    .where(like(investorAccounts.email, `${PREFIX}%`))

  for (const account of accounts) {
    await db.delete(portalTokens).where(eq(portalTokens.accountId, account.id))
    await db.delete(investorSessions).where(eq(investorSessions.accountId, account.id))

    // Reminders first: a queued row references the offer, so deleting the offer
    // out from under one fails on the foreign key. The fault-branch check
    // inserts one and removes it in its own `finally`; this is the belt to that
    // brace, for the run that dies somewhere else entirely.
    const seeded = await db
      .select({ id: offers.id })
      .from(offers)
      .where(eq(offers.accountId, account.id))
    for (const offer of seeded) {
      await db.delete(reminderEvents).where(eq(reminderEvents.offerId, offer.id))
    }

    await db.delete(offers).where(eq(offers.accountId, account.id))
    await db.delete(investorAccounts).where(eq(investorAccounts.id, account.id))
  }

  await db.delete(recipients).where(like(recipients.email, `${PREFIX}%`))
  await db.delete(rounds).where(like(rounds.name, `${PREFIX}%`))
}

/**
 * An investor with an offer and an unspent claim token, so the portal renders
 * with real figures rather than as an empty state. The figures are deliberately
 * long — a five-figure amount and a three-decimal percentage — because a short
 * one would not test the layout at all.
 */
async function seedInvestor(): Promise<string> {
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
      name: 'Alexandra Fenwick-Harrington',
      email: `${PREFIX}@example.test`,
      status: 'ACTIVE',
    })
    .returning()

  await db.insert(recipients).values({
    roundId: round!.id,
    name: 'Alexandra Fenwick-Harrington',
    email: `${PREFIX}@example.test`,
    jurisdiction: 'GB',
  })

  await db.insert(offers).values({
    roundId: round!.id,
    accountId: account!.id,
    proposedAmountUsd: '12500.00',
    spvPercentage: '41.666667',
    indirectPercentage: '12.500000',
    responseDeadline: '2026-12-31',
  })

  const { token, hash } = issueToken()
  await db.insert(portalTokens).values({
    tokenHash: hash,
    accountId: account!.id,
    purpose: 'CLAIM',
    expiresAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
  })

  return token
}

/**
 * The seeded owner gets a known password so the browser can sign in the way a
 * person does — through the real form and the real server action, rather than
 * by having a session cookie forged for it.
 */
async function setAdminPassword(): Promise<void> {
  const hash = await hashPassword(ADMIN_PASSWORD)
  await db
    .update(users)
    .set({ passwordHash: hash, passwordSetAt: new Date(), passwordChangedAt: new Date() })
    .where(eq(users.email, ADMIN_EMAIL))
}

/**
 * Starts the built application and waits for it to answer.
 *
 * It polls the URL rather than watching stdout for the word "Ready". A server
 * that fails to bind — a stale process from an interrupted run still holding
 * the port — prints an error and exits, and a stdout watcher waits the full
 * timeout for a line that is never coming before reporting something that
 * sounds like slowness rather than the address already being in use.
 */
async function startServer(): Promise<ChildProcess> {
  // `next` directly rather than `pnpm start`. Going through pnpm puts two
  // processes between this script and the server — pnpm, then a shell — and
  // `child.kill()` reaches only the first of them, leaving the real server
  // running and holding the port after the run finishes. `detached` puts the
  // whole tree in its own process group so it can be signalled as one.
  const child = spawn('node_modules/.bin/next', ['start', '--port', String(PORT)], {
    cwd: process.cwd(),
    // APP_URL has to be this origin, not whatever .env says. Every portal
    // link the application builds embeds it — that is §18.1's whole point —
    // so a claim link issued by a server that thinks it lives on port 3000
    // redirects the browser to port 3000, and the run dies on a connection
    // refused that looks like the server having crashed.
    env: { ...process.env, PORT: String(PORT), APP_URL: ORIGIN, BASE_PATH: '' },
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
    if (exited) {
      throw new Error(`The server exited before it was ready:\n${output}`)
    }
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

/** Signals the whole process group, so no server survives the run. */
function stopServer(child: ChildProcess): void {
  if (child.pid === undefined) return
  try {
    process.kill(-child.pid, 'SIGTERM')
  } catch {
    child.kill('SIGTERM')
  }
}

// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log('\nWP18 — every screen at 375px, in a real browser\n')

  await cleanUp()
  const claimToken = await seedInvestor()
  await setAdminPassword()

  const server = await startServer()
  let browser: Browser | undefined

  try {
    // `CHROMIUM_PATH` lets a machine that already has a Chromium — a CI image,
    // this container — point at it rather than downloading a second copy that
    // has to match the Playwright version exactly. Unset, Playwright uses its
    // own, which is what a developer running `pnpm exec playwright install`
    // will have.
    const executablePath = process.env.CHROMIUM_PATH
    // Fake camera and microphone, so the recorder can actually be driven. This
    // supplies a device and auto-accepts the browser's own permission prompt;
    // it does NOT bypass the Permissions-Policy header, which Chromium enforces
    // before either. That is the point — see `verifyTheRecorder`.
    browser = await chromium.launch({
      ...(executablePath ? { executablePath } : {}),
      // A fake camera, and deliberately NOT `--use-fake-ui-for-media-stream`.
      // That flag auto-accepts everything, including a request the
      // Permissions-Policy header has already refused: with `camera=()` served,
      // `getUserMedia` still resolved and only the console violation gave it
      // away. A check that passes on a broken header is worse than no check.
      // The context grants the *user* permission instead, which is the part a
      // person supplies and the part a policy is not.
      args: ['--use-fake-device-for-media-stream'],
    })
    const context = await browser.newContext({
      viewport: VIEWPORT,
      deviceScaleFactor: 3,
      isMobile: true,
      hasTouch: true,
      permissions: ['camera', 'microphone'],
    })
    const page = await context.newPage()
    watchTheConsole(page)

    console.log('Public screens')
    for (const [label, path] of [
      ['landing', '/'],
      ['verification', '/verify'],
      ['privacy', '/privacy'],
      ['admin sign-in', '/signin'],
      ['portal sign-in', '/portal/signin'],
      ['link not valid', '/portal/link-not-valid'],
    ] as const) {
      await auditScreen(page, label, path)
    }

    // §15.1 and AC43: the anti-phishing page has to work for somebody who has
    // thrown the email away and is typing the address into a browser. No
    // session, no cookie, no referrer. This runs before anything signs in, so
    // the context genuinely has nothing.
    const cookiesBeforeSignIn = await context.cookies()
    check(
      'the verification page is reachable with no session at all',
      cookiesBeforeSignIn.length === 0,
      `${cookiesBeforeSignIn.length} cookies were set`,
    )

    console.log('\nThe skip link')
    await page.goto(`${ORIGIN}/`, { waitUntil: 'networkidle' })
    await page.keyboard.press('Tab')
    const focused = await page.evaluate(() => {
      const el = document.activeElement as HTMLAnchorElement | null
      return {
        tag: el?.tagName ?? null,
        href: el?.getAttribute('href') ?? null,
        // Visible once focused, which is the whole point of it.
        left: el ? el.getBoundingClientRect().left : null,
      }
    })
    check('the first tab stop is the skip link', focused.href === '#main', String(focused.tag))
    check(
      'it becomes visible when focused',
      focused.left !== null && focused.left > -100,
      `left=${focused.left}`,
    )

    console.log('\nThe investor portal')
    await page.goto(`${ORIGIN}/portal/claim/${claimToken}`, { waitUntil: 'networkidle' })
    check('the claim link opens the portal', page.url().includes('/portal'), page.url())
    await auditScreen(page, 'portal', '/portal')

    console.log('\nThe administration screens')
    await page.goto(`${ORIGIN}/signin`, { waitUntil: 'networkidle' })
    await page.fill('input[name="email"]', ADMIN_EMAIL)
    await page.fill('input[name="password"]', ADMIN_PASSWORD)
    await page.click('button[type="submit"]')
    await page.waitForURL(/\/admin/, { timeout: 20_000 })
    check('the owner is signed in', page.url().includes('/admin'), page.url())

    for (const [label, path] of [
      ['overview', '/admin'],
      ['review and send', '/recipients'],
      ['investors', '/investors'],
      ['import', '/import'],
      ['email templates', '/templates'],
      ['the round', '/round'],
      ['updates', '/updates'],
      ['questions', '/questions'],
      ['reminders', '/reminders'],
      ['register', '/register'],
      ['compliance', '/compliance'],
      ['portal roadmap', '/admin/roadmap'],
      ['operator access', '/admin/invites'],
      ['audit log', '/audit'],
      ['system health', '/health'],
      ['two-factor', '/admin/security'],
      ['portal tiles', '/admin/roadmap'],
      ['media library', '/admin/media'],
      ['personal video', '/admin/video'],
      ['settings', '/admin/settings'],
      ['acknowledgement wording', '/admin/acknowledgements'],
      // The last two are not in the navigation's main run and were audited by
      // nobody. `/admin/password` renders in the `(account)` shell — a second
      // shell, added when the password page had to leave the admin one to stop
      // it redirecting to itself, and never measured at 375px until now. A
      // second shell is exactly the kind of thing that is excellent on a laptop
      // and broken on a phone, because nobody looks at it twice.
      ['password', '/admin/password'],
      ['refused', '/admin/no-access'],
    ] as const) {
      await auditScreen(page, label, path)
    }

    await verifyThePolicyInPractice(page)

    await verifyTheNonce(page)

    await verifyTheBannerWithAFaultBehindIt(page)
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

/**
 * The overview banner, with something actually wrong behind it.
 *
 * Everything above this renders against a healthy database, which is correct
 * for every screen in the list and leaves exactly one rendering unexercised —
 * and it is the one that matters most. The banner appears only when something
 * needs a person, so the branch that has never been drawn in a browser is the
 * branch that gets drawn on the worst morning. Its markup is the same `Notice`
 * used elsewhere, which made this unlikely rather than unknown, and unlikely is
 * not the same thing.
 *
 * All three of the banner's rules, because the banner's sentence is built from
 * the findings and one finding would not exercise the joining — and because the
 * last time a rule was left unrendered on the argument that its markup was the
 * same as its neighbour's, rendering it found two faults. Two faults are induced
 * in the audit log and one in the reminder queue; all three are put back. The
 * log is append-only, so the rows that exist are renamed for the duration rather
 * than deleted, and the rows this writes are removed by id.
 */
/**
 * The two policy claims that had never met a browser.
 *
 * `next.config.ts` carries `camera=(self)` and `microphone=(self)` rather than
 * the tidier-looking `camera=()`, and the comment there explains why: §13.3
 * records the operator's video in the browser through `getUserMedia`, and the
 * denial breaks it **with no sign** — no permission prompt appears and the
 * recorder reports a device fault indistinguishable from a broken webcam. The
 * same file allows `blob:` in `media-src`, because a recording is held as a blob
 * and played back from an object URL before it is uploaded.
 *
 * Both were asserted against the source, and source assertions cannot fail the
 * way a wrong header fails. Loading a page does not test them either: nothing is
 * requested until somebody presses something.
 *
 * **What this proves, precisely.** Permissions-Policy and Content-Security-
 * Policy are properties of a *document*, not of a component. So both claims are
 * exercised inside a real page served by this application, with its real
 * headers: `getUserMedia` is called, and a `<video>` is pointed at an object
 * URL. If `camera=()` were served, the first rejects with a permissions-policy
 * violation. If `blob:` were missing from `media-src`, the second refuses to
 * load. Neither depends on the recorder's own React state.
 *
 * **What it does not prove:** the recorder component's control flow. That card
 * renders only for an onboarded operator with a media store configured, and
 * standing that up is a fixture this script does not have. The gap is recorded
 * rather than papered over.
 *
 * The fake device is a device and not a bypass. Chromium applies the
 * Permissions-Policy header before it reaches any camera, real or fake, so a
 * wrong header fails here exactly as it would on the machine this deploys to.
 */
async function verifyThePolicyInPractice(page: Page): Promise<void> {
  console.log('\nThe policy, in a browser rather than in a header')

  complaints.length = 0
  await page.goto(`${ORIGIN}/admin/video`, { waitUntil: 'networkidle' })

  const camera = await page.evaluate(async () => {
    if (!navigator.mediaDevices?.getUserMedia) return 'no getUserMedia in this browser'
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true })
      const tracks = stream.getTracks().length
      for (const track of stream.getTracks()) track.stop()
      return tracks > 0 ? 'ok' : 'a stream with no tracks'
    } catch (error) {
      return `${(error as Error).name}: ${(error as Error).message}`.slice(0, 160)
    }
  })
  check(
    'the camera and microphone are permitted — Permissions-Policy camera=(self)',
    camera === 'ok',
    camera,
  )

  const policyDenied = complaints.filter((c) => /permissions policy/i.test(c))
  check(
    'and the browser reports no Permissions-Policy violation',
    policyDenied.length === 0,
    policyDenied.slice(0, 2).join(' | '),
  )

  // A blob on a media element is exactly what `media-src blob:` is for, and the
  // only way to find out whether the directive is right is to load one.
  const blobPlayed = await page.evaluate(async () => {
    const parts: BlobPart[] = [new Uint8Array([0x1a, 0x45, 0xdf, 0xa3])]
    const url = URL.createObjectURL(new Blob(parts, { type: 'video/webm' }))
    const player = document.createElement('video')
    player.src = url
    document.body.appendChild(player)

    const outcome = await new Promise<string>((resolve) => {
      // A four-byte file is not decodable, and that is fine: `error` with
      // MEDIA_ERR_SRC_NOT_SUPPORTED means the browser FETCHED the blob and then
      // failed to decode it, which is the proof wanted here. A CSP refusal is a
      // different code and arrives with a console violation.
      player.addEventListener('error', () => resolve(`code ${player.error?.code ?? '?'}`), {
        once: true,
      })
      player.addEventListener('loadedmetadata', () => resolve('loaded'), { once: true })
      setTimeout(() => resolve('nothing happened'), 5000)
    })

    player.remove()
    URL.revokeObjectURL(url)
    return outcome
  })
  // `code 4` is MEDIA_ERR_SRC_NOT_SUPPORTED, which a four-byte file earns
  // honestly — but a CSP refusal produces the same code, so the element's own
  // error says nothing on its own. The directive check is the real assertion;
  // this one is only that something happened at all.
  const mediaRefused = complaints.some((c) => /media-src/i.test(c))
  const fetched = blobPlayed === 'loaded' || blobPlayed === 'code 4'
  check(
    'a blob: source reaches the media element — media-src blob:',
    fetched && !mediaRefused,
    mediaRefused
      ? 'the policy refused it — media-src does not carry blob:'
      : `the element reported ${blobPlayed}`,
  )

  const heard = complaints.filter((c) => !isEnvironmental(c))
  const csp = heard.filter((c) => /CSP refused|Content Security Policy/i.test(c))
  check(
    'no Content-Security-Policy violation from any of it',
    csp.length === 0,
    csp.join(' | '),
  )
}

/**
 * The nonce, proved by injecting the thing it exists to refuse.
 *
 * Removing `'unsafe-inline'` from `script-src` is only worth doing if an inline
 * script the application did not render is now actually refused. Every other
 * check in this file is satisfied by a policy that blocks nothing: the pages
 * load, they hydrate, the console is quiet. A policy that has never been seen
 * to refuse anything is a string in a header.
 *
 * So four claims, each of which fails if the nonce is wrong in a different way:
 *
 *   1. **An inline script with no nonce does not run.** This is the attack.
 *      An investor's name, a question they submitted, a cell from an imported
 *      CSV — anywhere unescaped text could reach the page, this is what stops
 *      the script in it from executing. Under the old policy it ran.
 *   2. **An inline script carrying somebody else's nonce does not run.** A
 *      guessed or stale value is no better than none.
 *   3. **An inline script carrying *this response's* nonce does run.** Without
 *      this one, checks 1 and 2 would pass just as happily against a policy
 *      that forbids inline script outright — which would mean Next's own
 *      bootstrap is refused too and every page is dead. This is the check that
 *      distinguishes a working nonce from a broken policy.
 *   4. **The nonce is different on the next request.** A constant "nonce" is a
 *      value an attacker reads off one page and reuses on the next, which is
 *      the whole of the protection gone while every other check still passes.
 *
 * The value used in 3 is read from the response header rather than from the
 * document, deliberately: `script[nonce]` in the DOM is what Next *stamped*,
 * and comparing that to itself proves nothing about the header the browser is
 * enforcing. Taking it from the header proves the two agree.
 */
async function verifyTheNonce(page: Page): Promise<void> {
  console.log('\nThe nonce, proved by injecting what it refuses')

  complaints.length = 0

  const response = await page.goto(`${ORIGIN}/signin`, { waitUntil: 'networkidle' })
  const header = response?.headers()['content-security-policy'] ?? ''

  check(
    'the served policy carries a nonce',
    /script-src [^;]*'nonce-[A-Za-z0-9+/_-]+={0,2}'/.test(header),
    header.slice(0, 200) || 'no Content-Security-Policy header on the response',
  )
  check(
    "and script-src no longer carries 'unsafe-inline'",
    !/script-src[^;]*'unsafe-inline'/.test(header),
    header.slice(0, 200),
  )

  const nonce = /script-src [^;]*'nonce-([A-Za-z0-9+/_-]+={0,2})'/.exec(header)?.[1] ?? ''

  /**
   * Injected from inside the page, which is where an injection would come from.
   * `setAttribute` rather than the `.nonce` property because that is what a
   * bundler's own nonce support does, and because the property is hidden again
   * once the element is in the document.
   */
  const inject = async (value: string | null, flag: string): Promise<boolean> => {
    const ran = await page.evaluate(
      ([nonceValue, name]) => {
        const script = document.createElement('script')
        if (nonceValue !== null) script.setAttribute('nonce', nonceValue)
        script.textContent = `window[${JSON.stringify(name)}] = true`
        document.head.appendChild(script)
        script.remove()
        return (window as unknown as Record<string, boolean>)[name] === true
      },
      [value, flag] as const,
    )
    // A refusal is reported after the fact: Chromium queues both the console
    // message and the `securitypolicyviolation` event, so neither has arrived
    // by the time `evaluate` resolves. Without this wait the *execution* checks
    // pass and the *reporting* check fails, which reads as a broken detector
    // rather than as a race.
    await page.waitForTimeout(200)
    return ran
  }

  /** Either spelling of "the policy refused an inline script". */
  const refusedInlineScript = (complaint: string): boolean =>
    /CSP refused script-src/.test(complaint) ||
    /Refused to execute inline script/.test(complaint)

  const ranWithout = await inject(null, '__nonceless_ran')
  check(
    'an inline script with no nonce does not run',
    ranWithout === false,
    'it executed — script-src is not enforcing the nonce',
  )
  check(
    'and the policy says so, naming script-src',
    complaints.some((c) => /CSP refused script-src/.test(c)),
    complaints.filter((c) => /CSP refused/.test(c)).slice(0, 2).join(' | ') ||
      'no violation was reported at all',
  )

  const ranWithWrong = await inject('bm90LXRoZS1yZWFsLW5vbmNl', '__wrong_nonce_ran')
  check(
    "an inline script carrying somebody else's nonce does not run",
    ranWithWrong === false,
    'it executed — the nonce is not being compared',
  )

  const ranWithRight = nonce === '' ? false : await inject(nonce, '__right_nonce_ran')
  check(
    "an inline script carrying this response's nonce does run",
    ranWithRight === true,
    nonce === ''
      ? 'no nonce could be read from the header'
      : 'it was refused — the header and the document disagree, and every page is dead',
  )

  // A second request to the same URL. If this matched, the value is a constant
  // wearing the word nonce.
  const again = await page.goto(`${ORIGIN}/signin`, { waitUntil: 'domcontentloaded' })
  const second =
    /script-src [^;]*'nonce-([A-Za-z0-9+/_-]+={0,2})'/.exec(
      again?.headers()['content-security-policy'] ?? '',
    )?.[1] ?? ''
  check(
    'and the next request gets a different one',
    second !== '' && second !== nonce,
    second === '' ? 'the second response carried no nonce' : 'both responses carried the same value',
  )

  // The two deliberate refusals above are expected and are the point. Anything
  // else the browser objected to during this section is not.
  const stray = complaints.filter((c) => !isEnvironmental(c)).filter((c) => !refusedInlineScript(c))
  check(
    'and nothing else was refused along the way',
    stray.length === 0,
    stray.slice(0, 3).join(' | '),
  )
}

async function verifyTheBannerWithAFaultBehindIt(page: Page): Promise<void> {
  console.log('\nThe overview banner, with a fault behind it')

  const HIDDEN = 'reminder.run_completed__hidden_by_viewport'
  const existing = await db
    .select({ id: auditEvents.id })
    .from(auditEvents)
    .where(eq(auditEvents.action, 'reminder.run_completed'))

  const HIDDEN_MEDIA = 'media.checked__hidden_by_viewport'
  const existingMedia = await db
    .select({ id: auditEvents.id })
    .from(auditEvents)
    .where(eq(auditEvents.action, 'media.checked'))

  let written: string | undefined
  let claimed: string | undefined

  try {
    if (existing.length > 0) {
      await db
        .update(auditEvents)
        .set({ action: HIDDEN })
        .where(
          inArray(
            auditEvents.id,
            existing.map((row) => row.id),
          ),
        )
    }

    if (existingMedia.length > 0) {
      await db
        .update(auditEvents)
        .set({ action: HIDDEN_MEDIA })
        .where(
          inArray(
            auditEvents.id,
            existingMedia.map((row) => row.id),
          ),
        )
    }

    const [row] = await db
      .insert(auditEvents)
      .values({
        actorLabel: 'verify-viewport',
        entityType: 'media',
        entityId: null,
        action: 'media.checked',
        metadata: {
          storeConfigured: true,
          checked: 3,
          missing: 2,
          wrongSize: 0,
          unreadable: 0,
          orphans: 1,
          listed: true,
          truncated: false,
          problems: 3,
        },
      })
      .returning({ id: auditEvents.id })
    written = row?.id

    // The third rule: a reminder a run took and never finished with. It needs a
    // row rather than an audit entry, which is why it was left out the first
    // time — and leaving a rule unrendered because arranging it is fiddly is
    // exactly how the other two got through.
    const [offer] = await db
      .select({ id: offers.id })
      .from(offers)
      .innerJoin(investorAccounts, eq(offers.accountId, investorAccounts.id))
      .where(like(investorAccounts.email, `${PREFIX}%`))
      .limit(1)

    if (offer) {
      const [stuck] = await db
        .insert(reminderEvents)
        .values({
          offerId: offer.id,
          scheduledFor: new Date(Date.now() - 6 * 60 * 60 * 1000),
          sequence: 1,
          claimedAt: new Date(Date.now() - 5 * 60 * 60 * 1000),
        })
        .returning({ id: reminderEvents.id })
      claimed = stuck?.id
    }
    check('a reminder could be left mid-send for the banner to find', claimed !== undefined)

    // The whole point: the same measurements as every other screen, on the
    // branch that only exists when something is wrong.
    await auditScreen(page, 'overview, with a fault', '/admin')

    const text = (await page.locator('body').innerText()).replace(/\s+/g, ' ')

    check(
      'the banner is on the screen at all',
      /things need you/.test(text),
      text.slice(0, 160),
    )

    // The banner itself, not the page. The page legitimately greets whoever is
    // signed in by their own address, which is their own address on their own
    // screen; the banner is the thing that must carry nobody's.
    const banner = (
      await page.locator('p', { hasText: /things need you/ }).first().innerText()
    ).replace(/\s+/g, ' ')

    check(
      'and it names all three of them, from the findings rather than from prose',
      /the scheduled run/.test(banner) &&
        /reminders/.test(banner) &&
        /stored files/.test(banner),
      banner,
    )
    check(
      'and it joins them into a sentence rather than listing labels',
      /, .* and /.test(banner),
      banner,
    )
    check(
      'and it sends the reader to the page that says which',
      (await page.locator('a[href$="/health"]').count()) > 0,
    )
    check(
      'and it names no email address',
      !/[\w.+-]+@[\w-]+\.[\w.]{2,}/.test(banner),
      banner.match(/[\w.+-]+@[\w-]+\.[\w.]{2,}/)?.[0],
    )
    check(
      'and no investor',
      !banner.includes('Verify Investor') && !banner.includes(PREFIX),
    )

    // And the page it points at, on the branch that has a "Needs you" section.
    await auditScreen(page, 'system health, with a fault', '/health')
    const health = (await page.locator('body').innerText()).replace(/\s+/g, ' ')
    check('the health page leads with what needs a person', /Needs you/.test(health))
    check(
      'and says the same things the banner did',
      /No reminder run has ever completed/.test(health) &&
        /The last media check found 3 problems/.test(health) &&
        /marked as being sent for over/.test(health),
    )
    check(
      'and names the stuck reminder by its id, which the banner does not',
      claimed !== undefined && health.includes(claimed),
    )
  } finally {
    if (claimed) await db.delete(reminderEvents).where(eq(reminderEvents.id, claimed))
    if (written) await db.delete(auditEvents).where(eq(auditEvents.id, written))
    if (existing.length > 0) {
      await db
        .update(auditEvents)
        .set({ action: 'reminder.run_completed' })
        .where(eq(auditEvents.action, HIDDEN))
    }
    if (existingMedia.length > 0) {
      await db
        .update(auditEvents)
        .set({ action: 'media.checked' })
        .where(eq(auditEvents.action, HIDDEN_MEDIA))
    }
  }

  // Put back, and gone again — which is the other half of the claim. A banner
  // that is always there would have passed every check above.
  await page.goto(`${ORIGIN}/admin`, { waitUntil: 'networkidle' })
  const healthy = (await page.locator('body').innerText()).replace(/\s+/g, ' ')
  check('and it is gone once the fault is', !/things need you/.test(healthy))
  check(
    'while the way through to the health page is not',
    (await page.locator('a[href$="/health"]').count()) > 0,
  )

  const leftRenamed = await db
    .select({ id: auditEvents.id })
    .from(auditEvents)
    .where(inArray(auditEvents.action, [HIDDEN, HIDDEN_MEDIA]))
  check('no audit entry is left renamed', leftRenamed.length === 0)
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => process.exit())
