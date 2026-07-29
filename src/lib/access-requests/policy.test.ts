import { describe, expect, it } from 'vitest'
import {
  ACCESS_REQUEST_RECORDED_MESSAGE,
  accessRequestSchema,
  mayTransitionAccessRequest,
} from './policy'

describe('access request policy', () => {
  it('normalises the address and trims contact details', () => {
    const parsed = accessRequestSchema.parse({
      firstName: '  Graham ',
      lastName: ' Brain  ',
      email: ' GrahamBrain@Gmail.COM ',
      phone: ' +44 20 1234 5678 ',
    })

    expect(parsed).toEqual({
      firstName: 'Graham',
      lastName: 'Brain',
      email: 'grahambrain@gmail.com',
      phone: '+44 20 1234 5678',
    })
  })

  it('requires every verification contact field', () => {
    const parsed = accessRequestSchema.safeParse({
      firstName: '',
      lastName: '',
      email: 'not-an-email',
      phone: 'abc',
    })

    expect(parsed.success).toBe(false)
    if (!parsed.success) {
      expect(new Set(parsed.error.issues.map((issue) => issue.path[0]))).toEqual(
        new Set(['firstName', 'lastName', 'email', 'phone']),
      )
    }
  })

  it('has no transition that grants access or reopens a closed request', () => {
    expect(mayTransitionAccessRequest('PENDING', 'VERIFIED')).toBe(true)
    expect(mayTransitionAccessRequest('PENDING', 'CLOSED')).toBe(true)
    expect(mayTransitionAccessRequest('VERIFIED', 'CLOSED')).toBe(true)
    expect(mayTransitionAccessRequest('VERIFIED', 'PENDING')).toBe(false)
    expect(mayTransitionAccessRequest('CLOSED', 'PENDING')).toBe(false)
    expect(ACCESS_REQUEST_RECORDED_MESSAGE).not.toMatch(/approved|invited|access granted/i)
  })
})
