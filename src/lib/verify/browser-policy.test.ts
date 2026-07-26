import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { contentSecurityPolicy, generateNonce } from '@/lib/security/csp'

/**
 * The browser-policy headers. BUILD_SPEC §15, §13.3.
 *
 * An external review reported CSP, HSTS and Permissions-Policy absent. It was
 * right about all three, and the interesting part of adding them was not the
 * policy — it was the two things that a tidy-looking policy would have broken.
 *
 * `next.config.ts` is not importable from a test: it is TypeScript compiled by
 * Next's own loader, and its `headers()` is evaluated at build time. So these
 * read the source. The served proof belongs in `verify:deployment`, and the one
 * fact worth stating here is that **these headers are baked into
 * `routes-manifest.json` at build time** — a variable set only at runtime does
 * not reach them.
 */

const source = readFileSync(join(process.cwd(), 'next.config.ts'), 'utf8')

/** Comments explain what the code avoids; they must not trip a check for it. */
function withoutComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

const code = withoutComments(source)

/**
 * The policy is no longer scraped out of `next.config.ts`. It is a module, it
 * takes a nonce, and it can simply be called — which is a better test as well
 * as a shorter one: these assertions now read the string a browser is actually
 * sent, rather than the source that is supposed to produce it.
 */
const NONCE = 'r0LaGaWaVKmMwZLGf0zBiA=='
const policy = contentSecurityPolicy({ nonce: NONCE })

/**
 * Two files still get read rather than imported.
 *
 * `src/middleware.ts` imports `next/server`, which brings the Edge runtime
 * shims with it; the assertions wanted here are about *where* the header is
 * set, and reading four lines is a fairer test of that than standing up a
 * NextRequest. `csp.ts` is read as well as imported, for the handful of claims
 * that are about the source — that `Math.random` is not in it, that the nonce
 * is not optional.
 */
const policySource = readFileSync(join(process.cwd(), 'src/lib/security/csp.ts'), 'utf8')
const middlewareSource = readFileSync(join(process.cwd(), 'src/middleware.ts'), 'utf8')

function directive(name: string, value: string = policy): string {
  return (
    value
      .split(';')
      .map((entry) => entry.trim())
      .find((entry) => entry.startsWith(`${name} `) || entry === name) ?? ''
  )
}

