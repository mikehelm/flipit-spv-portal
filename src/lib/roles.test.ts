import { beforeEach, describe, expect, it } from 'vitest'
import { isOwner, isPrivileged, resolveRole } from './roles'
import { resetEnvCache } from './env'

function configure(owners: string, operators: string) {
  process.env.DATABASE_URL = 'postgresql://postgres@127.0.0.1:5433/spv'
  process.env.APP_URL = 'https://spv.flipit.com'
  process.env.PRODUCTION_APP_URL = 'https://spv.flipit.com'
  process.env.ENCRYPTION_KEY = Buffer.alloc(32, 3).toString('base64')
  process.env.AUTH_SECRET = 'a-sufficiently-long-secret'
  process.env.OWNER_EMAILS = owners
  process.env.OPERATOR_EMAILS = operators
  resetEnvCache()
}

beforeEach(() => {
  configure('mike@flipthepage.com,mike@flipit.com', 'serenedavid@gmail.com')
})

describe('role allowlist (BUILD_SPEC §2)', () => {
  it('recognises both owner addresses', () => {
    expect(resolveRole('mike@flipthepage.com')).toBe('OWNER')
    expect(resolveRole('mike@flipit.com')).toBe('OWNER')
  })

  it('recognises the operator', () => {
    expect(resolveRole('serenedavid@gmail.com')).toBe('OPERATOR')
  })

  it('is case and whitespace insensitive', () => {
    expect(resolveRole('  Mike@FlipIt.com  ')).toBe('OWNER')
    expect(resolveRole('SereneDavid@Gmail.com')).toBe('OPERATOR')
  })
})

describe('the negative case — this is the one that matters', () => {
  it('rejects an address on neither list', () => {
    expect(resolveRole('someone.else@gmail.com')).toBeNull()
  })

  it('rejects an empty or missing address', () => {
    expect(resolveRole('')).toBeNull()
    expect(resolveRole('   ')).toBeNull()
    expect(resolveRole(null)).toBeNull()
    expect(resolveRole(undefined)).toBeNull()
  })

  it('rejects a lookalike address', () => {
    expect(resolveRole('mike@flipit.co')).toBeNull()
    expect(resolveRole('mike@flipit.com.evil.com')).toBeNull()
    expect(resolveRole('notmike@flipit.com')).toBeNull()
    expect(resolveRole('serenedavid@gmail.com.attacker.net')).toBeNull()
  })

  it('rejects everyone when the allowlists are empty', () => {
    configure('', '')
    expect(resolveRole('mike@flipit.com')).toBeNull()
    expect(resolveRole('serenedavid@gmail.com')).toBeNull()
  })
})

describe('role precedence', () => {
  it('gives owner priority when an address appears on both lists', () => {
    configure('mike@flipit.com', 'mike@flipit.com')
    expect(resolveRole('mike@flipit.com')).toBe('OWNER')
  })
})

describe('helpers', () => {
  it('distinguishes owner from operator', () => {
    expect(isOwner('OWNER')).toBe(true)
    expect(isOwner('OPERATOR')).toBe(false)
    expect(isOwner(null)).toBe(false)
  })

  it('treats neither role as privileged when absent', () => {
    expect(isPrivileged('OWNER')).toBe(true)
    expect(isPrivileged('OPERATOR')).toBe(true)
    expect(isPrivileged(null)).toBe(false)
    expect(isPrivileged('INVESTOR')).toBe(false)
  })
})
