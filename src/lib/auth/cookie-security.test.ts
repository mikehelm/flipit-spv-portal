import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Session cookies, and the variable that was doing three jobs.
 * BUILD_SPEC §2.2, §18.1.
 *
 * `APP_URL` answered three unrelated questions: where links point, whether a
 * browser is on HTTPS, and whether real invitations may be sent. The third is
 * the send guard (§18.1), and it is the reason `APP_URL` is deliberately held at
 * `http://localhost:3000` until the moment somebody chooses to go live.
 *
 * The second question then got the wrong answer. Behind an HTTPS tunnel, with
 * `APP_URL` at localhost, the administrator session cookie was issued **without
 * `Secure`** — so a browser would send it on any `http://` request to the public
 * hostname, in the clear, before Cloudflare's redirect. The session it protects
 * belongs to somebody who can send securities solicitations.
 *
 * These are source-level tests because a cookie is set through Next's
 * `cookies()` and there is no request to inspect from a unit test. What they
 * pin is the shape that cannot be undone by a careless edit: neither session
 * module may derive `secure` from `APP_URL` again.
 */

function read(relativePath: string): string {
  return readFileSync(join(process.cwd(), relativePath), 'utf8')
}

function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

const SESSION_MODULES = ['src/lib/auth/session.ts', 'src/lib/portal/session.ts']

describe('every session cookie', () => {
  for (const path of SESSION_MODULES) {
    describe(path, () => {
      const source = withoutComments(read(path))

      it('derives Secure from the canonical origin', () => {
        expect(source).toContain('secure: config.isHttpsOrigin')
      })

      it('never derives Secure from APP_URL again', () => {
        // The regression, named. `APP_URL` is held at localhost on purpose, so
        // asking it about TLS produces a cookie that travels in the clear.
        expect(source).not.toMatch(/secure:.*APP_URL/)
        expect(source).not.toMatch(/APP_URL\.startsWith\('https/)
      })

      it('is HttpOnly, so script cannot read it', () => {
        expect(source).toContain('httpOnly: true')
      })

      it('is SameSite at least lax', () => {
        expect(source).toMatch(/sameSite: '(lax|strict)'/)
      })

      it('is scoped to the base path rather than to the whole host', () => {
        expect(source).toContain('config.BASE_PATH')
      })

      it('is never set with a hard-coded secure value', () => {
        // `secure: true` would break local development and `secure: false`
        // would break production. Both are a value where a question belongs.
        expect(source).not.toMatch(/secure: (true|false)/)
      })
    })
  }
})

describe('the canonical origin', () => {
  const env = withoutComments(read('src/lib/env.ts'))

  it('falls back to APP_URL when nothing is configured', () => {
    // Local development, and every deployment that existed before this change,
    // must behave exactly as they did.
    expect(env).toContain("declaredOrigin === '' ? value.APP_URL : declaredOrigin")
  })

  it('is the only thing isHttpsOrigin looks at', () => {
    expect(env).toContain("isHttpsOrigin: canonicalOrigin.startsWith('https://')")
  })

  it('is a different question from whether sending is allowed', () => {
    // If these two ever collapse back into one value, the safety catch and the
    // cookie contract become the same switch — and turning HTTPS on would turn
    // sending on. `isProductionDeployment` must keep comparing APP_URL with
    // PRODUCTION_APP_URL and nothing else.
    // The assertion is on the expression itself, not on what happens to sit
    // near it in the returned object — the two are adjacent there and that is
    // fine. What must never happen is the send question consulting the origin.
    // `lastIndexOf`, because the name appears twice: once in the `Env` type and
    // once in the value. It is the value that decides anything.
    const expression = env.slice(
      env.lastIndexOf('isProductionDeployment:'),
      env.lastIndexOf('canonicalOrigin,'),
    )
    expect(expression).toContain('normaliseUrl(value.APP_URL) === normaliseUrl(value.PRODUCTION_APP_URL)')
    expect(expression).not.toMatch(/canonicalOrigin|PUBLIC_ORIGIN|isHttpsOrigin/)
  })

  it('has a trailing slash taken off, so no URL is built with a double slash', () => {
    expect(env).toMatch(/canonicalOrigin = \([\s\S]{0,80}\)\.replace\(/)
  })
})

describe('crawler metadata', () => {
  const robots = withoutComments(read('src/lib/verify/robots.ts'))

  it('uses the canonical origin, not the deployment URL', () => {
    // robots.txt and sitemap.xml are fetched from the public hostname by
    // somebody the send guard has no authority over. They were publishing
    // http://localhost:3000 to search engines.
    expect(robots).toContain('canonicalUrl')
    expect(robots).not.toMatch(/absoluteUrl/)
  })
})

describe('links that the send guard does control', () => {
  const variables = withoutComments(read('src/lib/email/variables.ts'))

  it('still use APP_URL', () => {
    // Deliberate, and the distinction is the point. A portal link embeds the
    // domain it was issued from, and §18.1 refuses to issue one at all while
    // APP_URL is not the production value. Moving these onto the canonical
    // origin would let a pre-launch deployment mint links that look real.
    expect(variables).toContain('export function absoluteUrl')
    const body = variables.slice(
      variables.indexOf('export function absoluteUrl'),
      variables.indexOf('export function canonicalUrl'),
    )
    expect(body).toContain('env().APP_URL')
  })

  it('and the two builders are not accidentally the same function', () => {
    expect(variables).toContain('env().canonicalOrigin')
    expect(variables).toContain('env().APP_URL')
  })
})
