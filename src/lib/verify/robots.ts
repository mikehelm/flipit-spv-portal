import type { MetadataRoute } from 'next'
import { absoluteUrl, PRIVACY_PATH, VERIFICATION_PATH } from '@/lib/email/variables'
import { env } from '@/lib/env'

/**
 * What crawlers are told. BUILD_SPEC §15, §15.1.
 *
 * *"This page is the one part of the system deliberately indexed and public —
 * everything else is `noindex`. It only works if someone can find it."*
 *
 * So the policy has to do two opposite things at once, and the ordering is what
 * makes that work: a blanket `Disallow: /` keeps every private path out, and a
 * more specific `Allow: /verify` overrides it for the one page that should be
 * findable. Google and Bing both resolve conflicts by longest match, so the
 * seven-character allow beats the one-character disallow.
 *
 * **`robots.ts` must live at the root of `app/`.** It sat at
 * `app/verify/robots.ts` for a while, which generates `/verify/robots.txt` — a
 * file no crawler ever asks for. The policy was silently absent and the site
 * had no robots.txt at all. It is now `src/app/robots.ts`, and `robots.test.ts`
 * asserts the file is where Next.js will actually pick it up rather than only
 * asserting that the function returns the right object.
 *
 * Note what robots.txt is NOT: an access control. It is a request, and a
 * crawler that ignores it is not doing anything a browser could not. Every
 * private route is `noindex` in its own metadata, behind a session check, and
 * behind an `X-Robots-Tag` response header set in `next.config.ts`. This file
 * is the polite one of the three.
 *
 * **Every path here is relative to the domain root, not to the application.**
 * A crawler only ever reads `https://host/robots.txt`, so under the testing
 * deployment at `mikehelm.com/SPV` a rule saying `Allow: /verify` would name a
 * path that does not exist, and `Disallow: /` would ask a crawler to stay away
 * from the whole of mikehelm.com. Next.js applies `basePath` to the sitemap URL
 * because it is absolute, and does not apply it to the rule paths because they
 * are strings. So this does.
 *
 * The larger point, and it belongs in the runbook: under a path prefix this
 * file is not served from the domain root at all, so no crawler will ever read
 * it. On that deployment the `X-Robots-Tag` header is the only thing keeping
 * the application out of an index — which is why it is a header rather than a
 * meta tag, and why `pnpm verify:deployment` checks it against a running
 * server under the prefix.
 */
/**
 * The routes that are public and indexable, in one place.
 *
 * There are two and there should stay two. `/verify` is §15.1's anti-phishing
 * page — the one address an investor is told to type. `/privacy` is §18's
 * requirement: a Google reviewer opening it from a consent screen has no
 * account here, and §18 wants it standing before the application is ready.
 *
 * Everything else in the build is `noindex`, behind a session check, and
 * behind an `X-Robots-Tag` header. `next.config.ts` holds the same two, and
 * `robots.test.ts` asserts the two lists agree — a route indexable in one and
 * not the other is the failure that shipped in WP14.
 */
export const PUBLIC_PATHS = [VERIFICATION_PATH, PRIVACY_PATH] as const

export function withBasePath(path: string): string {
  const base = env().BASE_PATH
  if (base === '') return path
  return path === '/' ? `${base}/` : `${base}${path}`
}

export function buildVerificationRobotsPolicy(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: PUBLIC_PATHS.flatMap((path) => [
        withBasePath(path),
        `${withBasePath(path)}/`,
      ]),
      disallow: withBasePath('/'),
    },
    sitemap: absoluteUrl('/sitemap.xml'),
  }
}

/**
 * One entry, and it is the verification page.
 *
 * §15: "no sitemap entries for portal paths." A sitemap listing a portal URL
 * would be an invitation to index it, which is precisely backwards — and it
 * would publish the shape of the private application to anybody who asked for
 * the file.
 *
 * `lastModified` is deliberately absent. It would be the time this deployment
 * was built, which is information about the operation rather than about the
 * page, and the page's usefulness does not decay.
 */
export function buildVerificationSitemap(): MetadataRoute.Sitemap {
  return PUBLIC_PATHS.map((path) => ({
    url: absoluteUrl(path),
    changeFrequency: 'yearly' as const,
    // The verification page is the one somebody may be searching for in a
    // hurry. The privacy policy exists to be linked from a consent screen.
    priority: path === VERIFICATION_PATH ? 1 : 0.5,
  }))
}
