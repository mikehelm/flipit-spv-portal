import { NextResponse, type NextRequest } from 'next/server'
import { redeemDevelopmentOperatorLoginLink } from '@/lib/auth/development-login'

export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  const candidate = request.nextUrl.searchParams.get('token') ?? ''
  const accepted = await redeemDevelopmentOperatorLoginLink(candidate)
  const destination = accepted ? '/admin' : '/signin?error=DevelopmentLink'
  return NextResponse.redirect(new URL(destination, request.nextUrl.origin))
}
