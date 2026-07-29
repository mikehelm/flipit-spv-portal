import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  where: vi.fn(),
  set: vi.fn(),
  update: vi.fn(),
  encrypt: vi.fn((value: string) => `ciphertext:${value.length}`),
}))

vi.mock('drizzle-orm', () => ({ eq: vi.fn(() => 'service-row') }))
vi.mock('@/db', () => ({
  db: {
    update: mocks.update,
  },
}))
vi.mock('@/db/schema', () => ({
  serviceConfig: { id: 'id' },
}))
vi.mock('@/lib/auth/service-config', () => ({
  SERVICE_CONFIG_ID: 'service',
}))
vi.mock('@/lib/crypto', () => ({ encrypt: mocks.encrypt }))

import { storeSmtpCredential } from './configure'

describe('SMTP credential storage boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.where.mockResolvedValue(undefined)
    mocks.set.mockReturnValue({ where: mocks.where })
    mocks.update.mockReturnValue({ set: mocks.set })
  })

  it('encrypts both credential fields before the database receives them', async () => {
    const smtpUser = 'mailbox@example.invalid'
    const smtpPassword = 'abcdefghijklmnop'

    await storeSmtpCredential({ smtpUser, smtpPassword })

    expect(mocks.encrypt).toHaveBeenCalledWith(smtpUser)
    expect(mocks.encrypt).toHaveBeenCalledWith(smtpPassword)
    expect(mocks.set).toHaveBeenCalledWith(
      expect.objectContaining({
        smtpUserEncrypted: `ciphertext:${smtpUser.length}`,
        smtpPasswordEncrypted: `ciphertext:${smtpPassword.length}`,
      }),
    )
    expect(JSON.stringify(mocks.set.mock.calls)).not.toContain(smtpUser)
    expect(JSON.stringify(mocks.set.mock.calls)).not.toContain(smtpPassword)
  })
})
