import type { AdminRole } from '@/lib/roles'

export const VIEWER_EMAIL_REVIEW_LIMIT = 10
export const VIEWER_EMAIL_REVIEW_WINDOW_MS = 24 * 60 * 60 * 1_000

/**
 * Only the read-only experience tester is capped. Mike and David retain the
 * established behavior; their provider usage remains governed by the existing
 * spend and review controls.
 */
export function canAskViewerEmailReviewQuestion(
  role: AdminRole,
  recentAttempts: number,
): boolean {
  if (role !== 'VIEWER') return true
  return recentAttempts < VIEWER_EMAIL_REVIEW_LIMIT
}