describe('Content-Security-Policy', () => {
  it('starts from self and widens only by name', () => {
    expect(directive('default-src')).toBe("default-src 'self'")
  })

  it('forbids being framed, in both spellings', () => {
    // CSP for modern browsers, X-Frame-Options for the rest. §15.1's whole
    // point is that an investor can tell a genuine page from a copy, and a copy
    // inside somebody else's frame is exactly that attack.
    expect(directive('frame-ancestors')).toBe("frame-ancestors 'none'")
    expect(source).toContain("{ key: 'X-Frame-Options', value: 'DENY' }")
  })

  it('stops an injected form posting a password somewhere else', () => {
    expect(directive('form-action')).toBe("form-action 'self'")
  })

  it('allows no plugin, applet or nested frame', () => {
    expect(directive('object-src')).toBe("object-src 'none'")
    expect(directive('frame-src')).toBe("frame-src 'none'")
  })

  it('pins the base URI, so an injected <base> cannot re-point every link', () => {
    expect(directive('base-uri')).toBe("base-uri 'self'")
  })

  it('talks to nothing but itself', () => {
    // No CDN, no analytics, no font service, no tag manager. That is what makes
    // a policy this narrow achievable rather than aspirational.
    expect(directive('connect-src')).toBe("connect-src 'self'")
    for (const value of ['http://', 'https://', '*']) {
      expect(policy, value).not.toContain(value)
    }
  })

  it('permits blob: exactly where §13.3 needs it and nowhere else', () => {
    // A recorded video is held in memory as a blob before it is uploaded.
    expect(directive('media-src')).toContain('blob:')
    expect(directive('img-src')).toContain('blob:')
    expect(directive('worker-src')).toContain('blob:')
    expect(directive('connect-src')).not.toContain('blob:')
    expect(directive('script-src')).not.toContain('blob:')
  })

  it('never allows unsafe-eval, in either build', () => {
    // Next's development server evaluates code to hot-reload. Allowing it in
    // production would undo most of the policy's value, and the word appears
    // in neither branch of the module — only in the comment saying why.
    expect(withoutComments(policySource)).not.toContain('unsafe-eval')
    expect(contentSecurityPolicy({ nonce: NONCE, development: true })).not.toContain('unsafe-eval')
  })

  // -------------------------------------------------------------------------
  // The nonce. This is the directive that changed.
  // -------------------------------------------------------------------------

  it("carries a nonce and no longer carries 'unsafe-inline'", () => {
    // The old policy allowed any inline script. If unescaped text ever reached
    // a page, the policy stopped the injected script from *fetching* anything
    // and did nothing to stop it *running* — and running is the whole of the
    // damage on a page holding a claim token and a transfer amount.
    expect(directive('script-src')).toBe(`script-src 'self' 'nonce-${NONCE}'`)
    expect(directive('script-src')).not.toContain("'unsafe-inline'")
  })

  it("does not use 'strict-dynamic', which would discard 'self'", () => {
    // A browser that honours `'strict-dynamic'` ignores host sources in the
    // same directive, so the policy would rest entirely on the nonce
    // propagating through webpack's chunk loader. `'self'` already covers the
    // chunks, and this is the narrower of the two.
    expect(policy).not.toContain('strict-dynamic')
  })

  it('is refused a policy without a nonce, because the type has no such shape', () => {
    // Not a runtime assertion — a design one, restated so it is not quietly
    // undone. There is no `contentSecurityPolicy()` overload that omits the
    // nonce: a policy with neither a nonce nor `'unsafe-inline'` would refuse
    // Next's own bootstrap and serve every page dead, and the only way to be
    // sure nobody adds that variant "for the static pages" is that it cannot
    // be spelled.
    expect(policySource).toContain('nonce: string')
    expect(policySource).not.toMatch(/nonce\?\s*:/)
  })

  it('leaves style-src as the remaining unsafe-inline, and says so', () => {
    // Honesty about what was not fixed. An injected style can reposition or
    // hide things; it cannot read a token or call a server action. A nonce
    // cannot reach it either — React writes `style` attributes, which are
    // governed by style-src-attr.
    expect(directive('style-src')).toContain("'unsafe-inline'")
    expect(policySource).toContain('style-src` still carries')
  })

  it('widens for the development server only when asked, and never by default', () => {
    // `script-src-elem 'self' 'unsafe-inline'` overrides script-src for script
    // *elements*, which in development bypasses the nonce. That is the price of
    // a hot-reloading server and it must not reach a production response.
    expect(policy).not.toContain('script-src-elem')
    expect(contentSecurityPolicy({ nonce: NONCE, development: true })).toContain(
      "script-src-elem 'self' 'unsafe-inline'",
    )
  })

  it('is set in the middleware and NOT in next.config.ts', () => {
    // Two Content-Security-Policy headers on one response are two policies and
    // a browser enforces the intersection. That intersection would happen to be
    // correct here, invisibly, until somebody edited one of the two files.
    expect(code).not.toContain("key: 'Content-Security-Policy'")
    expect(middlewareSource).toContain("response.headers.set('content-security-policy', policy)")
  })

  it('is set on the request as well, because that is where Next reads it', () => {
    // Next takes the nonce from the INCOMING header and stamps it on the script
    // tags it renders. Set it only on the response and the policy names a nonce
    // that matches nothing on the page: every script is refused and the page
    // arrives looking correct and never hydrating.
    expect(middlewareSource).toContain("requestHeaders.set('content-security-policy', policy)")
    expect(middlewareSource).toContain('NextResponse.next({ request: { headers: requestHeaders } })')
  })

  it('lists the root path on its own, which a group will not match', () => {
    // Found on a served response under `/SPV`. A path-to-regexp group does not
    // match an empty segment: at a domain root `/((?!…).*)` matches `/` because
    // the group matches the empty string after the slash, and under a prefix
    // the landing page is `/SPV` with nothing after it and the middleware never
    // runs. The front door of the only deployment that faces the internet would
    // have carried no policy at all, with every domain-root check passing.
    // `next.config.ts` carries the same one-line entry for the same reason.
    expect(middlewareSource).toContain("matcher: ['/', ")
  })

  it('discards any Content-Security-Policy that arrived with the request', () => {
    // `set`, never `append`: an inbound policy is a client choosing this
    // application's policy for it, nonce included.
    expect(middlewareSource).not.toContain('requestHeaders.append')
  })
})

