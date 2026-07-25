import { describe, expect, it } from 'vitest'
import { portalAccess, type PortalAccess } from '@/lib/portal/access'
import {
  canAskQuestion,
  canReadOwnQuestions,
  sharedQaState,
  sharedQaVisible,
} from './visibility'

/**
 * BUILD_SPEC §6.7.5 — the owner-level switch, and what it does and does not
 * turn off.
 */

function access(overrides: Partial<Parameters<typeof portalAccess>[0]> = {}): PortalAccess {
  return portalAccess({
    accountStatus: 'ACTIVE',
    closedAccountAccess: 'READ_ONLY',
    serviceMode: 'ACTIVE',
    ...overrides,
  })
}

describe('the shared section, during the raise', () => {
  it('is visible by default — the switch defaults to on', () => {
    expect(
      sharedQaState({ qaVisibleDuringRaise: true, roundClosed: false, access: access() }),
    ).toBe('VISIBLE')
  })

  it('is hidden while the round is open when the owner has turned it off', () => {
    expect(
      sharedQaState({ qaVisibleDuringRaise: false, roundClosed: false, access: access() }),
    ).toBe('QUEUED_UNTIL_ROUND_CLOSES')
  })

  it('appears once the round closes, without anybody republishing anything', () => {
    expect(
      sharedQaState({ qaVisibleDuringRaise: false, roundClosed: true, access: access() }),
    ).toBe('VISIBLE')
  })

  it('is absent entirely for a visitor who cannot see the portal', () => {
    expect(
      sharedQaState({
        qaVisibleDuringRaise: true,
        roundClosed: true,
        access: access({ accountStatus: 'SUSPENDED' }),
      }),
    ).toBe('NO_ACCESS')
  })

  it('stays hidden from a suspended account even with the switch on', () => {
    expect(
      sharedQaVisible({
        qaVisibleDuringRaise: true,
        roundClosed: false,
        access: access({ accountStatus: 'SUSPENDED' }),
      }),
    ).toBe(false)
  })
})

describe('asking, and reading your own thread', () => {
  it('lets a live account ask', () => {
    expect(canAskQuestion(access())).toBe(true)
  })

  it('refuses a new question in a read-only service', () => {
    // The portal already says "responses and messages are not being accepted".
    // Accepting one into a queue nobody will answer would make that false.
    expect(canAskQuestion(access({ serviceMode: 'READ_ONLY' }))).toBe(false)
    expect(canAskQuestion(access({ serviceMode: 'SUNSET' }))).toBe(false)
  })

  it('still lets a read-only visitor read their own correspondence', () => {
    // §7 read-only is "view and download". Their own thread is their record.
    expect(canReadOwnQuestions(access({ serviceMode: 'READ_ONLY' }))).toBe(true)
    expect(canReadOwnQuestions(access({ serviceMode: 'SUNSET' }))).toBe(true)
  })

  it('lets a closed account with read-only access still read its own thread', () => {
    expect(canReadOwnQuestions(access({ accountStatus: 'CLOSED' }))).toBe(true)
    expect(canAskQuestion(access({ accountStatus: 'CLOSED' }))).toBe(false)
  })

  it('gives a suspended or archived account nothing', () => {
    for (const status of ['SUSPENDED', 'ARCHIVED'] as const) {
      expect(canAskQuestion(access({ accountStatus: status })), status).toBe(false)
      expect(canReadOwnQuestions(access({ accountStatus: status })), status).toBe(false)
    }
  })

  it('gives nobody anything when the service is disabled', () => {
    expect(canAskQuestion(access({ serviceMode: 'DISABLED' }))).toBe(false)
    expect(canReadOwnQuestions(access({ serviceMode: 'DISABLED' }))).toBe(false)
  })
})
