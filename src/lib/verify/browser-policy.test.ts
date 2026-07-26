import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

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
const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

function directive(name: string): string {
  const policy = /const directives = \[([\s\S]*?)\n  \]/.exec(source)?.[1] ?? ''
  const line = policy
    .split('\n')
    .map((entry) => entry.trim().replace(/^["']|["'],?$/g, ''))
    .find((entry) => entry.startsWith(`${name} `) || entry === name)
  return line ?? ''
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
      expect(source.slice(source.indexOf('const directives = ['), source.indexOf('  ]')), value).not.toContain(value)
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

  it('never allows unsafe-eval in a production build', () => {
    // Next's development server evaluates code to hot-reload. In production it
    // would undo most of the policy's value.
    const guard = source.slice(source.indexOf("NODE_ENV === 'development'"))
    expect(guard).toContain('unsafe-inline')
    expect(code).not.toContain('unsafe-eval')
  })

  it('admits in its own comment that script-src is the weak part', () => {
    // `'unsafe-inline'` on script-src is a real limitation: the policy defends
    // against injected external script and not against injected inline script.
    // A per-request nonce is the fix and it needs middleware. What must not
    // happen is somebody reading this file and believing it is airtight.
    expect(directive('script-src')).toContain("'unsafe-inline'")
    expect(source).toContain('nonce')
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
    expect(everywhere).toContain('contentSecurityPolicy()')
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
