import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  BAND_ORDER,
  computeOrder,
  hasUsableOverride,
  orderRegister,
  type RegisterCandidate,
} from './order'

/**
 * BUILD_SPEC §5.2.2 — the computed order, and the override that needs a reason.
 */

function candidate(overrides: Partial<RegisterCandidate> = {}): RegisterCandidate {
  return {
    accountId: 'account-1',
    joinedAt: new Date('2026-07-01T00:00:00Z'),
    fundsValueDate: null,
    commitmentAgreedAt: null,
    operatorOrderOverride: null,
    overrideReason: null,
    ...overrides,
  }
}

const ids = (rows: Array<{ accountId: string }>) => rows.map((row) => row.accountId)

// ---------------------------------------------------------------------------
// The three bands
// ---------------------------------------------------------------------------

describe('the three bands, in the specified order', () => {
  it('puts settled funds first, then commitments, then everyone else', () => {
    const settled = candidate({ accountId: 'settled', fundsValueDate: '2026-07-20' })
    const committed = candidate({
      accountId: 'committed',
      commitmentAgreedAt: new Date('2026-07-02T00:00:00Z'),
    })
    const plain = candidate({ accountId: 'plain', joinedAt: new Date('2026-06-01T00:00:00Z') })

    expect(ids(computeOrder([plain, committed, settled]))).toEqual([
      'settled',
      'committed',
      'plain',
    ])
  })

  it('does not let an early joiner overtake somebody who has settled', () => {
    // "Joining the register does not itself create a position; completing your
    // current participation does." (§5.2.1)
    const eager = candidate({ accountId: 'eager', joinedAt: new Date('2026-01-01T00:00:00Z') })
    const settled = candidate({
      accountId: 'settled',
      joinedAt: new Date('2026-07-24T00:00:00Z'),
      fundsValueDate: '2026-07-24',
    })

    expect(ids(computeOrder([eager, settled]))[0]).toBe('settled')
  })

  it('orders settled investors by value date, earliest first', () => {
    const rows = [
      candidate({ accountId: 'later', fundsValueDate: '2026-07-20' }),
      candidate({ accountId: 'earlier', fundsValueDate: '2026-07-02' }),
      candidate({ accountId: 'middle', fundsValueDate: '2026-07-11' }),
    ]
    expect(ids(computeOrder(rows))).toEqual(['earlier', 'middle', 'later'])
  })

  it('orders committed investors by commitment date', () => {
    const rows = [
      candidate({
        accountId: 'later',
        commitmentAgreedAt: new Date('2026-07-20T00:00:00Z'),
      }),
      candidate({
        accountId: 'earlier',
        commitmentAgreedAt: new Date('2026-07-02T00:00:00Z'),
      }),
    ]
    expect(ids(computeOrder(rows))).toEqual(['earlier', 'later'])
  })

  it('orders everyone else by the date they joined the register', () => {
    const rows = [
      candidate({ accountId: 'b', joinedAt: new Date('2026-07-10T00:00:00Z') }),
      candidate({ accountId: 'a', joinedAt: new Date('2026-07-01T00:00:00Z') }),
    ]
    expect(ids(computeOrder(rows))).toEqual(['a', 'b'])
  })

  it('treats somebody with both funds and a commitment as settled', () => {
    const both = candidate({
      accountId: 'both',
      fundsValueDate: '2026-07-20',
      commitmentAgreedAt: new Date('2026-07-01T00:00:00Z'),
    })
    const committedEarlier = candidate({
      accountId: 'committed',
      commitmentAgreedAt: new Date('2026-06-01T00:00:00Z'),
    })
    expect(ids(computeOrder([committedEarlier, both]))).toEqual(['both', 'committed'])
  })

  it('is total and stable — identical inputs never shuffle', () => {
    const rows = [
      candidate({ accountId: 'b' }),
      candidate({ accountId: 'a' }),
      candidate({ accountId: 'c' }),
    ]
    expect(ids(computeOrder(rows))).toEqual(ids(computeOrder(rows)))
    expect(ids(computeOrder(rows))).toEqual(['a', 'b', 'c'])
  })

  it('handles an empty register', () => {
    expect(computeOrder([])).toEqual([])
    expect(orderRegister([])).toEqual([])
  })

  it('declares exactly the three bands the spec names', () => {
    expect(BAND_ORDER).toEqual(['FUNDS_RECEIVED', 'COMMITMENT_AGREED', 'ON_THE_REGISTER'])
  })
})

// ---------------------------------------------------------------------------
// Overrides
// ---------------------------------------------------------------------------

