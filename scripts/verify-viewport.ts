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
 *
 * It creates its own data under an obvious prefix and deletes it at the end.
 * Run it against a development database only, with the app built:
 *
 *   pnpm build && pnpm tsx scripts/verify-viewport.ts
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

async function auditScreen(page: Page, label: string, path: string): Promise<void> {
  const response = await page.goto(`${ORIGIN}${path}`, { waitUntil: 'networkidle' })
  const status = response?.status() ?? 0
  check(`${label}: loads (${status})`, status < 400, `${path} returned ${status}`)
  if (status >= 400) return

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
    browser = await chromium.launch(executablePath ? { executablePath } : {})
    const context = await browser.newContext({
      viewport: VIEWPORT,
      deviceScaleFactor: 3,
      isMobile: true,
      hasTouch: true,
    })
    const page = await context.newPage()

    console.log('Public screens')
    for (const [label, path] of [
      ['landing', '/'],
      ['verification', '/verify'],
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
    ] as const) {
      await auditScreen(page, label, path)
    }

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
