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
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright'
import { db } from '@/db'
import {
  auditEvents,
  complianceApprovals,
  conversationMessages,
  importJobs,
  interestRegisterEntries,
  investorAccounts,
  mediaAssets,
  investorSessions,
  offers,
  portalTokens,
  qaEntries,
  recipients,
  reminderEvents,
  rounds,
  serviceConfig,
  users,
} from '@/db/schema'
import { SERVICE_CONFIG_ID } from '@/lib/auth/service-config'
import { hashPassword } from '@/lib/auth/password'
import { everythingSent, flatten, onScreen } from '@/lib/verify/page-text'
import { issueToken } from '@/lib/crypto'
import { AA_LARGE, AA_TEXT, contrastRatio, reportRatio } from '@/lib/contrast'
import { EMAIL_BODY_POLICY } from '@/lib/security/csp'
import { drawablePngWithMetadata, FIXTURE_SECRET_MARKER } from '@/lib/media/fixtures'
import {
  clearStoredFiles,
  ERASURE_COUNTS,
  removeErasureFixture,
  seedErasureFixture,
} from './lib/erasure-fixture'
import { mediaStore } from '@/lib/media/store'

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
    /\.well-known\/appspecific/.test(complaint) ||
    /*
     * The harness looking into a sandboxed frame.
     *
     * *"Blocked script execution in 'about:srcdoc' because the document's frame
     * is sandboxed and the 'allow-scripts' permission is not set."*
     *
     * It appears on the email preview, intermittently, and it is not the
     * application's doing. The email body was checked: 15,497 characters, four
     * links, and **no `<script>`, no `javascript:`, no event handler, no
     * `<form>`, no `<style>` and no nested frame**. There is nothing in it for
     * the browser to refuse. What is trying to run script in that frame is
     * Playwright, which installs its own init script into every frame it can
     * see; a sandboxed frame refuses it and Chromium says so.
     *
     * It is intermittent because it is a race between the harness reaching the
     * frame and the check reading the console — which is exactly why it is
     * listed here rather than tolerated per-screen. A flake that fails one run
     * in three teaches people to re-run rather than to read.
     *
     * And it is the sandbox **working**. The one thing it is not is a fault.
     */
    /Blocked script execution in 'about:srcdoc'/.test(complaint)
  )
}

/**
 * Nothing in the delivered markup that `style-src 'self'` will refuse.
 *
 * **Why the markup and not the live DOM.** The first version of this walked
 * `document.querySelectorAll('[style]')` and failed on all thirty-one screens,
 * naming `<next-route-announcer style="position: absolute;">` — the off-screen
 * element Next adds so a screen reader is told the page changed. It looked like
 * a real find and it was not one: **the Content-Security-Policy does not govern
 * the CSSOM.** Next writes `element.style.position = 'absolute'` from
 * JavaScript, which serialises into a `style` attribute the DOM will show you
 * and which no policy inspects. Checked rather than assumed: the computed
 * position is `absolute`, so the rule applied, and no violation was reported.
 *
 * What CSP *does* refuse is a style parsed from markup — a `style` attribute in
 * the HTML, `setAttribute('style', …)`, or a `<style>` element without the
 * nonce. So the delivered document is the thing to search, and searching it
 * catches the case that matters: a component written with `style={{…}}`, which
 * arrives in the HTML, is refused, and renders one rule short of correct with
 * nothing to show for it.
 *
 * The behavioural half — that the policy really does refuse one — is
 * `verifyTheStylePolicy`, which injects one and watches it fail.
 */
async function checkNothingInlineStyled(label: string, html: string): Promise<void> {
  const attributes = [...html.matchAll(/<([a-zA-Z][\w-]*)[^>]*\sstyle="([^"]*)"/g)].map(
    (m) => `<${m[1]!.toLowerCase()} style="${m[2]!.slice(0, 60)}">`,
  )
  check(
    `${label}: the markup carries no inline style the policy will refuse`,
    attributes.length === 0,
    attributes.slice(0, 4).join(' | '),
  )

  const unnonced = [...html.matchAll(/<style(\s[^>]*)?>/g)]
    .map((m) => m[1] ?? '')
    .filter((attrs) => !/\snonce="/.test(attrs))
  check(
    `${label}: every <style> element in the markup carries the nonce`,
    unnonced.length === 0,
    `${unnonced.length} without a nonce`,
  )
}

/**
 * The complaints the last `measureScreen` was told to expect and duly heard.
 *
 * Filtering a complaint away and never asserting it is the vacuous shape again:
 * the screen stops complaining, the check goes on passing, and nobody learns
 * that the thing being tolerated has been fixed. A caller that passes
 * `expectedComplaint` can read this and assert the complaint was actually made.
 */
let expectedComplaintsHeard: string[] = []

async function auditScreen(
  page: Page,
  label: string,
  path: string,
  /**
   * The status this screen is *supposed* to answer with. 404 for the
   * not-found page, which is a rendered screen like any other and was skipped
   * by this function for as long as it only accepted a success.
   */
  expected = 200,
  /**
   * Something that proves this screen is showing its **content** and not its
   * empty state — a word from a seeded row, not from the page's own chrome.
   *
   * Set on every screen whose subject is data, and it exists because three were
   * not. An inventory pass printed the rendered text of all thirty-two screens
   * and found `/questions` saying *"Nothing is waiting"* and `/register` saying
   * *"Nobody is on the register"*. Both had been green since they were added,
   * and in both cases the thing not being drawn was a **table** — the widest
   * thing this application renders and the whole reason this script exists.
   *
   * A layout check on an empty screen is not a weak check. It is a check of the
   * empty state, reported under the name of the populated one.
   */
  mustShow?: RegExp,
  /** See `measureScreen`. One complaint this screen is supposed to make. */
  expectedComplaint?: RegExp,
): Promise<void> {
  complaints.length = 0

  const response = await page.goto(`${ORIGIN}${path}`, { waitUntil: 'networkidle' })
  const status = response?.status() ?? 0
  const acceptable = expected === 200 ? status < 400 : status === expected
  check(`${label}: loads (${status})`, acceptable, `${path} returned ${status}`)
  if (!acceptable) return

  await measureScreen(page, label, {
    mustShow,
    expected,
    expectedComplaint,
    html: await response!.text(),
  })
}

/**
 * Everything `auditScreen` does **except** the navigation.
 *
 * Split out because three of the screens this script is meant to cover are not
 * reachable by a URL at all: steps 2, 3 and 4 of the import wizard are client
 * state on `/import`, and the only way to measure them is to press the buttons
 * and then measure what is in front of you. Before this, the import screen was
 * audited at step 1 — a heading, a file input and a sentence — and *the review
 * table was never measured at 375px by anything.*
 *
 * That table is the widest thing in the application: name, email, amount, SPV
 * percentage, indirect percentage, deadline and jurisdiction, one row per
 * recipient, with a totals block under it. If any screen here was going to push
 * a page sideways on a phone, it was that one.
 */
