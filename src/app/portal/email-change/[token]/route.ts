import { NextResponse, after, type NextRequest } from 'next/server'
import { confirmEmailChange } from '@/lib/portal/email-change'
import { notifyPreviousAddress } from '@/lib/portal/send-email-change-link'
import { env } from '@/lib/env'

/**
 * Redeeming a contact-address confirmation link. BUILD_SPEC §13.
 *
 * A **route handler**, not a page, for the same reason the claim route is one:
 * this is a link opened from an email and it performs a write. A server
 * component that mutated on render would run again on a prefetch and again on a
 * refresh.
 *
 * **It establishes no session**, and that is the difference between this and
 * the claim route. A sign-in link proves mailbox control in order to hand over
 * a session; this one proves mailbox control in order to record an address. If
 * it did both, an address-change confirmation would be a second, quieter way
 * into somebody's portal — and the mailbox it lands in is by definition one
 * this application has not previously trusted.
 *
 * Every failure — unknown token, spent, expired, revoked, account suspended
 * since it was sent, address taken in the meantime — redirects to the one page
 * with the one message. They are indistinguishable from outside.
 */
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ token: string }> },
) {
  const { token } = await context.params
  const result = await confirmEmailChange(decodeURIComponent(token))

  const base = env().APP_URL.replace(/\/+$/, '')

  if (!result.ok) {
    return NextResponse.redirect(`${base}/portal/link-not-valid`)
  }

  // The old mailbox is told, after the response has gone. The person who just
  // confirmed should not wait on an SMTP round trip, and the notice is not for
  // them anyway — it is for whoever still holds the address that was replaced.
  const requestId = result.requestId
  after(async () => {
    await notifyPreviousAddress(requestId)
  })

  return NextResponse.redirect(`${base}/portal/email-confirmed`)
}
