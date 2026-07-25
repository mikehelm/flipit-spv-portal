import { NextResponse, type NextRequest } from 'next/server'
import { redeemAdminSetupLink } from '@/lib/auth/bootstrap'
import { env } from '@/lib/env'

/**
 * Redeems a one-time administrator setup link. BUILD_SPEC §2.2, "First run".
 *
 * The link is minted on the server console, never by an unauthenticated
 * request — there is no POST here that would issue one. Redeeming is a GET
 * because the link is opened from a console or a message, which is the same
 * shape as the investor claim link in §4.1.
 *
 * Failure is a bare redirect with a generic code. An expired link, a revoked
 * one and an invented one are indistinguishable from outside.
 */
export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get('token') ?? ''
  const result = await redeemAdminSetupLink(token)

  const base = env().APP_URL.replace(/\/+$/, '')
  const destination = result.ok ? `${base}/admin` : `${base}/signin?error=SetupLink`

  return NextResponse.redirect(destination)
}
