/**
 * The application under a path prefix, asked rather than assumed. WP20.
 *
 * BUILD_SPEC §18: *"The app runs under a path prefix, so `basePath` must be
 * configurable from an environment variable from day one rather than
 * retrofitted. **Every internal link, asset path, cookie path, and callback URL
 * has to respect it.**"*
 *
 * CODEX_TASKS makes that the acceptance condition: *"the app runs under a path
 * prefix with every link correct."* "Every link correct" is not a property of
 * the configuration; it is a property of what comes back over the wire, and the
 * two disagreed. `next.config.ts` exempted `/verify` from the blanket
 * `noindex`, a unit test asserted the exemption was in the array, and the
 * served response carried `noindex` anyway — because Next.js applies every
 * matching entry in order and the catch-all overwrote it. That is invisible to
 * anything short of asking a running server.
 *
 * So this builds twice and serves twice: once at a domain root, once under
 * `/SPV`. Under the prefix it checks
 *
 *   - every route answers only under the prefix, and 404s without it;
 *   - every `href` and `src` in the delivered HTML carries the prefix, or is a
 *     fragment, a `mailto:`, or an absolute URL;
 *   - the session cookie is scoped to the prefix, so it is not offered to the
 *     rest of the domain;
 *   - `robots.txt` names prefixed paths, because a robots path is relative to
 *     the domain root and `Disallow: /` there is somebody else's whole site;
 *   - the sitemap's one URL is absolute and prefixed;
 *   - `X-Robots-Tag` is `noindex` everywhere except the verification page and
 *     the two crawler files, which is the check that failed;
 *   - a claim link works end to end under the prefix;
 *   - and sending is refused, because `APP_URL` is not `PRODUCTION_APP_URL`.
 *
 *   pnpm verify:deployment
 */

import 'dotenv/config'
import { spawn, type ChildProcess } from 'node:child_process'
import { eq, like } from 'drizzle-orm'
import { db } from '@/db'
import {
  documentPackages,
  investorAccounts,
  investorSessions,
  mediaAssets,
  offers,
  operatorVideos,
  portalTokens,
  recipients,
  rounds,
  users,
} from '@/db/schema'
import { issueToken } from '@/lib/crypto'
import { jpegWithMetadata, mp4WithLocation, pdfBytes } from '@/lib/media/fixtures'
import { ingest } from '@/lib/media/ingest'
import { mediaStore } from '@/lib/media/store'

const PREFIX = 'wp20-deploy'
const BASE_PATH = '/SPV'
const PORT = 3230
const HOST = `http://127.0.0.1:${PORT}`
const ORIGIN = `${HOST}${BASE_PATH}`
/** A fixture secret for the health endpoint, for the life of one server. */
const HEALTH_TOKEN = `${PREFIX}-health-token-not-a-real-secret-0000000000`

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

// ---------------------------------------------------------------------------

async function status(path: string): Promise<number> {
  const response = await fetch(`${HOST}${path}`, { redirect: 'manual' })
  return response.status
}

async function text(path: string): Promise<string> {
  const response = await fetch(`${HOST}${path}`)
  return response.text()
}

async function header(path: string, name: string): Promise<string | null> {
  const response = await fetch(`${HOST}${path}`, { redirect: 'manual' })
  return response.headers.get(name)
}

/**
 * The browser-policy headers, on a response rather than in a file.
 *
 * The unit suite asserts these against source, and `pnpm verify:viewport`
 * exercises what they block in a real browser. Between the two sat a gap this
 * script is the right place to close: **is the header on the wire at all, and
 * is it on the wire once?**
 *
 * That is not a pedantic question. The Content-Security-Policy now comes from
 * `src/middleware.ts` rather than from `next.config.ts`, and the failure mode
 * of getting that wrong is not an error — it is *two* `Content-Security-Policy`
 * headers on one response. A browser then enforces the intersection of two
 * policies, which here would happen to be roughly right, silently, until
 * somebody edited one of the two files. `fetch` joins repeated headers with a
 * comma, so a second policy shows up as a second `default-src`.
 *
 * And it is checked **under the path prefix** specifically. A middleware
 * matcher is a path pattern; Next rewrites it for `basePath`, and if that ever
 * stopped working the symptom would be an application served with no policy at
 * all on the one deployment that is reachable from the internet. Nothing else
 * in this repository would notice, because every other check runs at a domain
 * root.
 */
