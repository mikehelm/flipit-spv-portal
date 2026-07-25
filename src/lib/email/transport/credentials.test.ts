import { inspect } from 'node:util'
import { describe, expect, it } from 'vitest'
import { encrypt } from '@/lib/crypto'
import { readSmtpCredential, SmtpCredential } from './credentials'

const USER = 'serenedavid@gmail.com'
const APP_PASSWORD = 'abcdefghijklmnop'

describe('readSmtpCredential', () => {
  it('round-trips the encrypted pair', () => {
    const credential = readSmtpCredential({
      smtpUserEncrypted: encrypt(USER),
      smtpPasswordEncrypted: encrypt(APP_PASSWORD),
    })

    expect(credential?.user).toBe(USER)
    expect(credential?.password.expose()).toBe(APP_PASSWORD)
  })

  it('returns null when nothing is stored — a state, not an error', () => {
    expect(readSmtpCredential({ smtpUserEncrypted: null, smtpPasswordEncrypted: null })).toBeNull()
  })

  it('returns null when only one half is stored', () => {
    expect(
      readSmtpCredential({ smtpUserEncrypted: encrypt(USER), smtpPasswordEncrypted: null }),
    ).toBeNull()
    expect(
      readSmtpCredential({ smtpUserEncrypted: null, smtpPasswordEncrypted: encrypt(APP_PASSWORD) }),
    ).toBeNull()
  })

  it('throws loudly when a stored value will not decrypt', () => {
    expect(() =>
      readSmtpCredential({
        smtpUserEncrypted: 'v1.aaaa.bbbb.cccc',
        smtpPasswordEncrypted: 'v1.dddd.eeee.ffff',
      }),
    ).toThrow(/could not be decrypted/i)
  })

  it('does not put the ciphertext in the error it throws', () => {
    try {
      readSmtpCredential({
        smtpUserEncrypted: 'v1.aaaa.bbbb.cccc',
        smtpPasswordEncrypted: 'v1.dddd.eeee.ffff',
      })
    } catch (error) {
      expect((error as Error).message).not.toContain('dddd')
    }
  })
})

describe('SmtpCredential never serialises', () => {
  const credential = new SmtpCredential(USER, APP_PASSWORD)

  it('redacts under JSON.stringify, including the address', () => {
    const serialised = JSON.stringify({ smtp: credential })
    expect(serialised).not.toContain(APP_PASSWORD)
    expect(serialised).not.toContain(USER)
  })

  it('redacts under util.inspect', () => {
    expect(inspect(credential, { depth: 10 })).not.toContain(APP_PASSWORD)
  })

  it('redacts under string interpolation', () => {
    expect(`${credential}`).not.toContain(APP_PASSWORD)
  })

  it('keeps both halves in private fields', () => {
    expect(Object.keys(credential)).toHaveLength(0)
    expect(JSON.stringify({ ...credential })).not.toContain(APP_PASSWORD)
  })

  it('still gives the address to a caller that asks for it by name', () => {
    // §8.1 requires the dashboard to show the authenticated address. The getter
    // is how that happens; serialisation is not.
    expect(credential.user).toBe(USER)
  })
})
