/**
 * Operator onboarding. BUILD_SPEC §2.1.
 *
 * Five steps plus 4b, walked through the first time David signs in, and
 * **resumable** — he can abandon it halfway and pick it up where he left off,
 * because the progress is derived from what has actually been stored rather
 * than from a wizard position held in a cookie.
 *
 * This module is pure. `onboarding-store.ts` does the reading and writing.
 */

export type ContactMethod = 'PHONE' | 'WHATSAPP' | 'EMAIL_ONLY'

export type VideoChoice = 'RECORD_NOW' | 'UPLOAD_LATER' | 'SKIP'

export type OnboardingStepId =
  | 'DISPLAY_NAME'
  | 'CONTACT_METHOD'
  | 'SENDING_ACCOUNT'
  | 'VIDEO'
  | 'QA'
  | 'TEST_INVITATION'

export interface OnboardingStep {
  id: OnboardingStepId
  /** "4b" is a real step number in the spec, so this is a string. */
  number: string
  title: string
}

export const ONBOARDING_STEPS: readonly OnboardingStep[] = [
  { id: 'DISPLAY_NAME', number: '1', title: 'Confirm your display name' },
  { id: 'CONTACT_METHOD', number: '2', title: 'How should investors reach you?' },
  { id: 'SENDING_ACCOUNT', number: '3', title: 'Connect the sending account' },
  { id: 'VIDEO', number: '4', title: 'A personal video' },
  { id: 'QA', number: '4b', title: 'How questions and answers work' },
  { id: 'TEST_INVITATION', number: '5', title: 'Send yourself a test invitation' },
] as const

export interface OnboardingSnapshot {
  displayName: string | null
  contactMethod: ContactMethod | null
  contactValue: string | null
  /** SMTP user and app password are both stored, encrypted. */
  sendingAccountConfigured: boolean
  videoChoice: VideoChoice | null
  qaAcknowledged: boolean
  testInvitationAcknowledged: boolean
  completedAt: Date | null
}

function present(value: string | null): boolean {
  return typeof value === 'string' && value.trim() !== ''
}

/**
 * Email-only captures nothing. A blank stored value is not the same as no
 * value: `{{sender_phone}}` must be removed from the template entirely rather
 * than rendering empty (§2.1 step 2), and that decision is driven off the
 * contact value being genuinely absent.
 */
export function contactValueRequired(method: ContactMethod): boolean {
  return method !== 'EMAIL_ONLY'
}

export function isStepComplete(
  step: OnboardingStepId,
  snapshot: OnboardingSnapshot,
): boolean {
  switch (step) {
    case 'DISPLAY_NAME':
      return present(snapshot.displayName)
    case 'CONTACT_METHOD':
      if (snapshot.contactMethod === null) return false
      return contactValueRequired(snapshot.contactMethod)
        ? present(snapshot.contactValue)
        : snapshot.contactValue === null
    case 'SENDING_ACCOUNT':
      return snapshot.sendingAccountConfigured
    case 'VIDEO':
      return snapshot.videoChoice !== null
    case 'QA':
      return snapshot.qaAcknowledged
    case 'TEST_INVITATION':
      return snapshot.testInvitationAcknowledged
  }
}

export interface OnboardingProgress {
  steps: Array<OnboardingStep & { complete: boolean; current: boolean }>
  nextStep: OnboardingStepId | null
  completedCount: number
  totalCount: number
  /** Every step is done, so the flow may be marked finished. */
  canComplete: boolean
  /** Every step is done AND the completion has been recorded. */
  complete: boolean
}

export function onboardingProgress(snapshot: OnboardingSnapshot): OnboardingProgress {
  const done = ONBOARDING_STEPS.map((step) => isStepComplete(step.id, snapshot))
  const nextIndex = done.indexOf(false)

  return {
    steps: ONBOARDING_STEPS.map((step, index) => ({
      ...step,
      complete: done[index],
      current: index === nextIndex,
    })),
    nextStep: nextIndex === -1 ? null : ONBOARDING_STEPS[nextIndex].id,
    completedCount: done.filter(Boolean).length,
    totalCount: ONBOARDING_STEPS.length,
    canComplete: nextIndex === -1,
    complete: nextIndex === -1 && snapshot.completedAt !== null,
  }
}

/**
 * Deliberately requires both: every step done *and* the completion recorded.
 * A snapshot that was marked complete and has since lost a step — a revoked
 * app password, say — is not complete, and the operator is walked back through
 * the gap rather than left with a setup that silently no longer works.
 */
export function isOnboardingComplete(snapshot: OnboardingSnapshot): boolean {
  return onboardingProgress(snapshot).complete
}

/**
 * What to store for the chosen contact method. Email-only stores nothing —
 * not an empty string, which would render as a blank phone line.
 */
export function normaliseContactValue(
  method: ContactMethod,
  raw: string | null | undefined,
): string | null {
  if (!contactValueRequired(method)) return null
  const trimmed = (raw ?? '').trim()
  return trimmed === '' ? null : trimmed
}

/**
 * Loose on formatting, strict on shape. Investors dial it; the application
 * never parses it into anything.
 */
export function isPlausibleContactNumber(value: string): boolean {
  const trimmed = value.trim()
  if (!/^\+?[0-9(][0-9\s()\-.]*$/.test(trimmed)) return false
  const digits = trimmed.replace(/\D/g, '')
  return digits.length >= 7 && digits.length <= 15
}

/** `wa.me` takes digits only, no plus, no separators. BUILD_SPEC §2.1. */
export function whatsappLink(value: string): string {
  return `https://wa.me/${value.replace(/\D/g, '')}`
}

export const CONTACT_METHOD_LABELS: Record<ContactMethod, string> = {
  PHONE: 'Phone',
  WHATSAPP: 'WhatsApp',
  EMAIL_ONLY: 'Email only',
}

export const VIDEO_CHOICE_LABELS: Record<VideoChoice, string> = {
  RECORD_NOW: 'Record one now',
  UPLOAD_LATER: 'Upload one later',
  SKIP: 'Skip — no video',
}

/**
 * Step 4b, in two sentences, as the spec asks for. Kept here rather than in
 * the page so the wording is testable and quotable.
 */
export const QA_EXPLANATION = [
  'Questions investors ask in their portal arrive here, and your answer is private to the person who asked unless you tick the box to publish it.',
  'A published question appears on a shared page with no name, no initials and no identifying date — and you can rewrite the wording before publishing, while the original stays on the private record.',
] as const
