import type { MetadataRoute } from 'next'
import { absoluteUrl, VERIFICATION_PATH } from '@/lib/email/variables'

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
 */
export function buildVerificationRobotsPolicy(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: [VERIFICATION_PATH, `${VERIFICATION_PATH}/`],
      disallow: '/',
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
  return [
    {
      url: absoluteUrl(VERIFICATION_PATH),
      changeFrequency: 'yearly',
      priority: 1,
    },
  ]
}