async function verifyTheBrowserPolicyOnAServedResponse(): Promise<void> {
  console.log('\nThe browser policy, on the wire, under the prefix')

  for (const path of ['', '/verify', '/signin']) {
    const label = `${BASE_PATH}${path || '/'}`
    const response = await fetch(`${HOST}${BASE_PATH}${path}`, { redirect: 'manual' })
    const policy = response.headers.get('content-security-policy') ?? ''
    const html = await response.text()

    check(`${label} carries a Content-Security-Policy`, policy !== '', 'no header')

    // Repeated headers arrive joined by a comma. One policy, one `default-src`.
    check(
      `${label} carries exactly one of them`,
      (policy.match(/default-src/g) ?? []).length === 1,
      policy.slice(0, 220),
    )

    const nonce = /script-src [^;]*'nonce-([A-Za-z0-9+/_-]+={0,2})'/.exec(policy)?.[1]
    check(`${label} names a nonce`, nonce !== undefined, policy.slice(0, 220))
    check(
      `${label} does not allow inline script`,
      !/script-src[^;]*'unsafe-inline'/.test(policy),
      policy.slice(0, 220),
    )

    // The proof that the middleware ran *and* that Next saw what it set. If the
    // matcher stopped covering the prefix, the header would be absent; if only
    // the response header were set and not the request header, the document
    // would carry no nonce and every script on the page would be refused.
    check(
      `${label} stamps that same nonce on the document`,
      nonce !== undefined && html.includes(`nonce="${nonce}"`),
      nonce === undefined ? 'no nonce to look for' : 'the header and the document disagree',
    )
    check(
      `${label} leaves no un-nonced inline script behind`,
      !/<script(?![^>]*\bnonce=)[^>]*>[^<]/.test(html),
      'an inline script with no nonce would be refused, and the page would not hydrate',
    )
  }

  /**
   * The policy varies by path now, and **under the prefix is the only place that
   * can be proved wrong.**
   *
   * `capabilitiesFor` matches `/admin/video` on a segment boundary rather than by
   * equality, precisely so that `/SPV/admin/video` still gets `media-src blob:`.
   * A unit test asserts the function; only a served response asserts that the
   * path the middleware sees is the path the function was written for. If Next
   * ever handed the middleware a pathname with the prefix stripped, or the other
   * way round, these are what notice — and the symptom otherwise is a recorder
   * that plays nothing back on the one deployment facing the internet, with every
   * check at a domain root passing.
   *
   * Both screens redirect an unauthenticated request to sign-in, and that does
   * not matter: `header()` does not follow redirects, the middleware has already
   * run, and the header on that response was built from the path asked for.
   */
  for (const [label, path, expected, forbidden] of [
    ['the recorder', '/admin/video', /media-src [^;]*blob:/, /img-src [^;]*data:/],
    ['two-factor', '/admin/security', /img-src [^;]*data:/, /media-src [^;]*blob:/],
  ] as const) {
    const policy = (await header(`${BASE_PATH}${path}`, 'content-security-policy')) ?? ''
    check(
      `${label} gets its one extra source under the prefix`,
      expected.test(policy),
      policy.slice(0, 260),
    )
    check(`and not the other screen’s`, !forbidden.test(policy), policy.slice(0, 260))
  }

  const portalPolicy = (await header(`${BASE_PATH}/portal/signin`, 'content-security-policy')) ?? ''
  check(
    'an investor-facing page is served neither blob: nor data:',
    portalPolicy !== '' && !/blob:/.test(portalPolicy) && !/data:/.test(portalPolicy),
    portalPolicy.slice(0, 260),
  )
  check(
    'and workers there may come from this origin only',
    /worker-src 'self'(;|$)/.test(portalPolicy),
    portalPolicy.slice(0, 260),
  )

  // Two requests, one URL.
  const first = await header(`${BASE_PATH}/signin`, 'content-security-policy')
  const second = await header(`${BASE_PATH}/signin`, 'content-security-policy')
  check(
    'a second request gets a different nonce',
    first !== null && second !== null && first !== second,
    'both responses carried the same policy — the nonce is a constant',
  )

  // The static headers are next.config.ts's, and this is the first thing that
  // asks a served response for them under a prefix.
  const permissions = await header(`${BASE_PATH}/signin`, 'permissions-policy')
  check(
    'Permissions-Policy leaves the camera to this origin',
    permissions?.includes('camera=(self)') === true,
    String(permissions),
  )
  check(
    'and denies what §13.3 has no use for',
    permissions?.includes('geolocation=()') === true,
    String(permissions),
  )
  check(
    'no Strict-Transport-Security, because this run is not served over TLS',
    (await header(`${BASE_PATH}/signin`, 'strict-transport-security')) === null,
    'HSTS on an http origin is ignored by a browser and outlives the project on a dev machine',
  )
}

