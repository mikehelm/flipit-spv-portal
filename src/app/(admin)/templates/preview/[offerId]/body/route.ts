import { z } from 'zod'
import { currentAdmin } from '@/lib/auth/guards'
import { isOnboardingComplete } from '@/lib/auth/onboarding'
import { readOnboardingSnapshot } from '@/lib/auth/onboarding-store'
import { auditPreviewRead, loadPreviewRecipient, renderPreview } from '../../../data'

export const dynamic = 'force-dynamic'

/** The same parse the page does. An unknown kind falls back to the invitation. */
const kindSchema = z.enum(['INVITATION', 'REMINDER']).catch('INVITATION')

/**
 * The HTML part of one recipient's email, served as its own document.
 *
 * **Why this route exists.** The preview page used to put the body in a
 * `srcdoc` attribute, and a `srcdoc` frame inherits the embedding document's
 * Content-Security-Policy. This application serves `style-src 'self'`, so every
 * one of the invitation's 69 inline styles was refused inside the frame: the
 * operator reviewing the last screen before a real invitation went to a real
 * person was shown an unstyled document, while the recipient would see the
 * designed one. The card above the frame said *"this is the markup that will be
 * sent, byte for byte"*, which was true of the markup and false of the picture.
 *
 * The fix was **not** to widen the policy — that would have put
 * `'unsafe-inline'` back on every page in the application, an investor's portal
 * included, for the benefit of one frame. The body is served from here instead,
 * under `EMAIL_BODY_POLICY`: `default-src 'none'` with exactly one grant,
 * `style-src 'unsafe-inline'`, applying to this document and nothing else. See
 * `src/lib/security/csp.ts`.
 *
 * **It serves untrusted markup, so it is written as if the markup were hostile.**
 * The response is `sandbox`-ed by its own policy as well as by the frame element,
 * carries `frame-ancestors 'self'` so nobody else's page can embed it, loads no
 * image, runs no script, submits no form and is never cached.
 *
 * **It is behind the administrator guard**, and refuses with a status rather
 * than a redirect. A `<iframe>` element's request is not a navigation an
 * investor is reading, and a sign-in page rendered inside the preview frame is
 * the wrong answer to it — the same reasoning the operator's own video preview
 * route carries. Every refusal is the same empty 404, so this route cannot be
 * used to learn whether an offer id exists.
 *
 * **Nothing here sends and nothing here issues.** It renders through the same
 * `renderPreview` the page uses, which mints no token — the portal link in the
 * markup is the deliberately-unusable `PREVIEW_CLAIM_TOKEN`.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ offerId: string }> },
) {
  /**
   * One response for every refusal — no session, wrong role, unfinished
   * onboarding, unknown offer, an email that will not render.
   *
   * A route that answered 404 for an unknown offer and 403 for a known one
   * would tell an unauthenticated caller which ids are real, which is §15's
   * fifth question asked of a status code.
   */
  const refuse = () =>
    new Response(null, {
      status: 404,
      headers: {
        'Cache-Control': 'no-store',
        'X-Robots-Tag': 'noindex, nofollow, noarchive, nosnippet',
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer',
      },
    })

  const admin = await currentAdmin()
  if (!admin) return refuse()

  /**
   * The page is `requireOnboardedAdmin()`, which sends an operator who has not
   * finished setup back to finish it. That guard redirects, which this route
   * must not do, so the rule is restated as a refusal rather than skipped.
   * Skipping it would leave a surface reachable directly that is unreachable
   * through the screen it belongs to.
   */
  if (admin.role === 'OPERATOR') {
    const snapshot = await readOnboardingSnapshot(admin.id)
    if (!isOnboardingComplete(snapshot)) return refuse()
  }

  const { offerId } = await context.params
  const recipient = await loadPreviewRecipient(offerId)
  if (!recipient) return refuse()

  const kind = kindSchema.parse(new URL(request.url).searchParams.get('kind') ?? undefined)
  const outcome = await renderPreview(recipient, kind)

  /**
   * Logged as its own event, and deliberately not as a second `email.previewed`.
   *
   * Opening the page writes `email.previewed`; the frame it draws fetches this
   * route and writes `email.body_served`. Two rows for one screen, because two
   * reads happened — and because this route can be fetched **without** the page,
   * by an administrator with the URL. Folding it into the page's event would
   * leave a direct read of an investor's correspondence unrecorded, which is the
   * one thing §16 is for. The two names are distinct so that the log stays
   * readable rather than appearing to double-count.
   *
   * The refusals above are not audited here: none of them reaches a record, and
   * `requireRole` already logs `access.refused` for the case that matters.
   */
  await auditPreviewRead(admin, recipient, kind, outcome, 'email.body_served')

  // Nothing to serve. The page renders no frame in these states, so this is
  // reachable only by a direct fetch — and it answers the same as any other
  // refusal rather than explaining what is unresolved to a caller who has not
  // asked through the screen that explains it properly.
  if (outcome.status !== 'RENDERED') return refuse()

  return new Response(outcome.email.html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      /**
       * Never stored. This is one named individual's correspondence, rendered
       * with their address and the amount they are being offered, and a copy of
       * it in a shared cache or on disk is a copy nobody decided to make.
       */
      'Cache-Control': 'no-store, no-cache, must-revalidate, private',
      'X-Robots-Tag': 'noindex, nofollow, noarchive, nosnippet',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
    },
  })
}
