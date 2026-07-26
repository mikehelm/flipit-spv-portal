import { describe, expect, it } from 'vitest'
import type { PortalNotice } from './access'
import { CONTACT_COPY, portalContacts, type PortalContactInput } from './contact'

/**
 * The contact route on a notice. BUILD_SPEC §4.2, §7.
 *
 * The defect this closes: every notice ended "please contact David" and none of
 * them carried an address, to a reader who has just been locked out of the only
 * page that ever named him. So the assertions come in two kinds — that the
 * right address appears in the right state, and that an address which has
 * stopped being read is never offered as though it had not.
 */

const OPERATOR = 'serenedavid@gmail.com'
const STANDING = 'records@flipit.com'

function input(over: Partial<PortalContactInput> & { notice: PortalNotice }): PortalContactInput {
  return { operatorEmail: OPERATOR, serviceContactEmail: STANDING, ...over }
}

const WHILE_RUNNING: PortalNotice[] = ['SUSPENDED', 'CLOSED']
const WHILE_ENDING: PortalNotice[] = ['SUNSET', 'SERVICE_CLOSED', 'ARCHIVED']

describe('while the portal is still running', () => {
  it.each(WHILE_RUNNING)('%s leads with the operator', (notice) => {
    expect(portalContacts(input({ notice }))[0]).toEqual({ address: OPERATOR, use: 'PRIMARY' })
  })

  it.each(WHILE_RUNNING)('%s offers the standing address underneath', (notice) => {
    // Open Decision 7. Being suspended by a person and being unable to reach
    // that person are the same experience from outside.
    expect(portalContacts(input({ notice }))[1]).toEqual({ address: STANDING, use: 'FALLBACK' })
  })

  it('falls back to the standing address when there is no operator address', () => {
    expect(portalContacts(input({ notice: 'SUSPENDED', operatorEmail: null }))).toEqual([
      { address: STANDING, use: 'PRIMARY' },
    ])
  })

  it('shows one address when both settings hold the same one', () => {
    expect(portalContacts(input({ notice: 'SUSPENDED', serviceContactEmail: OPERATOR }))).toEqual([
      { address: OPERATOR, use: 'PRIMARY' },
    ])
  })

  it('compares the two without regard to case', () => {
    expect(
      portalContacts(input({ notice: 'CLOSED', serviceContactEmail: 'SereneDavid@Gmail.com' })),
    ).toHaveLength(1)
  })
})

describe('once the portal is closing or closed', () => {
  it.each(WHILE_ENDING)('%s leads with the standing address', (notice) => {
    expect(portalContacts(input({ notice }))).toEqual([{ address: STANDING, use: 'PRIMARY' }])
  })

  it.each(WHILE_ENDING)('%s does not offer the operator underneath', (notice) => {
    // §7's whole reason for a second address is that the first has stopped
    // being read. A closed portal offering an unmonitored address is the dead
    // end this file exists to fix, reintroduced one state later.
    const addresses = portalContacts(input({ notice })).map((row) => row.address)
    expect(addresses).not.toContain(OPERATOR)
  })

  it('uses the operator only when nothing else is configured', () => {
    expect(portalContacts(input({ notice: 'SERVICE_CLOSED', serviceContactEmail: null }))).toEqual([
      { address: OPERATOR, use: 'PRIMARY' },
    ])
  })
})

describe('read-only', () => {
  it('carries no contact line', () => {
    // The portal is open and the record is on the screen. There is nothing for
    // a contact line to rescue, and a standing invitation to write during a
    // deliberate quiet period is an invitation to be written to.
    expect(portalContacts(input({ notice: 'READ_ONLY' }))).toEqual([])
  })
})

describe('when nothing is configured', () => {
  const bare = { operatorEmail: null, serviceContactEmail: null }

  it.each([...WHILE_RUNNING, ...WHILE_ENDING])('%s names nobody at all', (notice) => {
    // Never invented. Saying nothing is better than naming a route that is not
    // one — and the absence is a finding in the health report, where somebody
    // can do something about it.
    expect(portalContacts({ notice, ...bare })).toEqual([])
  })

  it('treats blank and whitespace settings as unset', () => {
    expect(
      portalContacts({ notice: 'SUSPENDED', operatorEmail: '   ', serviceContactEmail: '' }),
    ).toEqual([])
  })

  it('trims an address that was pasted with a space on it', () => {
    expect(
      portalContacts({ notice: 'SUSPENDED', operatorEmail: ` ${OPERATOR} `, serviceContactEmail: null }),
    ).toEqual([{ address: OPERATOR, use: 'PRIMARY' }])
  })
})

describe('the words around the address', () => {
  it('names nobody', () => {
    // The copy used to say "David", and a hard-coded first name in a notice
    // goes wrong quietly on the day somebody else is answering.
    const all = Object.values(CONTACT_COPY)
      .map((copy) => `${copy.before}${copy.after}`)
      .join(' ')
    expect(all).not.toMatch(/David|Serene|Mike|Michael/)
  })

  it('promises nothing about a reply', () => {
    const all = Object.values(CONTACT_COPY)
      .map((copy) => `${copy.before}${copy.after}`)
      .join(' ')
    expect(all).not.toMatch(/will (reply|respond|get back)|within \d/)
  })

  it('reads as a sentence with the address in the middle', () => {
    for (const copy of Object.values(CONTACT_COPY)) {
      expect(copy.before.endsWith(' ')).toBe(true)
      expect(copy.after.trimEnd().endsWith('.')).toBe(true)
    }
  })
})

describe('what a contact line can never contain', () => {
  it('is derived only from configuration, never from a record', () => {
    // The one rule that outranks everything here: no investor-facing surface
    // may reveal that another investor exists. The input type is the proof —
    // there is nothing in it that came from an account.
    const contacts = portalContacts(input({ notice: 'SUSPENDED' }))
    expect(contacts.every((row) => [OPERATOR, STANDING].includes(row.address))).toBe(true)
  })
})
