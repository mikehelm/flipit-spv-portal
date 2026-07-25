import { NextResponse, type NextRequest } from 'next/server'
import { claimPortalToken } from '@/lib/portal/claim'
import { createInvestorSession } from '@/lib/portal/session'
import { env } from '@/lib/env'

/**
 * Redeeming an emailed portal link. BUILD_SPEC §4.1.
 *
 * A **route handler**, not a page, and the reason is not stylistic: claiming
 * establishes a session, and Next only permits a cookie to be set from a route
 * handler or a server action. As a server component this threw at runtime on
 * every single claim — which no amount of testing the claim *function* would
 * have caught, because the function was never the broken part.
 *
 * The URL is unchanged, because it is the URL embedded in every invitation
 * already sent and printed on the anti-phishing page. It is the same shape as
 * the administrator setup link, which is a route handler for the same reason.
 *
 * A GET, because the link is opened from an email — opening it is what proves
 * control of the mailbox. Single use is enforced inside `claimPortalToken`.
 *
 * Every failure redirects to one page with one message. An unknown token, a
 * spent one, an expired one and one belonging to a suspended account are
 * indistinguishable from outside.
 */
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ token: string }> },
) {
  const { token } = await context.params
  const result = await claimPortalToken(decodeURIComponent(token))

  const base = env().APP_URL.replace(/\/+$/, '')

  if (!result.ok) {
    return NextResponse.redirect(`${base}/portal/link-not-valid`)
  }

  await createInvestorSession(result.accountId)
  return NextResponse.redirect(`${base}/portal`)
}