async function measureScreen(
  page: Page,
  label: string,
  {
    mustShow,
    /**
     * The status this screen answers with, when it is not 200 — so the browser's
     * own note about a 404 is not counted as the screen complaining.
     */
    expected = 200,
    /**
     * The **served** markup, and only ever that. The inline-style checks are
     * skipped when it is absent.
     *
     * The first version of this fell back to `page.content()` for a wizard step
     * that has no served body of its own, on the reasoning that the DOM is the
     * fairer source. It is not, and this repository already knew why: an earlier
     * entry spent an afternoon on `<next-route-announcer style="position:
     * absolute">`, an invisible element Next adds client-side. `style-src-attr`
     * governs a style attribute *in the markup a document was parsed from*, and
     * does not inspect one assigned later by script — so the DOM fallback
     * reported a violation on every wizard step that the browser had not made
     * and would never make. Two checks, failing, naming a real element, about
     * nothing. Exactly the finding that was already documented as not a finding.
     *
     * A wizard step therefore gets its layout, contrast and console measured and
     * not its inline styles, because the document those styles came from is
     * `/import`, which is audited in its own right.
     */
    html,
    /**
     * One complaint this screen is *supposed* to make.
     *
     * The 404 case above is the same idea and predates this: a screen whose job
     * is to answer 404 makes the browser log the 404, and that is the screen
     * working. The error page is the stronger case — React reports an errored
     * server render to the console by design, and it is the only evidence in the
     * browser that the boundary caught anything at all. Silencing the check
     * entirely for that screen would have removed the only reading of what else
     * the browser said while its layout was being measured; naming the one
     * expected sentence leaves the rest of the check standing.
     *
     * Deliberately a pattern rather than a flag, so an unexpected second
     * complaint on the same screen still fails.
     */
    expectedComplaint,
  }: {
    mustShow?: RegExp
    expected?: number
    html?: string
    expectedComplaint?: RegExp
  } = {},
): Promise<void> {
  if (mustShow) {
    const text = await onScreen(page)
    check(
      `${label}: is showing content and not its empty state`,
      mustShow.test(text),
      `nothing matched ${mustShow} — measured ${text.length} characters`,
    )
  }

  const heard = complaints
    .filter((c) => !isEnvironmental(c))
    // A screen whose whole job is to answer 404 makes the browser log the 404.
    // That is the screen working, not the screen complaining.
    .filter((c) => expected === 200 || !c.includes(`status of ${expected}`))
    .filter((c) => !expectedComplaint?.test(c))
  // What the screen was allowed to say, kept so a caller can assert it happened
  // rather than merely tolerating it. A complaint that is filtered and never
  // asserted is a complaint nobody will notice stopping.
  expectedComplaintsHeard = expectedComplaint
    ? complaints.filter((c) => expectedComplaint.test(c))
    : []
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

  if (html !== undefined) await checkNothingInlineStyled(label, html)

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
  /*
   * The erasure fixture first, and it has to be first.
   *
   * Its address begins with this script's prefix, so the loop below would find
   * its account — and then fail, because that record holds conversation
   * messages and Q&A entries pointing at offers with no `onDelete`, which the
   * loop deletes in the wrong order for it. `removeErasureFixture` knows that
   * order. `verifyTheErasureSection` already calls it in its own `finally`;
   * this is for the run that dies somewhere else entirely.
   */
  await removeErasureFixture(`${PREFIX}-erasure`)

  const accounts = await db
    .select({ id: investorAccounts.id })
    .from(investorAccounts)
    .where(like(investorAccounts.email, `${PREFIX}%`))

  for (const account of accounts) {
    await db.delete(portalTokens).where(eq(portalTokens.accountId, account.id))
    await db.delete(investorSessions).where(eq(investorSessions.accountId, account.id))
    // Both cascade from the account, and both are deleted explicitly anyway:
    // a cascade that stops being declared is a cleanup that silently stops
    // cleaning, and this data is a question and an amount against a name.
    await db.delete(qaEntries).where(eq(qaEntries.askedByAccountId, account.id))
    await db
      .delete(interestRegisterEntries)
      .where(eq(interestRegisterEntries.accountId, account.id))

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

    // Audit rows naming an offer that is about to stop existing.
    //
    // Opening the email preview writes `email.previewed` against the offer — a
    // read is audited, correctly — and the portal claim and the stage screens
    // write their own. The offer goes below. An audit row pointing at a row that
    // was never really there is worse than no audit row, so these go by the same
    // by-id rule the import fixture and the overview-banner fixture follow, and
    // nothing else in the log is touched.
    if (seeded.length > 0) {
      await db.delete(auditEvents).where(
        inArray(
          auditEvents.entityId,
          seeded.map((offer) => offer.id),
        ),
      )
    }

    await db.delete(offers).where(eq(offers.accountId, account.id))
    await db.delete(investorAccounts).where(eq(investorAccounts.id, account.id))
  }

  await db.delete(recipients).where(like(recipients.email, `${PREFIX}%`))
  await db.delete(rounds).where(like(rounds.name, `${PREFIX}%`))

  // The wizard's own leavings, which are keyed by a filename and an evidence
  // reference rather than by an address. Called here as well as in the wizard's
  // `finally` so a run that dies between the two leaves nothing behind either.
  await clearImportFixtures()
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

  /**
   * A question waiting, a question answered and published, and a name on the
   * register — because without them three of the screens below were audited in
   * their empty state.
   *
   * That was found by measuring rather than by reading: an inventory pass
   * printed the rendered text of every screen this script visits, and
   * `/questions` said *"Nothing is waiting"*, `/register` said *"Nobody is on
   * the register"*. Both had been reported green since the day they were added.
   *
   * **The thing each of them was not rendering is a table** — a queue of
   * questions with a name and a date against each, and a computed-order register
   * with an amount in every row. A table of amounts is the widest thing this
   * application draws and the most likely to push a page sideways at 375px,
   * which is the entire subject of this script. So the two screens whose layout
   * risk was highest were the two whose layout had never been measured.
   *
   * The wording is deliberately long and unbroken. A short question wraps
   * anywhere and would prove nothing; a long address and a five-figure amount
   * are what actually strain a narrow column.
   */
  const operator = await db.query.users.findFirst({ where: eq(users.email, ADMIN_EMAIL) })

  await db.insert(qaEntries).values({
    askedByAccountId: account!.id,
    questionOriginal:
      'Could you clarify how the indirect Flipit interest interacts with the SPV percentage ' +
      'if the aggregate target is not reached before the response deadline?',
  })

  await db.insert(qaEntries).values({
    askedByAccountId: account!.id,
    questionOriginal: 'What happens to my participation if the round closes early?',
    questionPublic: 'What happens to a participation if the round closes early?',
    answer:
      'The participation stands exactly as recorded. Closing a round early does not alter ' +
      'any figure already agreed, and every document already issued remains on the portal.',
    answeredById: operator?.id ?? null,
    answeredAt: new Date(),
    isPublished: true,
    publishedAt: new Date(),
  })

  await db.insert(interestRegisterEntries).values({
    accountId: account!.id,
    indicativeAmountUsd: '47500.00',
    addedByOperator: true,
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

    /**
     * The fourth column is `mustShow`, and it is the reason this list is worth
     * re-reading. See `auditScreen`: every screen whose subject is data now has
     * to prove it is showing some, because three of them were being measured
     * empty and reported under the name of the populated screen.
     *
     * Screens with no data of their own — a form, a set of switches, a template
     * preview — have nothing to assert here and are left blank on purpose.
     */
    for (const [label, path, status, mustShow] of [
      ['overview', '/admin'],
      ['review and send', '/recipients', 200, /Alexandra Fenwick-Harrington/],
      ['investors', '/investors', 200, /Alexandra Fenwick-Harrington/],
      ['import', '/import'],
      ['email templates', '/templates'],
      ['the round', '/round'],
      ['updates', '/updates'],
      // The queue of unanswered questions, and the published pair beneath it.
      ['questions', '/questions', 200, /indirect Flipit interest interacts/],
      ['reminders', '/reminders'],
      // The computed-order table, with an amount in the row.
      ['register', '/register', 200, /47,500/],
      ['compliance', '/compliance'],
      ['portal roadmap', '/admin/roadmap'],
      ['operator access', '/admin/invites', 200, /PENDING/],
      ['audit log', '/audit', 200, /\d{4}-\d{2}-\d{2}/],
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
      // An address that is not one. It was audited by nobody, and that is how
      // the framework's built-in 404 — laid out entirely with inline `style`
      // attributes, every one of them now refused — went on being served
      // unstyled with nothing to say so.
      ['not found', '/an-address-that-is-not-one', 404],
    ] as const) {
      await auditScreen(page, label, path, status, mustShow)
    }

    await verifyTheImportWizardSteps(page)

    await verifyThePolicyInPractice(page)

    await verifyTheQrCodeLoads(page)

    await verifyTheNonce(page)

    await verifyTheStylePolicy(page)

    await verifyTheBannerWithAFaultBehindIt(page)

    await verifyTheEmailPreview(page)

    await verifyTheMediaLibraryWithSomethingInIt(page)

    await verifyTheErasureSection(page)

    await verifyTheErrorPage(browser)
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
/**
 * The two-factor QR code, actually decoded by the browser.
 *
 * `/admin/security` is one of the thirty-two screens `auditScreen` visits, and it
 * has been reported green since the day it was added. **The check was vacuous.**
 * The QR is rendered only while an account is *enrolling* — a secret stored and
 * not yet confirmed — and this script signs in as an owner who is not, so the
 * screen it audited had no image on it at all. A missing `img-src data:` would
 * have produced no violation, because there was nothing to refuse.
 *
 * That matters more now than it did. `img-src data:` used to be granted to every
 * page in the application; it is now granted to this path alone, which makes this
 * the only place it can be got wrong — and a two-factor code that will not render
 * is a release gate that cannot be passed.
 *
 * So this starts enrolment through the real form, loads the screen, and asks the
 * browser whether the image **decoded** — `naturalWidth > 0`, which is false both
 * for a refused request and for a broken data URL. Then it puts the account back
 * as it found it: the secret it created is cleared, so a developer's own database
 * does not end up half-enrolled by a script about layout.
 */
async function verifyTheQrCodeLoads(page: Page): Promise<void> {
  console.log('\nThe two-factor QR, which the policy now allows on one path only')

  const before = await db.query.users.findFirst({ where: eq(users.email, ADMIN_EMAIL) })

  try {
    complaints.length = 0
    await page.goto(`${ORIGIN}/admin/security`, { waitUntil: 'networkidle' })

    await page.getByRole('button', { name: /Start setting up two-factor|Start again/ }).click()

    // The row, not the screen. See the page-text entry in PROGRESS.md.
    const deadline = Date.now() + 20_000
    let enrolling = false
    while (Date.now() < deadline && !enrolling) {
      const row = await db.query.users.findFirst({ where: eq(users.email, ADMIN_EMAIL) })
      enrolling = row?.totpSecretEncrypted != null && row?.totpConfirmedAt == null
      if (!enrolling) await new Promise((resolve) => setTimeout(resolve, 200))
    }
    check('enrolment starts, so there is a QR to render', enrolling)

    await page.goto(`${ORIGIN}/admin/security`, { waitUntil: 'networkidle' })

    const qr = await page.evaluate(() => {
      const image = Array.from(document.querySelectorAll('img')).find((element) =>
        element.currentSrc.startsWith('data:') || element.src.startsWith('data:'),
      )
      if (!image) return { found: false, complete: false, width: 0 }
      return { found: true, complete: image.complete, width: image.naturalWidth }
    })

    check('the QR is a data: image on the page', qr.found, 'no <img> with a data: source')
    check(
      'and the browser decoded it — img-src data: is served on this path',
      qr.complete && qr.width > 0,
      `complete=${qr.complete} naturalWidth=${qr.width}`,
    )

    const refused = complaints
      .filter((c) => !isEnvironmental(c))
      .filter((c) => /CSP refused|Content Security Policy/i.test(c))
    check(
      'and no directive refused anything on the way',
      refused.length === 0,
      refused.slice(0, 3).join(' | '),
    )
  } finally {
    // Back as it was. An enrolment left half-finished by this script would make
    // the next sign-in ask for a code nobody has.
    await db
      .update(users)
      .set({
        totpSecretEncrypted: before?.totpSecretEncrypted ?? null,
        totpConfirmedAt: before?.totpConfirmedAt ?? null,
      })
      .where(eq(users.email, ADMIN_EMAIL))
  }
}

/**
 * The import wizard's later steps, measured where they actually live.
 *
 * `/import` is audited in the list above, and until now that audit saw **step 1**
 * — a heading, a file input and one sentence. Steps 2, 3 and 4 are client state
 * on the same URL, so no amount of visiting the path reaches them, and *nothing
 * in this repository had ever measured them at 375px.*
 *
 * Step 3 is the one that matters. It is a table of every recipient in the file —
 * name, email, amount, SPV percentage, indirect percentage, deadline,
 * jurisdiction — with a totals block under it. It is the widest thing this
 * application draws. §13.2 makes 375px the condition of the whole build, and the
 * screen most likely to fail it was the screen nothing looked at.
 *
 * The file is built in the page rather than read from disk, the same way the
 * upload fixtures are: `SAMPLE_IMPORT.csv` exists and using it would tie this
 * check to a file somebody may edit for another reason. The rows here are
 * deliberately awkward — a long double-barrelled name, a long address, a
 * six-figure amount and a six-decimal percentage — because a tidy row proves
 * nothing about a narrow column.
 *
 * **Step 4 is now pressed, and this is the entry that changed that.** The last
 * version stopped at the review table on the reasoning that pressing *Import*
 * would make a layout script into one that writes investor records. It would,
 * and the objection was to the writing rather than to the measuring — so this
 * writes under the same prefix everything else here writes under, asserts what
 * was created, and removes it before the function returns. What the objection
 * was actually protecting was the check above it, *"nothing was created by
 * looking at it"*, and that check is unchanged and still runs first: the promise
 * is that **the review step** creates nothing, not that the confirm step does.
 *
 * Step 4 is the screen that reports what the import did, and its sentence is
 * assembled from four counts and an optional second paragraph. It is drawn at
 * 375px here for the first time with **every clause of it present at once**,
 * which needs a fixture that produces all four:
 *
 *   - a **new** account, from the GB row;
 *   - a **reused** account, from the US row, whose address is given an account
 *     before the wizard runs — §4.3 says accounts are durable, so an address
 *     that already has one keeps it and gains a second offer;
 *   - a **blocked** offer, from the US row, because the approval this fixture
 *     records covers GB only;
 *   - and a cleared one beside it.
 *
 * That last pair is the reason this is worth more than a layout measurement.
 * §8.2 and AC7 say a jurisdiction block stops **one recipient and never the
 * batch**, and until now that rule was proved by unit tests and by
 * `verify-register.ts` against the service functions. It had never been driven
 * through the operator's own screen. It is now: two rows in, one held, one
 * cleared, both recorded, nothing sent.
 */
async function verifyTheImportWizardSteps(page: Page): Promise<void> {
  console.log('\nThe import wizard past step 1, which nothing had ever seen')

  const owner = await db.query.users.findFirst({ where: eq(users.email, ADMIN_EMAIL) })
  if (!owner) throw new Error(`no ${ADMIN_EMAIL} user — run pnpm db:seed`)

  try {
    // GB only, so the US row in the file below is held and the GB one is not.
    // Recorded directly rather than through the owner's screen: this is a
    // fixture, and §8.2's rule that only an owner may record one is proved by
    // `verify-register.ts` and by the unit suite, not weakened here. Nothing in
    // this function reads an approval by any path other than the application's
    // own `getCurrentApproval`.
    await db.insert(complianceApprovals).values({
      approverName: 'A. Lawyer',
      approverRole: 'Partner',
      approvedAt: new Date('2026-07-20T00:00:00Z'),
      evidenceReference: `${PREFIX} import approval`,
      approvedJurisdictions: ['GB'],
      approvedTemplateHash: 'f'.repeat(64),
      templateKind: 'INVITATION',
      recordedById: owner.id,
    })

    // The address the wizard must **reuse** rather than duplicate. §4.3.
    await db.insert(investorAccounts).values({
      name: 'Bartholomew Ravensworth-Cole',
      email: `${PREFIX}-import-two@example.test`,
      status: 'ACTIVE',
    })

    complaints.length = 0
    await page.goto(`${ORIGIN}/import`, { waitUntil: 'networkidle' })

    await page.evaluate(() => {
      const rows = [
        'recipient_name,recipient_email,investment_amount_usd,spv_percentage,response_deadline,recipient_jurisdiction,indirect_flipit_percentage_override,internal_notes',
        'Alexandra Fenwick-Harrington,wp18-viewport-import-one@example.test,127500.00,41.666660,2026-12-31,GB,12.500000,Introduced by David at the Lisbon dinner',
        'Bartholomew Ravensworth-Cole,wp18-viewport-import-two@example.test,8250.50,2.750000,2026-11-15,US,,Asked for the long form of the agreement',
      ].join('\n')

      const input = document.querySelector('input[type="file"]') as HTMLInputElement | null
      if (!input) throw new Error('no file input on the import screen')
      const transfer = new DataTransfer()
      // Named under the prefix so the job row it creates can be removed by the
      // same rule as everything else. The previous name was `register.csv`,
      // which left an `import_jobs` row behind on every run of this script with
      // nothing to identify it by.
      transfer.items.add(new File([rows], 'wp18-viewport-register.csv', { type: 'text/csv' }))
      input.files = transfer.files
      input.dispatchEvent(new Event('change', { bubbles: true }))
    })

    await page.getByRole('button', { name: /Read the file/ }).click()

    // A locator wait, and legitimately: the wizard's step is client state, so
    // there is no row to poll. What settles is a control appearing, which is what
    // Playwright's own waiting is for. See the page-text entry in PROGRESS.md for
    // the distinction.
    await page.getByRole('button', { name: /Check the file/ }).waitFor({ timeout: 40_000 })
    await measureScreen(page, 'import — the columns', {
      mustShow: /recipient_name|Alexandra Fenwick-Harrington/,
    })

    await page.getByRole('button', { name: /Check the file/ }).click()
    await page.getByRole('button', { name: /Import \d+ recipient/ }).waitFor({ timeout: 40_000 })

    // The review table, at 375px, for the first time.
    await measureScreen(page, 'import — the review table', {
      mustShow: /127,500|Alexandra Fenwick-Harrington/,
    })

    check(
      'and nothing was created by looking at it',
      (
        await db
          .select({ email: recipients.email })
          .from(recipients)
          .where(like(recipients.email, `${PREFIX}-import%`))
      ).length === 0,
      'the review step created recipient rows, which is the one thing it promises not to do',
    )

    /*
     * The checks that would have caught the fixture this replaces.
     *
     * The version of this script that first measured the review table waited
     * for the Import button and never asked whether it was **enabled**. It was
     * not. The file carried an SPV percentage of `41.666667`, and 41.666667% of
     * the SPV works out as 12.5000001% of Flipit — seven decimals into a column
     * that stores six — so the application refused the whole file, exactly as
     * §10 requires. What that script measured and reported as *"the review
     * table"* was therefore the **error variant**: a box saying one row stops
     * the file, a table with one row in it rather than two, and a disabled
     * button reading "Import 1 recipient(s)".
     *
     * It passed. `waitFor` resolves on a disabled button, `\d+` matches a 1 as
     * happily as a 2, and `mustShow` matched a name that is in the file and so
     * is on the screen either way. That is the fourth defect of this family in
     * four entries — a check that would still pass if the thing it names were
     * absent — and this one was introduced by the entry that was fixing the
     * third.
     *
     * So: the file is now one the application accepts, and the screen is asked
     * to say so rather than merely to contain a name.
     */
    const review = await onScreen(page)

    check(
      'the file was accepted — nothing on this screen stops it',
      !/error\(s\) stop this whole file/.test(review),
      review.slice(0, 400),
    )

    check(
      'both rows are on the review table, not one',
      /Alexandra Fenwick-Harrington/.test(review) && /Bartholomew Ravensworth-Cole/.test(review),
      review.slice(0, 400),
    )

    const importButton = page.getByRole('button', { name: /Import \d+ recipient/ })
    check(
      'and the button under it offers both of them',
      /Import 2 recipient\(s\)/.test(await importButton.innerText()),
      await importButton.innerText(),
    )
    check(
      'and the button is enabled, which is the check that was missing',
      await importButton.isEnabled(),
      'the review step drew a table for a file the application had refused',
    )

    check(
      'the US row is held and the GB one is ready, side by side',
      /Blocked/.test(review) && /Ready/.test(review),
      'the review step said nothing about the row its own approval does not cover',
    )

    check(
      'the override is reported as replacing the calculation, with both figures',
      /12\.500000% replaces the calculated 12\.499998%/.test(review),
      'the operator is not told what the override displaced',
    )

    check(
      'and a total over the stated raise is a warning here, never a refusal — §10',
      /more than the stated raise/.test(review) && !/error\(s\) stop this whole file/.test(review),
      'a modelling total was treated as an error',
    )

    await verifyStepFour(page)
    await verifyTheRefusedFile(page)
  } finally {
    await clearImportFixtures()
  }
}

/**
 * The review screen's *other* variant — the one an operator meets on a bad day.
 *
 * It was being measured by accident until this session, and the accident was the
 * defect: the fixture's percentage did not divide, so every measurement of "the
 * review table" was in fact a measurement of the refusal. Fixing the fixture
 * fixed the wrong measurement and left the refusal unmeasured by anything, which
 * would have been a worse trade if nobody noticed. So it is measured on purpose,
 * with a file that is refused for the exact reason the old fixture was.
 *
 * The contrast is the point. §9 and AC7 draw a hard line between two severities
 * that land on the same screen:
 *
 *   - a **file error** stops the whole file, good rows included, because a
 *     spreadsheet with a bad address in it is not a spreadsheet to send offers
 *     from;
 *   - a **jurisdiction block** stops one recipient and leaves the batch alone.
 *
 * An operator has to be able to tell which they are looking at from the screen,
 * and until now nothing had checked that they can.
 */
async function verifyTheRefusedFile(page: Page): Promise<void> {
  await page.evaluate(() => {
    const rows = [
      'recipient_name,recipient_email,investment_amount_usd,spv_percentage,response_deadline,recipient_jurisdiction,indirect_flipit_percentage_override,internal_notes',
      // Fine. Present to prove the refusal takes it down too.
      'Clementine Ashworth,wp18-viewport-import-three@example.test,5000.00,1.500000,2026-10-01,GB,,',
      // 41.666667% of the SPV is 12.5000001% of Flipit — seven decimals into a
      // column that stores six. This is the row the previous fixture used, and
      // the reason every earlier measurement of the review table was a
      // measurement of this screen.
      'Peregrine Ashby-Lowell,wp18-viewport-import-four@example.test,127500.00,41.666667,2026-12-31,GB,12.500000,',
    ].join('\n')

    const input = document.querySelector('input[type="file"]') as HTMLInputElement | null
    if (!input) throw new Error('no file input on the import screen')
    const transfer = new DataTransfer()
    transfer.items.add(new File([rows], 'wp18-viewport-refused.csv', { type: 'text/csv' }))
    input.files = transfer.files
    input.dispatchEvent(new Event('change', { bubbles: true }))
  })

  await page.getByRole('button', { name: /Read the file/ }).click()
  await page.getByRole('button', { name: /Check the file/ }).waitFor({ timeout: 40_000 })
  await page.getByRole('button', { name: /Check the file/ }).click()
  await page.getByRole('button', { name: /Import \d+ recipient/ }).waitFor({ timeout: 40_000 })

  await measureScreen(page, 'import — a file it refuses', {
    mustShow: /stop this whole file/,
  })

  const refused = await onScreen(page)

  check(
    'the refusal says the whole file is stopped, not that one row is held',
    /error\(s\) stop this whole file/.test(refused) && !/Blocked/.test(refused),
    refused.slice(0, 400),
  )

  check(
    'and it names the row and the figure that will not divide',
    /12\.5000001/.test(refused) && /Round the SPV percentage/.test(refused),
    'the operator is told the file is wrong and not which number to change',
  )

  const button = page.getByRole('button', { name: /Import \d+ recipient/ })
  check(
    'the import button is switched off',
    !(await button.isEnabled()),
    'a file the application refused could still be imported',
  )

  check(
    'and the good row is not offered on its own',
    !/Import 1 recipient\(s\)/.test(refused) || !(await button.isEnabled()),
    'the screen offered to import the survivors of a refused file',
  )

  check(
    'and nothing was created by any of it',
    (
      await db
        .select({ email: recipients.email })
        .from(recipients)
        .where(like(recipients.email, `${PREFIX}-import-three%`))
    ).length === 0,
    'a refused file created a recipient row',
  )
}

/**
 * Step 4, pressed — and then read as a set of database facts rather than as a
 * sentence on a screen.
 *
 * The screen is measured first, because that is what this script is for. What
 * follows it is the part that could not have been asserted anywhere else: the
 * counts on the screen are the *only* place the application reports what an
 * import did, and a wrong count there is indistinguishable from a right one
 * without going and looking. So each of the four is checked against the rows.
 */
async function verifyStepFour(page: Page): Promise<void> {
  await page.getByRole('button', { name: /Import \d+ recipient/ }).click()

  // Client state again, and again a control rather than a row: the wizard is on
  // step 4 exactly when its restart button exists.
  await page.getByRole('button', { name: /Import another file/ }).waitFor({ timeout: 60_000 })

  // The screen nothing had ever drawn, with all four counts and the held-row
  // paragraph on it at once.
  await measureScreen(page, 'import — what it created', {
    mustShow: /2 recipient\(s\) and 2 offer\(s\) created/,
  })

  const reported = await onScreen(page)

  check(
    'it says one account was created and one reused',
    /1 new investor account\(s\)/.test(reported) && /1 existing account\(s\) reused/.test(reported),
    reported.slice(0, 400),
  )

  check(
    'and it says one recipient is held, not that the import failed',
    /1 recipient\(s\) are held/.test(reported) && !/failed|error/i.test(reported),
    reported.slice(0, 400),
  )

  check(
    'and it says on the screen that nothing was emailed',
    /Nothing has been emailed/.test(reported),
    'the one screen that could leave an operator thinking the invitations went out does not say they did not',
  )

  // ---- and now the rows, which are the thing the sentence is a summary of ----

  const created = await db
    .select()
    .from(recipients)
    .where(like(recipients.email, `${PREFIX}-import%`))

  check('two recipient rows exist', created.length === 2, `found ${created.length}`)

  const accounts = await db
    .select()
    .from(investorAccounts)
    .where(like(investorAccounts.email, `${PREFIX}-import%`))

  check(
    'and two accounts, not three — the existing address was reused',
    accounts.length === 2,
    `found ${accounts.length}; a duplicate account for an address that already had one breaks §4.3`,
  )

  const madeOffers = accounts.length
    ? await db
        .select()
        .from(offers)
        .where(
          inArray(
            offers.accountId,
            accounts.map((a) => a.id),
          ),
        )
    : []

  check('and two offers', madeOffers.length === 2, `found ${madeOffers.length}`)

  const gb = madeOffers.find((o) => o.proposedAmountUsd.startsWith('127500'))
  const us = madeOffers.find((o) => o.proposedAmountUsd.startsWith('8250'))

  check(
    'the US row is blocked, and says why',
    us?.blocked === true &&
      us?.blockReason === 'JURISDICTION_NOT_APPROVED' &&
      us?.emailStatus === 'BLOCKED',
    `blocked=${us?.blocked} reason=${us?.blockReason} status=${us?.emailStatus}`,
  )

  check(
    'the GB row beside it is not — a block stops one recipient, never the batch',
    gb?.blocked === false && gb?.blockReason === null && gb?.emailStatus === 'DRAFT',
    `blocked=${gb?.blocked} reason=${gb?.blockReason} status=${gb?.emailStatus}`,
  )

  check(
    'the amounts are stored as written, to the cent',
    gb?.proposedAmountUsd === '127500.00' && us?.proposedAmountUsd === '8250.50',
    `${gb?.proposedAmountUsd} / ${us?.proposedAmountUsd}`,
  )

  check(
    "the file's indirect override is stored on the row it was written against",
    gb?.indirectPercentage === '12.500000' && gb?.indirectOverridden === true,
    `${gb?.indirectPercentage} overridden=${gb?.indirectOverridden}`,
  )

  check(
    'and the row without one carries a derived figure, marked as derived',
    us?.indirectOverridden === false && us?.indirectPercentage !== null,
    `${us?.indirectPercentage} overridden=${us?.indirectOverridden}`,
  )

  check(
    'nothing was emailed to either of them',
    accounts.length > 0 &&
      (
        await db
          .select({ id: conversationMessages.id })
          .from(conversationMessages)
          .where(
            inArray(
              conversationMessages.accountId,
              accounts.map((a) => a.id),
            ),
          )
      ).length === 0,
    'an import wrote a message to an investor, which no import may do',
  )

  check(
    'and neither of them has a claim token',
    accounts.length > 0 &&
      (
        await db
          .select({ id: portalTokens.id })
          .from(portalTokens)
          .where(
            inArray(
              portalTokens.accountId,
              accounts.map((a) => a.id),
            ),
          )
      ).length === 0,
    'an import issued a token, which is WP5 behind the §8 gates and not this',
  )

  // The restart button, which is the only way back and had never been pressed.
  await page.getByRole('button', { name: /Import another file/ }).click()
  await page.getByRole('button', { name: /Read the file/ }).waitFor({ timeout: 20_000 })
  const afterRestart = await onScreen(page)
  check(
    'starting again clears the figures rather than leaving them on the screen',
    !/127,500/.test(afterRestart) && !/2 recipient\(s\) and 2 offer\(s\)/.test(afterRestart),
    afterRestart.slice(0, 300),
  )
  await measureScreen(page, 'import — back at the start')
}

/**
 * Everything the wizard run above wrote, removed.
 *
 * The recipients, accounts and offers go by the same email prefix `cleanUp`
 * uses, so a run that dies mid-wizard is tidied by the `finally` in `main` even
 * if this never runs. What this adds is the three kinds of row that are keyed by
 * something other than an address: the import job (and, by cascade, its column
 * mappings), the approval, and the audit rows naming the offers — because those
 * offers are about to stop existing, and an audit row pointing at a row that was
 * never really there is worse than no audit row at all.
 *
 * The audit log is otherwise append-only and is left alone. Deleting by id what
 * this script itself wrote is the same rule the overview-banner fixture already
 * follows; nothing else in the log is touched.
 */
async function clearImportFixtures(): Promise<void> {
  const accounts = await db
    .select({ id: investorAccounts.id })
    .from(investorAccounts)
    .where(like(investorAccounts.email, `${PREFIX}-import%`))

  if (accounts.length > 0) {
    const ids = accounts.map((a) => a.id)
    const mine = await db.select({ id: offers.id }).from(offers).where(inArray(offers.accountId, ids))
    if (mine.length > 0) {
      await db.delete(auditEvents).where(
        inArray(
          auditEvents.entityId,
          mine.map((o) => o.id),
        ),
      )
    }
    await db.delete(conversationMessages).where(inArray(conversationMessages.accountId, ids))
    await db.delete(portalTokens).where(inArray(portalTokens.accountId, ids))
    await db.delete(offers).where(inArray(offers.accountId, ids))
    await db.delete(investorAccounts).where(inArray(investorAccounts.id, ids))
  }

  await db.delete(recipients).where(like(recipients.email, `${PREFIX}-import%`))

  const jobs = await db
    .select({ id: importJobs.id })
    .from(importJobs)
    .where(like(importJobs.filename, `${PREFIX}%`))
  if (jobs.length > 0) {
    const ids = jobs.map((j) => j.id)
    await db.delete(auditEvents).where(inArray(auditEvents.entityId, ids))
    // `column_mappings` cascades from the job.
    await db.delete(importJobs).where(inArray(importJobs.id, ids))
  }

  await db
    .delete(complianceApprovals)
    .where(like(complianceApprovals.evidenceReference, `${PREFIX}%`))
}

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

/**
 * `style-src 'self'`, proved the same way as the nonce: by injecting one.
 *
 * The style directive lost its `'unsafe-inline'` after the script one did. It
 * is the smaller of the two — an injected style can move or hide things, it
 * cannot read a claim token — but hiding things is not nothing on a page whose
 * job is to state an amount, and a rule that covers the figure with a block of
 * colour is a style rather than a script.
 *
 * Three claims, and the third is the one that stops this check being a lie:
 *
 *   1. **A `style` attribute set from markup is refused.** `setAttribute` is
 *      what the parser does, so this is the injected-HTML case exactly.
 *   2. **A `<style>` element with no nonce is refused.**
 *   3. **A style set through the CSSOM still applies** — and CSP does not
 *      govern it. This is not a hole being papered over; it is the
 *      specification. Next itself relies on it for the route announcer, and a
 *      check written without knowing it fails on every screen for no reason.
 *      Recording it here is what stops the next person "fixing" that.
 */
async function verifyTheStylePolicy(page: Page): Promise<void> {
  console.log('\nThe style policy, proved by injecting what it refuses')

  complaints.length = 0
  await page.goto(`${ORIGIN}/signin`, { waitUntil: 'networkidle' })

  const fromMarkup = await page.evaluate(() => {
    const el = document.createElement('div')
    el.id = 'wp18-style-probe'
    // What a parser does with an injected `style="…"`, and what CSP inspects.
    el.setAttribute('style', 'position: fixed; width: 123px')
    document.body.appendChild(el)
    const applied = getComputedStyle(el).width
    el.remove()
    return applied
  })
  // Same reason as the wait in `verifyTheScriptPolicy`: Chromium queues the
  // violation report, so it has not arrived when `evaluate` resolves. This is a
  // wait for a *browser event*, not a stand-in for a database read — the
  // distinction the page-text entry in PROGRESS.md is about.
  await page.waitForTimeout(200)
  check(
    'a style attribute set from markup does not apply',
    fromMarkup !== '123px',
    `the element measured ${fromMarkup} — style-src is not enforcing`,
  )
  check(
    'and the policy says so, naming style-src',
    complaints.some((c) => /CSP refused style-src/.test(c)),
    complaints.filter((c) => /CSP refused/.test(c)).slice(0, 2).join(' | ') ||
      'no violation was reported at all',
  )

  const before = complaints.length
  const fromStyleElement = await page.evaluate(() => {
    const style = document.createElement('style')
    style.textContent = '#wp18-style-probe-2 { width: 321px }'
    document.head.appendChild(style)
    const el = document.createElement('div')
    el.id = 'wp18-style-probe-2'
    document.body.appendChild(el)
    const applied = getComputedStyle(el).width
    el.remove()
    style.remove()
    return applied
  })
  // As above: waiting for the queued violation report, not for a write.
  await page.waitForTimeout(200)
  check(
    'a <style> element with no nonce does not apply',
    fromStyleElement !== '321px',
    `the element measured ${fromStyleElement}`,
  )
  check(
    'and that was refused too',
    complaints.slice(before).some((c) => /CSP refused style-src|Refused to apply inline style/.test(c)),
    complaints.slice(before).slice(0, 2).join(' | ') || 'no violation was reported',
  )

  // The exemption, stated rather than discovered. Next's route announcer
  // depends on it, and a check that does not know this fails everywhere.
  const throughTheCssom = await page.evaluate(() => {
    const el = document.createElement('div')
    el.style.width = '234px'
    document.body.appendChild(el)
    const applied = getComputedStyle(el).width
    el.remove()
    return applied
  })
  check(
    'a style set through the CSSOM still applies, because no policy governs it',
    throughTheCssom === '234px',
    `the element measured ${throughTheCssom}`,
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

    const text = await onScreen(page)

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
    const health = await onScreen(page)
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
  const healthy = await onScreen(page)
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

/**
 * The media library, with a file in it — the screen nobody had populated.
 *
 * `/admin/media` has been audited from the beginning, and audited **empty**
 * every time. It carries no `mustShow`, so every run measured whichever of its
 * two empty states the environment happened to produce — *"there is nowhere to
 * store a file yet"* or *"nothing uploaded yet"* — and reported the result under
 * the name of the populated screen. That is the exact defect `mustShow` exists
 * to prevent, described in its own docstring, sitting on a screen for months.
 *
 * The populated screen is a different screen. Per image it draws a thumbnail, a
 * row of three pills, a storage address in a `<code>` element that does not
 * wrap by nature, two forms and a destructive button — none of which had ever
 * been at 375px.
 *
 * **And it uploads a real file through the real form**, which is the other half
 * of what was missing. `verify:uploads` drives this form twice and both times to
 * be *refused*; the successful band on §13.2 has never been driven from a
 * browser at all. So this chooses a file with metadata in it, presses the
 * button, and then asks three questions nothing had asked:
 *
 *   - does the thumbnail actually **load**? It is served by `/media/[key]`,
 *     which is the one route in this application with no session check, and a
 *     broken image renders as alt text that would pass every layout check on
 *     this screen.
 *   - is §13.2's headline promise true **of the bytes a browser receives**? The
 *     fixture carries a street address in five metadata blocks. `ingest` is unit
 *     tested; the served response is not, and that is the artefact.
 *   - does the address printed on the screen fetch the image it names?
 */
/**
 * The erasure section, opened, at 375px. OPEN_DECISIONS.md item 12.
 *
 * `/investors` is audited by the loop above, and until now that audit could not
 * see this section at all. It is a `<details>` and it starts **closed**, so
 * nothing inside it is laid out, nothing inside it is measured, and a page that
 * scrolls sideways the moment somebody expands it would have been reported green
 * every time. It is the same gap the import wizard had — a screen reachable only
 * by pressing something — and it is worse here, because the thing behind it is
 * the only irreversible action in the application.
 *
 * What is behind it is also the tallest and narrowest-fitting thing this
 * application draws: a sixteen-item list of sentences, each prefixed by a
 * number, inside a bordered box, inside a card, inside a page. The longest of
 * the sixteen is *"register entries with their reason cleared"* — forty-one
 * characters that must wrap without pushing anything past 375px.
 *
 * **Both branches are measured**, because they are different layouts and only
 * one of them has ever been thought about:
 *
 *   - **blocked** — the count list, then a notice where the form would be. The
 *     notice is a long unbroken paragraph naming an environment variable, which
 *     is exactly the shape that overflows a narrow column.
 *   - **the form** — the count list, a second notice, a text input, a tickbox
 *     with a paragraph beside it, and a destructive button.
 *
 * The record is the shared fixture from `scripts/lib/erasure-fixture.ts`, the same
 * one `verify:account-access` reads the numbers off. That is deliberate: this
 * script measures what that one asserts, so the list measured here can never be
 * shorter than the list checked there.
 *
 * It is seeded here rather than in `seedInvestor` and removed in this function's
 * own `finally`, so that the twenty-six screens audited above are measured
 * against the register they have always been measured against. A hundred and
 * forty extra rows on `/investors` is a different screen.
 */
async function verifyTheErasureSection(page: Page): Promise<void> {
  console.log('\nThe erasure section, opened, which nothing had ever laid out')

  const prefix = `${PREFIX}-erasure`

  try {
    const { account } = await seedErasureFixture(prefix)

    const card = page
      .locator('article', { hasText: 'Erase their personal data' })
      .filter({ hasText: `${prefix} Target` })
    const section = card.locator('details', { hasText: 'Erase their personal data' }).first()

    /** Expand it and hand back what a person can read inside it. */
    const open = async (): Promise<string> => {
      if (!(await section.evaluate((node) => (node as HTMLDetailsElement).open))) {
        await section.locator('summary').click()
      }
      await section.locator('li').first().waitFor({ state: 'visible', timeout: 20_000 })
      return flatten(await section.innerText())
    }

    /*
     * ---- blocked: the count list and the refusal ---------------------------
     *
     * **Only reachable on a run with no media store**, and that is a property of
     * the branch rather than a shortcoming of this script. `blockedBy` is set
     * when a record holds stored files *and* `mediaStore()` is null, which is
     * process-wide — so on the configured run this script asks for a few
     * hundred lines above, no record on the page can be in that state. It is
     * measured when it can be and said out loud when it cannot, because a
     * conditional check that stays quiet is a check nobody knows did not run.
     */
    complaints.length = 0
    await page.goto(`${ORIGIN}/investors`, { waitUntil: 'networkidle' })
    const blocked = await open()

    if (mediaStore() === null) {
      check(
        'with no media store, the section is the blocked one and the notice is measured',
        /no media store is configured/.test(blocked),
        blocked.slice(0, 300),
      )

      /*
       * All sixteen, on the screen, before a single pixel is measured.
       *
       * Without this the measurement is of whatever the card happened to draw,
       * and this script already knows what that costs: three screens were
       * audited in their empty state for months and reported under the name of
       * the populated one. A count list with four lines on it is a shorter box
       * than one with sixteen, and the whole question here is whether sixteen
       * fit.
       */
      const missing = ERASURE_COUNTS.filter((row) => !blocked.includes(`${row.n} ${row.label}`))
      check(
        'all sixteen count lines are drawn, so the box being measured is the tall one',
        missing.length === 0,
        missing.map((row) => `${row.n} ${row.label}`).join(' | '),
      )

      await measureScreen(page, 'investors — erasure, blocked', {
        mustShow: /register entries with their reason cleared/,
      })
    } else {
      console.log(
        '  note  a media store is configured, so no record on this page can be in the ' +
          'blocked state and that branch is not measured on this run',
      )
    }

    // ---- the form, which is the other layout -------------------------------
    complaints.length = 0
    await clearStoredFiles(account.id)
    await page.goto(`${ORIGIN}/investors`, { waitUntil: 'networkidle' })
    const offered = await open()

    check(
      'with the stored files gone, the form is what is being measured',
      !/no media store is configured/.test(offered) &&
        (await section.locator('input[name="confirmation"]').count()) === 1,
      offered.slice(0, 300),
    )

    const missingFromTheForm = ERASURE_COUNTS.filter(
      (row) =>
        row.label !== 'stored files destroyed outright' &&
        !offered.includes(`${row.n} ${row.label}`),
    )
    check(
      'and the fifteen remaining count lines are drawn above it',
      missingFromTheForm.length === 0,
      missingFromTheForm.map((row) => `${row.n} ${row.label}`).join(' | '),
    )

    /*
     * Case-insensitively, and that cost a round.
     *
     * The label is `Field`'s, which carries `uppercase` — a `text-transform`,
     * not different characters in the markup. `innerText` is the *rendered*
     * text, so it reads TYPE THEIR EMAIL ADDRESS TO CONFIRM and an exact
     * pattern fails on a screen that is perfectly correct. Every other
     * `mustShow` in this script happens to name content rather than a label,
     * which is why nothing had met this before.
     */
    await measureScreen(page, 'investors — erasure, the form', {
      mustShow: /type their email address to confirm/i,
    })

    /*
     * The one thing `measureScreen` cannot ask, because it is about a box
     * rather than about the page: does the count list itself stay inside its
     * own container?
     *
     * The page-level check catches a list that pushes the document sideways. A
     * list that overflows its bordered box *without* widening the page —
     * because an ancestor clips or scrolls — is invisible to it, and reads on a
     * phone as a sentence cut off mid-word with no indication that there is
     * more.
     */
    const listOverflow = await section.evaluate((node) => {
      const list = node.querySelector('ul')
      if (!list) return { found: false, overflow: 0, worst: '' }
      const box = list.getBoundingClientRect()
      let overflow = 0
      let worst = ''
      for (const item of Array.from(list.querySelectorAll('li'))) {
        const rect = item.getBoundingClientRect()
        const past = Math.max(rect.right - box.right, box.left - rect.left)
        if (past > overflow) {
          overflow = past
          worst = item.textContent ?? ''
        }
      }
      return { found: true, overflow: Math.round(overflow), worst: worst.slice(0, 80) }
    })
    check(
      'every count line stays inside the box that draws it',
      listOverflow.found && listOverflow.overflow <= 1,
      `${listOverflow.overflow}px past the edge on “${listOverflow.worst}”`,
    )
  } finally {
    await removeErasureFixture(prefix)
  }
}

async function verifyTheMediaLibraryWithSomethingInIt(page: Page): Promise<void> {
  console.log('\nThe media library, with something in it')

  const store = mediaStore()
  check(
    'a media store is configured for this run',
    store !== null,
    'set MEDIA_STORE in .env — the populated library cannot be measured without one',
  )
  if (!store) return

  const NAME = `${PREFIX} brand mark`
  /** The street address the fixture hides in five separate metadata blocks. */
  const SECRET = FIXTURE_SECRET_MARKER

  try {
    await page.goto(`${ORIGIN}/admin/media`, { waitUntil: 'networkidle' })

    // The contrast is the point: this run has seen the empty state, and every
    // previous run saw nothing else.
    check(
      'it starts empty, which is the only state anything had ever measured',
      /Nothing uploaded yet/.test(await onScreen(page)),
      'the library was not empty at the start of this check',
    )

    /*
     * A PNG a browser will actually draw, with real metadata in it, chosen
     * through the real input.
     *
     * `drawablePngWithMetadata` rather than `pngWithMetadata`, and that
     * distinction is the finding this check produced. Every other fixture in
     * this repository writes a deliberately fake CRC — correct for `ingest`,
     * which reads a signature and an `IHDR`, and correct for the stripper, which
     * works on chunk boundaries. A browser validates one, so until this fixture
     * existed nothing here could produce an image capable of being displayed,
     * and the plainest question anybody could ask of a media library could not
     * be asked at all.
     *
     * `setInputFiles` with a buffer rather than a path: the fixture is generated
     * and writing it to disk to feed a file picker would leave a file behind on
     * a run that dies.
     */
    await page.locator('#file').setInputFiles({
      name: 'brand-mark.png',
      mimeType: 'image/png',
      buffer: Buffer.from(drawablePngWithMetadata()),
    })

    check(
      'choosing a file puts its name on the screen',
      (await page.locator('#file').evaluate(
        (input) => (input as HTMLInputElement).files?.[0]?.name ?? '',
      )) === 'brand-mark.png',
      'the input reported no file — nothing below is measuring an upload',
    )

    await page.fill('input[name="name"]', NAME)
    await page.fill(
      'textarea[name="description"]',
      'For the email header. Orange on dark.',
    )
    await page.locator('form:has(#file)').getByRole('button', { name: 'Upload it' }).click()

    // The card is server-rendered after a revalidate, so this waits for the
    // name rather than for a fixed delay.
    await page.getByText(NAME, { exact: false }).first().waitFor({ timeout: 30_000 })

    const [asset] = await db
      .select()
      .from(mediaAssets)
      .where(eq(mediaAssets.name, NAME))
    check('the upload reached the library', asset !== undefined)
    if (!asset) return

    const shown = await onScreen(page)
    check(
      'the card names the format, the size and the dimensions',
      /png/i.test(shown) && /KB/.test(shown) && /128\s*×\s*64/.test(shown),
      shown.slice(0, 400),
    )
    check(
      'and prints the address it is served from',
      shown.includes(`/media/${asset.storageKey}`),
      'the operator cannot copy the address into an email template',
    )

    /*
     * The thumbnail, asked of the browser.
     *
     * `naturalWidth` is 0 for an image that failed to load and non-zero for one
     * that decoded. A broken thumbnail renders as alt text — which has a size, a
     * contrast ratio and a tap target, and would pass every other check on this
     * screen while showing the operator nothing.
     */
    const thumbnail = await page.evaluate(() => {
      const element = document.querySelector('img')
      if (!element) return null
      return {
        src: element.getAttribute('src') ?? '',
        loaded: element.naturalWidth > 0,
        width: element.naturalWidth,
        height: element.naturalHeight,
      }
    })
    check('a thumbnail is drawn at all', thumbnail !== null)
    check(
      'and the browser actually decoded it',
      thumbnail?.loaded === true,
      `naturalWidth was ${thumbnail?.width} — the image did not load and the alt text would pass every layout check here`,
    )
    check(
      'at the dimensions the row recorded',
      thumbnail?.width === asset.width && thumbnail?.height === asset.height,
      `${thumbnail?.width}×${thumbnail?.height} against ${asset.width}×${asset.height} on the row`,
    )

    /*
     * §13.2's headline promise, on the bytes rather than on the function.
     *
     * *"A photograph taken on a phone carries the coordinates it was taken at;
     * that is stripped before anything is written to disk."* `ingest` is unit
     * tested against that. What a browser receives from `/media/[key]` is a
     * different artefact, and nothing had ever read one.
     */
    const served = await page.request.get(`${ORIGIN}${thumbnail!.src}`)
    const bytes = Buffer.from(await served.body())
    check(
      'the address on the screen fetches the image it names',
      served.status() === 200 && (served.headers()['content-type'] ?? '').startsWith('image/'),
      `${served.status()} ${served.headers()['content-type']}`,
    )
    check(
      'and what the browser receives carries none of the metadata that went in',
      !bytes.includes(SECRET) && !bytes.includes('tEXt') && !bytes.includes('eXIf'),
      'the served file still contains what §13.2 promises is removed before anything is written to disk',
    )
    check(
      'served as the type sniffed from the file, never one a browser proposed',
      served.headers()['content-type'] === asset.contentType &&
        served.headers()['x-content-type-options'] === 'nosniff',
      `${served.headers()['content-type']} / ${served.headers()['x-content-type-options']}`,
    )

    /*
     * And now the screen itself, at 375px, populated — which is the whole reason
     * this function exists. `mustShow` is the asset's own name, so a run that
     * silently lost the upload measures nothing and says so.
     */
    await measureScreen(page, 'media library — with an image in it', {
      mustShow: new RegExp(PREFIX),
      html: await (await page.request.get(`${ORIGIN}/admin/media`)).text(),
    })

    check(
      'the destructive control is present and named plainly',
      /Remove/.test(shown) && /Removing deletes the stored file as well/.test(shown),
      'an operator can delete a file with no warning about what else it breaks',
    )
  } finally {
    /*
     * By id, and the stored file with it. A row deleted without its file leaves
     * bytes on disk that nothing points at; a file deleted without its row
     * leaves a card whose thumbnail is broken — which is the state this function
     * asserts cannot happen.
     */
    const leftovers = await db
      .select()
      .from(mediaAssets)
      .where(like(mediaAssets.name, `${PREFIX}%`))
    for (const leftover of leftovers) {
      await store.remove(leftover.storageKey)
      await db.delete(auditEvents).where(eq(auditEvents.entityId, leftover.id))
      await db.delete(mediaAssets).where(eq(mediaAssets.id, leftover.id))
    }
  }
}

/**
 * The error page, rendered by a real error.
 *
 * This item has been on the Uncertain list for seven entries, always with the
 * same sentence beside it: *"reaching it deliberately needs a fault that can be
 * induced and undone."* The obstacle was never the measuring. It was that every
 * obvious way to make this application fail — deleting a table, revoking a
 * grant, corrupting a row — mutates the database the other 391 checks are
 * standing on, and a run killed halfway leaves a developer with a broken
 * development database and no note explaining it.
 *
 * **So the fault is put somewhere it cannot reach anything.** A second copy of
 * the application is started, from the same build, on its own port, with
 * `DATABASE_URL` naming a database that does not exist. Nothing is created and
 * nothing is dropped; the working database is not touched, not even read. The
 * fault is undone by killing a process.
 *
 * Reaching a page that queries is then the only remaining problem, because no
 * public page in this application does — `/`, `/verify`, `/privacy`, `/signin`
 * and both portal pages all answer 200 against a database that is not there,
 * which is itself worth knowing. What queries is the **session lookup**, and it
 * runs whenever a session cookie is present, before anything asks whether the
 * cookie is any good. So the context carries a cookie that is not a session:
 * `readAdminSession` hashes it, goes to the database to look it up, and the
 * request fails inside a real page render exactly as it would if Postgres went
 * away mid-morning.
 *
 * That is a fair simulation of the fault this page exists for. A database
 * unreachable, or a migration that has not run, is by a distance the likeliest
 * way this application will ever produce a 500.
 *
 * **What it found, on the first run:**
 *
 *   - the served response carries **no visible text at all**. `error.tsx` is a
 *     client component, as the framework requires, so the branded page appears
 *     on hydration and not before. A reader with JavaScript off gets a blank
 *     page under a 500. That is a property of the framework rather than a
 *     defect here, and nothing had said so.
 *   - the response **does** carry the error digest, in the flight payload, twice
 *     — while `error.tsx`'s own docstring says it *"withholds the digest too."*
 *     It withholds it from the page. It cannot withhold it from the payload:
 *     Next puts it there. The claim is now stated accurately in that file, and
 *     the check below asserts the true and useful property — that **nothing
 *     else** is in the response — using `everythingSent`, which reads the
 *     payload and the attributes rather than the rendered text.
 */
async function verifyTheErrorPage(browser: Browser): Promise<void> {
  console.log('\nThe error page, with a real error behind it')

  const port = PORT + 1
  const origin = `http://127.0.0.1:${port}`

  const broken = spawn('node_modules/.bin/next', ['start', '--port', String(port)], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(port),
      APP_URL: origin,
      BASE_PATH: '',
      // A database that does not exist. Not a closed port: a refused connection
      // and a missing database fail at different layers, and the missing one is
      // the closer match to the fault this page will really meet — a migration
      // that has not run, or a restore pointed at the wrong name.
      DATABASE_URL: 'postgresql://postgres@127.0.0.1:5433/spv-no-such-database',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  })

  let context: BrowserContext | undefined
  try {
    const deadline = Date.now() + 60_000
    let up = false
    while (Date.now() < deadline && !up) {
      try {
        const response = await fetch(`${origin}/verify`)
        up = response.status < 500
      } catch {
        // Not listening yet.
      }
      if (!up) await new Promise((r) => setTimeout(r, 500))
    }
    check('a second copy of the application starts against a database that is not there', up)
    if (!up) return

    // Worth its own check: no public page in this application queries. An
    // investor reading the anti-phishing page while the database is down still
    // gets the anti-phishing page, which is the one time it is most needed.
    const publicPages = await Promise.all(
      ['/', '/verify', '/privacy', '/signin'].map(async (path) => ({
        path,
        status: (await fetch(`${origin}${path}`)).status,
      })),
    )
    check(
      'and every public page still answers, because none of them reads the database',
      publicPages.every((p) => p.status < 400),
      publicPages.map((p) => `${p.path} ${p.status}`).join(' | '),
    )

    context = await browser.newContext({
      viewport: VIEWPORT,
      deviceScaleFactor: 3,
      isMobile: true,
      hasTouch: true,
    })
    // Not a session. A string that makes the session lookup happen at all.
    await context.addCookies([
      { name: 'spv.admin_session', value: 'not-a-session', domain: '127.0.0.1', path: '/' },
    ])
    const page = await context.newPage()
    watchTheConsole(page)
    complaints.length = 0

    const response = await page.goto(`${origin}/admin`, { waitUntil: 'networkidle' })
    check(
      'a page that reads the database answers 500',
      response?.status() === 500,
      `returned ${response?.status()}`,
    )

    const shown = await onScreen(page)
    check(
      'and the reader gets this application’s error page, not the framework’s',
      /Something went wrong at our end/.test(shown),
      shown.slice(0, 300),
    )
    check(
      'which says nothing was lost and nothing was sent',
      /Nothing you were doing has been lost/.test(shown) &&
        /nothing has been sent anywhere/.test(shown),
      shown.slice(0, 300),
    )
    check(
      'and offers a retry rather than a sign-in form',
      /Try again/.test(shown) && !/Sign in|password/i.test(shown),
      'an investor whose portal failed to render was sent to a form asking for their address',
    )

    // The layout checks, on the one screen in the application that is drawn
    // when everything else has stopped working. React reports an errored server
    // render to the console by design, and that one sentence is the screen
    // working; every other complaint still fails the check.
    const expectedComplaint = /An error occurred in the Server Components render/
    await measureScreen(page, 'error page', { expected: 500, expectedComplaint })

    // And the sentence React logs is itself a surface. It is read by anybody the
    // reader forwards a screenshot of the console to.
    const logged = complaints.filter((c) => expectedComplaint.test(c)).join(' | ')
    check(
      'and what React logs to the console names no fault either',
      logged !== '' &&
        !/spv-no-such-database|does not exist|postgres(ql)?:\/\//i.test(logged) &&
        /omitted in production builds/.test(logged),
      logged.slice(0, 300),
    )

    /*
     * The leak checks, and deliberately against `everythingSent` rather than
     * `onScreen`.
     *
     * `error.tsx` says it shows no detail: not the message, not the stack, not
     * the digest. Read off the rendered page that claim is true and easy. Read
     * off the response it is not quite: the framework puts the digest in the
     * flight payload and this application cannot take it out. So the digest is
     * excluded from what follows and stated plainly in `error.tsx`, and what is
     * asserted here is the part that matters and that this application does
     * control — that a failed render sends the reader **no fact about the
     * fault**.
     */
    const sent = await everythingSent(page)
    const leaks = [
      ['the database name', /spv-no-such-database/],
      ['a Postgres error', /does not exist|relation|ECONNREFUSED|ENOTFOUND/i],
      ['a connection string', /postgres(ql)?:\/\//i],
      ['a stack frame', /\bat [A-Za-z_$][\w$]*\s*\(|\.ts:\d+:\d+|\.js:\d+:\d+/],
      ['a path on the server', /\/root\/|\/home\/|node_modules/],
      ['a table name', /\binvestor_accounts\b|\bsessions\b|\boffers\b/],
      ['an address', /@example\.test|@flipthepage\.com|@gmail\.com/],
    ] as const

    for (const [what, pattern] of leaks) {
      check(
        `the response contains no ${what}`,
        !pattern.test(sent),
        `${pattern} matched what was sent`,
      )
    }

    check(
      'the digest is not on the screen, whatever the payload carries',
      !/digest/i.test(shown),
      'the reader is shown an opaque code they can only forward to a stranger',
    )

    check(
      'the retry button is a real control at 44px',
      await page.getByRole('button', { name: /Try again/ }).isEnabled(),
      'the one control on the failure page cannot be pressed',
    )

    /*
     * The pre-hydration state, which is the finding this section exists to have
     * written down. The response body is measured directly rather than through
     * the browser: what a reader with JavaScript off sees is what arrived, and
     * a browser has already run the script by the time it can be asked.
     */
    const servedText = flatten(
      (await (await fetch(`${origin}/admin`, { headers: { cookie: 'spv.admin_session=not-a-session' } })).text())
        .replace(/<script[\s\S]*?<\/script>/g, '')
        .replace(/<[^>]+>/g, ' '),
    )
    check(
      'the served body carries no fault detail either, before any script runs',
      !/does not exist|postgres|spv-no-such-database/i.test(servedText),
      servedText.slice(0, 300),
    )
    check(
      'and it is blank until hydration — a framework property, recorded not fixed',
      servedText.replace(/Admin — Flipit SPV/, '').trim().length < 40,
      `the served 500 body drew ${servedText.length} characters: ${servedText.slice(0, 200)}`,
    )

    await verifyTheErrorAnInvestorGets(page, origin)
  } finally {
    await context?.close()
    stopServer(broken)
  }
}

/**
 * The same failure, on the investor's own portal.
 *
 * Everything above is an operator's screen. §16 and the review checklist's fifth
 * question are about **an investor's**: *"does any investor-facing response, page
 * or error reveal that another investor exists?"* — and the word `error` in that
 * sentence had never been tested, because no error had ever been produced.
 *
 * It is the sharpest instance of the rule there is. An investor whose portal
 * fails to render is the one reader in this system who must be told nothing:
 * not that a database exists, not what is in it, and above all not that anybody
 * else is in it. The page's own promise — *"nothing has been sent anywhere"* —
 * is the sentence a person reads when they are wondering whether their money
 * moved, so it has to be there and it has to be the whole of what they get.
 *
 * Reached the same way as the operator's: a cookie that is not a session, which
 * makes the lookup happen before anything asks whether the cookie is any good.
 */
async function verifyTheErrorAnInvestorGets(page: Page, origin: string): Promise<void> {
  await page.context().clearCookies()
  await page.context().addCookies([
    { name: 'spv.portal_session', value: 'not-a-session', domain: '127.0.0.1', path: '/' },
  ])
  complaints.length = 0

  const response = await page.goto(`${origin}/portal`, { waitUntil: 'networkidle' })
  check(
    "an investor's portal answers 500 rather than something worse",
    response?.status() === 500,
    `returned ${response?.status()}`,
  )

  const shown = await onScreen(page)
  check(
    'and the investor gets the branded page with the sentence that matters',
    /Something went wrong at our end/.test(shown) && /nothing has been sent anywhere/.test(shown),
    shown.slice(0, 300),
  )

  await measureScreen(page, "error page, on an investor's portal", {
    expected: 500,
    expectedComplaint: /An error occurred in the Server Components render/,
  })

  /*
   * The fifth question, asked of an error for the first time. The seeded
   * investor is a real row in the working database — a different database from
   * the one this server is failing to reach — so none of this could be here by
   * accident, which is the point: what is being checked is that the failure path
   * does not reach for a name to be helpful with.
   */
  const sent = await everythingSent(page)
  for (const [what, pattern] of [
    ['a name', /Fenwick-Harrington|Ravensworth-Cole|Ashby-Lowell/],
    ['an address', /@example\.test|@flipthepage\.com|@gmail\.com/],
    ['an amount', /127,500|\$[\d,]{4,}/],
    ['a count of anybody', /\b\d+ (investor|recipient|account|offer)/i],
    ['a fault', /does not exist|relation|postgres(ql)?:\/\/|spv-no-such-database/i],
  ] as const) {
    check(
      `the investor's error response contains no ${what}`,
      !pattern.test(sent),
      `${pattern} matched what was sent to an investor`,
    )
  }

  check(
    'and it does not send them to a form asking who they are',
    !/Sign in|email address|password/i.test(shown),
    'an investor whose portal failed was asked to identify themselves',
  )
}

/**
 * The email preview, which is the last screen anybody sees before a real
 * invitation goes to a real person — and which nothing had ever opened.
 *
 * It has been on the Uncertain list, in the same sentence as the recorder and
 * the image preview, since the CSP entries: *"the image upload preview and the
 * email template preview are still unexercised."* `/templates` is audited;
 * `/templates/preview/[offerId]` is a different screen behind a parameter, and
 * nothing in this repository had ever been to it.
 *
 * It matters more than its position on that list suggests, for three reasons.
 *
 * **It renders untrusted markup.** An email body is markup by construction, and
 * this page puts it in an `<iframe sandbox="">` rather than into the admin
 * document. `sandbox=""` grants nothing: no scripts, no forms, and — the one
 * that matters — no same-origin. That claim is a sentence in a docstring and an
 * attribute in a source file, and neither of those is the browser. **The
 * property is browser-enforced or it is not true**, and the only way to know is
 * to ask a browser, which is what this script is for.
 *
 * **It is the pre-flight surface.** §11.4 makes an unresolved template variable
 * a send-blocking fault; this is the screen where an operator would see one.
 *
 * **It is investor-facing content on an operator's screen.** The preview is of
 * one recipient. A second investor is created for the duration precisely so
 * that the leak check has something it *could* find — a check for another
 * investor's name against a database holding one investor is the vacuous shape
 * this repository has now been caught by four times.
 */
async function verifyTheEmailPreview(page: Page): Promise<void> {
  console.log('\nThe email preview, which nothing had ever opened')

  const [account] = await db
    .select({ id: investorAccounts.id })
    .from(investorAccounts)
    .where(eq(investorAccounts.email, `${PREFIX}@example.test`))
  if (!account) throw new Error('the seeded investor is missing')

  const [offer] = await db.select().from(offers).where(eq(offers.accountId, account.id))
  if (!offer) throw new Error('the seeded offer is missing')

  // Somebody else, so the leak check below can fail.
  const [other] = await db
    .insert(investorAccounts)
    .values({
      name: 'Wilhelmina Draycott-Pemberley',
      email: `${PREFIX}-other@example.test`,
      status: 'ACTIVE',
    })
    .returning()
  const [otherOffer] = await db
    .insert(offers)
    .values({
      roundId: offer.roundId,
      accountId: other!.id,
      proposedAmountUsd: '98765.43',
      spvPercentage: '9.000000',
      indirectPercentage: '2.700000',
      responseDeadline: '2026-12-31',
    })
    .returning()

  const tokensBefore = await db
    .select({ id: portalTokens.id })
    .from(portalTokens)
    .where(eq(portalTokens.accountId, account.id))

  const [configBefore] = await db
    .select({
      name: serviceConfig.defaultSenderName,
      email: serviceConfig.defaultSenderEmail,
    })
    .from(serviceConfig)
    .where(eq(serviceConfig.id, SERVICE_CONFIG_ID))

  try {
    /*
     * The blocked state first, because it is the state this repository is
     * actually in and nobody had looked at it.
     *
     * The seeded database has no sending account configured — that is Michael
     * and David's step, not a build's — so `sender_name` and `sender_email` do
     * not resolve, and §11.4 refuses to render an email with a gap in it. What
     * an operator gets instead is a card naming each missing variable. It is the
     * send-blocking surface, it is the screen this build shows until the day the
     * app password is connected, and it had never been measured anywhere.
     */
    await auditScreen(
      page,
      'email preview — nothing to preview yet',
      `/templates/preview/${offer.id}`,
      200,
      /Alexandra Fenwick-Harrington/,
    )

    const blocked = await onScreen(page)
    check(
      'with no sending account configured, the preview refuses rather than rendering a gap',
      /cannot be sent yet/.test(blocked) && !/HTML part/.test(blocked),
      blocked.slice(0, 300),
    )
    check(
      'and it names each variable that could not be resolved',
      /sender_name/.test(blocked) && /sender_email/.test(blocked),
      'the operator is told there is a problem and not which one',
    )

    /*
     * Now the rendered state, which needs a sender.
     *
     * **This sets a display name and an address. It does not touch the
     * mail-connection gate.** Everything the §8 gate reads — the encrypted
     * credential, the recorded connection — is left exactly as it is; what is
     * set here is the two `service_config` fields the operator's own onboarding
     * form sets, and the address is an `@example.test` one that could not
     * receive mail if anything tried. Nothing here sends. Both values go back in
     * the `finally` below.
     */
    await db
      .update(serviceConfig)
      .set({
        defaultSenderName: 'David Serene',
        defaultSenderEmail: `${PREFIX}-sender@example.test`,
      })
      .where(eq(serviceConfig.id, SERVICE_CONFIG_ID))

    /*
     * The defect that used to be recorded here is fixed, and this is where the
     * fix is proved rather than asserted.
     *
     * It was: a `srcdoc` frame inherits the embedding document's Content-
     * Security-Policy, and this application serves `style-src 'self'`. A
     * designed HTML email is inline styles by construction — the invitation
     * carries 69 of them, because that is the only styling a mail client will
     * honour — so every one was refused inside the preview frame, and the
     * operator reviewing the last screen before a real invitation went to a real
     * person saw an **unstyled** version of what the recipient would receive.
     *
     * The body now comes from `…/preview/[offerId]/body`, its own authenticated
     * route under its own narrow policy, and the frame points at `src`. So this
     * screen is audited with **no tolerated complaint at all**: if one style is
     * still refused anywhere on it, `measureScreen` fails on the console rather
     * than having been told to expect it.
     */
    await auditScreen(
      page,
      'email preview',
      `/templates/preview/${offer.id}`,
      200,
      /Alexandra Fenwick-Harrington/,
    )

    check(
      "the email's own styling is no longer refused inside the preview frame",
      expectedComplaintsHeard.length === 0,
      'a complaint was tolerated on a screen that should now make none',
    )

    const shown = await onScreen(page)

    check(
      'both parts of the email are on the screen, not just the HTML one',
      /HTML part/.test(shown) && /Plain-text part/.test(shown),
      'a text part is mandatory and materially helps deliverability — §11.4',
    )

    check(
      'no template variable is left unresolved on the screen',
      !/\{\{|\}\}/.test(shown),
      'an unresolved variable is a send-blocking fault and this is where it would be seen',
    )

    check(
      'the figures in the email are the stored ones',
      /12,500/.test(shown),
      'the preview showed an amount that is not the one on the offer',
    )

    /*
     * The sandbox, asked of the browser rather than of the source.
     *
     * `contentDocument` is `null` for a frame the browser has given an opaque
     * origin to, and non-null the moment `allow-same-origin` appears or the
     * attribute is dropped. That is the whole claim — *"no same-origin"* — and
     * it is the difference between an email body being inert markup and an
     * email body being able to read the administrator's page it is drawn on.
     */
    const frame = await page.evaluate(() => {
      const element = document.querySelector('iframe')
      if (!element) return null
      return {
        sandbox: element.getAttribute('sandbox'),
        referrerPolicy: element.getAttribute('referrerpolicy'),
        reachable: element.contentDocument !== null,
        src: element.getAttribute('src') ?? '',
        srcdoc: element.getAttribute('srcdoc'),
      }
    })

    check('the email is drawn in a frame at all', frame !== null)
    check(
      'and the frame is pointed at the body route, not at a srcdoc attribute',
      /\/templates\/preview\/[^/]+\/body\?kind=INVITATION$/.test(frame?.src ?? '') &&
        frame?.srcdoc === null,
      `src="${frame?.src}" srcdoc=${frame?.srcdoc === null ? 'absent' : 'PRESENT'}`,
    )
    check(
      'the frame grants nothing — sandbox is present and empty',
      frame?.sandbox === '',
      `sandbox="${frame?.sandbox}"`,
    )
    check(
      'and the browser enforces it: the email cannot be reached from the page',
      frame?.reachable === false,
      'contentDocument was reachable, so the frame shares this origin and an email body can read the administrator’s screen',
    )
    check(
      'and it sends no referrer',
      frame?.referrerPolicy === 'no-referrer',
      `referrerPolicy="${frame?.referrerPolicy}"`,
    )

    /*
     * The frame is not empty, asked of the browser rather than of an attribute.
     *
     * `srcdoc` carried the body in the markup, so "is there anything to draw"
     * used to be answerable by reading the page. A `src` is a promise that
     * something will be fetched, and a fetch that 404s leaves a frame that is
     * white, silent and passes every other check on this screen — which is the
     * exact failure the old `hasBody` check existed to catch, in its new shape.
     *
     * Playwright can enumerate a frame it cannot script, so this is asked of
     * `page.frames()`: the child frame exists and its URL is the route.
     */
    const childFrames = page.frames().filter((candidate) => candidate !== page.mainFrame())
    check(
      'the browser actually loaded a document into it',
      childFrames.length === 1 && /\/templates\/preview\/[^/]+\/body\?/.test(childFrames[0]!.url()),
      `${childFrames.length} child frames: ${childFrames.map((f) => f.url()).join(', ')}`,
    )

    /*
     * The route itself, read directly — the part of this that a screenshot
     * could never show and the console could only hint at.
     *
     * `page.request` carries the browsing context's cookies, so this is the
     * administrator's own fetch of the same URL the frame fetched.
     */
    const bodyUrl = `${ORIGIN}${frame!.src}`
    const bodyResponse = await page.request.get(bodyUrl)
    const bodyHeaders = bodyResponse.headers()
    const bodyMarkup = await bodyResponse.text()

    check(
      'the body route answers the administrator',
      bodyResponse.status() === 200,
      `${bodyResponse.status()} from ${frame!.src}`,
    )
    check(
      'and it is served as a document rather than sniffed into one',
      (bodyHeaders['content-type'] ?? '').startsWith('text/html') &&
        bodyHeaders['x-content-type-options'] === 'nosniff',
      `${bodyHeaders['content-type']} / ${bodyHeaders['x-content-type-options']}`,
    )
    check(
      'and it carries the email body’s own policy, not the application’s',
      bodyHeaders['content-security-policy'] === EMAIL_BODY_POLICY,
      `policy was: ${bodyHeaders['content-security-policy']}`,
    )
    check(
      'which grants inline style and nothing else at all',
      /(^|;\s*)style-src 'unsafe-inline'(;|$)/.test(bodyHeaders['content-security-policy'] ?? '') &&
        /(^|;\s*)default-src 'none'(;|$)/.test(bodyHeaders['content-security-policy'] ?? ''),
      bodyHeaders['content-security-policy'] ?? 'no policy at all',
    )
    check(
      'and the grant is what the email actually needs — it is inline styles throughout',
      (bodyMarkup.match(/\sstyle="/g) ?? []).length > 20,
      `${(bodyMarkup.match(/\sstyle="/g) ?? []).length} inline styles in the served body`,
    )
    /*
     * §16's fifth question, asked of the body response as well as of the page.
     *
     * It used to be enough to ask it of the page: the email travelled in a
     * `srcdoc` attribute, so `everythingSent` covered the markup too. The body
     * is its own response now, and a leak check that stopped covering it would
     * be green about something it was no longer reading — the shape this
     * repository has been caught by four times. The other investor exists two
     * rows away for the duration of this function, so there is something to find.
     */
    for (const [what, pattern] of [
      ["the other investor's name", /Draycott-Pemberley/],
      ["the other investor's address", new RegExp(`${PREFIX}-other@example\\.test`)],
      ["the other investor's amount", /98,?765/],
    ] as const) {
      check(
        `the served email body contains no ${what}`,
        !pattern.test(bodyMarkup),
        `${pattern} matched the body one recipient is about to be sent`,
      )
    }

    check(
      'this one path may be framed by this application, and DENY still holds elsewhere',
      bodyHeaders['x-frame-options'] === 'SAMEORIGIN',
      `X-Frame-Options: ${bodyHeaders['x-frame-options']}`,
    )
    check(
      'one recipient’s correspondence is never stored on the way',
      /no-store/.test(bodyHeaders['cache-control'] ?? '') &&
        /noindex/.test(bodyHeaders['x-robots-tag'] ?? ''),
      `${bodyHeaders['cache-control']} / ${bodyHeaders['x-robots-tag']}`,
    )

    /*
     * And the guard, asked without a session.
     *
     * A new context with no cookies at all. This is a route that serves a named
     * individual's correspondence — their address, the amount they are being
     * offered, and the shape of the link they will be sent — and the id in the
     * URL is the only thing between it and anybody who guesses one.
     */
    const anonymous = await page.context().browser()!.newContext()
    try {
      const refused = await anonymous.request.get(bodyUrl)
      check(
        'and without a session it refuses, with nothing in the response',
        refused.status() === 404 && (await refused.text()).length === 0,
        `${refused.status()}, ${(await refused.text()).length} bytes`,
      )
      const invented = await anonymous.request.get(
        `${ORIGIN}/templates/preview/00000000-0000-4000-8000-000000000000/body`,
      )
      check(
        'and an offer that does not exist refuses identically — no id is confirmed',
        invented.status() === refused.status(),
        `${invented.status()} for an invented id against ${refused.status()} for a real one`,
      )
    } finally {
      await anonymous.close()
    }

    /*
     * §16 and the fifth review question, on an operator's screen that renders
     * one investor's correspondence while another exists two rows away.
     */
    const sent = await everythingSent(page)
    for (const [what, pattern] of [
      ["the other investor's name", /Draycott-Pemberley/],
      ["the other investor's address", new RegExp(`${PREFIX}-other@example\\.test`)],
      ["the other investor's amount", /98,?765/],
    ] as const) {
      check(`the preview contains no ${what}`, !pattern.test(sent), `${pattern} matched`)
    }

    check(
      'previewing issued no credential — a read does not mint a token',
      (
        await db
          .select({ id: portalTokens.id })
          .from(portalTokens)
          .where(eq(portalTokens.accountId, account.id))
      ).length === tokensBefore.length,
      'opening the preview created a portal token, which would make a preview a way of issuing access',
    )

    check(
      'and the link it shows is not one that works',
      !/\/portal\/claim\?token=[A-Za-z0-9_-]{20,}/.test(sent),
      'the preview rendered a claimable link',
    )

    // The reminder is a different template through the same screen, and the
    // `kind` parameter is parsed rather than cast — an unknown value falls back
    // to the invitation rather than throwing.
    await auditScreen(
      page,
      'email preview — the reminder',
      `/templates/preview/${offer.id}?kind=REMINDER`,
      200,
      /Alexandra Fenwick-Harrington/,
      /Refused to apply inline style/,
    )
    await auditScreen(
      page,
      'email preview — an unknown kind falls back rather than failing',
      `/templates/preview/${offer.id}?kind=NONSENSE`,
      200,
      /Alexandra Fenwick-Harrington/,
      /Refused to apply inline style/,
    )
  } finally {
    await db.delete(offers).where(eq(offers.id, otherOffer!.id))
    await db.delete(investorAccounts).where(eq(investorAccounts.id, other!.id))
    await db
      .update(serviceConfig)
      .set({
        defaultSenderName: configBefore?.name ?? null,
        defaultSenderEmail: configBefore?.email ?? null,
      })
      .where(eq(serviceConfig.id, SERVICE_CONFIG_ID))
  }
}
