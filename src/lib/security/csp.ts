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

/**
 * A widening that exactly one screen needs, named after the screen's reason.
 *
 * The policy used to be one string for every response, which meant the two
 * administration screens with an unusual requirement set the policy for the
 * investor portal as well. Asking what those widenings were actually for
 * produced a shorter answer than the comments claimed:
 *
 *   - **There is not one `data:` URL in this application** except the two-factor
 *     QR code on `/admin/security`, which `qrcode` renders as a data URL into an
 *     `<img>`. `font-src data:` was for a font nobody added, and `img-src data:`
 *     was described as being "for the inline brand marks" — the brand marks are
 *     inline `<svg>` elements, which no fetch directive governs at all.
 *   - **There is one `createObjectURL` in the repository**, in the recorder on
 *     `/admin/video`. `img-src blob:` was allowed alongside it and no `<img>`
 *     was ever involved: the blob goes on a `<video>`.
 *
 * So an investor's portal was carrying `data:` on images and fonts and `blob:`
 * on images, for features living on two screens they cannot reach. None of the
 * three is a script vector — `script-src` refuses everything without the nonce
 * — but §15 rests on the portal being the hardest page in this application to
 * abuse, and a source a page has no use for is a source it should not be
 * offered. The specification is silent, so this is the conservative reading.
 */
export type CspCapability =
  /** `/admin/security` renders the two-factor QR as `<img src="data:image/png…">`. */
  | 'QR_DATA_IMAGE'
  /** `/admin/video` plays a recording back from an object URL before uploading it. */
  | 'MEDIA_BLOB'

/**
 * Which widenings a path may have — the whole of the mapping, in one place.
 *
 * Matched on a segment boundary rather than by equality, for the reason both
 * `next.config.ts` and the middleware matcher carry a note about: under a base
 * path the served path is `/SPV/admin/video`, and a check for
 * `=== '/admin/video'` would quietly hand the *narrow* policy to the one screen
 * that needs the wide one. That failure is invisible to a test that reads source
 * and shows up as a camera that does not work on the only deployment facing the
 * internet.
 *
 * Erring wide on a path that does not exist — `/anything/admin/video` — costs
 * nothing: it is a 404, and no investor-facing route can be made to match, since
 * every one of them is under `/portal`, `/verify`, `/privacy` or the root.
 */
export function capabilitiesFor(pathname: string): CspCapability[] {
  const capabilities: CspCapability[] = []
  if (/(^|\/)admin\/security(\/|$)/.test(pathname)) capabilities.push('QR_DATA_IMAGE')
  if (/(^|\/)admin\/video(\/|$)/.test(pathname)) capabilities.push('MEDIA_BLOB')
  return capabilities
}

export interface CspOptions {
  /**
   * The per-request nonce, base64, as it appears inside `'nonce-…'`. Required:
   * there is no "policy without a nonce" variant, because a policy without a
   * nonce and without `'unsafe-inline'` would refuse Next's own bootstrap and
   * serve every page dead.
   */
  nonce: string
  /**
   * What this path may load beyond the base policy.
   *
   * Defaults to none, which is the policy every investor-facing page gets. A
   * caller that forgets it gets the narrow policy rather than the wide one — the
   * safe direction for a default, and the reason this is a list of additions
   * rather than a list of exclusions.
   */
  capabilities?: readonly CspCapability[]
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
 *
 * ---
 *
 * **That is what the entry before this one said, and it was wrong about the
 * size of the job.** Removing every inline style attribute meant removing one:
 * `text-transform: uppercase` on the jurisdiction box, which is a class. Nothing
 * here uses `next/font` or `next/image`, no route sets a style at runtime, and
 * Next inlines no critical CSS in this configuration — the served HTML of every
 * screen contains no `<style>` element and no `style` attribute at all. So the
 * directive is now `'self'`, and both `'unsafe-inline'` keywords are gone from
 * this policy.
 *
 * **What it costs to break.** `style-src-attr` falls back to this directive and
 * a nonce cannot reach an attribute, so an inline style added anywhere from now
 * on is *refused*: the element renders with that one rule missing and nothing
 * says so. `auditScreen` in `pnpm verify:viewport` therefore fails on any
 * element carrying a `style` attribute, on every screen, and names the offender
 * — which is what makes this directive maintainable rather than a trap for
 * whoever writes the next component.
 *
 * The email templates in `lib/updates/notification.ts` and `lib/qa/messages.ts`
 * are full of inline styles and always will be, because a mail client accepts
 * nothing else. This policy does not reach them: it governs documents this
 * application serves, and an email is rendered by somebody else's program.
 */
export const STYLE_SRC = "style-src 'self'"

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
export function contentSecurityPolicy({
  nonce,
  capabilities = [],
  development = false,
}: CspOptions): string {
  const may = (capability: CspCapability): boolean => capabilities.includes(capability)
  const scriptSource = development
    ? `script-src 'self' 'nonce-${nonce}' 'unsafe-eval'`
    : `script-src 'self' 'nonce-${nonce}'`
  const styleSource = development
    ? "style-src 'self' 'unsafe-inline'"
    : STYLE_SRC
  const connectSource = development
    ? "connect-src 'self' ws: wss:"
    : "connect-src 'self'"

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
    scriptSource,
    styleSource,
    /**
     * `data:` only where the two-factor QR is drawn.
     *
     * Every other image in this application is a file this origin serves or an
     * inline `<svg>`, and an `<svg>` element in the markup is not a fetch, so no
     * directive governs it. `blob:` was here as well and nothing ever put a blob
     * on an `<img>`.
     */
    may('QR_DATA_IMAGE') ? "img-src 'self' data:" : "img-src 'self'",
    /**
     * `blob:` only where a recording is played back before being uploaded.
     *
     * `verify:viewport` loads a blob onto a `<video>` on `/admin/video` and
     * fails if the policy refuses it, so this is checked in a browser on the one
     * path that carries it — and `verify:recorder` drives the real component.
     */
    may('MEDIA_BLOB') ? "media-src 'self' blob:" : "media-src 'self'",
    // No `@font-face` anywhere, and no `next/font`. `data:` was here for a font
    // that was never added.
    "font-src 'self'",
    connectSource,
    /**
     * `worker-src 'self'`, with no `blob:`.
     *
     * The comment that used to sit here said "MediaRecorder may run off a worker
     * created from a blob". *May* was doing a lot of work: it was a guess, and
     * `verify:recorder` — which records, stops, plays back and uploads through
     * the real component with the real headers — passes 107 of 107 without it,
     * reporting no violation of any directive. Chromium implements MediaRecorder
     * natively and creates no worker the policy can see.
     *
     * This is the widening worth having removed. A blob worker is the only one of
     * the four that runs **script**: `script-src` refuses an inline script
     * without the nonce, and a worker is a separate execution context reached by
     * a different directive. It was never reachable — an attacker who could call
     * `new Worker` has already run script — but it was the one allowance whose
     * subject was code rather than pixels, it was granted on a guess, and it was
     * granted on every page in the application.
     */
    "worker-src 'self'",
  ]

  // Next's development overlay injects script elements and inline styles in
  // addition to evaluating its debugging helpers. These allowances exist only
  // in `next dev`; production retains the nonce-only script policy and the
  // self-only style policy above.
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
