import { afterEach, describe, expect, it } from 'vitest'
import {
  clearPrivilegedActorResolver,
  ImportAuthorizationError,
  registerPrivilegedActorResolver,
  requireImportActor,
  type PrivilegedActor,
} from './authz'

const owner: PrivilegedActor = {
  userId: 'user-owner',
  email: 'mike@flipit.com',
  role: 'OWNER',
  label: 'mike@flipit.com',
}

const operator: PrivilegedActor = {
  userId: 'user-operator',
  email: 'serenedavid@gmail.com',
  role: 'OPERATOR',
  label: 'serenedavid@gmail.com',
}

afterEach(() => {
  clearPrivilegedActorResolver()
})

describe('requireImportActor', () => {
  it('lets the operator import — he is the one who uploads the list', async () => {
    registerPrivilegedActorResolver(async () => operator)
    await expect(requireImportActor()).resolves.toEqual(operator)
  })

  it('lets the owner import — full access to all records', async () => {
    registerPrivilegedActorResolver(async () => owner)
    await expect(requireImportActor()).resolves.toEqual(owner)
  })

  it('refuses when nobody is signed in', async () => {
    registerPrivilegedActorResolver(async () => null)
    await expect(requireImportActor()).rejects.toBeInstanceOf(ImportAuthorizationError)
    await expect(requireImportActor()).rejects.toMatchObject({ code: 'NOT_SIGNED_IN' })
  })

  it('refuses a role that is not permitted for this particular action', async () => {
    registerPrivilegedActorResolver(async () => operator)
    await expect(requireImportActor(['OWNER'])).rejects.toMatchObject({ code: 'WRONG_ROLE' })
  })

  it('refuses rather than throwing something unrecognisable when the session lookup fails', async () => {
    registerPrivilegedActorResolver(async () => {
      throw new Error('session store unavailable')
    })
    await expect(requireImportActor()).rejects.toThrow('session store unavailable')
  })
})
