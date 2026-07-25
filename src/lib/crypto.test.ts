import { beforeAll, describe, expect, it } from 'vitest'
import {
  decrypt,
  encrypt,
  hashTemplateSource,
  hashToken,
  issueToken,
  maskConfigured,
  tokensMatch,
} from './crypto'
import { resetEnvCache } from './env'

beforeAll(() => {
  process.env.DATABASE_URL = 'postgresql://postgres@127.0.0.1:5433/spv'
  process.env.APP_URL = 'https://spv.flipit.com'
  process.env.PRODUCTION_APP_URL = 'https://spv.flipit.com'
  process.env.ENCRYPTION_KEY = Buffer.alloc(32, 9).toString('base64')
  process.env.AUTH_SECRET = 'a-sufficiently-long-secret'
  resetEnvCache()
})

describe('encryption at rest (BUILD_SPEC §15)', () => {
  it('round-trips a secret', () => {
    const secret = 'abcd efgh ijkl mnop' // the shape of a Gmail app password
    expect(decrypt(encrypt(secret))).toBe(secret)
  })

  it('never stores the plaintext in the payload', () => {
    const secret = 'sk-super-secret-openai-key'
    const payload = encrypt(secret)
    expect(payload).not.toContain(secret)
    expect(payload).not.toContain('super')
  })

  it('produces a different ciphertext each time', () => {
    const secret = 'same input'
    expect(encrypt(secret)).not.toBe(encrypt(secret))
  })

  it('refuses a tampered payload rather than returning wrong plaintext', () => {
    const payload = encrypt('sensitive')
    const parts = payload.split('.')
    const flipped = Buffer.from(parts[3], 'base64url')
    flipped[0] = flipped[0] ^ 0xff
    const tampered = [parts[0], parts[1], parts[2], flipped.toString('base64url')].join('.')
    expect(() => decrypt(tampered)).toThrow()
  })

  it('refuses a payload with an unknown scheme version', () => {
    expect(() => decrypt('v9.aaa.bbb.ccc')).toThrow(/unknown scheme|malformed/i)
  })

  it('handles unicode', () => {
    const secret = 'pässwörd — with em dash and £'
    expect(decrypt(encrypt(secret))).toBe(secret)
  })
})

describe('credential masking', () => {
  it('never reveals whether a value is long, short, or what it starts with', () => {
    expect(maskConfigured('sk-abcdef123456')).toBe('Configured')
    expect(maskConfigured('x')).toBe('Configured')
    expect(maskConfigured(null)).toBe('Not configured')
    expect(maskConfigured(undefined)).toBe('Not configured')
    expect(maskConfigured('')).toBe('Not configured')
  })
})

describe('tokens (BUILD_SPEC §15)', () => {
  it('issues at least 128 bits of entropy', () => {
    const { token } = issueToken()
    // 32 bytes base64url encodes to 43 characters.
    expect(Buffer.from(token, 'base64url').length).toBe(32)
    expect(Buffer.from(token, 'base64url').length * 8).toBeGreaterThanOrEqual(128)
  })

  it('issues a different token every time', () => {
    const seen = new Set<string>()
    for (let i = 0; i < 500; i++) seen.add(issueToken().token)
    expect(seen.size).toBe(500)
  })

  it('stores a hash that does not contain the token', () => {
    const { token, hash } = issueToken()
    expect(hash).not.toBe(token)
    expect(hash).not.toContain(token)
    expect(token).not.toContain(hash)
  })

  it('hashes deterministically so a presented token can be looked up', () => {
    const { token, hash } = issueToken()
    expect(hashToken(token)).toBe(hash)
  })

  it('matches a correct token and rejects a wrong one', () => {
    const { token, hash } = issueToken()
    expect(tokensMatch(token, hash)).toBe(true)
    expect(tokensMatch(issueToken().token, hash)).toBe(false)
    expect(tokensMatch('', hash)).toBe(false)
    expect(tokensMatch(token + 'x', hash)).toBe(false)
  })
})

describe('template hashing (BUILD_SPEC §8.2)', () => {
  const template = {
    subject: 'Private invitation to participate in Flipit',
    htmlSource: '<p>Dear {{first_name}},</p>',
    textSource: 'Dear {{first_name}},',
  }

  it('is stable for identical source', () => {
    expect(hashTemplateSource(template)).toBe(hashTemplateSource({ ...template }))
  })

  it('changes when one character of the body changes', () => {
    const drifted = { ...template, textSource: 'Dear  {{first_name}},' }
    expect(hashTemplateSource(drifted)).not.toBe(hashTemplateSource(template))
  })

  it('changes when the subject changes', () => {
    const drifted = { ...template, subject: template.subject + ' ' }
    expect(hashTemplateSource(drifted)).not.toBe(hashTemplateSource(template))
  })

  it('cannot be fooled by moving text between the subject and the body', () => {
    const a = hashTemplateSource({ subject: 'ab', htmlSource: 'c', textSource: 'd' })
    const b = hashTemplateSource({ subject: 'a', htmlSource: 'bc', textSource: 'd' })
    expect(a).not.toBe(b)
  })
})
