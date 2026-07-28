import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const PAGE = join(
  process.cwd(),
  'src/app/(admin)/admin/onboarding/page.tsx',
)

function page(): string {
  return readFileSync(PAGE, 'utf8')
}

describe('guided operator onboarding', () => {
  it('uses the shared four-state language and one personal next action', () => {
    const body = page()
    expect(body).toContain("from '@/components/admin/guided'")
    expect(body).toContain('nextPersonalOnboardingStep(progress)')
    expect(body).toContain('status="Needs you"')
    expect(body).not.toMatch(/label:\s*['"](?:Done|Now|Later)['"]/)
  })

  it('keeps every existing onboarding action available', () => {
    const body = page()
    for (const action of [
      'confirmDisplayNameAction',
      'setContactMethodAction',
      'recordVideoChoiceAction',
      'acknowledgeQaAction',
      'acknowledgeTestInvitationAction',
      'completeOnboardingAction',
    ]) {
      expect(body).toContain(action)
    }
  })

  it('shows mail health without exposing owner controls', () => {
    const body = page()
    expect(body).toContain('describeMailConnection(config)')
    expect(body).toContain("mail.state === 'HEALTHY'")
    expect(body).toContain("mailHealthy ? 'Complete' : 'Waiting'")
    expect(body).toContain('Mike must connect or re-verify')
    expect(body).not.toContain('MailConnectionPanel')
    expect(body).not.toContain('showDisconnect')
    expect(body).not.toContain('testMailConnectionAction')
    expect(body).not.toContain('disconnectSendingAccountAction')
  })

  it('offers Finish only behind existing completion and healthy live mail', () => {
    const body = page()
    expect(body).toContain('canOfferOnboardingFinish(progress, mailHealthy)')
    const finish = body.slice(body.indexOf('{canOfferFinish'))
    expect(finish).toContain('completeOnboardingAction')
    expect(finish).toContain('Finish setup')
  })
})
