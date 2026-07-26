/**
 * The Content-Security-Policy, in one place, built per request.
 *
 * This used to live in `next.config.ts` as a constant string, and its own
 * comment said what was wrong with it:
 *
 *   > **`script-src` carries `'unsafe-inline'`, and that is the weak part.**
 *   > Next injects inline bootstrap and hydration scripts, and the tight answer
 *   > is a per-request nonce, which needs middleware and makes every route
 *   > dynamic.
 *
 * `'unsafe-inline'` on `script-src` is not a small concession. It is the
 * concession that makes the rest of the policy close to decorative against the
 * attack that actually matters here: if a name, a note, a question or an
 * imported CSV cell ever reaches the page unescaped, the policy stops the
 * injected script from *fetching* anything and does nothing at all to stop it
 * *running*. On a page that holds an investor's claim token and their transfer
 * amount, running is the whole of the damage.
 *
 * So the policy is now generated for each request with a fresh nonce, and
 * `'unsafe-inline'` is gone from `script-src`. Next reads the nonce out of the
 * `Content-Security-Policy` request header that `src/middleware.ts` sets, and
 * stamps it on every script tag it emits — the bootstrap, the chunk tags and
 * the streamed flight data. An inline `<script>` that this application did not
 * render carries no nonce and does not execute.
 *
 * **A header value, never a page.** The nonce is not stored, not logged and not
 * reused: it exists for the length of one response. Reusing one across requests
 * would return the policy to roughly the strength of `'unsafe-inline'`, because
 * an attacker who can read one page can read the nonce out of it.
 *
 * This module is deliberately free of imports. It is evaluated in the Edge
 * runtime by the middleware and in Node by the tests, and anything it pulled in
 * would have to be safe in both.
 */

export interface CspOptions {
  /**
   * The per-request nonce, base64, as it appears inside `'nonce-…'`. Required:
   * there is no "policy without a nonce" variant, because a policy without a
   * nonce and without `'unsafe-inline'` would refuse Next's own bootstrap and
   * serve every page dead.
   */
  nonce: string
  /**
   * `next dev` only. The development server hot-reloads by evaluating code and
   * injects script elements this policy would otherwise refuse.
   */
  development?: boolean
}

/**
 * `style-src` still carries `'unsafe-inline'`, and that is now the weak part.
 *
 * It is a much smaller one than the script equivalent — an injected style can
 * reposition or hide things, it cannot read a token or call a server action —
 * but it is not nothing, and the honest thing is to name it rather than let the
 * removal of one `'unsafe-inline'` read as the removal of both.
 *
 * A nonce cannot fix it as it stands. Tailwind v4 ships a stylesheet from this
 * origin, which `'self'` covers; the inline styles come from React writing
 * `style={{…}}` attributes and from Next inlining critical CSS during
 * streaming, and a `style` *attribute* is governed by `style-src-attr`, which a
 * nonce cannot reach. Removing it means removing every inline style attribute
 * in the application first.
 */
export const STYLE_SRC = "style-src 'self' 'unsafe-inline'"

/**
 * Build the policy.
 *
 * This application loads nothing from anywhere else — no CDN, no analytics, no
 * font service, no tag manager — so `default-src 'self'` is achievable rather
 * than aspirational, and every widening below is named with the feature that
 * needs it.
 *
 * `frame-ancestors 'none'` says what `X-Frame-Options: DENY` says, for browsers
 * that prefer the modern spelling. Both are kept.
 */
export function contentSecurityPolicy({ nonce, development = false }: CspOptions): string {
  const directives = [
    "default-src 'self'",
    "base-uri 'self'",
    // Nothing in this application is a plugin or an applet, and a <frame> on an
    // investor's portal is somebody else's page wearing it.
    "object-src 'none'",
    "frame-src 'none'",
    "frame-ancestors 'none'",
    // A form on this origin may only post back to this origin. Without it, an
    // injected form could post a password or a claim token elsewhere.
    "form-action 'self'",
    /**
     * The nonce, and this origin, and nothing else.
     *
     * `'strict-dynamic'` was considered and is not used. It would let a script
     * that carries the nonce load further scripts without them carrying it,
     * and — the part that matters — browsers that honour it *ignore* `'self'`,
     * so the policy would rest entirely on nonce propagation through webpack's
     * chunk loader. Next stamps the nonce on the script tags it renders and
     * loads the rest by URL from this origin, which `'self'` already covers.
     * The version without `'strict-dynamic'` is the narrower of the two here.
     */
    `script-src 'self' 'nonce-${nonce}'`,
    STYLE_SRC,
    // `data:` for the inline brand marks; `blob:` for a video preview held in
    // memory before it is uploaded (§13.3).
    "img-src 'self' data: blob:",
    "media-src 'self' blob:",
    "font-src 'self' data:",
    "connect-src 'self'",
    // MediaRecorder may run off a worker created from a blob.
    "worker-src 'self' blob:",
  ]

  // Next's development server evaluates code to hot-reload. Never in a
  // production build — `'unsafe-eval'` there would undo most of the value of
  // the policy, and this branch is the only place the word could appear.
  if (development) {
    directives.push("script-src-elem 'self' 'unsafe-inline'")
  }

  return directives.join('; ')
}

/**
 * A fresh nonce.
 *
 * 16 bytes from the platform CSPRNG, base64. `crypto.getRandomValues` rather
 * than `randomUUID` because a UUID is 122 bits of entropy dressed as text and
 * this wants bytes; `btoa` rather than `Buffer` because the middleware runs in
 * the Edge runtime, where `Buffer` is not guaranteed.
 *
 * Next's own nonce reader accepts `[A-Za-z0-9+/_-]+={0,2}`, which standard
 * base64 satisfies.
 */
export function generateNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}
