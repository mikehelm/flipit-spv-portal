/**
 * The health report, reduced to something a machine outside the deployment can
 * poll. BUILD_SPEC §6.5, §7, §8.1, §18.1.
 *
 * Every previous piece of this work ends in the same sentence: *nothing still
 * tells anybody without somebody looking.* `pnpm check:health` exits non-zero,
 * the admin health page lists the findings, the overview carries a banner — and
 * all three need either a person opening a screen or a scheduler already
 * running on the box. The failure they exist for is the one where the box is
 * the thing that stopped, and a check that runs on the machine it is watching
 * cannot report that machine being down.
 *
 * So this is the same report, shaped for an uptime monitor: a URL somebody
 * else's infrastructure asks for every few minutes, answering 200 when nothing
 * needs a person and 503 when something does. The monitor already knows how to
 * page somebody on a 503, which is the whole point — it means no second
 * unattended sender in this application. The reminder job stays the only thing
 * here that sends without being asked.
 *
 * **What the answer may contain.** Area names, severities and counts. Not a
 * headline, not a detail, not a remedy, not an id, and no address. The health
 * page shows all of those because it is behind a session; this is behind a
 * shared secret held by a third-party monitoring service, which is a weaker
 * thing, and the payload is sized to that. `describeAreas` made the same
 * judgement for the overview banner for the same reason: an area is one of a
 * fixed handful of words and there is nothing in it that could be about a
 * person.
 *
 * Nothing here reads a database or a request. The route composes this with
 * `buildHealthReport`; everything below is a function of its argument.
 */

import { createHash, timingSafeEqual } from 'node:crypto'
import type { HealthReport } from './report'
import type { Severity } from './rules'

/**
 * What a monitor is told, in one word.
 *
 * The first three mirror `Severity`. `unavailable` is the fourth case and has
 * no equivalent in the report, because it is the case where there is no report
 * — the database was unreachable, or a rule threw. It is deliberately not
 * folded into `wrong`: `wrong` is a claim about the system, made after looking,
 * and saying it when nothing could be looked at would be a lie of exactly the
 * kind this file exists to prevent. Both page somebody. Only one of them is
 * honest about what is known.
 */
export type SignalStatus = 'ok' | 'attention' | 'wrong' | 'unavailable'

/** The area of one finding that is not fine, and how not fine it is. */
export interface SignalArea {
  area: string
  severity: Extract<Severity, 'ATTENTION' | 'WRONG'>
}

export interface HealthSignal {
  status: SignalStatus
  /** When the report was taken, ISO-8601 UTC. Absent when there is no report. */
  at: string | null
  counts: { wrong: number; attention: number; ok: number }
  /**
   * The areas that are not fine, worst first, deduplicated.
   *
   * Fine areas are left out. This is not the health page's argument — that
   * listing what was checked distinguishes "all well" from "failed to look" —
   * because here the counts already make that distinction, and a monitor's
   * alert body is read on a phone at three in the morning.
   */
  areas: SignalArea[]
}

const STATUS_OF: Record<Severity, SignalStatus> = {
  OK: 'ok',
  ATTENTION: 'attention',
  WRONG: 'wrong',
}

/**
 * The report, reduced.
 *
 * Built field by field from the findings rather than by spreading them, so a
 * field added to `Finding` later — one carrying a reminder id, say, which is
 * exactly what the health page shows and the banner does not — cannot arrive
 * here by inheritance. It would have to be typed in.
 */
export function summariseHealth(report: HealthReport): HealthSignal {
  const counts = {
    wrong: report.findings.filter((finding) => finding.severity === 'WRONG').length,
    attention: report.findings.filter((finding) => finding.severity === 'ATTENTION').length,
    ok: report.findings.filter((finding) => finding.severity === 'OK').length,
  }

  const seen = new Set<string>()
  const areas: SignalArea[] = []

  for (const severity of ['WRONG', 'ATTENTION'] as const) {
    for (const finding of report.findings) {
      if (finding.severity !== severity) continue
      if (seen.has(finding.area)) continue
      seen.add(finding.area)
      areas.push({ area: finding.area, severity })
    }
  }

  return {
    status: STATUS_OF[report.worst],
    at: report.at.toISOString(),
    counts,
    areas,
  }
}

/** The answer when the report itself could not be built. */
export function unavailableSignal(): HealthSignal {
  return { status: 'unavailable', at: null, counts: { wrong: 0, attention: 0, ok: 0 }, areas: [] }
}

/**
 * 200 or 503, and nothing in between.
 *
 * `attention` is 200 on purpose. Those findings are decisions somebody made — a
 * non-active service mode, a testing deployment correctly refusing to send —
 * and the command already treats them as exit 0. A monitor that paged on them
 * would page every night of a deliberate read-only period, and a monitor that
 * pages when nothing is wrong is one that gets muted.
 */
export function signalStatusCode(status: SignalStatus): 200 | 503 {
  return status === 'ok' || status === 'attention' ? 200 : 503
}

/**
 * Does the presented token match the configured one?
 *
 * Compared over SHA-256 digests rather than the raw strings, which makes the
 * comparison both fixed-length — `timingSafeEqual` throws on a length mismatch,
 * and catching that throw would itself leak the length — and constant-time in
 * the bytes. The same shape as the sign-in form's timing work, for the same
 * reason: this is an unauthenticated endpoint on the open internet.
 *
 * An unconfigured token is never a match, including against an empty header.
 * A deployment that has not set one has no health endpoint at all, rather than
 * one anybody can read.
 */
export function healthTokenAccepted(presented: string | null, configured: string): boolean {
  if (configured === '') return false
  if (presented === null || presented === '') return false

  const a = createHash('sha256').update(presented, 'utf8').digest()
  const b = createHash('sha256').update(configured, 'utf8').digest()

  return timingSafeEqual(a, b)
}

/**
 * The header the token is read from.
 *
 * A header rather than a query parameter, because a query string is written to
 * every access log between the monitor and here, and a token in a log file is
 * the credential rule broken by a different route. Every monitoring service
 * that is worth pointing at this can set a request header.
 */
export const HEALTH_TOKEN_HEADER = 'x-health-token'
