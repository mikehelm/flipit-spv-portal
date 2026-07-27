import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AuditInput } from '@/lib/audit'

/**
 * The owner-only rule and the confirmation, tested against the actual server
 * action rather than against the pure helper it calls.
 *
 * Same reasoning as `compliance.test.ts`: the interesting failure is not "the
 * rule is wrong", it is "somebody added an entry point and forgot to call the
 * rule". This module has one exported mutation and it is enumerated below, so
 * a second one that skips the check fails this file.
 *
 * The database is mocked at the *service* seam — `previewErasure` and
 * `eraseAccount` — because what is being tested here is the gate in front of
 * them. That they do the right thing to real rows is proved by
 * `scripts/verify-erasure.ts` against a real Postgres with a second investor
 * present, which is the only way that particular claim can honestly be made.
 */

const currentAdmin = vi.fn()
const auditSpy = vi.fn<(input: AuditInput) => Promise<void>>()
const previewErasure = vi.fn()
const eraseAccount = vi.fn()

vi.mock('@/lib/auth/guards', () => ({
  currentAdmin: () => currentAdmin(),
}))

vi.mock('@/lib/audit', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/audit')>()
  return {
    ...actual,
    audit: (input: AuditInput) => {
      actual.assertNoSecrets(input.metadata)
      auditSpy(input)
      return Promise.resolve()
    },
  }
})

vi.mock('@/lib/erasure/erase', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/erasure/erase')>()
  return {
    ...actual,
    previewErasure: (id: string) => previewErasure(id),
    eraseAccount: (input: unknown) => eraseAccount(input),
    auditErasureRefusal: (
      actor: { id: string; label: string } | null,
      accountId: string | null,
      detail: Record<string, unknown>,
    ) => {
      auditSpy({
        actor: actor ? { kind: 'user', id: actor.id, label: actor.label } : { kind: 'system', label: 'unauthenticated' },
        entityType: 'investor_account',
        entityId: accountId,
        action: 'investor_account.erase_refused',
        metadata: detail,
      })
      return Promise.resolve()
    },
  }
})

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

const OWNER = {
  id: 'user-owner',
  email: 'mike@flipthepage.com',
  name: 'Michael Helm',
  role: 'OWNER' as const,
}

const OPERATOR = {
  id: 'user-operator',
  email: 'serenedavid@gmail.com',
  name: 'David Serene',
  role: 'OPERATOR' as const,
}

const PREVIEW = {
  accountId: 'acc-1',
  name: 'Jane Investor',
  email: 'jane@example.com',
  status: 'ACTIVE',
  alreadyErased: false,
  counts: {
    offers: 1,
    recipients: 1,
    statusEvents: 1,
    offerStatusEvents: 0,
    emailSnapshots: 1,
    sendEvents: 1,
    conversationMessages: 2,
    investorResponses: 1,
    emailChangeRequests: 0,
    commitments: 0,
    paymentInstructions: 0,
    fundsReceipts: 0,
    documentPackages: 0,
    participationCertificates: 0,
    qaEntries: 0,
    qaThreadMessages: 0,
    registerEntries: 0,
    auditRowsRelabelled: 3,
    storedObjects: 0,
  },
  blockedBy: null as string | null,
}

function goodForm(): FormData {
  const form = new FormData()
  form.set('accountId', 'acc-1')
  form.set('confirmation', 'jane@example.com')
  form.set('acknowledged', 'on')
  return form
}

async function action() {
  const mod = await import('./erasure')
  return mod.eraseInvestorAction
}

beforeEach(() => {
  currentAdmin.mockReset()
  auditSpy.mockReset()
  previewErasure.mockReset()
  eraseAccount.mockReset()
  previewErasure.mockResolvedValue({ ...PREVIEW, counts: { ...PREVIEW.counts } })
  eraseAccount.mockResolvedValue({
    ok: true,
    pseudonym: 'Erased investor 0123456789ab',
    offersAffected: 1,
    objectsDestroyed: 0,
    auditRowsRelabelled: 3,
  })
})

describe('only the owner can erase', () => {
  it('an operator is refused, and nothing is erased', async () => {
    currentAdmin.mockResolvedValue(OPERATOR)
    const state = await (await action())({ status: 'idle' }, goodForm())

    expect(state.status).toBe('error')
    expect(eraseAccount).not.toHaveBeenCalled()
    // Not even the preview: an operator does not get to see the blast radius of
    // a decision they cannot take.
    expect(previewErasure).not.toHaveBeenCalled()
  })

  it('the refusal is written to the audit log', async () => {
    currentAdmin.mockResolvedValue(OPERATOR)
    await (await action())({ status: 'idle' }, goodForm())

    const refusals = auditSpy.mock.calls
      .map(([input]) => input)
      .filter((input) => input.action === 'investor_account.erase_refused')

    expect(refusals).toHaveLength(1)
    expect(refusals[0].metadata?.requiredRole).toBe('OWNER')
    expect(refusals[0].metadata?.actorRole).toBe('OPERATOR')
  })

  it('nobody signed in is refused too', async () => {
    currentAdmin.mockResolvedValue(null)
    const state = await (await action())({ status: 'idle' }, goodForm())

    expect(state.status).toBe('error')
    expect(eraseAccount).not.toHaveBeenCalled()
  })

  it('the owner is allowed through', async () => {
    currentAdmin.mockResolvedValue(OWNER)
    const state = await (await action())({ status: 'idle' }, goodForm())

    expect(state.status).toBe('ok')
    expect(eraseAccount).toHaveBeenCalledTimes(1)
  })
})

