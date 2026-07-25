import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  REMINDER_HOUR_UTC,
  isDue,
  isStale,
  planReminders,
  subtractDays,
} from './schedule'

/** BUILD_SPEC §6.5 — the default 7 and 2 days before the deadline. */

const NOW = new Date('2026-07-01T00:00:00Z')

describe('date arithmetic', () => {
  it('subtracts days across a month boundary', () => {
    expect(subtractDays('2026-08-03', 7)).toBe('2026-07-27')
  })

  it('subtracts days across a year boundary', () => {
    expect(subtractDays('2027-01-02', 7)).toBe('2026-12-26')
  })

  it('handles a leap day', () => {
    expect(subtractDays('2028-03-01', 1)).toBe('2028-02-29')
  })
})

describe('the default schedule', () => {
  it('plans seven days and two days before, in that order', () => {
    const planned = planReminders({
      responseDeadline: '2026-08-10',
      daysBefore: [7, 2],
      maxPerRecipient: 2,
      now: NOW,
    })

    expect(planned.map((row) => row.daysBefore)).toEqual([7, 2])
    expect(planned.map((row) => row.sequence)).toEqual([1, 2])
    expect(planned[0]!.scheduledFor.toISOString()).toBe(
      `2026-08-03T${String(REMINDER_HOUR_UTC).padStart(2, '0')}:00:00.000Z`,
    )
    expect(planned[1]!.scheduledFor.toISOString()).toBe(
      `2026-08-08T${String(REMINDER_HOUR_UTC).padStart(2, '0')}:00:00.000Z`,
    )
  })

  it('produces the same plan whatever order the days are given in', () => {
    const a = planReminders({
      responseDeadline: '2026-08-10',
      daysBefore: [2, 7],
      maxPerRecipient: 2,
      now: NOW,
    })
    const b = planReminders({
      responseDeadline: '2026-08-10',
      daysBefore: [7, 2],
      maxPerRecipient: 2,
      now: NOW,
    })
    expect(a).toEqual(b)
  })

  it('collapses a duplicated day', () => {
    const planned = planReminders({
      responseDeadline: '2026-08-10',
      daysBefore: [7, 7, 2],
      maxPerRecipient: 5,
      now: NOW,
    })
    expect(planned).toHaveLength(2)
  })
})

describe('the cap binds the plan, not just the send (§6.5)', () => {
  it('never plans more than the cap', () => {
    const planned = planReminders({
      responseDeadline: '2026-08-10',
      daysBefore: [14, 7, 2],
      maxPerRecipient: 2,
      now: NOW,
    })
    expect(planned).toHaveLength(2)
  })

  it('drops the ones nearest the deadline, keeping the last chance to respond', () => {
    const planned = planReminders({
      responseDeadline: '2026-08-10',
      daysBefore: [14, 7, 2],
      maxPerRecipient: 2,
      now: NOW,
    })
    expect(planned.map((row) => row.daysBefore)).toEqual([14, 7])
  })

  it('plans nothing at all when the cap is zero', () => {
    expect(
      planReminders({
        responseDeadline: '2026-08-10',
        daysBefore: [7, 2],
        maxPerRecipient: 0,
        now: NOW,
      }),
    ).toEqual([])
  })
})

describe('the past', () => {
  it('drops a reminder whose date has already gone', () => {
    const planned = planReminders({
      responseDeadline: '2026-07-05',
      daysBefore: [7, 2],
      maxPerRecipient: 2,
      now: NOW,
    })
    // Seven days before the fifth is 28 June, already past on 1 July.
    expect(planned.map((row) => row.daysBefore)).toEqual([2])
  })

  it('plans nothing when the deadline itself has passed', () => {
    expect(
      planReminders({
        responseDeadline: '2026-06-01',
        daysBefore: [7, 2],
        maxPerRecipient: 2,
        now: NOW,
      }),
    ).toEqual([])
  })

  it('ignores a negative or fractional day count', () => {
    const planned = planReminders({
      responseDeadline: '2026-08-10',
      daysBefore: [7, -3, 1.5],
      maxPerRecipient: 5,
      now: NOW,
    })
    expect(planned.map((row) => row.daysBefore)).toEqual([7])
  })
})

describe('due and stale', () => {
  const at = new Date('2026-08-03T09:00:00Z')

  it('is due at its scheduled minute and after', () => {
    expect(isDue(at, at)).toBe(true)
    expect(isDue(at, new Date('2026-08-03T10:00:00Z'))).toBe(true)
    expect(isDue(at, new Date('2026-08-03T08:59:00Z'))).toBe(false)
  })

  it('is not stale within two days', () => {
    expect(isStale(at, new Date('2026-08-04T09:00:00Z'))).toBe(false)
  })

  it('is stale after two days', () => {
    // A nudge about a deadline that has since moved closer reads as wrong.
    expect(isStale(at, new Date('2026-08-06T09:00:01Z'))).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Source-level rules
// ---------------------------------------------------------------------------

describe('the reminder modules obey the standing rules', () => {
  const DIR = join(process.cwd(), 'src/lib/reminders')

  function sources(): Array<{ name: string; source: string }> {
    return readdirSync(DIR)
      .filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'))
      .map((name) => ({
        name,
        source: readFileSync(join(DIR, name), 'utf8')
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .replace(/^\s*\/\/.*$/gm, ''),
      }))
  }

  it('reaches the transport through the one gated path only', () => {
    for (const { name, source } of sources()) {
      expect(source, name).not.toContain('new SmtpTransport')
      expect(source, name).not.toContain('getTransport(')
      expect(source, name).not.toContain('nodemailer')
      expect(source, name).not.toContain('sendOneEmail')
    }
  })

  it('loads the compliance context for REMINDER and never for INVITATION', () => {
    const run = sources().find((entry) => entry.name === 'run.ts')!.source
    expect(run).toContain("loadGateContext('REMINDER')")
    expect(run).not.toContain("loadGateContext('INVITATION')")
    expect(run).toContain("kind: 'REMINDER'")
  })

  it('never console-logs', () => {
    for (const { name, source } of sources()) {
      expect(source, name).not.toMatch(/console\.(log|info|warn|error|debug)/)
    }
  })

  it('handles no money or percentage at all', () => {
    for (const { name, source } of sources()) {
      expect(source, name).not.toContain('formatMoney')
      expect(source, name).not.toContain('formatPercentage')
      expect(source, `${name} uses parseFloat`).not.toContain('parseFloat')
      expect(source, `${name} uses .toNumber(`).not.toContain('.toNumber(')
    }
  })

  it('has no send path that skips the eligibility re-check', () => {
    const run = sources().find((entry) => entry.name === 'run.ts')!.source
    const sendOneStart = run.indexOf('export async function sendOne(')
    const sendOneEnd = run.indexOf('async function skip(')
    const body = run.slice(sendOneStart, sendOneEnd)

    // The eligibility check must come before the call that sends.
    const checkAt = body.indexOf('eligibility.eligible')
    const sendAt = body.indexOf('sendInvitation(')
    expect(checkAt).toBeGreaterThan(-1)
    expect(sendAt).toBeGreaterThan(checkAt)
  })
})
