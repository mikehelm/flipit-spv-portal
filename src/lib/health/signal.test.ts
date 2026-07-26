import { describe, expect, it } from 'vitest'
import type { HealthReport } from './report'
import type { Finding, Severity } from './rules'
import {
  HEALTH_TOKEN_HEADER,
  healthTokenAccepted,
  signalStatusCode,
  summariseHealth,
  unavailableSignal,
} from './signal'

/**
 * The reduction from a health report to something a monitor can be pointed at.
 *
 * Two things are being pinned here and only one of them is obvious. The obvious
 * one is the status code: 503 when something needs a person, 200 when nothing
 * does, and 200 for the findings that are decisions rather than faults — a
 * monitor that pages during a deliberate read-only week is a monitor that gets
 * muted, and a muted monitor is worse than none because somebody believes it is
 * watching.
 *
 * The one that matters more is what the payload may contain. This endpoint sits
 * behind a shared secret held by a third-party monitoring service, which is a
 * weaker thing than a session, and the body ends up in that service's alert
 * history and in a push notification on somebody's lock screen. So: areas,
 * severities and counts. No headline, no detail, no remedy, no id, no address.
 * Every one of those is asserted below against a report deliberately stuffed
 * with them.
 */

const AT = new Date('2026-07-25T09:00:00.000Z')

function finding(over: Partial<Finding> & { severity: Severity }): Finding {
  return {
    area: 'Reminders',
    headline: 'A reminder was taken and never sent',
    detail: 'Reminder 6f0a1c2d-3e4f-5a6b-7c8d-9e0f1a2b3c4d has been claimed for 5 hours.',
    remedy: 'Open the reminder queue and release it.',
    ...over,
  }
}

function report(findings: Finding[]): HealthReport {
  const worst: Severity = findings.some((row) => row.severity === 'WRONG')
    ? 'WRONG'
    : findings.some((row) => row.severity === 'ATTENTION')
      ? 'ATTENTION'
      : 'OK'
  return { at: AT, findings, worst }
}

// ---------------------------------------------------------------------------
// The status word
// ---------------------------------------------------------------------------

describe('the status word', () => {
  it('is ok when every finding is fine', () => {
    const signal = summariseHealth(report([finding({ severity: 'OK' }), finding({ severity: 'OK' })]))
    expect(signal.status).toBe('ok')
  })

  it('is attention when the worst finding is a decision somebody made', () => {
    const signal = summariseHealth(
      report([finding({ severity: 'OK' }), finding({ severity: 'ATTENTION', area: 'Service mode' })]),
    )
    expect(signal.status).toBe('attention')
  })

  it('is wrong when anything needs a person, however much else is fine', () => {
    const signal = summariseHealth(
      report([
        finding({ severity: 'OK' }),
        finding({ severity: 'ATTENTION' }),
        finding({ severity: 'WRONG' }),
      ]),
    )
    expect(signal.status).toBe('wrong')
  })

  it('follows the report rather than recomputing it', () => {
    // If the two ever disagree the report is right — it is the same value the
    // command exits on and the page renders from.
    const inconsistent: HealthReport = { at: AT, findings: [finding({ severity: 'OK' })], worst: 'WRONG' }
    expect(summariseHealth(inconsistent).status).toBe('wrong')
  })
})

describe('unavailable', () => {
  it('is its own word rather than being folded into wrong', () => {
    // "wrong" is a claim about the system made after looking at it. Saying it
    // when nothing could be looked at would be the exact lie this whole report
    // exists to prevent.
    expect(unavailableSignal().status).toBe('unavailable')
  })

  it('carries no timestamp, because there was no reading', () => {
    expect(unavailableSignal().at).toBeNull()
  })

  it('carries no counts that would read as "nothing wrong"', () => {
    const signal = unavailableSignal()
    expect(signal.areas).toEqual([])
    // Zeroes across the board are only safe because the status word is checked
    // first and the code is 503. Both are asserted.
    expect(signalStatusCode(signal.status)).toBe(503)
  })
})

// ---------------------------------------------------------------------------
// The status code — what actually pages somebody
// ---------------------------------------------------------------------------

describe('the status code', () => {
  it('is 200 when nothing needs a person', () => {
    expect(signalStatusCode('ok')).toBe(200)
  })

  it('is 200 for a decision somebody made', () => {
    // A non-active service mode and a testing deployment that correctly refuses
    // to send are both ATTENTION, and `pnpm check:health` exits 0 on them. A
    // monitor paging on those would page every night of a deliberate pause.
    expect(signalStatusCode('attention')).toBe(200)
  })

  it('is 503 when something needs a person', () => {
    expect(signalStatusCode('wrong')).toBe(503)
  })

  it('is 503 when the report could not be built', () => {
    expect(signalStatusCode('unavailable')).toBe(503)
  })

  it('is only ever one of those two', () => {
    const codes = (['ok', 'attention', 'wrong', 'unavailable'] as const).map(signalStatusCode)
    expect(new Set(codes)).toEqual(new Set([200, 503]))
  })
})

// ---------------------------------------------------------------------------
// What the payload may contain
// ---------------------------------------------------------------------------

