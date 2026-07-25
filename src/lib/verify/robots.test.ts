import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
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

  it('allows nothing else', () => {
    for (const path of rules.allow) {
      expect(path.startsWith('/verify')).toBe(true)
    }
  })

  it('points at the sitemap', () => {
    expect(policy.sitemap).toMatch(/\/sitemap\.xml$/)
  })
})

describe('the sitemap', () => {
  const entries = buildVerificationSitemap()

  it('has exactly one entry', () => {
    expect(entries).toHaveLength(1)
  })

  it('and it is the verification page', () => {
    expect(entries[0]!.url).toMatch(/\/verify$/)
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

  it('opts exactly one page into indexing', () => {
    const indexed = pages.filter((file) => {
      const source = readFileSync(file, 'utf8')
      return /index:\s*true/.test(source)
    })

    expect(indexed.map((file) => relative(APP_DIR, file))).toEqual(['verify/page.tsx'])
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

  it('exempts the verification page and the two crawler files', () => {
    expect(config).toContain("'/verify'")
    expect(config).toContain("'/robots.txt'")
    expect(config).toContain("'/sitemap.xml'")
    expect(config).toMatch(/index, follow/)
  })

  it('refuses framing and sends no referrer', () => {
    expect(config).toContain('X-Frame-Options')
    expect(config).toContain('Referrer-Policy')
  })
})