describe('the confirmation', () => {
  beforeEach(() => {
    currentAdmin.mockResolvedValue(OWNER)
  })

  it('a wrong address erases nothing', async () => {
    const form = goodForm()
    form.set('confirmation', 'someone.else@example.com')

    const state = await (await action())({ status: 'idle' }, form)

    expect(state.status).toBe('error')
    expect(eraseAccount).not.toHaveBeenCalled()
  })

  it('a mistyped address is audited, because it means somebody meant another row', async () => {
    const form = goodForm()
    form.set('confirmation', 'someone.else@example.com')
    await (await action())({ status: 'idle' }, form)

    expect(
      auditSpy.mock.calls
        .map(([input]) => input.action)
        .filter((a) => a === 'investor_account.erase_refused'),
    ).toHaveLength(1)
  })

  it('case and stray whitespace do not defeat it', async () => {
    const form = goodForm()
    form.set('confirmation', '  JANE@Example.com  ')

    const state = await (await action())({ status: 'idle' }, form)

    expect(state.status).toBe('ok')
  })

  it('an unticked acknowledgement erases nothing', async () => {
    const form = goodForm()
    form.delete('acknowledged')

    const state = await (await action())({ status: 'idle' }, form)

    expect(state.status).toBe('error')
    expect(eraseAccount).not.toHaveBeenCalled()
  })

  it('there is no reason field, and supplying one changes nothing', async () => {
    /*
     * Deliberate, and the opposite of every other consequential action here. An
     * erasure must not be the moment new prose about a person enters the record.
     */
    const form = goodForm()
    form.set('reason', 'Because Jane at 14 Acacia Avenue telephoned about it')

    const state = await (await action())({ status: 'idle' }, form)

    expect(state.status).toBe('ok')
    const [[input]] = eraseAccount.mock.calls
    expect(Object.keys(input as object)).toEqual(['accountId', 'actor'])
  })
})

describe('refusals that are not about authority', () => {
  beforeEach(() => {
    currentAdmin.mockResolvedValue(OWNER)
  })

  it('an unknown account is refused', async () => {
    previewErasure.mockResolvedValue(null)
    const state = await (await action())({ status: 'idle' }, goodForm())

    expect(state.status).toBe('error')
    expect(eraseAccount).not.toHaveBeenCalled()
  })

  it('an already-erased account is refused rather than erased twice', async () => {
    previewErasure.mockResolvedValue({ ...PREVIEW, alreadyErased: true })
    const state = await (await action())({ status: 'idle' }, goodForm())

    expect(state.status).toBe('error')
    if (state.status !== 'error') return
    expect(state.message).toContain('already been erased')
    expect(eraseAccount).not.toHaveBeenCalled()
  })

  it('unreachable stored files stop the whole thing before the database is touched', async () => {
    previewErasure.mockResolvedValue({
      ...PREVIEW,
      blockedBy: 'This investor holds stored files and no media store is configured.',
    })
    const state = await (await action())({ status: 'idle' }, goodForm())

    expect(state.status).toBe('error')
    expect(eraseAccount).not.toHaveBeenCalled()
  })
})

describe('what the operator and owner are told', () => {
  it('the success message names the pseudonym and what survived', async () => {
    currentAdmin.mockResolvedValue(OWNER)
    const state = await (await action())({ status: 'idle' }, goodForm())

    expect(state.status).toBe('ok')
    if (state.status !== 'ok') return
    expect(state.message).toContain('Erased investor 0123456789ab')
    expect(state.message).toContain('audit row')
    expect(state.message).toContain('archived')
  })

  it('no message anywhere repeats the erased address back', async () => {
    /*
     * The point of the exercise. A success banner that says "erased
     * jane@example.com" has just written the address into a screenshot, a
     * support ticket and whatever the browser caches.
     */
    currentAdmin.mockResolvedValue(OWNER)
    const state = await (await action())({ status: 'idle' }, goodForm())

    expect(state.status).toBe('ok')
    if (state.status !== 'ok') return
    expect(state.message).not.toContain('jane@example.com')
    expect(state.message).not.toContain('Jane Investor')
  })

  it('no audit metadata carries the erased address either', async () => {
    currentAdmin.mockResolvedValue(OWNER)
    await (await action())({ status: 'idle' }, goodForm())

    for (const [input] of auditSpy.mock.calls) {
      expect(JSON.stringify(input.metadata ?? {})).not.toContain('jane@example.com')
    }
  })
})
