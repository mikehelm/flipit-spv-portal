import { NextResponse } from 'next/server'
import { z } from 'zod'
import { currentIdentity } from '@/lib/auth/guards'
import {
  DAVID_EMAIL,
  recordUsabilitySignal,
} from '@/lib/usability'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

const inputSchema = z
  .object({
    pagePath: z.string().min(1).max(300),
    durationMs: z.number().int().min(0).max(5 * 60 * 1000),
    clickCount: z.number().int().min(0).max(500),
    rapidClickCount: z.number().int().min(0).max(100),
    browserErrorCount: z.number().int().min(0).max(100),
  })
  .strict()

const HEADERS = {
  'Cache-Control': 'no-store, no-cache, must-revalidate',
  'X-Robots-Tag': 'noindex, nofollow, noarchive, nosnippet',
} as const

/**
 * Records David's coarse, disclosed usability counters. Nobody else is
 * tracked, even if another operator is added later.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const identity = await currentIdentity()
  if (!identity) {
    return NextResponse.json({ ok: false }, { status: 401, headers: HEADERS })
  }
  if (
    identity.role !== 'OPERATOR' ||
    identity.email.toLowerCase() !== DAVID_EMAIL
  ) {
    return new NextResponse(null, { status: 204, headers: HEADERS })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ ok: false }, { status: 400, headers: HEADERS })
  }
  const parsed = inputSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ ok: false }, { status: 400, headers: HEADERS })
  }

  await recordUsabilitySignal({
    actorUserId: identity.id,
    ...parsed.data,
  })
  return NextResponse.json({ ok: true }, { headers: HEADERS })
}
