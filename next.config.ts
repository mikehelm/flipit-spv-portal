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
        // The three headers that are not about indexing apply everywhere,
        // including the public routes the entry above deliberately skips.
        // `/verify` must still refuse to be framed: it is the page that tells
        // an investor what a genuine message looks like, and a copy of it
        // inside somebody else's frame is the exact attack §15.1 is about.
        source: '/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'no-referrer' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
        ],
      },
    ]
  },
}

export default nextConfig
