import { describe, expect, it } from 'vitest'
import {
  ONBOARDING_STEPS,
  type OnboardingProgress,
  type OnboardingStepId,
} from '@/lib/auth/onboarding'
import {
  PERSONAL_ONBOARDING_STEPS,
  canOfferOnboardingFinish,
  nextPersonalOnboardingStep,
} from '@/lib/auth/onboarding-guidance'

function progress(completed: OnboardingStepId[]): OnboardingProgress {
  const complete = new Set(completed)
  return {
    steps: ONBOARDING_STEPS.map((step) => ({
      ...step,
      complete: complete.has(step.id),
      current: false,
    })),
    nextStep: null,
    completedCount: complete.size,
    totalCount: ONBOARDING_STEPS.length,
    canComplete: complete.size === ONBOARDING_STEPS.length,
    complete: false,
  }
}

describe('David-owned onboarding order', () => {
  it('keeps the five personal tasks in their canonical order', () => {
    expect(PERSONAL_ONBOARDING_STEPS).toEqual([
      'DISPLAY_NAME',
      'CONTACT_METHOD',
      'VIDEO',
      'QA',
      'TEST_INVITATION',
    ])
  })

  it('moves to personal work even while the sending account waits on Mike', () => {
    const state = progress(['DISPLAY_NAME', 'CONTACT_METHOD'])
    state.nextStep = 'SENDING_ACCOUNT'
    expect(nextPersonalOnboardingStep(state)).toBe('VIDEO')
  })

  it('returns no personal action only when all five personal tasks are complete', () => {
    const withoutMail = progress([...PERSONAL_ONBOARDING_STEPS])
    expect(nextPersonalOnboardingStep(withoutMail)).toBeNull()
    expect(withoutMail.canComplete).toBe(false)
  })

  it('never presents Finish while stored mail is stale, failed or otherwise unhealthy', () => {
    const ready = progress([...ONBOARDING_STEPS.map((step) => step.id)])
    expect(ready.canComplete).toBe(true)

    expect(canOfferOnboardingFinish(ready, false)).toBe(false)
    expect(canOfferOnboardingFinish(ready, true)).toBe(true)

    ready.complete = true
    expect(canOfferOnboardingFinish(ready, true)).toBe(false)
  })
})
