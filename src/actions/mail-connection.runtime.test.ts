import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  store: vi.fn(),
  verify: vi.fn(),
  send: vi.fn(),
  audit: vi.fn(),
  requireOwner: vi.fn(),
  revalidatePath: vi.fn(),
}))

vi.mock('drizzle-orm', () => ({ eq: vi.fn() }))
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }))
vi.mock('@/db', () => ({
  db: { update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn() })) })) },
}))
vi.mock('@/db/schema', () => ({
  serviceConfig: { id: 'id' },
}))
vi.mock('@/lib/audit', () => ({ audit: mocks.audit }))
vi.mock('@/lib/auth/guards', () => ({
  requireAdmin: mocks.requireOwner,
  requireOwner: mocks.requireOwner,
}))
vi.mock('@/lib/auth/service-config', () => ({
  readServiceConfig: vi.fn(),
  SERVICE_CONFIG_ID: 'service',
}))
vi.mock('@/lib/email/transport', () => ({
  verifyMailConnection: mocks.verify,
  sendOneEmail: mocks.send,
}))
vi.mock('@/lib/email/transport/configure', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('@/lib/email/transport/configure')>()
  return { ...original, storeSmtpCredential: mocks.store }
})

import { connectOwnerSendingAccountAction } from './mail-connection'

describe('owner SMTP configuration runtime boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireOwner.mockResolvedValue({
      id: 'owner-1',
      email: 'owner@example.invalid',
      role: 'OWNER',
    })
  })

  it('stores, verifies without sending, and never returns the app password', async () => {
    mocks.verify.mockResolvedValue({
      ok: true,
      authenticatedAddress: 'mailbox@example.invalid',
    })

    const form = new FormData()
    form.set('smtpUser', 'mailbox@example.invalid')
    form.set('smtpPassword', 'abcd efgh ijkl mnop')

    const result = await connectOwnerSendingAccountAction(
      { status: 'idle' },
      form,
    )

    expect(mocks.requireOwner).toHaveBeenCalledOnce()
    expect(mocks.store).toHaveBeenCalledWith({
      smtpUser: 'mailbox@example.invalid',
      smtpPassword: 'abcdefghijklmnop',
    })
    expect(mocks.verify).toHaveBeenCalledOnce()
    expect(mocks.send).not.toHaveBeenCalled()
    expect(JSON.stringify(mocks.audit.mock.calls)).not.toContain('abcdefghijklmnop')
    expect(JSON.stringify(mocks.audit.mock.calls)).not.toContain('abcd efgh')
    expect(JSON.stringify(result)).not.toContain('abcdefghijklmnop')
    expect(JSON.stringify(result)).not.toContain('abcd efgh')
  })

  it('reports a failed authentication without sending or exposing the secret', async () => {
    mocks.verify.mockResolvedValue({
      ok: false,
      detail: 'Gmail refused the authentication. Nothing was sent.',
    })

    const form = new FormData()
    form.set('smtpUser', 'mailbox@example.invalid')
    form.set('smtpPassword', 'qrst uvwx yzab cdef')

    const result = await connectOwnerSendingAccountAction(
      { status: 'idle' },
      form,
    )

    expect(mocks.send).not.toHaveBeenCalled()
    expect(JSON.stringify(mocks.audit.mock.calls)).not.toContain('qrstuvwxyzabcdef')
    expect(JSON.stringify(mocks.audit.mock.calls)).not.toContain('qrst uvwx')
    expect(JSON.stringify(result)).not.toContain('qrstuvwxyzabcdef')
    expect(JSON.stringify(result)).not.toContain('qrst uvwx')
  })
})
