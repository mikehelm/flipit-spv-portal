import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AuditInput } from '@/lib/audit'

/**
 * The owner-only rule, tested against the actual server actions rather than
 * against the pure helper they call. BUILD_SPEC §8.2 item 4, §22 AC19.
 *
 * The point of testing the action and not just `authorizeComplianceAction` is
 * that the interesting failure mode is not "the rule is wrong" — it is
 * "somebody added an action and forgot to call the rule". Every exported
 * mutation in the module is enumerated below, so a new one that skips the
 * check fails this file.
 */

const currentAdmin = vi.fn()
const auditSpy = vi.fn<(input: AuditInput) => Promise<void>>()

vi.mock('@/lib/auth/guards', () => ({
  currentAdmin: () => currentAdmin(),
}))

vi.mock('@/lib/audit', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/audit')>()
  return {
    ...actual,
    audit: (input: AuditInput) => {
      // The real helper refuses secrets and message bodies. Keep that running
      // so a careless metadata key fails here rather than in production.
      actual.assertNoSecrets(input.metadata)
      auditSpy(input)
      return Promise.resolve()
    },
  }
})

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

const OPERATOR = {
  id: 'user-operator',
  email: 'serenedavid@gmail.com',
  name: 'David Serene',
  role: 'OPERATOR' as const,
}

async function actions() {
  return import('./compliance')
}

beforeEach(() => {
  currentAdmin.mockReset()
  auditSpy.mockReset()
})

/** Every mutation in the module, with a form that would otherwise succeed. */
async function everyMutation() {
  const mod = await actions()

  const approvalForm = () => {
    const form = new FormData()
    form.set('templateKind', 'INVITATION')
    form.set('approverName', 'A. Lawyer')
    form.set('approverRole', 'Partner')
    form.set('approverFirm', 'Baker & Co')
    form.set('approvedAt', '2026-07-20')
    form.set('evidenceReference', 'Letter 2026-07-20')
    form.set('jurisdictions', 'GB, AU, FR, TH')
    form.set('conditions', '')
    form.set('templateHash', 'x'.repeat(64))
    form.set('acknowledged', 'on')
    form.set('amendmentReason', 'Widening the cleared list after further advice.')
    return form
  }

  const clearForm = () => {
    const form = new FormData()
    form.set('offerId', 'offer-1')
    form.set('reference', 'Baker & Co advice 2026-07-22')
    return form
  }

  return [
    { name: 'RECORD', run: () => mod.recordApprovalAction({ status: 'idle' }, approvalForm()) },
    { name: 'AMEND', run: () => mod.amendApprovalAction({ status: 'idle' }, approvalForm()) },
    {
      name: 'VOID',
      run: () => {
        const form = new FormData()
        form.set('approvalId', 'approval-1')
        form.set('reason', 'Withdrawn following further advice.')
        return mod.voidApprovalAction({ status: 'idle' }, form)
      },
    },
    { name: 'CLEAR_RECIPIENT', run: () => mod.clearRecipientAction({ status: 'idle' }, clearForm()) },
    {
      name: 'REVOKE_RECIPIENT_CLEARANCE',
      run: () => {
        const form = new FormData()
        form.set('offerId', 'offer-1')
        return mod.revokeRecipientClearanceAction({ status: 'idle' }, form)
      },
    },
    { name: 'RECHECK', run: () => mod.recheckJurisdictionsAction({ status: 'idle' }, new FormData()) },
  ]
}

describe('an operator cannot record, amend or void an approval (§8.2 item 4)', () => {
  it('refuses every compliance mutation, with a message that says who can', async () => {
    currentAdmin.mockResolvedValue(OPERATOR)

    for (const mutation of await everyMutation()) {
      auditSpy.mockClear()
      const result = await mutation.run()

      expect(result.status, `${mutation.name} should be refused`).toBe('error')
      if (result.status !== 'error') continue
      expect(result.message).toMatch(/Only the owner/)
      expect(result.message).not.toMatch(/something went wrong/i)
    }
  })

  it('logs every refused attempt, naming the action and the role (§22 AC19)', async () => {
    currentAdmin.mockResolvedValue(OPERATOR)

    for (const mutation of await everyMutation()) {
      auditSpy.mockClear()
      await mutation.run()

      expect(auditSpy, `${mutation.name} should be audited`).toHaveBeenCalledTimes(1)
      const entry = auditSpy.mock.calls[0][0]

      expect(entry.action).toBe('compliance.refused')
      expect(entry.entityType).toBe('compliance_approval')
      expect(entry.actor).toEqual({
        kind: 'user',
        id: OPERATOR.id,
        label: OPERATOR.email,
      })
      expect(entry.metadata).toMatchObject({
        attemptedAction: mutation.name,
        refusalReason: 'NOT_OWNER',
        actorRole: 'OPERATOR',
        requiredRole: 'OWNER',
      })
    }
  })

  it('writes nothing about the attempt that could be a credential or a body', async () => {
    currentAdmin.mockResolvedValue(OPERATOR)
    const mod = await actions()
    await mod.recheckJurisdictionsAction({ status: 'idle' }, new FormData())

    // assertNoSecrets already ran inside the mock; this is the explicit form.
    const keys = Object.keys(auditSpy.mock.calls[0][0].metadata ?? {})
    expect(keys).not.toContain('token')
    expect(keys).not.toContain('body')
  })
})

describe('a signed-out caller', () => {
  it('is refused and logged as not signed in, and creates nothing', async () => {
    currentAdmin.mockResolvedValue(null)

    for (const mutation of await everyMutation()) {
      auditSpy.mockClear()
      const result = await mutation.run()

      expect(result.status).toBe('error')
      expect(auditSpy).toHaveBeenCalledTimes(1)
      expect(auditSpy.mock.calls[0][0].metadata).toMatchObject({
        refusalReason: 'NOT_SIGNED_IN',
        actorRole: null,
      })
      expect(auditSpy.mock.calls[0][0].actor).toEqual({
        kind: 'system',
        label: 'unauthenticated',
      })
    }
  })
})

describe('an offer can only be unblocked with a recorded reference (§8.3)', () => {
  const OWNER = {
    id: 'user-owner',
    email: 'mike@flipit.com',
    name: 'Michael Helm',
    role: 'OWNER' as const,
  }

  it('refuses the owner too when no reference is given', async () => {
    currentAdmin.mockResolvedValue(OWNER)
    const mod = await actions()

    for (const reference of ['', '   ', 'ok']) {
      const form = new FormData()
      form.set('offerId', 'offer-1')
      form.set('reference', reference)

      const result = await mod.clearRecipientAction({ status: 'idle' }, form)

      expect(result.status).toBe('error')
      if (result.status !== 'error') continue
      expect(result.message).toMatch(/recorded reference/)
      expect(result.message).toMatch(/no blanket unblock/i)
      // Nothing was written: the only audit entries in this module's write
      // paths come after the reference has been accepted.
      expect(auditSpy).not.toHaveBeenCalled()
    }
  })

  it('has no exported action that unblocks a jurisdiction for everybody', async () => {
    const mod = await actions()
    const names = Object.keys(mod)

    expect(names).toEqual(
      expect.arrayContaining([
        'recordApprovalAction',
        'amendApprovalAction',
        'voidApprovalAction',
        'clearRecipientAction',
        'revokeRecipientClearanceAction',
        'recheckJurisdictionsAction',
      ]),
    )
    // If someone adds one, this fails and they have to justify it here.
    expect(names).toHaveLength(6)
  })
})