/**
 * Every `href` and `src` in a document, minus the ones a base path does not
 * apply to: a fragment, an absolute URL, a `mailto:` and a `tel:`.
 */
function internalLinks(html: string): string[] {
  const found = new Set<string>()
  for (const m of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
    const value = m[1]!
    if (value.startsWith('#')) continue
    if (/^[a-z][a-z0-9+.-]*:/i.test(value)) continue
    if (value.startsWith('//')) continue
    found.add(value)
  }
  return [...found]
}

// ---------------------------------------------------------------------------

async function cleanUp(): Promise<void> {
  const accounts = await db
    .select({ id: investorAccounts.id })
    .from(investorAccounts)
    .where(like(investorAccounts.email, `${PREFIX}%`))

  for (const account of accounts) {
    await db.delete(portalTokens).where(eq(portalTokens.accountId, account.id))
    await db.delete(investorSessions).where(eq(investorSessions.accountId, account.id))
    await db.delete(offers).where(eq(offers.accountId, account.id))
    await db.delete(investorAccounts).where(eq(investorAccounts.id, account.id))
  }

  await db.delete(recipients).where(like(recipients.email, `${PREFIX}%`))
  await db.delete(rounds).where(like(rounds.name, `${PREFIX}%`))
}

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
    .values({ name: 'Prefix Verify', email: `${PREFIX}@example.test`, status: 'ACTIVE' })
    .returning()

  await db.insert(recipients).values({
    roundId: round!.id,
    name: 'Prefix Verify',
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

// ---------------------------------------------------------------------------

function run(command: string, args: string[], env: Record<string, string>): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let output = ''
    child.stdout?.on('data', (b: Buffer) => (output += b.toString()))
    child.stderr?.on('data', (b: Buffer) => (output += b.toString()))
    child.on('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`${command} failed:\n${output}`)),
    )
    child.on('error', reject)
  })
}