describe('the nonce itself', () => {
  it('is base64 in the shape Next will accept', () => {
    // Next's reader is /^'nonce-([A-Za-z0-9+/_-]+={0,2})'$/ and ignores
    // anything else, silently, leaving every script un-nonced.
    expect(generateNonce()).toMatch(/^[A-Za-z0-9+/_-]+={0,2}$/)
  })

  it('is 16 bytes, which is 24 base64 characters', () => {
    expect(generateNonce()).toHaveLength(24)
  })

  it('is different every time', () => {
    // A constant is not a nonce; it is a value an attacker reads off one page
    // and reuses on the next. `pnpm verify:viewport` proves this against two
    // real responses; this proves the generator itself.
    const drawn = new Set(Array.from({ length: 200 }, () => generateNonce()))
    expect(drawn.size).toBe(200)
  })

  it('comes from the platform CSPRNG', () => {
    // Math.random is not seeded for this and is predictable from prior output.
    expect(policySource).toContain('crypto.getRandomValues')
    expect(policySource).not.toContain('Math.random')
  })
})

describe('Permissions-Policy', () => {
  const policy = /const PERMISSIONS_POLICY = \[([\s\S]*?)\]\.join/.exec(source)?.[1] ?? ''

  it('leaves the camera and microphone available to this origin', () => {
    // The trap. §13.3 records the operator's video in the browser through
    // getUserMedia, and `camera=()` breaks it silently — no prompt appears and
    // the recorder reports a device fault. A shipped feature, switched off by a
    // header that looked more secure.
    expect(policy).toContain('camera=(self)')
    expect(policy).toContain('microphone=(self)')
  })

  it('and denies them to every other origin', () => {
    expect(policy).not.toContain('camera=*')
    expect(policy).not.toContain('microphone=*')
  })

  it('switches off what this application has no use for, by name', () => {
    for (const feature of ['geolocation', 'payment', 'usb', 'display-capture']) {
      expect(policy, feature).toContain(`${feature}=()`)
    }
  })

  it('is wired to every route, not only the private ones', () => {
    const everywhere = source.slice(source.indexOf("source: '/:path*'"))
    expect(everywhere).toContain('PERMISSIONS_POLICY')
  })

  it('stays in next.config.ts, because it does not vary per request', () => {
    // The Content-Security-Policy moved to middleware only because a nonce has
    // to be drawn per response. Nothing else about these headers changes from
    // one request to the next, and a static header belongs in the static place
    // — where it is one list rather than code somebody has to read.
    expect(code).toContain("key: 'Permissions-Policy'")
    expect(code).toContain("key: 'X-Frame-Options'")
    expect(withoutComments(middlewareSource)).not.toContain('Permissions-Policy')
  })

  it('is not weakened by the middleware, which touches one header and no other', () => {
    // The first middleware in this application. What it must not become is the
    // place access decisions are made: the Edge runtime cannot reach the
    // database, so it would have to trust a cookie, and §2 and §18 are enforced
    // where the data is.
    expect(middlewareSource).not.toMatch(/NextResponse\.(redirect|rewrite|json)/)
    expect(middlewareSource).not.toContain('cookies')
    expect(middlewareSource).not.toContain('@/db')
  })
})

describe('Strict-Transport-Security', () => {
  const fn = source.slice(
    source.indexOf('function strictTransportSecurity'),
    source.indexOf('export default nextConfig'),
  )

  it('is sent only when a browser actually reaches this deployment over TLS', () => {
    expect(fn).toContain("startsWith('https://')")
    expect(fn).toContain('return []')
  })

  it('follows the same origin that decides whether a cookie is Secure', () => {
    // One question, one answer. If HSTS and the cookie contract could disagree,
    // one of them is wrong and nobody would know which.
    expect(fn).toContain('PUBLIC_ORIGIN')
    expect(fn).toContain('APP_URL')
  })

  it('does not preload and does not claim subdomains', () => {
    // Both are close to irreversible. Preload is a browser vendor hard-coding
    // the name; includeSubDomains decides for hostnames somebody may later use
    // for something unrelated.
    expect(fn).not.toContain('preload')
    expect(fn).not.toContain('includeSubDomains')
  })

  it('lasts a year', () => {
    expect(fn).toContain('max-age=31536000')
  })
})
