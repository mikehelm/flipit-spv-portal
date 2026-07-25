import { describe, expect, it } from 'vitest'
import { encrypt } from '@/lib/crypto'
import { GmailApiTransport } from './gmail-api'
import { getTransport } from './index'
import { SmtpTransport } from './smtp'
import { TransportNotConfiguredError } from './types'

const USER = 'serenedavid@gmail.com'
const APP_PASSWORD = 'abcdefghijklmnop'

/**
 * §8.1: "Store the active transport in configuration so the state is never
 * ambiguous." These tests are the proof that the column is actually load-
 * bearing rather than decorative.
 */
describe('getTransport', () => {
  it('builds the SMTP transport when configuration says SMTP', () => {
    const transport = getTransport({
      emailTransport: 'SMTP',
      smtpUserEncrypted: encrypt(USER),
      smtpPasswordEncrypted: encrypt(APP_PASSWORD),
    })

    expect(transport).toBeInstanceOf(SmtpTransport)
    expect(transport.name).toBe('SMTP')
    expect(transport.authenticatedAddress).toBe(USER)
  })

  it('builds the Gmail API transport when configuration says so — the switch is real', () => {
    const transport = getTransport({
      emailTransport: 'GMAIL_API',
      smtpUserEncrypted: encrypt(USER),
      smtpPasswordEncrypted: encrypt(APP_PASSWORD),
    })

    expect(transport).toBeInstanceOf(GmailApiTransport)
    expect(transport.name).toBe('GMAIL_API')
  })

  it('does not fall back from a selected transport to a working one', async () => {
    // Silently sending over SMTP because the selected transport does not work
    // is exactly the ambiguity §8.1 asks us to avoid.
    const transport = getTransport({
      emailTransport: 'GMAIL_API',
      smtpUserEncrypted: encrypt(USER),
      smtpPasswordEncrypted: encrypt(APP_PASSWORD),
    })
    await expect(
      transport.sendOne({
        to: 'investor@example.com',
        fromName: 'David Serene',
        subject: 'Subject',
        html: '<p>Body</p>',
        text: 'Body',
      }),
    ).rejects.toBeInstanceOf(TransportNotConfiguredError)
  })

  it('refuses to build an SMTP transport with no credential, and says why', () => {
    expect(() =>
      getTransport({
        emailTransport: 'SMTP',
        smtpUserEncrypted: null,
        smtpPasswordEncrypted: null,
      }),
    ).toThrow(/no sending credential is stored/i)
  })

  it('returns a transport whose serialised form holds no credential', () => {
    const transport = getTransport({
      emailTransport: 'SMTP',
      smtpUserEncrypted: encrypt(USER),
      smtpPasswordEncrypted: encrypt(APP_PASSWORD),
    })

    expect(JSON.stringify(transport)).not.toContain(APP_PASSWORD)
  })
})

describe('the module surface', () => {
  it('exports no function that sends to more than one recipient', async () => {
    const surface = await import('./index')
    for (const name of Object.keys(surface)) {
      expect(name).not.toMatch(/send(All|Many|Bulk|Batch)|broadcast/i)
    }
    expect(Object.keys(surface)).toContain('sendOneEmail')
  })
})
