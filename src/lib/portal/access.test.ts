import { describe, expect, it } from 'vitest'
import {
  canRespond,
  canView,
  portalAccess,
  SIGN_IN_ACCEPTED_MESSAGE,
  type AccountStatus,
  type ClosedAccountAccess,
  type ServiceMode,
} from './access'

/**
 * BUILD_SPEC §4.2, §7, and AC — suspension revokes and refuses; a closed
 * account with `read_only` can still sign back in.
 *
 * §4.2 states these rules "explicitly, because revocation alone does not answer
 * it". These tests are the transcription of that table. If someone later makes
 * a suspended account able to request a link, several of them fail.
 */

const ALL_STATUSES: AccountStatus[] = [
  'INVITED',
  'ACTIVE',
  'SUSPENDED',
  'CLOSED',
  'ARCHIVED',
]
const ALL_MODES: ServiceMode[] = ['ACTIVE', 'READ_ONLY', 'SUNSET', 'DISABLED']

const access = (
  accountStatus: AccountStatus,
  serviceMode: ServiceMode = 'ACTIVE',
  closedAccountAccess: ClosedAccountAccess = 'READ_ONLY',
) => portalAccess({ accountStatus, serviceMode, closedAccountAccess })

describe('the §4.2 table, transcribed', () => {
  it('invited: the claim link works and nothing else exists yet', () => {
    const result = access('INVITED')
    expect(result.allowClaim).toBe(true)
    expect(result.issueLink).toBe(false)
    expect(result.capability).toBe('NONE')
  })

  it('active: full access to their own record', () => {
    const result = access('ACTIVE')
    expect(result.capability).toBe('FULL')
    expect(result.issueLink).toBe(true)
    expect(canRespond(result)).toBe(true)
  })

  it('suspended: no new link, no access, and a neutral notice', () => {
    const result = access('SUSPENDED')
    expect(result.issueLink).toBe(false)
    expect(result.allowClaim).toBe(false)
    expect(result.capability).toBe('NONE')
    expect(result.notice).toBe('SUSPENDED')
  })

  it('closed with read_only: may sign back in, read only', () => {
    const result = access('CLOSED', 'ACTIVE', 'READ_ONLY')
    expect(result.issueLink).toBe(true)
    expect(result.capability).toBe('READ_ONLY')
    expect(canView(result)).toBe(true)
    expect(canRespond(result)).toBe(false)
  })

  it('closed with none: no link, no access', () => {
    const result = access('CLOSED', 'ACTIVE', 'NONE')
    expect(result.issueLink).toBe(false)
    expect(result.capability).toBe('NONE')
    expect(result.notice).toBe('CLOSED')
  })

  it('archived: never issues a sign-in link, in any service mode', () => {
    for (const mode of ALL_MODES) {
      const result = access('ARCHIVED', mode)
      expect(result.issueLink).toBe(false)
      expect(result.capability).toBe('NONE')
    }
  })
})

describe('a suspended account is unreachable however the service is set', () => {
  it('holds across every service mode', () => {
    for (const mode of ALL_MODES) {
      const result = access('SUSPENDED', mode)
      expect(result.issueLink).toBe(false)
      expect(result.allowClaim).toBe(false)
      expect(result.capability).toBe('NONE')
    }
  })

  it('holds across both closed-access settings, which do not apply to it', () => {
    for (const setting of ['READ_ONLY', 'NONE'] as ClosedAccountAccess[]) {
      expect(access('SUSPENDED', 'ACTIVE', setting).issueLink).toBe(false)
    }
  })
})

describe('the service mode can only ever narrow access', () => {
  it('never widens it for any combination', () => {
    const rank = { FULL: 2, READ_ONLY: 1, NONE: 0 } as const

    for (const status of ALL_STATUSES) {
      const inActiveService = access(status, 'ACTIVE')
      for (const mode of ALL_MODES) {
        const result = access(status, mode)
        expect(rank[result.capability]).toBeLessThanOrEqual(rank[inActiveService.capability])
        if (!inActiveService.issueLink) expect(result.issueLink).toBe(false)
        if (!inActiveService.allowClaim) expect(result.allowClaim).toBe(false)
      }
    }
  })

  it('read_only service makes an active account read-only', () => {
    const result = access('ACTIVE', 'READ_ONLY')
    expect(result.capability).toBe('READ_ONLY')
    expect(canRespond(result)).toBe(false)
    expect(result.issueLink).toBe(true)
  })

  it('sunset still lets an investor in to take their records away', () => {
    const result = access('ACTIVE', 'SUNSET')
    expect(result.issueLink).toBe(true)
    expect(canView(result)).toBe(true)
    expect(result.notice).toBe('SUNSET')
  })

  it('disabled closes the door to everybody, including a claim', () => {
    for (const status of ALL_STATUSES) {
      const result = access(status, 'DISABLED')
      expect(result.capability).toBe('NONE')
      expect(result.issueLink).toBe(false)
      expect(result.allowClaim).toBe(false)
    }
  })
})

describe('the notice never says more than it has to', () => {
  it('prefers the account’s own reason over the service’s', () => {
    expect(access('SUSPENDED', 'READ_ONLY').notice).toBe('SUSPENDED')
  })

  it('says nothing at all in the ordinary case', () => {
    expect(access('ACTIVE', 'ACTIVE').notice).toBeNull()
  })

  it('mentions no other investor, in any state', () => {
    for (const status of ALL_STATUSES) {
      for (const mode of ALL_MODES) {
        const notice = access(status, mode).notice
        if (notice === null) continue
        expect(notice).not.toMatch(/other|another|else|investor|participant|count|total/i)
      }
    }
  })
})

describe('the sign-in response is one sentence and has no variants — §4.1', () => {
  it('does not say whether the address is known', () => {
    expect(SIGN_IN_ACCEPTED_MESSAGE).toMatch(/if that address has a record/i)
    expect(SIGN_IN_ACCEPTED_MESSAGE).not.toMatch(/not found|unknown|suspended|closed|no account/i)
  })
})
