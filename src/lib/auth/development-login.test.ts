import { describe, expect, it } from 'vitest'
import {
  DEVELOPMENT_LOGIN_TTL_MINUTES,
  developmentLoginExpiresAt,
  isDevelopmentLoginToken,
} from './development-login'

describe('development login links', () => {
  it('expire after exactly ten minutes', () => {
    const now = new Date('2026-07-29T18:51:00.000Z')
    expect(DEVELOPMENT_LOGIN_TTL_MINUTES).toBe(10)
    expect(developmentLoginExpiresAt(now).toISOString()).toBe(
      '2026-07-29T19:01:00.000Z',
    )
  })

  it('recognises only the separate development token namespace', () => {
    expect(isDevelopmentLoginToken('dev_random-value')).toBe(true)
    expect(isDevelopmentLoginToken('random-value')).toBe(false)
    expect(isDevelopmentLoginToken('')).toBe(false)
  })
})
