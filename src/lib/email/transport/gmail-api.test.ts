import { describe, expect, it } from 'vitest'
import { GmailApiTransport } from './gmail-api'
import { TransportNotConfiguredError, type OutboundMessage } from './types'

const message: OutboundMessage = {
  to: 'investor@example.com',
  fromName: 'David Serene',
  subject: 'Subject',
  html: '<p>Body</p>',
  text: 'Body',
}

/**
 * The stub exists so `service_config.email_transport` is a real switch rather
 * than a column nobody reads (§8.1). Its job is to be selectable and to fail
 * loudly, so that is what is tested.
 */
describe('GmailApiTransport', () => {
  it('refuses to send, saying it is not configured', async () => {
    const transport = new GmailApiTransport()
    await expect(transport.sendOne(message)).rejects.toBeInstanceOf(TransportNotConfiguredError)
    await expect(transport.sendOne(message)).rejects.toThrow(/not configured/i)
  })

  it('reports a failed check rather than throwing, so the dashboard can show it', async () => {
    const result = await new GmailApiTransport().verifyConnection()
    expect(result.ok).toBe(false)
    expect(result.detail).toMatch(/not configured/i)
    expect(result.failure?.retryable).toBe(false)
  })

  it('says what implementing it would take, not just that it is missing', async () => {
    const result = await new GmailApiTransport().verifyConnection()
    expect(result.detail).toMatch(/gmail\.send/)
    expect(result.detail).toMatch(/SMTP/)
  })

  it('has no authenticated address, because nothing is authenticated', () => {
    expect(new GmailApiTransport().authenticatedAddress).toBeNull()
  })

  it('satisfies the same interface as the SMTP transport', () => {
    const transport = new GmailApiTransport()
    expect(transport.name).toBe('GMAIL_API')
    expect(typeof transport.sendOne).toBe('function')
    expect(typeof transport.verifyConnection).toBe('function')
  })
})
