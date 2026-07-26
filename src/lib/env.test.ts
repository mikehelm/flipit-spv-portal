import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { env, resetEnvCache } from './env'

const valid = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://postgres@127.0.0.1:5433/spv',
  BASE_PATH: '',
  APP_URL: 'https://spv.flipit.com',
  PRODUCTION_APP_URL: 'https://spv.flipit.com',
  ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
  AUTH_SECRET: 'a-sufficiently-long-secret',
  OWNER_EMAILS: 'mike@flipthepage.com,mike@flipit.com',
  OPERATOR_EMAILS: 'serenedavid@gmail.com',
}

let original: NodeJS.ProcessEnv

function apply(overrides: Record<string, string | undefined>) {
  const merged = { ...valid, ...overrides }
  for (const key of Object.keys(merged)) {
    const value = merged[key as keyof typeof merged]
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  resetEnvCache()
}

beforeEach(() => {
  original = { ...process.env }
})

afterEach(() => {
  process.env = original
  resetEnvCache()
})

describe('environment validation', () => {
  it('accepts a valid configuration', () => {
    apply({})
    expect(env().APP_URL).toBe('https://spv.flipit.com')
  })

  it('refuses to start when a required variable is missing', () => {
    apply({ ENCRYPTION_KEY: undefined })
    expect(() => env()).toThrow(/ENCRYPTION_KEY/)
  })

  it('refuses an encryption key that is not 32 bytes', () => {
    apply({ ENCRYPTION_KEY: Buffer.alloc(16, 1).toString('base64') })
    expect(() => env()).toThrow(/32 bytes/)
  })

  it('rejects a base path with a trailing slash', () => {
    apply({ BASE_PATH: '/SPV/' })
    expect(() => env()).toThrow(/BASE_PATH/)
  })

  it('accepts a base path with a leading slash and no trailing slash', () => {
    apply({ BASE_PATH: '/SPV' })
    expect(env().BASE_PATH).toBe('/SPV')
  })

  it('splits and lowercases the role allowlists', () => {
    apply({ OWNER_EMAILS: ' Mike@Flipit.com , mike@flipthepage.com ' })
    expect(env().ownerEmails).toEqual([
      'mike@flipit.com',
      'mike@flipthepage.com',
    ])
  })
})

describe('the health endpoint secret', () => {
  it('defaults to empty, which switches the endpoint off', () => {
    apply({ HEALTH_TOKEN: undefined })
    expect(env().HEALTH_TOKEN).toBe('')
  })

  it('accepts a token of at least 32 characters', () => {
    const token = 'x'.repeat(32)
    apply({ HEALTH_TOKEN: token })
    expect(env().HEALTH_TOKEN).toBe(token)
  })

  it('refuses to start on a short one', () => {
    // There is nothing rate-limiting an unauthenticated health check, so the
    // length is the whole defence. A deployment that sets a weak one should
    // find out at boot rather than never.
    apply({ HEALTH_TOKEN: 'short' })
    expect(() => env()).toThrow(/HEALTH_TOKEN/)
  })
})

describe('production deployment guard (BUILD_SPEC §18.1, AC44)', () => {
  it('recognises the production deployment', () => {
    apply({
      APP_URL: 'https://spv.flipit.com',
      PRODUCTION_APP_URL: 'https://spv.flipit.com',
    })
    expect(env().isProductionDeployment).toBe(true)
  })

  it('ignores a trailing slash and case when comparing', () => {
    apply({
      APP_URL: 'https://SPV.flipit.com/',
      PRODUCTION_APP_URL: 'https://spv.flipit.com',
    })
    expect(env().isProductionDeployment).toBe(true)
  })

  it('marks the testing deployment as not production', () => {
    apply({
      APP_URL: 'https://mikehelm.com/SPV',
      PRODUCTION_APP_URL: 'https://spv.flipit.com',
      BASE_PATH: '/SPV',
    })
    expect(env().isProductionDeployment).toBe(false)
  })

  it('marks localhost as not production', () => {
    apply({ APP_URL: 'http://localhost:3000' })
    expect(env().isProductionDeployment).toBe(false)
  })
})
