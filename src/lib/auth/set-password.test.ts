import { describe, expect, it } from 'vitest'
import { InMemoryCredentialStore, type CredentialStore } from './credential-store'
import { hashPassword, verifyPassword } from './password'
import { setAdminPassword } from './set-password'

const OWNER_ID = 'user-owner'
const OWNER_EMAIL = 'mike@flipit.com'
const GOOD = 'seven pelicans crossing'
const ALSO_GOOD = 'nineteen lanterns adrift'

async function storeWithPassword(password: string | null): Promise<CredentialStore> {
  return new InMemoryCredentialStore([
    {
      userId: OWNER_ID,
      email: OWNER_EMAIL,
      passwordHash: password === null ? null : await hashPassword(password),
      passwordSetAt: password === null ? null : new Date('2026-07-01T00:00:00Z'),
    },
  ])
}

const base = {
  userId: OWNER_ID,
  email: OWNER_EMAIL,
  newPassword: GOOD,
  confirmation: GOOD,
}

describe('choosing a password for the first time', () => {
  it('accepts a strong password and stores a verifier that verifies', async () => {
    const store = await storeWithPassword(null)
    const result = await setAdminPassword(base, { store })

    expect(result.ok).toBe(true)

    const after = await store.findByEmail(OWNER_EMAIL)
    expect(after?.passwordHash).not.toBeNull()
    expect(await verifyPassword(after!.passwordHash!, GOOD)).toBe(true)
  })

  it('never stores the password itself', async () => {
    const store = await storeWithPassword(null)
    await setAdminPassword(base, { store })

    const after = await store.findByEmail(OWNER_EMAIL)
    expect(after?.passwordHash).not.toContain(GOOD)
    expect(after?.passwordHash?.startsWith('$argon2id$')).toBe(true)
  })

  it('refuses a password shorter than the minimum, and says why without quoting it', async () => {
    const store = await storeWithPassword(null)
    const result = await setAdminPassword(
      { ...base, newPassword: 'zx9qv', confirmation: 'zx9qv' },
      { store },
    )

    expect(result).toMatchObject({ ok: false, reason: 'WEAK_PASSWORD' })
    if (result.ok) throw new Error('unreachable')
    expect(result.message).not.toContain('zx9qv')
    expect(result.message).toMatch(/at least 12 characters/i)
    expect((await store.findByEmail(OWNER_EMAIL))?.passwordHash).toBeNull()
  })

  it('refuses a well-known password', async () => {
    const store = await storeWithPassword(null)
    const result = await setAdminPassword(
      { ...base, newPassword: 'correcthorsebatterystaple', confirmation: 'correcthorsebatterystaple' },
      { store },
    )
    expect(result).toMatchObject({ ok: false, reason: 'WEAK_PASSWORD' })
  })

  it('refuses a password built out of the account address', async () => {
    const store = await storeWithPassword(null)
    const result = await setAdminPassword(
      { ...base, newPassword: 'mike@flipit.com!!', confirmation: 'mike@flipit.com!!' },
      { store },
    )
    expect(result).toMatchObject({ ok: false, reason: 'WEAK_PASSWORD' })
  })

  it('reports a mistyped confirmation as a typo rather than as a weak password', async () => {
    const store = await storeWithPassword(null)
    const result = await setAdminPassword({ ...base, confirmation: 'x' }, { store })
    expect(result).toMatchObject({ ok: false, reason: 'MISMATCHED_CONFIRMATION' })
    expect((await store.findByEmail(OWNER_EMAIL))?.passwordHash).toBeNull()
  })

  it('refuses when the account already has a password, rather than overwriting it', async () => {
    const store = await storeWithPassword(GOOD)
    const result = await setAdminPassword(
      { ...base, newPassword: ALSO_GOOD, confirmation: ALSO_GOOD },
      { store },
    )

    expect(result).toMatchObject({ ok: false, reason: 'ALREADY_SET' })
    // The original still works.
    const after = await store.findByEmail(OWNER_EMAIL)
    expect(await verifyPassword(after!.passwordHash!, GOOD)).toBe(true)
  })
})

describe('changing an existing password', () => {
  it('requires the current password and replaces the verifier', async () => {
    const store = await storeWithPassword(GOOD)
    const result = await setAdminPassword(
      { ...base, newPassword: ALSO_GOOD, confirmation: ALSO_GOOD, currentPassword: GOOD },
      { store },
    )

    expect(result.ok).toBe(true)
    const after = await store.findByEmail(OWNER_EMAIL)
    expect(await verifyPassword(after!.passwordHash!, ALSO_GOOD)).toBe(true)
    expect(await verifyPassword(after!.passwordHash!, GOOD)).toBe(false)
  })

  it('refuses a wrong current password and changes nothing', async () => {
    const store = await storeWithPassword(GOOD)
    const result = await setAdminPassword(
      {
        ...base,
        newPassword: ALSO_GOOD,
        confirmation: ALSO_GOOD,
        currentPassword: 'not the password',
      },
      { store },
    )

    expect(result).toMatchObject({ ok: false, reason: 'WRONG_CURRENT_PASSWORD' })
    const after = await store.findByEmail(OWNER_EMAIL)
    expect(await verifyPassword(after!.passwordHash!, GOOD)).toBe(true)
  })

  it('refuses a first-time form replayed against an account that now has a password', async () => {
    // The give-away is a blank currentPassword against a set verifier.
    const store = await storeWithPassword(GOOD)
    const result = await setAdminPassword(
      { ...base, newPassword: ALSO_GOOD, confirmation: ALSO_GOOD, currentPassword: '' },
      { store },
    )
    expect(result).toMatchObject({ ok: false, reason: 'ALREADY_SET' })
  })

  it('refuses a current password supplied for an account that has none', async () => {
    const store = await storeWithPassword(null)
    const result = await setAdminPassword({ ...base, currentPassword: 'anything' }, { store })
    expect(result).toMatchObject({ ok: false, reason: 'NO_SUCH_ACCOUNT' })
    expect((await store.findByEmail(OWNER_EMAIL))?.passwordHash).toBeNull()
  })
})

describe('identity', () => {
  it('refuses when the address and the user id disagree', async () => {
    const store = await storeWithPassword(null)
    const result = await setAdminPassword({ ...base, userId: 'someone-else' }, { store })
    expect(result).toMatchObject({ ok: false, reason: 'NO_SUCH_ACCOUNT' })
    expect((await store.findByEmail(OWNER_EMAIL))?.passwordHash).toBeNull()
  })

  it('refuses an address with no account at all', async () => {
    const store = await storeWithPassword(null)
    const result = await setAdminPassword(
      { ...base, email: 'stranger@example.com' },
      { store },
    )
    expect(result).toMatchObject({ ok: false, reason: 'NO_SUCH_ACCOUNT' })
  })
})

describe('no message ever quotes the password', () => {
  it('holds across every failure path', async () => {
    const secret = 'a memorable pass phrase'
    const cases: Array<Promise<{ ok: boolean; message?: string }>> = [
      setAdminPassword(
        { ...base, newPassword: secret, confirmation: 'different' },
        { store: await storeWithPassword(null) },
      ),
      setAdminPassword(
        { ...base, newPassword: secret, confirmation: secret, currentPassword: secret },
        { store: await storeWithPassword(GOOD) },
      ),
      setAdminPassword(
        { ...base, email: 'nobody@example.com', newPassword: secret, confirmation: secret },
        { store: await storeWithPassword(null) },
      ),
    ]

    for (const pending of cases) {
      const result = await pending
      expect(result.ok).toBe(false)
      expect(result.message ?? '').not.toContain(secret)
    }
  })
})
