import { describe, expect, it } from 'vitest'
import {
  ONBOARDING_STEPS,
  QA_EXPLANATION,
  contactValueRequired,
  isOnboardingComplete,
  isPlausibleContactNumber,
  isStepComplete,
  normaliseContactValue,
  onboardingProgress,
  whatsappLink,
  type OnboardingSnapshot,
} from './onboarding'

/** BUILD_SPEC §2.1. */

const blank: OnboardingSnapshot = {
  displayName: null,
  contactMethod: null,
  contactValue: null,
  sendingAccountConfigured: false,
  videoChoice: null,
  qaAcknowledged: false,
  testInvitationAcknowledged: false,
  completedAt: null,
}

const finished: OnboardingSnapshot = {
  displayName: 'David Serene',
  contactMethod: 'WHATSAPP',
  contactValue: '+66 81 234 5678',
  sendingAccountConfigured: true,
  videoChoice: 'SKIP',
  qaAcknowledged: true,
  testInvitationAcknowledged: true,
  completedAt: new Date('2026-07-25T10:00:00Z'),
}

describe('the six steps', () => {
  it('are the ones the spec lists, in order, including 4b', () => {
    expect(ONBOARDING_STEPS.map((s) => `${s.number}:${s.id}`)).toEqual([
      '1:DISPLAY_NAME',
      '2:CONTACT_METHOD',
      '3:SENDING_ACCOUNT',
      '4:VIDEO',
      '4b:QA',
      '5:TEST_INVITATION',
    ])
  })
})

describe('resumability', () => {
  it('starts at step 1 with nothing stored', () => {
    const progress = onboardingProgress(blank)
    expect(progress.nextStep).toBe('DISPLAY_NAME')
    expect(progress.completedCount).toBe(0)
    expect(progress.canComplete).toBe(false)
    expect(progress.complete).toBe(false)
  })

  it('picks up where an abandoned run left off', () => {
    const abandoned: OnboardingSnapshot = {
      ...blank,
      displayName: 'David Serene',
      contactMethod: 'PHONE',
      contactValue: '+66 81 234 5678',
    }
    const progress = onboardingProgress(abandoned)
    expect(progress.nextStep).toBe('SENDING_ACCOUNT')
    expect(progress.completedCount).toBe(2)
    expect(progress.steps.find((s) => s.id === 'SENDING_ACCOUNT')?.current).toBe(true)
  })

  it('marks a later-completed step done even when an earlier one is missing', () => {
    const patchy: OnboardingSnapshot = { ...blank, qaAcknowledged: true }
    const progress = onboardingProgress(patchy)
    expect(progress.nextStep).toBe('DISPLAY_NAME')
    expect(progress.steps.find((s) => s.id === 'QA')?.complete).toBe(true)
  })

  it('is complete only when every step is done and completion was recorded', () => {
    expect(isOnboardingComplete(finished)).toBe(true)
    expect(isOnboardingComplete({ ...finished, completedAt: null })).toBe(false)
    expect(onboardingProgress({ ...finished, completedAt: null }).canComplete).toBe(true)
  })

  it('reopens if a completed step later becomes untrue', () => {
    // The app password was revoked at Google: setup is no longer finished, and
    // the operator is walked back to the gap rather than left with a broken send.
    expect(isOnboardingComplete({ ...finished, sendingAccountConfigured: false })).toBe(
      false,
    )
  })
})

describe('step 2 — contact method', () => {
  it('requires a value for phone and WhatsApp', () => {
    expect(contactValueRequired('PHONE')).toBe(true)
    expect(contactValueRequired('WHATSAPP')).toBe(true)

    expect(
      isStepComplete('CONTACT_METHOD', {
        ...blank,
        contactMethod: 'PHONE',
        contactValue: null,
      }),
    ).toBe(false)

    expect(
      isStepComplete('CONTACT_METHOD', {
        ...blank,
        contactMethod: 'PHONE',
        contactValue: '   ',
      }),
    ).toBe(false)
  })

  it('captures nothing for email-only', () => {
    expect(contactValueRequired('EMAIL_ONLY')).toBe(false)
    expect(normaliseContactValue('EMAIL_ONLY', '+66 81 234 5678')).toBeNull()
    expect(
      isStepComplete('CONTACT_METHOD', {
        ...blank,
        contactMethod: 'EMAIL_ONLY',
        contactValue: null,
      }),
    ).toBe(true)
  })

  it('treats a stored blank as not-complete, because a blank renders a blank phone line', () => {
    expect(
      isStepComplete('CONTACT_METHOD', {
        ...blank,
        contactMethod: 'EMAIL_ONLY',
        contactValue: '',
      }),
    ).toBe(false)
    expect(normaliseContactValue('PHONE', '   ')).toBeNull()
  })

  it('trims a captured number without otherwise reformatting it', () => {
    expect(normaliseContactValue('PHONE', '  +66 81 234 5678 ')).toBe('+66 81 234 5678')
  })

  it('accepts realistic numbers and rejects nonsense', () => {
    for (const good of ['+66812345678', '+66 81 234 5678', '(020) 7946-0958', '0812345678']) {
      expect(isPlausibleContactNumber(good), good).toBe(true)
    }
    for (const bad of ['', 'call me', '12345', '+', '+1234567890123456789', 'x+44 20']) {
      expect(isPlausibleContactNumber(bad), bad).toBe(false)
    }
  })

  it('builds a wa.me link from digits only', () => {
    expect(whatsappLink('+66 81 234 5678')).toBe('https://wa.me/66812345678')
    expect(whatsappLink('(020) 7946-0958')).toBe('https://wa.me/02079460958')
  })
})

describe('step 4b — the Q&A explanation', () => {
  it('is two sentences, as the spec asks', () => {
    expect(QA_EXPLANATION).toHaveLength(2)
  })

  it('states that answers are private by default and published answers are anonymous', () => {
    const text = QA_EXPLANATION.join(' ').toLowerCase()
    expect(text).toContain('private')
    expect(text).toContain('publish')
    expect(text).toContain('no name')
  })
})
