import { describe, expect, it } from 'vitest'
import { assertNoSecrets } from './audit'

/**
 * BUILD_SPEC §15: never log a credential, an email body, or an API key.
 * This throws rather than redacting — a silent redaction teaches nobody.
 */
describe('audit metadata refuses secrets', () => {
  it('accepts ordinary identifiers and counts', () => {
    expect(() =>
      assertNoSecrets({ offerId: 'abc', recipientCount: 12, jurisdiction: 'GB' }),
    ).not.toThrow()
  })

  it('accepts no metadata at all', () => {
    expect(() => assertNoSecrets(undefined)).not.toThrow()
  })

  it.each([
    'password',
    'smtpPassword',
    'apiKey',
    'api_key',
    'accessToken',
    'token',
    'credential',
    'htmlBody',
    'textBody',
    'body',
    'transcript',
  ])('rejects metadata key %s', (key) => {
    expect(() => assertNoSecrets({ [key]: 'anything' })).toThrow(/must not contain secrets/i)
  })

  it('names every offending key so the fix is obvious', () => {
    expect(() => assertNoSecrets({ password: 'x', body: 'y', offerId: 'z' })).toThrow(
      /password.*body|body.*password/i,
    )
  })
})
