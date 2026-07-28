import { describe, expect, it } from 'vitest'
import {
  canAskViewerEmailReviewQuestion,
  VIEWER_EMAIL_REVIEW_LIMIT,
  VIEWER_EMAIL_REVIEW_WINDOW_MS,
} from './viewer-limit'

describe('viewer email-review AI limit', () => {
  it('admits the first ten viewer attempts and refuses the eleventh', () => {
    expect(canAskViewerEmailReviewQuestion('VIEWER', VIEWER_EMAIL_REVIEW_LIMIT - 1)).toBe(
      true,
    )
    expect(canAskViewerEmailReviewQuestion('VIEWER', VIEWER_EMAIL_REVIEW_LIMIT)).toBe(
      false,
    )
  })

  it('does not change owner or operator behavior', () => {
    expect(canAskViewerEmailReviewQuestion('OWNER', 10_000)).toBe(true)
    expect(canAskViewerEmailReviewQuestion('OPERATOR', 10_000)).toBe(true)
  })

  it('uses a rolling twenty-four-hour window', () => {
    expect(VIEWER_EMAIL_REVIEW_WINDOW_MS).toBe(24 * 60 * 60 * 1_000)
  })
})
