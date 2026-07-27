import { NextResponse, type NextRequest } from 'next/server'
import { capabilitiesFor, contentSecurityPolicy, generateNonce } from '@/lib/security/csp'

/**
 * The first middleware in this application, and it does exactly one thing:
 * it gives every response a Content-Security-Policy carrying a fresh nonce.
 *
 * **Why it has to be here and not in `next.config.ts`.** The headers in
 * `next.config.ts` are evaluated once, at build time, and baked into
 * `.next/routes-manifest.json`. A nonce that is the same on every response is
 * not a nonce; it is a password published on every page that uses it. A
 * per-request value needs per-request code, and middleware is the only place
 * Next runs code before a response is formed.
 *
 * **Why the policy is set on the request as well as the response.** Next reads
 * the nonce out of the *incoming* `Content-Security-Policy` header
 * (`getScriptNonceFromHeader`) and stamps it on every script tag it renders.
 * Setting it only on the response would send a policy whose nonce matches
 * nothing on the page, and every script — including Next's own bootstrap —
 * would be refused. That failure is silent in the network tab and loud in the
 * console, which is why `pnpm verify:viewport` listens to the console.
 *
 * **What is deliberately not here.** No authentication, no redirects, no role
 * check, no reading of a cookie. Every access decision in this application is
 * made by the page or the route handler that serves the thing, against the
 * database, and moving any part of that into middleware would put an access
 * rule in a second place — where the Edge runtime cannot reach the database to
 * check it properly and would have to trust a cookie instead. §2 and §18 are
 * enforced where the data is.
 *
 * The other browser-policy headers — `X-Frame-Options`, `Referrer-Policy`,
 * `X-Content-Type-Options`, `Permissions-Policy`, `Strict-Transport-Security`,
 * `X-Robots-Tag` — stay in `next.config.ts`. None of them varies per request,
 * and a static header belongs in the static place.
 */
export function middleware(request: NextRequest): NextResponse {
  /**
   * The policy varies by path now, and this is the only thing in this file that
   * reads the request.
   *
   * Two administration screens need one extra source each — the two-factor QR
   * needs `data:` on images, the recorder needs `blob:` on media — and until now
   * every page in the application carried both, plus two more that nothing used
   * at all. `capabilitiesFor` holds the mapping and the reasoning; see `csp.ts`.
   *
   * It reads `nextUrl.pathname` and matches on a segment boundary rather than by
   * equality, because under a base path the path here is `/SPV/admin/video`.
   * Getting that wrong would serve the *narrow* policy to the screen that needs
   * the wide one — invisible to any check that reads source, and visible only as
   * a recorder that will not play back on the deployment facing the internet.
   * `pnpm verify:deployment` is the one thing here that serves under a prefix.
   */
  const policy = contentSecurityPolicy({
    nonce: generateNonce(),
    capabilities: capabilitiesFor(request.nextUrl.pathname),
    development: process.env.NODE_ENV === 'development',
  })

  const requestHeaders = new Headers(request.headers)
  /**
   * Set, never append. A `Content-Security-Policy` arriving on the request from
   * outside is a client claiming to have chosen this application's policy for
   * it — including, if it were merged, a nonce the client knows. Whatever came
   * in is discarded here.
   */
  requestHeaders.set('content-security-policy', policy)

  const response = NextResponse.next({ request: { headers: requestHeaders } })
  response.headers.set('content-security-policy', policy)
  return response
}

/**
 * Everything except the build's own immutable assets.
 *
 * `_next/static` and `_next/image` are the compiled chunks, the stylesheet and
 * the optimised images. A Content-Security-Policy on a `.js` or `.css` response
 * governs nothing — the policy that decides whether a script may run is the one
 * on the *document* that loaded it — so excluding them costs no protection and
 * keeps a per-request random draw off the path of every asset on every page.
 *
 * Everything else is included on purpose, and that is wider than the usual
 * copied-around matcher: API routes, the media route that streams an uploaded
 * file, `/export/*` which returns a CSV, and `robots.txt`. A response that is
 * not a document still carries the header, so a browser coaxed into treating
 * one as a document — the reason `X-Content-Type-Options: nosniff` is also set
 * — meets the policy rather than nothing.
 */
export const config = {
  /**
   * `'/'` is listed on its own, and it is not redundant.
   *
   * `/((?!…).*)` is a path-to-regexp group, and a group does not match an empty
   * segment. At a domain root that goes unnoticed, because the path is `/` and
   * the group matches the empty string after the slash. Under a path prefix it
   * does not: Next rewrites the matcher to `/SPV/((?!…).*)`, the landing page is
   * served at `/SPV` with nothing after it, and the middleware never runs — so
   * the front door of the only deployment that faces the internet would be
   * served with **no Content-Security-Policy at all**, while every check at a
   * domain root passed.
   *
   * This is the second time this exact trap has been sprung in this
   * repository. `next.config.ts` carries the same one-line entry for the same
   * reason, with the same note. Neither was visible to a test that reads the
   * source; both were found by asking a running server —
   * `pnpm verify:deployment`, which is the only thing here that serves under a
   * prefix.
   */
  matcher: ['/', '/((?!_next/static|_next/image).*)'],
}
