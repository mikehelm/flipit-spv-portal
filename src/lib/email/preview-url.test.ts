import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { resetEnvCache } from '@/lib/env'
import {
  EMAIL_BODY_POLICY,
  capabilitiesFor,
  contentSecurityPolicy,
  isEmailBodyPath,
} from '@/lib/security/csp'
import { emailBodyPath } from './preview-url'

/**
 * The email preview's body route, and the three files that have to agree about
 * where it lives.
 *
 * The frame on `/templates/preview/[offerId]` is the one frame in this
 * application. Its `src` is built by `emailBodyPath`; the middleware decides
 * which Content-Security-Policy the response carries by matching
 * `isEmailBodyPath`; and `next.config.ts` narrows `X-Frame-Options` on the same
 * path. Three separate spellings of one route.
 *
 * If they disagree the failure is **silent and it is invisible in the network
 * tab**. The body arrives, the policy that reaches it is the application's own,
 * every inline style in the email is refused, and the operator sees an unstyled
 * document that they have no reason to distrust — which is exactly the defect
 * this route was built to remove, arrived at a second time from a different
 * direction. So the pairing is asserted rather than assumed, including under a
 * base path, which is how it would actually break.
 */

const ORIGINAL_ENV = { ...process.env }

function deployedUnder(basePath: string): void {
  process.env.BASE_PATH = basePath
  resetEnvCache()
}

afterEach(() => {
  process.env = { ...ORIGINAL_ENV }
  resetEnvCache()
})

/** The path without the query, which is all the middleware ever sees. */
function pathOnly(url: string): string {
  return url.split('?')[0]!
}

const OFFER = '7f1c9a2e-3d55-4b60-9f0a-2c1d8e4b6a71'

describe('the email body route', () => {
  it('is recognised by the middleware at a domain root', () => {
    deployedUnder('')
    const url = emailBodyPath(OFFER, 'INVITATION')
    expect(url).toBe(`/templates/preview/${OFFER}/body?kind=INVITATION`)
    expect(isEmailBodyPath(pathOnly(url))).toBe(true)
  })

  it('and under a base path, which is how this would silently break', () => {
    // The application runs under `/SPV` before it runs at a domain root. A
    // pattern matching on equality rather than on a segment boundary would hand
    // this document the *application* policy on the only deployment that faces
    // the internet, and every check at a domain root would pass.
    deployedUnder('/SPV')
    const url = emailBodyPath(OFFER, 'REMINDER')
    expect(url).toBe(`/SPV/templates/preview/${OFFER}/body?kind=REMINDER`)
    expect(isEmailBodyPath(pathOnly(url))).toBe(true)
  })

  it('carries the kind, so the frame shows the template the page is describing', () => {
    deployedUnder('')
    expect(emailBodyPath(OFFER, 'REMINDER')).toContain('kind=REMINDER')
    expect(emailBodyPath(OFFER, 'INVITATION')).toContain('kind=INVITATION')
  })

  it('escapes the identifier rather than pasting it into a URL', () => {
    deployedUnder('')
    expect(emailBodyPath('a/b?c', 'INVITATION')).toContain('a%2Fb%3Fc')
  })

  it('the page it belongs to is granted a frame, and nothing else is', () => {
    // `frame-src 'self'` on one screen. The capability is granted by path, and
    // the portal — the page holding a claim token and a transfer amount — is
    // served the `'none'` version, as is every other screen.
    expect(capabilitiesFor(`/templates/preview/${OFFER}`)).toEqual(['EMAIL_BODY_FRAME'])
    expect(capabilitiesFor(`/SPV/templates/preview/${OFFER}`)).toEqual(['EMAIL_BODY_FRAME'])
    for (const path of ['/', '/portal', '/templates', '/verify', '/investors', '/admin']) {
      expect(capabilitiesFor(path), path).toEqual([])
    }
  })

  it('the body route itself is granted no frame of its own', () => {
    // The two patterns must not both match. A body document served the
    // application policy *plus* `frame-src 'self'` would be the original defect
    // with an extra widening on top.
    expect(capabilitiesFor(`/templates/preview/${OFFER}/body`)).toEqual([])
    expect(isEmailBodyPath(`/templates/preview/${OFFER}`)).toBe(false)
  })

  it('a path that merely contains the words does not match either', () => {
    expect(isEmailBodyPath('/templates/previews/x/body')).toBe(false)
    expect(isEmailBodyPath('/templates/preview/x/y/body')).toBe(false)
    expect(isEmailBodyPath('/body')).toBe(false)
    expect(capabilitiesFor('/templates/preview')).toEqual([])
  })
})

