import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('Owner mail configuration boundary', () => {
  const source = readFileSync('src/actions/mail-connection.ts', 'utf8')
  const action = source.slice(
    source.indexOf('export async function connectOwnerSendingAccountAction'),
    source.indexOf('/**\n * Authenticate against smtp.gmail.com'),
  )

  it('requires the Owner before storing a credential', () => {
    expect(action.indexOf('await requireOwner()')).toBeGreaterThanOrEqual(0)
    expect(action.indexOf('await requireOwner()')).toBeLessThan(
      action.indexOf('await storeSmtpCredential'),
    )
  })

  it('cannot send mail', () => {
    expect(action).not.toContain('sendOneEmail')
    expect(action).not.toContain('sendMail')
    expect(action).not.toContain('send(')
  })
})
