import type {
  OnboardingProgress,
  OnboardingStepId,
} from '@/lib/auth/onboarding'

export const PERSONAL_ONBOARDING_STEPS = [
  'DISPLAY_NAME',
  'CONTACT_METHOD',
  'VIDEO',
  'QA',
  'TEST_INVITATION',
] as const satisfies readonly OnboardingStepId[]

export type PersonalOnboardingStepId =
  (typeof PERSONAL_ONBOARDING_STEPS)[number]

/**
 * The next thing David owns, independent of the owner-managed mail dependency.
 * Completion itself remains governed by `onboardingProgress.canComplete`.
 */
export function nextPersonalOnboardingStep(
  progress: OnboardingProgress,
): PersonalOnboardingStepId | null {
  return (
    PERSONAL_ONBOARDING_STEPS.find(
      (id) => !progress.steps.find((step) => step.id === id)?.complete,
    ) ?? null
  )
}

/**
 * The completion action keeps its existing requirements and is only presented
 * when the owner-managed mail dependency is healthy. This changes no stored
 * completion rule; it prevents the guided UI from offering a visibly
 * contradictory next step while mail is Waiting.
 */
export function canOfferOnboardingFinish(
  progress: OnboardingProgress,
  mailHealthy: boolean,
): boolean {
  return progress.canComplete && mailHealthy && !progress.complete
}
