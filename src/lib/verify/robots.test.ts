import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { buildVerificationRobotsPolicy, buildVerificationSitemap } from './robots'

/**
 * BUILD_SPEC §15, §15.1 — "the verification page is the only indexable route in
 * the application."
 *
 * Most of this file checks the *filesystem* rather than a return value, and
 * that is deliberate. The policy function was correct for weeks while sitting
 * at `app/verify/robots.ts`, which Next.js publishes as `/verify/robots.txt` —
 * a path no crawler ever requests. Every unit test passed and the site had no
 * robots.txt at all. A test that only calls the function would still pass
 * today if somebody moved the file back.
 */

const APP_DIR = join(process.cwd(), 'src/app')

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry)
    return statSync(full).isDirectory() ? walk(full) : [full]
  })
}

describe('the metadata files are where Next.js looks for them', () => {
  it('has robots.ts at the root of app/, not nested', () => {
    expect(existsSync(join(APP_DIR, 'robots.ts'))).toBe(true)

    const nested = walk(APP_DIR).filter(
      (file) => file.endsWith('/robots.ts') && file !== join(APP_DIR, 'robots.ts'),
    )
    expect(nested.map((file) => relative(process.cwd(), file))).toEqual([])
  })

  it('has sitemap.ts at the root of app/', () => {
    expect(existsSync(join(APP_DIR, 'sitemap.ts'))).toBe(true)
  })
})

describe('the robots policy', () => {
  const policy = buildVerificationRobotsPolicy()
  const rules = policy.rules as { allow: string[]; disallow: string }

  it('disallows everything', () => {
    expect(rules.disallow).toBe('/')
  })

  it('allows the verification page back in', () => {
    expect(rules.allow).toContain('/verify')
  })

  it('allows the two public pages and nothing else', () => {
    for (const path of rules.allow) {
      expect(
        path.startsWith('/verify') || path.startsWith('/privacy'),
        `robots.txt allows ${path}, which is neither public page`,
      ).toBe(true)
    }
    // Nothing under a private route, however it is spelled.
    for (const path of rules.allow) {
      expect(path).not.toMatch(/portal|admin|api|recipients|compliance|audit/)
    }
  })

  it('points at the sitemap', () => {
    expect(policy.sitemap).toMatch(/\/sitemap\.xml$/)
  })
})

describe('the sitemap', () => {
  const entries = buildVerificationSitemap()

  it('has exactly two entries', () => {
    // One per public page. Growing this list means arguing for a third public
    // page, which is a decision rather than a change to a number.
    expect(entries).toHaveLength(2)
  })

  it('and they are the verification page and the privacy policy', () => {
    const urls = entries.map((entry) => entry.url).sort()
    expect(urls[0]).toMatch(/\/privacy$/)
    expect(urls[1]).toMatch(/\/verify$/)
  })

  it('the verification page is the higher priority of the two', () => {
    const verify = entries.find((entry) => entry.url.endsWith('/verify'))
    const privacy = entries.find((entry) => entry.url.endsWith('/privacy'))
    expect(verify!.priority!).toBeGreaterThan(privacy!.priority!)
  })

  it('lists no portal, admin or api path', () => {
    // §15: "no sitemap entries for portal paths." A sitemap listing one would
    // both invite indexing and publish the shape of the private application.
    const urls = entries.map((entry) => entry.url).join(' ')
    for (const path of ['/portal', '/admin', '/api', '/recipients', '/compliance', '/signin']) {
      expect(urls, path).not.toContain(path)
    }
  })

  it('carries no build timestamp', () => {
    expect(entries[0]!.lastModified).toBeUndefined()
  })
})