describe('the policy the body is served under', () => {
  const directive = (name: string) =>
    EMAIL_BODY_POLICY.split(';')
      .map((entry) => entry.trim())
      .find((entry) => entry === name || entry.startsWith(`${name} `)) ?? ''

  it('grants exactly one thing, and it is the reason the route exists', () => {
    // A designed HTML email is inline styles by construction — that is the only
    // styling a mail client honours — and this is the grant that lets the
    // operator see what the recipient will see.
    expect(directive('style-src')).toBe("style-src 'unsafe-inline'")
  })

  it('and the grant does not reach the application policy', () => {
    // The one-line alternative was widening `style-src` everywhere, which would
    // have put `'unsafe-inline'` back on an investor's portal for the benefit of
    // one frame. `browser-policy.test.ts` asserts the base policy has no
    // `'unsafe-inline'` at all; this asserts the two are separate strings.
    expect(contentSecurityPolicy({ nonce: 'r0LaGaWaVKmMwZLGf0zBiA==' })).not.toContain(
      'unsafe-inline',
    )
  })

  it('starts from none, so every other capability is refused by default', () => {
    expect(directive('default-src')).toBe("default-src 'none'")
  })

  it('runs no script — there is no script-src to widen and no nonce to carry', () => {
    // `default-src 'none'` covers it. A nonce in this policy would be a nonce
    // something could be made to carry, on a document made of untrusted markup.
    expect(EMAIL_BODY_POLICY).not.toContain('script-src')
    expect(EMAIL_BODY_POLICY).not.toContain('nonce-')
  })

  it('loads no image, which is a decision and not an omission', () => {
    // Both templates are image-free by construction and `templates.test.ts`
    // asserts it. An `<img>` in untrusted markup is an outbound request from the
    // administrator's browser to whatever host the markup names, made before
    // anything has been sent.
    expect(directive('img-src')).toBe("img-src 'none'")
  })

  it('may be framed by this application and by nobody else', () => {
    expect(directive('frame-ancestors')).toBe("frame-ancestors 'self'")
    expect(directive('frame-ancestors')).not.toContain('*')
  })

  it('submits nothing and re-points nothing', () => {
    expect(directive('form-action')).toBe("form-action 'none'")
    expect(directive('base-uri')).toBe("base-uri 'none'")
  })

  it('is sandboxed by the response as well as by the frame element', () => {
    // The frame carries `sandbox=""`. This repeats it on the response, so the
    // restriction holds when an administrator opens the URL directly — a
    // defence that exists only in the parent document is not a defence of the
    // route.
    expect(directive('sandbox')).toBe('sandbox')
  })

  it('reaches nothing on the network at all', () => {
    for (const value of ['http://', 'https://', 'data:', 'blob:', '*']) {
      expect(EMAIL_BODY_POLICY, value).not.toContain(value)
    }
  })
})

describe('the headers around it', () => {
  const withoutComments = (text: string) =>
    text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

  const nextConfig = withoutComments(
    readFileSync(join(process.cwd(), 'next.config.ts'), 'utf8'),
  )
  const route = readFileSync(
    join(process.cwd(), 'src/app/(admin)/templates/preview/[offerId]/body/route.ts'),
    'utf8',
  )
  const page = readFileSync(
    join(process.cwd(), 'src/app/(admin)/templates/preview/[offerId]/page.tsx'),
    'utf8',
  )
  const middleware = readFileSync(join(process.cwd(), 'src/middleware.ts'), 'utf8')

  it('X-Frame-Options is narrowed on this path and DENY everywhere else', () => {
    // DENY refuses same-origin framing too — that is what DENY means — so the
    // frame would be empty without this. `SAMEORIGIN` rather than a removal,
    // because a browser reading no X-Frame-Options falls back to the CSP, and
    // both spellings should say the same thing.
    expect(nextConfig).toContain("{ key: 'X-Frame-Options', value: 'DENY' }")
    expect(nextConfig).toContain("source: '/templates/preview/:offerId/body'")
    expect(nextConfig).toContain("{ key: 'X-Frame-Options', value: 'SAMEORIGIN' }")
  })

  it('and the narrowing comes last, because a later entry is what overwrites', () => {
    // Next applies every matching entry in order. Above the catch-all this
    // would be silently undone, the frame would be empty, and the configuration
    // would look correct — the same shape as the `/verify` defect this file
    // already carries a note about.
    expect(nextConfig.indexOf("value: 'SAMEORIGIN'")).toBeGreaterThan(
      nextConfig.lastIndexOf("value: 'DENY'"),
    )
  })

  it('the middleware chooses the policy by path, before the capability mapping', () => {
    expect(middleware).toContain('isEmailBodyPath(')
    expect(middleware).toContain('EMAIL_BODY_POLICY')
  })

  it('the frame is pointed at a route, never back at a srcdoc attribute', () => {
    // The whole of the fix, in one attribute. `srcDoc` here would restore the
    // defect and every check above would still pass.
    expect(page).toContain('src={emailBodyPath(')
    expect(withoutComments(page)).not.toContain('srcDoc')
  })

  it('and the frame still grants nothing', () => {
    // A route on this origin is same-origin with the page unless the frame says
    // otherwise, which is the one thing `sandbox=""` was here to prevent.
    expect(page).toContain('sandbox=""')
  })

  it('the route refuses without a session, and refuses identically', () => {
    expect(route).toContain('currentAdmin()')
    expect(route).toContain('if (!admin) return refuse()')
    // One response for every refusal. A 404 for an unknown offer and a 403 for
    // a known one would tell an unauthenticated caller which ids are real.
    expect(route).toContain('status: 404')
    expect(route).not.toContain('status: 403')
    expect(route).not.toContain('redirect(')
  })

  it('the route restates the onboarding rule the page redirects for', () => {
    expect(route).toContain('isOnboardingComplete')
  })

  it('the route stores nothing and is never indexed', () => {
    expect(route).toContain("'Cache-Control': 'no-store, no-cache, must-revalidate, private'")
    expect(route).toContain("'X-Robots-Tag': 'noindex, nofollow, noarchive, nosnippet'")
    expect(route).toContain("'X-Content-Type-Options': 'nosniff'")
  })

  it('the route records the read, under its own name', () => {
    // Two rows for one screen, because two reads happened — and because this
    // route can be fetched without the page, by an administrator with the URL.
    expect(route).toContain("'email.body_served'")
  })

  it('and it sets no Content-Security-Policy of its own', () => {
    // Two CSP headers on one response are two policies and a browser enforces
    // the intersection — which here would be the application policy AND the
    // body policy, refusing every inline style and restoring the defect.
    // Comments explain what the code avoids; they must not trip a check for it.
    expect(withoutComments(route)).not.toMatch(/[Cc]ontent-[Ss]ecurity-[Pp]olicy/)
  })
})
