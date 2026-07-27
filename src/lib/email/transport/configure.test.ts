import { describe, expect, it } from 'vitest'
import { smtpCredentialSchema } from './configure'

describe('SMTP credential input', () => {
  it('normalises the address and removes spaces from a Google app password', () => {
    const parsed = smtpCredentialSchema.parse({
      smtpUser: ' Flipit.SPV.Portal@GMAIL.com ',
      smtpPassword: 'abcd efgh ijkl mnop',
    })

    expect(parsed).toEqual({
      smtpUser: 'flipit.spv.portal@gmail.com',
      smtpPassword: 'abcdefghijklmnop',
    })
  })

  it('refuses an invalid address and implausible app password', () => {
    const parsed = smtpCredentialSchema.safeParse({
      smtpUser: 'not-an-email',
      smtpPassword: 'short',
    })

    expect(parsed.success).toBe(false)
  })
})