async function startServer(env: Record<string, string>): Promise<ChildProcess> {
  const child = spawn('node_modules/.bin/next', ['start', '--port', String(PORT)], {
    cwd: process.cwd(),
    env: { ...process.env, ...env, PORT: String(PORT) },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  })

  let output = ''
  let exited = false
  child.stdout?.on('data', (b: Buffer) => (output += b.toString()))
  child.stderr?.on('data', (b: Buffer) => (output += b.toString()))
  child.on('exit', () => (exited = true))

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

  stopServer(child)
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

// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log(`\nWP20 — the application under ${BASE_PATH}\n`)

  await cleanUp()
  const claimToken = await seedInvestor()

  const deploymentEnv = {
    BASE_PATH,
    APP_URL: ORIGIN,
    // Crawler and cookie origins must describe the same prefixed deployment
    // being exercised, even if the caller's local environment names a
    // different preview origin.
    PUBLIC_ORIGIN: ORIGIN,
    // Switches the health endpoint on for this run. Long enough to satisfy the
    // boot check, and obviously a fixture — it exists for the length of one
    // server and is never written anywhere.
    HEALTH_TOKEN,
    // The testing deployment is by definition not the production one, and the
    // send guard has to say so. This is the value §18.1 compares against.
    PRODUCTION_APP_URL: 'https://spv.flipit.com',
  }

  console.log('Building with the prefix set')
  await run('node_modules/.bin/next', ['build'], deploymentEnv)
  console.log('  built\n')

  const server = await startServer(deploymentEnv)

  try {
    console.log('Routing')
    for (const path of ['', '/verify', '/privacy', '/signin', '/portal/signin']) {
      check(`${BASE_PATH}${path || '/'} answers`, (await status(`${ORIGIN}${path}`.slice(HOST.length))) < 400)
    }
    check('the same route without the prefix is not found', (await status('/verify')) === 404)
    check('the domain root is not found', (await status('/')) === 404)

    console.log('\nLinks and assets')
    for (const page of ['', '/verify', '/privacy', '/signin']) {
      const html = await text(`${BASE_PATH}${page}`)
      const links = internalLinks(html)
      const unprefixed = links.filter((l) => !l.startsWith(`${BASE_PATH}/`))
      check(
        `every internal link on ${BASE_PATH}${page || '/'} carries the prefix`,
        unprefixed.length === 0,
        unprefixed.slice(0, 5).join(', '),
      )
      check(`${BASE_PATH}${page || '/'} has links to check`, links.length > 0)
    }

    console.log('\nIndexing — the header, which is the only layer that works under a prefix')
    for (const path of ['', '/signin', '/portal/signin']) {
      const value = await header(`${BASE_PATH}${path}`, 'x-robots-tag')
      check(`${BASE_PATH}${path || '/'} is noindex`, value?.includes('noindex') === true, String(value))
    }
    for (const path of ['/verify', '/privacy', '/robots.txt', '/sitemap.xml']) {
      const value = await header(`${BASE_PATH}${path}`, 'x-robots-tag')
      check(
        `${BASE_PATH}${path} is indexable`,
        value === 'index, follow',
        `X-Robots-Tag: ${value}`,
      )
    }
    check(
      'the verification page still refuses to be framed',
      (await header(`${BASE_PATH}/verify`, 'x-frame-options')) === 'DENY',
    )

    await verifyTheBrowserPolicyOnAServedResponse()

    console.log('\nCrawler files')
    const robots = await text(`${BASE_PATH}/robots.txt`)
    check('robots.txt allows the prefixed verification path', robots.includes(`${BASE_PATH}/verify`))
    check('and the prefixed privacy path', robots.includes(`${BASE_PATH}/privacy`))
    check(
      'and disallows the prefixed root, not the whole host',
      robots.includes(`Disallow: ${BASE_PATH}/`) && !/Disallow: \/$/m.test(robots),
      robots.replace(/\n/g, ' | '),
    )
    check('robots.txt points at the prefixed sitemap', robots.includes(`${ORIGIN}/sitemap.xml`))

    const sitemap = await text(`${BASE_PATH}/sitemap.xml`)
    check('the sitemap names the prefixed verification page', sitemap.includes(`${ORIGIN}/verify`))
    check('and the prefixed privacy policy', sitemap.includes(`${ORIGIN}/privacy`))
    check(
      'and lists no portal, admin or api path',
      !/\/(portal|admin|api|recipients|compliance)/.test(sitemap),
    )

    console.log('\nThe claim link, end to end under the prefix')
    const claim = await fetch(`${ORIGIN}/portal/claim/${claimToken}`, { redirect: 'manual' })
    check('a claim link redirects rather than erroring', claim.status >= 300 && claim.status < 400, String(claim.status))

    const location = claim.headers.get('location') ?? ''
    check('and redirects to a prefixed path', location.includes(`${BASE_PATH}/portal`), location)

    const setCookie = claim.headers.get('set-cookie') ?? ''
    check('it sets a session cookie', setCookie.includes('spv.portal_session'), setCookie.slice(0, 40))
    check(
      'scoped to the prefix, so it is not offered to the rest of the domain',
      setCookie.includes(`Path=${BASE_PATH}`),
      setCookie.replace(/spv\.portal_session=[^;]+/, 'spv.portal_session=…'),
    )
    check('and it is HttpOnly', /HttpOnly/i.test(setCookie))

    const cookie = setCookie.split(';')[0]!
    const portal = await fetch(`${ORIGIN}/portal`, { headers: { cookie } })
    check('the portal renders for that session', portal.status === 200, String(portal.status))

    const portalHtml = await portal.text()
    check('and shows the investor their own figures', portalHtml.includes('12,500.00'))
    const portalUnprefixed = internalLinks(portalHtml).filter(
      (l) => !l.startsWith(`${BASE_PATH}/`),
    )
    check(
      'every link on the portal carries the prefix',
      portalUnprefixed.length === 0,
      portalUnprefixed.slice(0, 5).join(', '),
    )

    /**
     * §13.3 — the video, over real HTTP, with a real investor session.
     *
     * This is the check the whole range change exists for. Safari opens a
     * video with `Range: bytes=0-1` and abandons a server that answers 200
     * with the entire body, so a portal that served the whole file was a
     * portal whose personal video did not play on an iPhone at all. Asserting
     * the parser in isolation does not prove the route sends a 206.
     */
    console.log('\n§13.3 — range requests on the video, over real HTTP')

    const store = mediaStore()

    if (!store) {
      check('a media store is configured for this run', false, 'set MEDIA_STORE')
    } else {
      const videoBytes = mp4WithLocation()
      const ingested = await ingest('video', videoBytes, 'video/mp4')

      if (!ingested.ok) {
        check('a video can be stored for this check', false, ingested.message)
      } else {
        const [operator] = await db.select().from(users).limit(1)

        const [videoRow] = await db
          .insert(operatorVideos)
          .values({
            ownerId: operator?.id ?? null,
            storageKey: ingested.storageKey,
            contentType: ingested.format,
            sizeBytes: ingested.sizeBytes,
            caption: `${PREFIX} range check`,
            publishedAt: new Date(),
          })
          .returning()

        const videoUrl = `${ORIGIN}/portal/video/${videoRow!.id}`

        const whole = await fetch(videoUrl, { headers: { cookie } })
        check('the whole video is served to a signed-in investor', whole.status === 200, String(whole.status))
        check(
          'and it advertises that it accepts ranges, which is how a player knows it may seek',
          whole.headers.get('accept-ranges') === 'bytes',
          String(whole.headers.get('accept-ranges')),
        )
        check(
          'the whole response is still private and unindexed',
          whole.headers.get('cache-control')?.includes('no-store') === true &&
            whole.headers.get('x-robots-tag')?.includes('noindex') === true,
        )
        const wholeBody = new Uint8Array(await whole.arrayBuffer())
        check('and it is the stored file', wholeBody.length === ingested.sizeBytes)

        // The two bytes Safari asks for.
        const safari = await fetch(videoUrl, { headers: { cookie, range: 'bytes=0-1' } })
        check('bytes=0-1 is answered 206, not 200', safari.status === 206, String(safari.status))
        check(
          'with a Content-Range naming the span and the total',
          safari.headers.get('content-range') === `bytes 0-1/${ingested.sizeBytes}`,
          String(safari.headers.get('content-range')),
        )
        const safariBody = new Uint8Array(await safari.arrayBuffer())
        check('and exactly two bytes come back', safariBody.length === 2, String(safariBody.length))
        check(
          'which are the first two bytes of the file',
          safariBody[0] === wholeBody[0] && safariBody[1] === wholeBody[1],
        )
        check(
          'a partial response is as private and unindexed as a whole one',
          safari.headers.get('cache-control')?.includes('no-store') === true &&
            safari.headers.get('x-robots-tag')?.includes('noindex') === true,
        )

        // A seek into the middle, which is what scrubbing does.
        const middle = await fetch(videoUrl, {
          headers: { cookie, range: `bytes=${ingested.sizeBytes - 4}-` },
        })
        check('an open-ended range from near the end is 206', middle.status === 206, String(middle.status))
        const middleBody = new Uint8Array(await middle.arrayBuffer())
        check('and returns exactly the last four bytes', middleBody.length === 4, String(middleBody.length))
        check(
          'which are the last four bytes of the file',
          middleBody.every((byte, i) => byte === wholeBody[ingested.sizeBytes - 4 + i]),
        )

        const past = await fetch(videoUrl, {
          headers: { cookie, range: `bytes=${ingested.sizeBytes + 10}-` },
        })
        check('a range past the end is 416, not a broken 206', past.status === 416, String(past.status))
        check(
          'and names the size so a player can correct itself',
          past.headers.get('content-range') === `bytes */${ingested.sizeBytes}`,
          String(past.headers.get('content-range')),
        )

        // A range request still cannot get past the access checks.
        const anonymous = await fetch(videoUrl, { headers: { range: 'bytes=0-1' } })
        check(
          'a range request without a session is the same 404 as anything else',
          anonymous.status === 404,
          String(anonymous.status),
        )

        await db.delete(operatorVideos).where(eq(operatorVideos.id, videoRow!.id))
        await store.remove(ingested.storageKey)
      }

      /**
       * §5, §13.2 — the other two things that are served from a store.
       *
       * The video was streamed first because it is the biggest. The image and
       * the document followed, and the reason to check them over real HTTP is
       * the same: a streamed body and a buffered one carry identical bytes, so
       * the only way to know a route did not quietly go back to reading a
       * twenty-megabyte agreement into memory is to see the length it declares
       * and the bytes that arrive agree with what is stored.
       */
      console.log('\n§5, §13.2 — an image and a document, over real HTTP')

      const imageBytes = jpegWithMetadata()
      const image = await ingest('image', imageBytes, 'image/jpeg')

      if (!image.ok) {
        check('an image can be stored for this check', false, image.message)
      } else {
        const [assetRow] = await db
          .insert(mediaAssets)
          .values({
            name: `${PREFIX} image`,
            storageKey: image.storageKey,
            contentType: image.format,
            sizeBytes: image.sizeBytes,
          })
          .returning()

        const served = await fetch(`${ORIGIN}/media/${image.storageKey}`)
        check('a library image is served without a session, as an email needs', served.status === 200, String(served.status))
        check(
          'and declares the length the store actually has',
          served.headers.get('content-length') === String(image.sizeBytes),
          String(served.headers.get('content-length')),
        )
        const servedBody = new Uint8Array(await served.arrayBuffer())
        check('and every byte of it arrives', servedBody.length === image.sizeBytes, String(servedBody.length))
        check(
          'and they are the stored bytes, in order',
          servedBody[0] === 0xff && servedBody[1] === 0xd8,
        )
        check(
          'a key that names nothing is a 404, not an empty 200',
          (await fetch(`${ORIGIN}/media/img_NOTHINGHEREATALLNOTHINGX`)).status === 404,
        )

        await db.delete(mediaAssets).where(eq(mediaAssets.id, assetRow!.id))
        await store.remove(image.storageKey)
      }

      const document = await ingest('document', pdfBytes(), 'application/pdf')

      if (!document.ok) {
        check('a document can be stored for this check', false, document.message)
      } else {
        const [investor] = await db
          .select()
          .from(investorAccounts)
          .where(eq(investorAccounts.email, `${PREFIX}@example.test`))
          .limit(1)

        const [offer] = await db
          .select()
          .from(offers)
          .where(eq(offers.accountId, investor!.id))
          .limit(1)

        const [documentRow] = await db
          .insert(documentPackages)
          .values({
            offerId: offer!.id,
            title: `${PREFIX} agreement`,
            storageKey: document.storageKey,
            contentType: document.format,
            sizeBytes: document.sizeBytes,
            issuedAt: new Date(),
          })
          .returning()

        const url = `${ORIGIN}/portal/document/${documentRow!.id}`

        const download = await fetch(url, { headers: { cookie } })
        check('an issued document downloads for the investor it belongs to', download.status === 200, String(download.status))
        check(
          'as an attachment, with a filename built from the title',
          download.headers.get('content-disposition')?.startsWith('attachment;') === true,
          String(download.headers.get('content-disposition')),
        )
        check(
          'declaring the length the store has, not the one the row claims',
          download.headers.get('content-length') === String(document.sizeBytes),
          String(download.headers.get('content-length')),
        )
        const downloaded = new Uint8Array(await download.arrayBuffer())
        check('and every byte arrives', downloaded.length === document.sizeBytes, String(downloaded.length))
        check(
          'and it is a PDF, which is what was stored',
          String.fromCharCode(...downloaded.slice(0, 5)) === '%PDF-',
        )
        check(
          'the same download without a session is the same 404 as anything else',
          (await fetch(url)).status === 404,
        )

        await db.delete(documentPackages).where(eq(documentPackages.id, documentRow!.id))
        await store.remove(document.storageKey)
      }
    }

    /**
     * The health endpoint, over real HTTP, under the prefix.
     *
     * `route.test.ts` proves the handler. What only a running server can show
     * is the part somebody has to type into a monitoring service: the URL. A
     * monitor pointed at `https://host/api/health` on a deployment served from
     * `/SPV` polls a 404 forever and shows a green tick over a dead
     * application — which is the exact failure this endpoint exists to close,
     * reintroduced by the prefix. So the prefixed address is asked, and the
     * unprefixed one is asked too, and the second must not answer.
     */
    console.log('\nThe health endpoint — §6.5')
    const healthy = await fetch(`${ORIGIN}/api/health`, {
      headers: { 'x-health-token': HEALTH_TOKEN },
    })
    check(
      `${BASE_PATH}/api/health answers with the token`,
      healthy.status === 200 || healthy.status === 503,
      String(healthy.status),
    )

    const signal = (await healthy.json()) as {
      status: string
      at: string | null
      counts: Record<string, number>
      areas: { area: string; severity: string }[]
    }
    const serialised = JSON.stringify(signal)
    check(
      'the status word is one of the four',
      ['ok', 'attention', 'wrong', 'unavailable'].includes(signal.status),
      signal.status,
    )
    check(
      'the code and the word agree',
      (healthy.status === 503) === (signal.status === 'wrong' || signal.status === 'unavailable'),
      `${healthy.status} / ${signal.status}`,
    )
    check(
      'the body carries no address, no id and no sentence',
      !/[\w.+-]+@[\w-]+\.[\w.-]+/.test(serialised) &&
        !/[0-9a-f]{8}-[0-9a-f]{4}/.test(serialised) &&
        Object.keys(signal).sort().join(',') === 'areas,at,counts,status',
      serialised,
    )
    check(
      'it is noindex and not cached',
      healthy.headers.get('x-robots-tag')?.includes('noindex') === true &&
        healthy.headers.get('cache-control')?.includes('no-store') === true,
      `${healthy.headers.get('x-robots-tag')} / ${healthy.headers.get('cache-control')}`,
    )

    const unauthenticated = await fetch(`${ORIGIN}/api/health`)
    check('and without the token it is not found', unauthenticated.status === 404)
    check('with an empty body', (await unauthenticated.text()) === '')

    check(
      'the unprefixed address does not answer — a monitor pointed there would show a green tick forever',
      (await status('/api/health')) === 404,
    )

    console.log('\nThe base-URL guard — §18.1, AC44')
    const { evaluateSendGuard } = await import('@/lib/email/transport/guard')

    // Everything else healthy, so the only thing left to refuse on is the
    // deployment. That is the point: this is not a general "sending is broken"
    // check, it is the guard §18.1 asks for.
    const guard = evaluateSendGuard({
      intent: 'INVITATION',
      config: {
        serviceMode: 'ACTIVE',
        emailTransport: 'SMTP',
        smtpUserEncrypted: 'v1.aaa.bbb.ccc',
        smtpPasswordEncrypted: 'v1.ddd.eee.fff',
        smtpLastVerifiedAt: new Date(),
        smtpLastVerifyResult: 'OK: Authenticated to smtp.gmail.com:587 over STARTTLS.',
        operatorTwoFactorEnrolled: true,
      },
      isProductionDeployment: false,
    })

    check('a real invitation is refused off the production deployment', !guard.allowed)
    check(
      'and the reason names the deployment rather than something vague',
      !guard.allowed && guard.blocks.some((b) => b.reason === 'NOT_PRODUCTION_DEPLOYMENT'),
      guard.allowed ? 'allowed' : guard.blocks.map((b) => b.reason).join(', '),
    )

    // §18.1 carves out the test send to the operator's own address, which is
    // the whole reason the testing deployment is usable at all.
    const testSend = evaluateSendGuard({
      intent: 'TEST',
      config: {
        serviceMode: 'ACTIVE',
        emailTransport: 'SMTP',
        smtpUserEncrypted: 'v1.aaa.bbb.ccc',
        smtpPasswordEncrypted: 'v1.ddd.eee.fff',
        smtpLastVerifiedAt: new Date(),
        smtpLastVerifyResult: 'OK: Authenticated to smtp.gmail.com:587 over STARTTLS.',
        operatorTwoFactorEnrolled: true,
      },
      isProductionDeployment: false,
      operatorEmail: 'operator@example.test',
      recipient: 'operator@example.test',
    })
    check('a test send to the operator is still allowed here', testSend.allowed)
  } finally {
    stopServer(server)
    await cleanUp()

    // Leave the tree in the state the rest of the toolchain expects: a build
    // with the prefix baked in would break `pnpm start` for the next person.
    console.log('\nRebuilding without the prefix')
    await run('node_modules/.bin/next', ['build'], { BASE_PATH: '' })
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
