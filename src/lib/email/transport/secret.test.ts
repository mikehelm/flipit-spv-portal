import { inspect } from 'node:util'
import { describe, expect, it } from 'vitest'
import { Secret, scrubSecrets } from './secret'

const APP_PASSWORD = 'abcdefghijklmnop'

describe('Secret', () => {
  it('gives the value back only through expose()', () => {
    const secret = new Secret(APP_PASSWORD)
    expect(secret.expose()).toBe(APP_PASSWORD)
  })

  it('cannot be reached by JSON.stringify, even nested', () => {
    const wrapped = { config: { auth: { pass: new Secret(APP_PASSWORD) } } }
    const serialised = JSON.stringify(wrapped)
    expect(serialised).not.toContain(APP_PASSWORD)
    expect(serialised).toContain('[redacted]')
  })

  it('cannot be reached by string interpolation', () => {
    expect(`${new Secret(APP_PASSWORD)}`).toBe('[redacted]')
    expect(String(new Secret(APP_PASSWORD))).toBe('[redacted]')
    expect([new Secret(APP_PASSWORD)].join(',')).toBe('[redacted]')
  })

  it('cannot be reached by console.log / util.inspect', () => {
    const inspected = inspect({ password: new Secret(APP_PASSWORD) }, { depth: 10 })
    expect(inspected).not.toContain(APP_PASSWORD)
  })

  it('exposes only its length, so a UI can say "16 characters" without the value', () => {
    expect(new Secret(APP_PASSWORD).length).toBe(16)
  })

  it('keeps the value in a private field, so removing toJSON would not leak it', () => {
    const secret = new Secret(APP_PASSWORD)
    expect(Object.keys(secret)).toHaveLength(0)
    expect(Object.getOwnPropertyNames(secret)).toHaveLength(0)
    expect(JSON.stringify({ ...secret })).not.toContain(APP_PASSWORD)
  })
})

describe('scrubSecrets', () => {
  it('removes a secret that appeared in text', () => {
    expect(scrubSecrets(`535 rejected ${APP_PASSWORD}`, [APP_PASSWORD])).toBe(
      '535 rejected [redacted]',
    )
  })

  it('accepts Secret instances as well as strings', () => {
    expect(scrubSecrets(`x ${APP_PASSWORD} y`, [new Secret(APP_PASSWORD)])).toBe('x [redacted] y')
  })

  it('removes every occurrence', () => {
    const scrubbed = scrubSecrets(`${APP_PASSWORD} and ${APP_PASSWORD}`, [APP_PASSWORD])
    expect(scrubbed).not.toContain(APP_PASSWORD)
  })

  it('ignores null, undefined and trivially short values', () => {
    expect(scrubSecrets('a short abc string', [null, undefined, 'abc'])).toBe(
      'a short abc string',
    )
  })

  it('leaves text alone when nothing matches', () => {
    expect(scrubSecrets('250 OK', [APP_PASSWORD])).toBe('250 OK')
  })
})