describe('an override needs a recorded reason (§5.2.2)', () => {
  it('is ignored when no reason was recorded', () => {
    expect(
      hasUsableOverride({ operatorOrderOverride: 1, overrideReason: null }),
    ).toBe(false)
    expect(
      hasUsableOverride({ operatorOrderOverride: 1, overrideReason: '   ' }),
    ).toBe(false)
  })

  it('is ignored when the position is absent or nonsense', () => {
    expect(hasUsableOverride({ operatorOrderOverride: null, overrideReason: 'a reason' })).toBe(
      false,
    )
    expect(hasUsableOverride({ operatorOrderOverride: 0, overrideReason: 'a reason' })).toBe(false)
    expect(hasUsableOverride({ operatorOrderOverride: -3, overrideReason: 'a reason' })).toBe(
      false,
    )
  })

  it('does not move anybody when the reason is missing', () => {
    // The rule lives in the ordering, not only in the form that sets it. A row
    // written directly into the database with a position and no reason must
    // still not jump the queue.
    const rows = [
      candidate({ accountId: 'settled', fundsValueDate: '2026-07-01' }),
      candidate({
        accountId: 'sneaky',
        operatorOrderOverride: 1,
        overrideReason: null,
      }),
    ]
    expect(ids(orderRegister(rows))).toEqual(['settled', 'sneaky'])
  })

  it('moves somebody up when a reason was recorded', () => {
    const rows = [
      candidate({ accountId: 'settled', fundsValueDate: '2026-07-01' }),
      candidate({
        accountId: 'moved',
        operatorOrderOverride: 1,
        overrideReason: 'Agreed with the owner on the call of 24 July.',
      }),
    ]
    const ordered = orderRegister(rows)
    expect(ids(ordered)).toEqual(['moved', 'settled'])
    expect(ordered[0]!.overridden).toBe(true)
    expect(ordered[0]!.overrideReason).toContain('24 July')
  })

  it('moves somebody down as well as up', () => {
    const rows = [
      candidate({ accountId: 'settled', fundsValueDate: '2026-07-01' }),
      candidate({ accountId: 'plain-a', joinedAt: new Date('2026-07-02T00:00:00Z') }),
      candidate({ accountId: 'plain-b', joinedAt: new Date('2026-07-03T00:00:00Z') }),
    ]
    rows[0] = { ...rows[0]!, operatorOrderOverride: 3, overrideReason: 'Stood themselves down.' }

    expect(ids(orderRegister(rows))).toEqual(['plain-a', 'plain-b', 'settled'])
  })

  it('records where the computation alone would have put them', () => {
    const rows = [
      candidate({ accountId: 'settled', fundsValueDate: '2026-07-01' }),
      candidate({
        accountId: 'moved',
        operatorOrderOverride: 1,
        overrideReason: 'A recorded reason.',
      }),
    ]
    const moved = orderRegister(rows).find((row) => row.accountId === 'moved')!
    expect(moved.position).toBe(1)
    expect(moved.computedPosition).toBe(2)
  })

  it('still produces a list when two people are both moved to first', () => {
    const rows = [
      candidate({ accountId: 'a', operatorOrderOverride: 1, overrideReason: 'Reason one.' }),
      candidate({ accountId: 'b', operatorOrderOverride: 1, overrideReason: 'Reason two.' }),
      candidate({ accountId: 'c' }),
    ]
    const ordered = orderRegister(rows)
    expect(ordered).toHaveLength(3)
    expect(new Set(ids(ordered)).size).toBe(3)
    expect(ordered.map((row) => row.position)).toEqual([1, 2, 3])
  })

  it('clamps a position past the end of the list to the end', () => {
    const rows = [
      candidate({ accountId: 'a' }),
      candidate({ accountId: 'b', operatorOrderOverride: 99, overrideReason: 'Way down.' }),
    ]
    expect(ids(orderRegister(rows))).toEqual(['a', 'b'])
  })

  it('never loses or duplicates anybody, whatever the overrides say', () => {
    const rows: RegisterCandidate[] = [
      candidate({ accountId: 'a', fundsValueDate: '2026-07-01' }),
      candidate({ accountId: 'b', operatorOrderOverride: 2, overrideReason: 'Reason.' }),
      candidate({ accountId: 'c', operatorOrderOverride: 2, overrideReason: 'Reason.' }),
      candidate({ accountId: 'd', operatorOrderOverride: 100, overrideReason: 'Reason.' }),
      candidate({ accountId: 'e' }),
    ]
    const ordered = orderRegister(rows)
    expect(ordered).toHaveLength(rows.length)
    expect(new Set(ids(ordered))).toEqual(new Set(['a', 'b', 'c', 'd', 'e']))
    expect(ordered.map((row) => row.position)).toEqual([1, 2, 3, 4, 5])
  })
})

// ---------------------------------------------------------------------------
// Source-level rules
// ---------------------------------------------------------------------------

describe('no money or percentage becomes a JavaScript number (checklist 1)', () => {
  const REGISTER_DIR = join(process.cwd(), 'src/lib/register')

  function withoutComments(source: string): string {
    return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  }

  it('never coerces a value anywhere in the register modules', () => {
    const files = readdirSync(REGISTER_DIR).filter(
      (name) => name.endsWith('.ts') && !name.endsWith('.test.ts'),
    )

    for (const name of files) {
      const code = withoutComments(readFileSync(join(REGISTER_DIR, name), 'utf8'))
      expect(code, `${name} uses parseFloat`).not.toContain('parseFloat')
      expect(code, `${name} uses parseInt`).not.toContain('parseInt')
      expect(code, `${name} uses .toNumber(`).not.toContain('.toNumber(')
      expect(code, `${name} uses Intl.NumberFormat`).not.toContain('Intl.NumberFormat')

      // `Number.isInteger` on a POSITION is a count of places in a list, not a
      // value — the check is that no VALUE is coerced with `Number(`.
      expect(code, `${name} uses Number(`).not.toMatch(/(?<!\.is)\bNumber\s*\(/)
    }
  })
})
