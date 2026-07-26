import { NextResponse, type NextRequest } from 'next/server'
import { buildHealthReport } from '@/lib/health/report'
import {
  HEALTH_TOKEN_HEADER,
  healthTokenAccepted,
  signalStatusCode,
  summariseHealth,
  unavailableSignal,
} from '@/lib/health/signal'
import { env } from '@/lib/env'

/**
 * `GET /api/health` — the one surface that reaches somebody without somebody
 * looking. BUILD_SPEC §6.5, §7, §8.1, §15, §18.1.
 *
 * The health report has three faces now and each answers a question the others
 * cannot. The admin page answers *what is wrong* for the person who would fix
 * it. `pnpm check:health` answers it in a log at three in the morning, for a
 * scheduler running on this machine. This one answers *is this deployment
 * alive and is anything wrong with it* for a machine that is not this machine
 * — which is the only vantage point from which "the box stopped" is visible at
 * all. A checker running on the box it watches reports nothing when the box is
 * the thing that failed.
 *
 * It is a poll rather than a push on purpose. Pushing would mean a second
 * unattended sender in an application whose reminder job is deliberately the
 * only one (§6.5, and the rule that every constraint on it is load-bearing).
 * An uptime monitor already knows how to page a person on a 503, and it is
 * somebody else's infrastructure staying up.
 *
 * Off unless configured, and indistinguishable from absent when it is off.
 * Without `HEALTH_TOKEN` the handler answers 404 to everything, before it looks
 * at the request and before it opens a database connection — so an unconfigured
 * deployment costs a scanner exactly what an invented path costs it, and learns
 * them the same nothing.
 *
 * Read-only, like the page and the command. It notices and it stops.
 */

export const runtime = 'nodejs'

/**
 * Never cached, at any layer.
 *
 * A cached health check is the specific failure of telling somebody everything
 * is fine because it was, which is worse than no check: it converts an outage
 * into a silence that looks deliberate.
 */
export const dynamic = 'force-dynamic'
export const revalidate = 0

/** The headers every answer carries, including the 404s. */
const HEADERS = {
  'Cache-Control': 'no-store, no-cache, must-revalidate',
  'X-Robots-Tag': 'noindex, nofollow, noarchive, nosnippet',
  'Content-Type': 'application/json; charset=utf-8',
} as const

/**
 * The answer to anybody without the token, and to everybody when there is no
 * token configured. Empty body, so the two are the same response byte for byte.
 */
function absent(): NextResponse {
  return new NextResponse(null, { status: 404, headers: HEADERS })
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!healthTokenAccepted(request.headers.get(HEALTH_TOKEN_HEADER), env().HEALTH_TOKEN)) {
    return absent()
  }

  let signal
  try {
    signal = summariseHealth(await buildHealthReport())
  } catch {
    // The error object is deliberately not logged. A Postgres failure carries
    // the connection string, and a connection string carries a password — and
    // the one rule with no exception in this build is that a credential never
    // reaches a log line. That this endpoint threw is the whole of what a log
    // needs; the 503 below is what actually tells somebody.
    console.error('health signal: the report could not be built')
    signal = unavailableSignal()
  }

  return NextResponse.json(signal, {
    status: signalStatusCode(signal.status),
    headers: HEADERS,
  })
}
