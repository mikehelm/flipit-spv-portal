import { describe, expect, it } from 'vitest'
import {
  GMAIL_ALIAS_HELP_URL,
  isTohuDecision,
  TOHU_ALIAS_EMAIL,
} from './tohu-decision'

describe('David and Tohu email decision', () => {
  it('uses a Gmail plus alias that remains a distinct portal address', () => {
    expect(TOHU_ALIAS_EMAIL).toBe('serenedavid+tohu@gmail.com')
    expect(GMAIL_ALIAS_HELP_URL).toMatch(
      /^https:\/\/support\.google\.com\/mail\//,
    )
  })

  it('admits only the three displayed choices', () => {
    expect(isTohuDecision('PLUS_ALIAS')).toBe(true)
    expect(isTohuDecision('COMBINE')).toBe(true)
    expect(isTohuDecision('DECIDE_LATER')).toBe(true)
    expect(isTohuDecision('invented')).toBe(false)
  })
})
