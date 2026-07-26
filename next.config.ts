import type { NextConfig } from 'next'

/**
 * basePath is read from the environment from the first commit.
 *
 * The application runs under "/SPV" on the testing deployment before it runs
 * at a domain root in production, so every internal link, asset path, cookie
 * path and OAuth callback has to respect it. Retrofitting this later is the
 * kind of change that breaks links quietly. BUILD_SPEC §18.1.
 */
const basePath = process.env.BASE_PATH ?? ''

if (basePath !== '' && (!basePath.startsWith('/') || basePath.endsWith('/'))) {
  throw new Error(
    `BASE_PATH must be empty or start with "/" and not end with "/". Received: ${basePath}`,
  )
}

const nextConfig: NextConfig = {
  basePath: basePath === '' ? undefined : basePath,
  reactStrictMode: true,
  poweredByHeader: false,

  /**
   * `X-Robots-Tag: noindex` on everything, then the verification page opts back
   * in. BUILD_SPEC §15, §15.1.
   *
   * A `<meta name="robots">` tag only exists inside an HTML document, so it
   * covers pages and nothing else. A downloaded participation certificate, a
   * route handler's response and an API reply have no head to put a tag in —
   * and a PDF carrying an investor's name and the amount they transferred is
   * exactly the sort of thing that must never be indexable. A header covers all
   * of them.
   *
   * The order matters: Next.js applies the first matching `source`, so the
   * three public entries come before the catch-all.
   */
  async headers() {
    // Kept in step with PUBLIC_PATHS in src/lib/verify/robots.ts; robots.test.ts
    // asserts the two agree. A route indexable in one list and not the other is
    // exactly the defect this file shipped in WP14.
    const publicRoutes = ['/verify', '/privacy', '/robots.txt', '/sitemap.xml']

    /**
     * The catch-all must EXCLUDE the public routes rather than merely come
     * after them.
     *
     * Next.js applies every matching `headers()` entry, in order, and a later
     * entry overwrites an earlier one for the same key. So a specific
     * `/verify` entry followed by a `/:path*` catch-all leaves `/verify`
     * carrying the catch-all's `noindex` — the exemption is present in the
     * configuration and absent from the response.
     *
     * That shipped in WP14 and its test passed, because the test read this
     * array rather than a served response. `pnpm verify:deployment` now asks a
     * running server, which is the only way this class of defect is visible.
     */
    const excludePublic = `/((?!${publicRoutes
      .map((route) => route.slice(1).replace(/\./g, '\\.'))
      .join('|')}).*)`

    const privateHeaders = [
      { key: 'X-Robots-Tag', value: 'noindex, nofollow, noarchive, nosnippet' },
    ]

    return [
      ...publicRoutes.map((source) => ({
        source,
        headers: [{ key: 'X-Robots-Tag', value: 'index, follow' }],
      })),
      {
        // The landing page, on its own. `excludePublic` below is a
        // path-to-regexp group, and a group will not match an empty segment —
        // so "/" falls through it and would be served with no policy at all.
        // Found by asking a running server; the source test cannot see it.
        source: '/',
        headers: privateHeaders,
      },
      {
        source: excludePublic,
        headers: [
          { key: 'X-Robots-Tag', value: 'noindex, nofollow, noarchive, nosnippet' },
          // Not about indexing, but the same one-line-per-risk idea: an
          // investor's portal must not be framed by a third-party page, and a
          // referrer header must not carry a claim token to an outside site.
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'no-referrer' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
        ],
      },
      {
        // The browser-policy headers apply everywhere,
        // including the public routes the entry above deliberately skips.
        // `/verify` must still refuse to be framed: it is the page that tells
        // an investor what a genuine message looks like, and a copy of it
        // inside somebody else's frame is the exact attack §15.1 is about.
        source: '/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'no-referrer' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          // Content-Security-Policy is deliberately NOT here. It carries a
          // per-request nonce and is set by `src/middleware.ts`; see the note
          // where `contentSecurityPolicy` used to live, below.
          { key: 'Permissions-Policy', value: PERMISSIONS_POLICY },
          ...strictTransportSecurity(),
        ],
      },
    ]
  },
}

// ---------------------------------------------------------------------------
// Browser policy headers
// ---------------------------------------------------------------------------

/**
 * Content-Security-Policy — moved out of this file, and this note is why.
 *
 * It used to be a constant here, and its own comment recorded the flaw:
 * `script-src` carried `'unsafe-inline'`, because Next injects inline bootstrap
 * and hydration scripts and a build-time constant cannot carry a per-request
 * nonce. Every header in this function is evaluated once, at build time, and
 * baked into `.next/routes-manifest.json`. A nonce that is identical on every
 * response is not a nonce.
 *
 * The policy now lives in `src/lib/security/csp.ts` and is applied per request
 * by `src/middleware.ts`, with `'unsafe-inline'` gone from `script-src`.
 *
 * It is set in exactly one of the two places, never both: two
 * `Content-Security-Policy` headers on one response are two policies, and a
 * browser enforces the intersection. That intersection would happen to be
 * correct here and it would be an accident, invisible in either file, and a
 * trap for whoever next edits one of them.
 *
 * `frame-ancestors 'none'` says what `X-Frame-Options: DENY` says, for browsers
 * that prefer the modern spelling. Both are kept — the second is in the list
 * above, the first is in the policy module.
 */

/**
 * Permissions-Policy.
 *
 * **`camera` and `microphone` are `self`, deliberately.** §13.3 records the
 * operator's video in the browser through `getUserMedia`, and the tidy-looking
 * `camera=(), microphone=()` would break a shipped feature silently — the
 * prompt simply never appears and the recorder reports a device problem. Denied
 * to every other origin, which is what matters.
 *
 * Everything else this application has no use for is switched off by name
 * rather than left to a browser default that may change.
 */
const PERMISSIONS_POLICY = [
  'camera=(self)',
  'microphone=(self)',
  'geolocation=()',
  'payment=()',
  'usb=()',
  'serial=()',
  'bluetooth=()',
  'midi=()',
  'magnetometer=()',
  'gyroscope=()',
  'accelerometer=()',
  'display-capture=()',
  'idle-detection=()',
].join(', ')

/**
 * Strict-Transport-Security, and only when a browser is actually reaching this
 * deployment over TLS.
 *
 * Sent on an http:// origin it is ignored; sent on a development machine that
 * later serves something else on localhost it is a nuisance that outlives the
 * project. So it follows `PUBLIC_ORIGIN` — the same value that decides whether
 * a session cookie is `Secure` — and is absent otherwise.
 *
 * **No `preload`, and no `includeSubDomains`.** Both are close to irreversible:
 * preload means asking a browser vendor to hard-code the domain, and
 * `includeSubDomains` on a name somebody else may later use for something
 * unrelated is a decision made on their behalf. A year of max-age on this one
 * hostname is the whole of what is needed here.
 */
function strictTransportSecurity(): Array<{ key: string; value: string }> {
  const origin = (process.env.PUBLIC_ORIGIN || process.env.APP_URL || '').trim()
  if (!origin.startsWith('https://')) return []
  return [{ key: 'Strict-Transport-Security', value: 'max-age=31536000' }]
}

export default nextConfig
