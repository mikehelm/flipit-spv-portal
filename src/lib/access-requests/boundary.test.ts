import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const action = readFileSync('src/actions/access-requests.ts', 'utf8')
const publicAction = readFileSync('src/app/access-request/action.ts', 'utf8')
const store = readFileSync('src/lib/access-requests/store.ts', 'utf8')
const adminPage = readFileSync('src/app/(admin)/access-requests/page.tsx', 'utf8')
const onboarding = readFileSync('src/actions/onboarding.ts', 'utf8')

describe('access-request authority boundary', () => {
  it('allows only acting owner/operator accounts to read or decide requests', () => {
    expect(adminPage).toContain('await requireOnboardedAdmin()')
    expect(action.match(/await requireOnboardedAdmin\(\)/g)).toHaveLength(2)
    expect(adminPage).not.toContain('requireReader')
    expect(action).not.toContain('requireReader')
    const deletion = action.slice(action.indexOf('export async function deleteAccessRequestAction'))
    expect(deletion).toContain('await requireOwner()')
  })

  it('has no path from verification or closure to access, invitations, links, or mail', () => {
    for (const source of [action, store]) {
      expect(source).not.toMatch(/\busers\b/)
      expect(source).not.toMatch(/\boperatorInvites\b/)
      expect(source).not.toMatch(/\bsetupLinks\b/)
      expect(source).not.toMatch(/\bsendOneEmail\b/)
      expect(source).not.toMatch(/\bsendMail\b/)
      expect(source).not.toMatch(/\ballowlist/i)
    }
  })

  it('keeps submitted PII out of audit metadata', () => {
    const auditBlock = publicAction.slice(publicAction.indexOf('await audit({'))
    expect(auditBlock).not.toContain('firstName')
    expect(auditBlock).not.toContain('lastName')
    expect(auditBlock).not.toContain('phone')
    expect(auditBlock).not.toContain('email')
  })

  it('stores a keyed source hash and never the raw source address', () => {
    expect(store).toContain("createHmac('sha256', env().AUTH_SECRET)")
    expect(store).toContain('sourceHash')
    expect(store).not.toMatch(/sourceIp|ipAddress|rawSource/)
  })

  it('uses a response-time floor for all valid public submissions', () => {
    expect(publicAction).toContain('MINIMUM_VALID_SUBMISSION_MS')
    expect(publicAction).toContain('await new Promise')
  })

  it('fails closed when an edit races with a verification or closure', () => {
    expect(store).toContain('.returning({ id: accessRequests.id })')
    expect(store).toContain('if (updated.length !== 1)')
  })
})

describe('SMTP credential ownership', () => {
  it('has no operator onboarding action that can store a credential', () => {
    expect(onboarding).not.toContain('storeSmtpCredential')
    expect(onboarding).not.toContain('smtpPassword')
    expect(onboarding).not.toContain('connectSendingAccountAction')
  })
})
