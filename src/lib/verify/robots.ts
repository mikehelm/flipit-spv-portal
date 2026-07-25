import type { MetadataRoute } from 'next'

/**
 * Longest-match robots rules allow /verify while the root disallow keeps every
 * private application path out of crawlers.
 */
export function buildVerificationRobotsPolicy(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: ['/verify', '/verify/'],
      disallow: '/',
    },
  }
}
