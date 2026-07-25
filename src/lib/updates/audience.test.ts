import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  ADDRESSABLE_STATUSES,
  decodeAudience,
  describeAudience,
  encodeAudience,
  isAddressable,
  statusesFor,
  type UpdateAudience,
} from './audience'

/**
 * BUILD_SPEC §6 — "all active investors, a filtered subset (by status), or a
 * single investor".
 */

describe('who an update can be addressed to', () => {
  it('never includes a suspended or archived account', () => {
    // §4.2 gives neither any portal access. A delivery row for an account that
    // cannot read is a record of a communication that did not happen.
    expect(isAddressable('SUSPENDED')).toBe(false)
    expect(isAddressable('ARCHIVED')).toBe(false)
    expect(ADDRESSABLE_STATUSES).not.toContain('SUSPENDED')
    expect(ADDRESSABLE_STATUSES).not.toContain('ARCHIVED')
  })

  it('includes invited, active and closed accounts', () => {
    expect(ADDRESSABLE_STATUSES).toEqual(['INVITED', 'ACTIVE', 'CLOSED'])
  })

  it('drops a suspended status even when a filter names it', () => {
    const audience: UpdateAudience = {
      kind: 'STATUS',
      statuses: ['ACTIVE', 'SUSPENDED', 'ARCHIVED'],
    }
    expect(statusesFor(audience)).toEqual(['ACTIVE'])
  })

  it('resolves ALL to the whole addressable set', () => {
    expect(statusesFor({ kind: 'ALL' })).toEqual(ADDRESSABLE_STATUSES)
  })

  it('resolves an empty filter to nothing rather than to everybody', () => {
    // The dangerous failure here is a filter that means "none" being read as
    // "all" and a targeted update going to the whole list.
    expect(statusesFor({ kind: 'STATUS', statuses: ['SUSPENDED'] })).toEqual([])
  })
})

describe('encoding the audience into one text column', () => {
  const cases: UpdateAudience[] = [
    { kind: 'ALL' },
    { kind: 'STATUS', statuses: ['ACTIVE', 'CLOSED'] },
    { kind: 'ONE', accountId: 'account-42' },
  ]

  it('round-trips every shape', () => {
    for (const audience of cases) {
      expect(decodeAudience(encodeAudience(audience))).toEqual(audience)
    }
  })

  it('falls back to ALL on an unreadable column rather than throwing', () => {
    // The delivery rows are the authority for who received a published update.
    // This value only ever describes the audience on screen, and a corrupt
    // column must not take down the page that would let somebody notice it.
    for (const bad of [null, '', 'not json', '{"kind":"NONSENSE"}', '{"kind":"ONE"}']) {
      expect(decodeAudience(bad), String(bad)).toEqual({ kind: 'ALL' })
    }
  })
})

describe('describing an audience to the operator', () => {
  it('names the single recipient when there is one', () => {
    expect(describeAudience({ kind: 'ONE', accountId: 'a' }, 'Jane Example')).toBe(
      'Jane Example only',
    )
  })

  it('does not invent a name when none was passed', () => {
    expect(describeAudience({ kind: 'ONE', accountId: 'a' })).toBe('One investor only')
  })

  it('lists the statuses', () => {
    expect(describeAudience({ kind: 'STATUS', statuses: ['ACTIVE', 'CLOSED'] })).toContain(
      'active or closed',
    )
  })
})

// ---------------------------------------------------------------------------
// Source-level rules
// ---------------------------------------------------------------------------

describe('the updates modules obey the standing rules', () => {
  const DIR = join(process.cwd(), 'src/lib/updates')

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

  it('has no bulk send (§14)', () => {
    for (const { name, source } of sources()) {
      expect(source, name).not.toMatch(/notifyAll|sendAll|sendMany|sendBatch|sendBulk|notifyEveryone/i)
    }
  })

  it('calls the transport through the one gated entry point only', () => {
    for (const { name, source } of sources()) {
      expect(source, name).not.toContain('new SmtpTransport')
      expect(source, name).not.toContain('getTransport(')
      expect(source, name).not.toContain('nodemailer')
    }
  })

  it('never console-logs', () => {
    for (const { name, source } of sources()) {
      expect(source, name).not.toMatch(/console\.(log|info|warn|error|debug)/)
    }
  })

  it('never coerces a value to a JavaScript number', () => {
    for (const { name, source } of sources()) {
      expect(source, `${name} uses parseFloat`).not.toContain('parseFloat')
      expect(source, `${name} uses parseInt`).not.toContain('parseInt')
      expect(source, `${name} uses .toNumber(`).not.toContain('.toNumber(')
      expect(source, `${name} uses Number(`).not.toMatch(/(?<!\.is)\bNumber\s*\(/)
    }
  })

  it('writes the title and body in exactly two places (§6 immutability)', () => {
    // `createDraft` and `editDraft`, and `editDraft` refuses a published row.
    // A third writer is how a published update becomes editable.
    const service = sources().find((entry) => entry.name === 'service.ts')!.source
    const bodyWriters = service.match(/^\s*body,\s*$/gm) ?? []
    expect(bodyWriters.length).toBeLessThanOrEqual(2)
  })

  it('never deletes a published update', () => {
    const service = sources().find((entry) => entry.name === 'service.ts')!.source
    const deletes = service.match(/db\.delete\(\w+\)/g) ?? []
    // One: discarding an unpublished draft. Withdrawal is an update, not a
    // delete, because a tombstone that deletes the evidence is not a tombstone.
    expect(deletes).toHaveLength(1)
    expect(service).toContain('db.delete(portalUpdates)')
  })
})
