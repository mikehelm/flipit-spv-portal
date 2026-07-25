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
    const publicRoutes = ['/verify', '/robots.txt', '/sitemap.xml']

    return [
      ...publicRoutes.map((source) => ({
        source,
        headers: [{ key: 'X-Robots-Tag', value: 'index, follow' }],
      })),
      {
        source: '/:path*',
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
    ]
  },
}

export default nextConfig