describe('what the answer contains', () => {
  const stuffed = report([
    finding({
      severity: 'WRONG',
      area: 'Reminders',
      headline: 'A reminder was taken and never sent',
      detail: 'Reminder 6f0a1c2d-3e4f-5a6b-7c8d-9e0f1a2b3c4d, claimed 5 hours ago.',
      remedy: 'Release it from the reminder queue.',
    }),
    finding({
      severity: 'WRONG',
      area: 'Mail',
      headline: 'The mail connection was refused',
      detail: 'smtp.gmail.com rejected the app password for serenedavid@gmail.com.',
      remedy: 'Generate a new app password.',
    }),
    finding({ severity: 'ATTENTION', area: 'Service mode', headline: 'Read-only' }),
    finding({ severity: 'OK', area: 'Backups', headline: 'A backup ran last night' }),
  ])

  it('names the areas that are not fine, worst first', () => {
    expect(summariseHealth(stuffed).areas).toEqual([
      { area: 'Reminders', severity: 'WRONG' },
      { area: 'Mail', severity: 'WRONG' },
      { area: 'Service mode', severity: 'ATTENTION' },
    ])
  })

  it('leaves out the areas that are fine', () => {
    expect(summariseHealth(stuffed).areas.map((row) => row.area)).not.toContain('Backups')
  })

  it('counts everything, so "all well" is distinguishable from "failed to look"', () => {
    expect(summariseHealth(stuffed).counts).toEqual({ wrong: 2, attention: 1, ok: 1 })
  })

  it('names an area once however many findings it has', () => {
    const doubled = report([
      finding({ severity: 'WRONG', area: 'Reminders', headline: 'one' }),
      finding({ severity: 'WRONG', area: 'Reminders', headline: 'another' }),
    ])
    expect(summariseHealth(doubled).areas).toEqual([{ area: 'Reminders', severity: 'WRONG' }])
  })

  it('reports the worse severity when one area has both', () => {
    const mixed = report([
      finding({ severity: 'ATTENTION', area: 'Mail', headline: 'a note' }),
      finding({ severity: 'WRONG', area: 'Mail', headline: 'a fault' }),
    ])
    expect(summariseHealth(mixed).areas).toEqual([{ area: 'Mail', severity: 'WRONG' }])
  })

  it('carries no headline, detail, remedy, id or address anywhere in it', () => {
    // The assertion that matters. This body ends up in a third-party alert
    // history and on a lock screen.
    const serialised = JSON.stringify(summariseHealth(stuffed))

    expect(serialised).not.toContain('taken and never sent')
    expect(serialised).not.toContain('Release it')
    expect(serialised).not.toContain('6f0a1c2d')
    expect(serialised).not.toContain('serenedavid')
    expect(serialised).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.-]+/)
    expect(serialised).not.toContain('smtp.gmail.com')
  })

  it('has exactly the four fields, so a fifth has to be typed in deliberately', () => {
    expect(Object.keys(summariseHealth(stuffed)).sort()).toEqual(['areas', 'at', 'counts', 'status'])
  })

  it('gives each area exactly two fields, for the same reason', () => {
    const first = summariseHealth(stuffed).areas[0]!
    expect(Object.keys(first).sort()).toEqual(['area', 'severity'])
  })

  it('reports the time of the reading in UTC', () => {
    expect(summariseHealth(stuffed).at).toBe('2026-07-25T09:00:00.000Z')
  })
})

// ---------------------------------------------------------------------------
// The token
// ---------------------------------------------------------------------------

describe('the shared secret', () => {
  const TOKEN = 'a'.repeat(43)

  it('accepts the configured token', () => {
    expect(healthTokenAccepted(TOKEN, TOKEN)).toBe(true)
  })

  it('refuses a different one of the same length', () => {
    expect(healthTokenAccepted('b'.repeat(43), TOKEN)).toBe(false)
  })

  it('refuses a prefix of it', () => {
    expect(healthTokenAccepted(TOKEN.slice(0, 42), TOKEN)).toBe(false)
  })

  it('refuses it with something appended', () => {
    expect(healthTokenAccepted(`${TOKEN}x`, TOKEN)).toBe(false)
  })

  it('refuses a missing header', () => {
    expect(healthTokenAccepted(null, TOKEN)).toBe(false)
  })

  it('refuses an empty header', () => {
    expect(healthTokenAccepted('', TOKEN)).toBe(false)
  })

  it('refuses everything when no token is configured', () => {
    // The endpoint does not exist on a deployment that has not turned it on.
    expect(healthTokenAccepted('anything', '')).toBe(false)
    expect(healthTokenAccepted('', '')).toBe(false)
    expect(healthTokenAccepted(null, '')).toBe(false)
  })

  it('does not throw on a length mismatch', () => {
    // timingSafeEqual throws when the buffers differ in length, and catching
    // that throw would be a branch whose timing reveals the length. Digests are
    // compared instead, so every comparison is 32 bytes.
    expect(() => healthTokenAccepted('short', TOKEN)).not.toThrow()
    expect(() => healthTokenAccepted('x'.repeat(5000), TOKEN)).not.toThrow()
  })

  it('is read from a header rather than a query string', () => {
    // A query string is written to every access log between the monitor and
    // here, and a token in a log file is the credential rule broken by a
    // different route.
    expect(HEALTH_TOKEN_HEADER).toBe('x-health-token')
  })
})
