import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DIGEST_CADENCE_DAYS, buildRoundDigest, digestDue } from './digest'
import type { RoundSummary } from './summary'

/**
 * BUILD_SPEC §6.6 — the deadline email, and the sentence the whole section
 * turns on: *"If David does nothing, nothing happens… Silence never closes
 * anyone's opportunity."*
 */

function summary(overrides: Partial<RoundSummary> = {}): RoundSummary {
  return {
    roundId: 'round-1',
    name: 'Flipit SPV — first round',
    openedAt: new Date('2026-07-01T00:00:00Z'),
    closedAt: null,
    totals: {
      proposed: '30,000.00',
      committed: '12,500.00',
      accepted: '12,500.00',
      received: '5,000.00',
      aggregate: '30,000.00',
      overCommitted: false,
    },
    participants: [
      {
        offerId: 'offer-1',
        accountId: 'account-1',
        name: 'Jane Example',
        email: 'jane@example.com',
        responseChoice: 'NO_RESPONSE',
        responseDeadline: '2026-08-01',
        originalDeadline: '2026-08-01',
        stage: 'INVITATION_SENT',
        emailStatus: 'SENT',
        blocked: false,
        accountStatus: 'ACTIVE',
        deadlineReached: true,
      },
    ],
    counts: {
      total: 4,
      responded: 3,
      notResponded: 1,
      interested: 2,
      notInterested: 1,
      askedAQuestion: 0,
      extended: 1,
      deadlineReached: 1,
      blocked: 0,
      notSent: 0,
    },
    nextDeadline: null,
    allDeadlinesPassed: true,
    ...overrides,
  }
}

describe('the digest says whose decision it is', () => {
  const message = buildRoundDigest(summary())

  it('states all three options and the fourth', () => {
    // §6.6: "close the round now, extend the deadline for everyone, or extend
    // it for named stragglers" — and doing nothing.
    expect(message.text).toContain('IT IS YOUR CALL')
    expect(message.text).toContain('close the round now')
    expect(message.text).toContain('extend the deadline for everyone')
    expect(message.text).toContain('extend it for named people')
    expect(message.text).toContain('If you do nothing, the round stays open')
  })

  it('says plainly that a deadline closes nothing', () => {
    expect(message.text).toContain("closes nobody's opportunity by itself")
    expect(message.html).toContain('closes nobody')
  })

  it('names the cadence it will chase on', () => {
    expect(message.text).toContain(`in ${DIGEST_CADENCE_DAYS} days`)
  })

  it('carries the counts §6.6 asks for', () => {
    expect(message.text).toContain('Responded:            3')
    expect(message.text).toContain('Not responded:        1')
    expect(message.text).toContain('Asked for more time:  1')
  })

  it('carries the totals against the aggregate', () => {
    // Money is USD throughout — the columns are named *_usd — and the digest
    // says so rather than leaving a bare figure to be read as anything.
    expect(message.text).toContain('USD 12,500.00 of USD 30,000.00')
    expect(message.text).toContain('USD 5,000.00')
  })

  it('names who has not responded, because it goes to the operator alone', () => {
    expect(message.text).toContain('Jane Example')
    expect(message.text).toContain('jane@example.com')
  })

  it('says it went to nobody else', () => {
    expect(message.text).toContain('went to you and to nobody else')
    expect(message.text).toContain('No investor has been told a deadline has passed')
  })

  it('says so honestly when everybody has answered', () => {
    const all = buildRoundDigest(
      summary({
        participants: [],
        counts: { ...summary().counts, notResponded: 0 },
      }),
    )
    expect(all.text).toContain('Everybody past their deadline has responded.')
  })

  it('has a text part carrying the same information as the HTML part', () => {
    for (const fragment of ['Jane Example', '12,500.00', 'YOUR CALL']) {
      expect(message.text.toUpperCase()).toContain(fragment.toUpperCase())
    }
    expect(message.html).toContain('Jane Example')
    expect(message.html).toContain('12,500.00')
  })
})

describe('when a digest is due', () => {
  const now = new Date('2026-08-02T09:00:00Z')

  it('is due when a deadline has been reached and none has been sent', () => {
    expect(digestDue({ summary: summary(), lastSentAt: null, now })).toBe(true)
  })

  it('is not due before any deadline is reached', () => {
    expect(
      digestDue({
        summary: summary({ counts: { ...summary().counts, deadlineReached: 0 } }),
        lastSentAt: null,
        now,
      }),
    ).toBe(false)
  })

  it('is never due for a closed round', () => {
    expect(
      digestDue({
        summary: summary({ closedAt: new Date('2026-08-01T00:00:00Z') }),
        lastSentAt: null,
        now,
      }),
    ).toBe(false)
  })

  it('waits the cadence before chasing again', () => {
    const yesterday = new Date('2026-08-01T09:00:00Z')
    expect(digestDue({ summary: summary(), lastSentAt: yesterday, now })).toBe(false)
  })

  it('chases again once the cadence has elapsed', () => {
    const longAgo = new Date('2026-07-20T09:00:00Z')
    expect(digestDue({ summary: summary(), lastSentAt: longAgo, now })).toBe(true)
  })

  it('is still due days after the deadline, not only on the day', () => {
    // A scheduler that misses a day must not mean the email never arrives.
    expect(
      digestDue({ summary: summary(), lastSentAt: null, now: new Date('2026-09-01T00:00:00Z') }),
    ).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Source-level rules
// ---------------------------------------------------------------------------

describe('nothing closes a round on its own (§6.6)', () => {
  const DIR = join(process.cwd(), 'src/lib/rounds')

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

  it('writes closedAt in exactly one function, and it takes a confirmation', () => {
    const close = sources().find((entry) => entry.name === 'close.ts')!.source

    const writes = (close.match(/closedAt:\s*now/g) ?? []).length
    expect(writes).toBe(1)
    expect(close).toContain('confirmed: boolean')
    expect(close).toContain('if (!input.confirmed)')
  })

  it('has no scheduled or date-triggered close anywhere', () => {
    for (const { name, source } of sources()) {
      expect(source, name).not.toMatch(/autoClose|closeIfDue|closeExpired|expireRound/i)
    }
  })

  it('the digest module sends and never closes', () => {
    const digest = sources().find((entry) => entry.name === 'digest.ts')!.source
    expect(digest).not.toContain('closedAt:')
    expect(digest).not.toContain('closeRound')
  })

  it('reaches the transport through the one gated path only', () => {
    for (const { name, source } of sources()) {
      expect(source, name).not.toContain('new SmtpTransport')
      expect(source, name).not.toContain('getTransport(')
      expect(source, name).not.toContain('nodemailer')
    }
  })

  it('never coerces a money value to a JavaScript number', () => {
    for (const { name, source } of sources()) {
      expect(source, `${name} uses parseFloat`).not.toContain('parseFloat')
      expect(source, `${name} uses .toNumber(`).not.toContain('.toNumber(')
      expect(source, `${name} uses Number(`).not.toMatch(/(?<!\.is)\bNumber\s*\(/)
    }
  })

  it('never console-logs', () => {
    for (const { name, source } of sources()) {
      expect(source, name).not.toMatch(/console\.(log|info|warn|error|debug)/)
    }
  })
})