describe('every route is noindex except the verification page', () => {
  const pages = walk(APP_DIR).filter((file) => file.endsWith('/page.tsx'))

  it('found the pages to check', () => {
    expect(pages.length).toBeGreaterThan(5)
  })

  it('opts exactly two pages into indexing, and names them', () => {
    /**
     * Two, not one, and the second one arrived in WP20 with a reason.
     *
     * `/verify` is §15.1's anti-phishing page. `/privacy` is §18's
     * requirement — a Google reviewer opening it from a consent screen has no
     * account here, and Gmail verification cannot start until it is hosted on
     * the application's own domain.
     *
     * A third would need the same kind of argument, in writing, here.
     */
    const indexed = pages.filter((file) => {
      const source = readFileSync(file, 'utf8')
      return /index:\s*true/.test(source)
    })

    expect(indexed.map((file) => relative(APP_DIR, file)).sort()).toEqual([
      'privacy/page.tsx',
      'verify/page.tsx',
    ])
  })

  it('the privacy policy reads no investor data', () => {
    // It is public. A database import here would be one refactor away from a
    // public page that can be made to reveal a record.
    const source = readFileSync(join(APP_DIR, 'privacy/page.tsx'), 'utf8')
    expect(source).not.toContain("from '@/db'")
    expect(source).not.toContain('investorAccounts')
    expect(source).not.toMatch(/loadPortalView|readInvestorAccount|loadInvestorQa/)
  })

  it('sets the default to noindex in the root layout, so a page that forgets is still safe', () => {
    const layout = readFileSync(join(APP_DIR, 'layout.tsx'), 'utf8')
    expect(layout).toMatch(/robots:\s*\{\s*index:\s*false/)
  })
})

describe('the response header covers what a meta tag cannot', () => {
  const config = readFileSync(join(process.cwd(), 'next.config.ts'), 'utf8')

  it('sets X-Robots-Tag: noindex on every path', () => {
    // A route handler and a downloaded PDF have no head to put a meta tag in.
    // The participation certificate carries an investor's name and the amount
    // they transferred.
    expect(config).toContain("source: '/:path*'")
    expect(config).toMatch(/X-Robots-Tag'[^}]*noindex/)
  })

  it('exempts the two public pages and the two crawler files', () => {
    expect(config).toContain("'/verify'")
    expect(config).toContain("'/privacy'")
    expect(config).toContain("'/robots.txt'")
    expect(config).toContain("'/sitemap.xml'")
    expect(config).toMatch(/index, follow/)
  })

  it('the catch-all EXCLUDES the public routes rather than merely following them', () => {
    /**
     * Next.js applies every matching `headers()` entry in order, and a later
     * one overwrites an earlier one for the same key. So a `/verify` entry
     * followed by a `/:path*` catch-all leaves `/verify` carrying `noindex` —
     * the exemption present in the configuration and absent from the response.
     *
     * That is what shipped in WP14, and it passed this file's tests because
     * they read the array. `pnpm verify:deployment` asks a running server,
     * which is the only place it is visible; this is the source-level guard
     * that stops it being reintroduced by deleting the negative lookahead.
     */
    expect(config).toContain('(?!')
    expect(config).toMatch(/excludePublic/)

    // And the landing page needs its own entry, because a path-to-regexp group
    // will not match an empty segment and "/" falls straight through.
    expect(config).toMatch(/source: '\/',/)
  })

  it('the two lists of public routes agree', () => {
    const policy = readFileSync('src/lib/verify/robots.ts', 'utf8')
    for (const route of ['/verify', '/privacy']) {
      expect(config, `next.config.ts omits ${route}`).toContain(`'${route}'`)
      expect(policy, `robots.ts omits ${route}`).toContain(route)
    }
  })

  it('refuses framing and sends no referrer', () => {
    expect(config).toContain('X-Frame-Options')
    expect(config).toContain('Referrer-Policy')
  })
})

describe('under a path prefix — the testing deployment', () => {
  const original = { base: process.env.BASE_PATH, app: process.env.APP_URL }

  beforeAll(() => {
    // These tests re-import the module with different configuration, so the
    // environment has to be put back or every later file inherits /SPV.
  })

  afterAll(() => {
    process.env.BASE_PATH = original.base
    process.env.APP_URL = original.app
    vi.resetModules()
  })

  /**
   * BUILD_SPEC §18: the application runs at `mikehelm.com/SPV` before it runs
   * at `spv.flipit.com`, and *"every internal link, asset path, cookie path,
   * and callback URL has to respect it."*
   *
   * A robots rule is a path, and a path in robots.txt is relative to the
   * domain root — never to the application. `Disallow: /` served from a
   * deployment at `/SPV` asks a crawler to leave the whole of mikehelm.com
   * alone, which is somebody else's site.
   */
  it('prefixes the rule paths, because robots paths are domain-relative', async () => {
    vi.resetModules()
    process.env.BASE_PATH = '/SPV'
    process.env.APP_URL = 'https://mikehelm.com/SPV'

    const { buildVerificationRobotsPolicy: build } = await import('./robots')
    const policy = build()
    const rules = Array.isArray(policy.rules) ? policy.rules[0]! : policy.rules!

    expect(rules.allow).toEqual([
      '/SPV/verify',
      '/SPV/verify/',
      '/SPV/privacy',
      '/SPV/privacy/',
    ])
    expect(rules.disallow).toBe('/SPV/')

    // Never a bare "/" — that is the whole of the host.
    expect(rules.disallow).not.toBe('/')
  })

  it('leaves the paths alone at a domain root', async () => {
    vi.resetModules()
    process.env.BASE_PATH = ''
    process.env.APP_URL = 'https://spv.flipit.com'

    const { buildVerificationRobotsPolicy: build } = await import('./robots')
    const policy = build()
    const rules = Array.isArray(policy.rules) ? policy.rules[0]! : policy.rules!

    expect(rules.allow).toEqual(['/verify', '/verify/', '/privacy', '/privacy/'])
    expect(rules.disallow).toBe('/')
  })
})
