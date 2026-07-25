import { describe, expect, it } from 'vitest'
import type { ComplianceApprovalRecord } from './approvals'
import type { OfferGateRow } from './offers'
import { planBlockUpdates } from './offers'

/** BUILD_SPEC §8.2 item 3 — the block flags the review table reads. */

function approval(codes: string[] = ['GB', 'AU', 'FR', 'TH']): ComplianceApprovalRecord {
  return {
    id: 'approval-1',
    approverName: 'A. Lawyer',
    approverRole: 'Partner',
    approverFirm: null,
    approvedAt: new Date('2026-07-20T00:00:00Z'),
    evidenceReference: 'Letter 2026-07-20',
    approvedJurisdictions: codes,
    approvedTemplateHash: 'a'.repeat(64),
    templateKind: 'INVITATION',
    conditions: null,
    recordedById: 'user-owner',
    voidedAt: null,
    voidedReason: null,
    createdAt: new Date('2026-07-21T09:00:00Z'),
  }
}

function row(overrides: Partial<OfferGateRow> = {}): OfferGateRow {
  return {
    id: 'offer-1',
    roundId: 'round-1',
    jurisdiction: 'GB',
    blocked: false,
    blockReason: null,
    blockDetail: null,
    jurisdictionApprovalRef: null,
    recipientName: 'Jane Example',
    recipientEmail: 'jane@example.com',
    emailStatus: 'DRAFT',
    stage: 'INVITATION_SENT',
    ...overrides,
  }
}

describe('planBlockUpdates', () => {
  it('blocks an uncleared jurisdiction and leaves the cleared ones alone', () => {
    const plan = planBlockUpdates(
      [
        row({ id: 'gb', jurisdiction: 'GB' }),
        row({ id: 'us', jurisdiction: 'US' }),
        row({ id: 'au', jurisdiction: 'AU' }),
      ],
      approval(),
    )

    expect(plan.updates).toHaveLength(1)
    expect(plan.updates[0]).toMatchObject({
      offerId: 'us',
      blocked: true,
      blockReason: 'JURISDICTION_NOT_APPROVED',
      change: 'BLOCKED',
    })
    expect(plan.unchanged).toBe(2)
  })

  it('lifts a jurisdiction block when the approval is widened', () => {
    const plan = planBlockUpdates(
      [
        row({
          id: 'us',
          jurisdiction: 'US',
          blocked: true,
          blockReason: 'JURISDICTION_NOT_APPROVED',
          blockDetail: 'held',
        }),
      ],
      approval(['GB', 'US']),
    )

    expect(plan.updates).toEqual([
      {
        offerId: 'us',
        blocked: false,
        blockReason: null,
        blockDetail: null,
        emailStatus: null,
        change: 'UNBLOCKED',
      },
    ])
  })

  it('lifts a jurisdiction block when a reference has been recorded for that person', () => {
    const plan = planBlockUpdates(
      [
        row({
          id: 'us',
          jurisdiction: 'US',
          blocked: true,
          blockReason: 'JURISDICTION_NOT_APPROVED',
          jurisdictionApprovalRef: 'Baker & Co advice 2026-07-22',
        }),
        row({ id: 'us2', jurisdiction: 'US' }),
      ],
      approval(),
    )

    expect(plan.updates.find((u) => u.offerId === 'us')?.change).toBe('UNBLOCKED')
    expect(plan.updates.find((u) => u.offerId === 'us2')?.change).toBe('BLOCKED')
  })

  it('never lifts a hold placed for another reason', () => {
    for (const reason of ['VALIDATION_FAILED', 'UNRESOLVED_TEMPLATE_VARIABLE', 'MANUALLY_HELD'] as const) {
      const plan = planBlockUpdates(
        [row({ jurisdiction: 'GB', blocked: true, blockReason: reason })],
        approval(),
      )
      expect(plan.updates).toEqual([])
      expect(plan.unchanged).toBe(1)
    }
  })

  it('never overwrites another reason with the jurisdiction one', () => {
    const plan = planBlockUpdates(
      [row({ jurisdiction: 'US', blocked: true, blockReason: 'MANUALLY_HELD' })],
      approval(),
    )
    expect(plan.updates).toEqual([])
  })

  it('records a missing jurisdiction as a validation failure, not a jurisdiction refusal', () => {
    const plan = planBlockUpdates([row({ jurisdiction: null })], approval())
    expect(plan.updates[0]).toMatchObject({
      blocked: true,
      blockReason: 'VALIDATION_FAILED',
    })
  })

  it('blocks everyone when there is no approval at all', () => {
    const plan = planBlockUpdates(
      [row({ id: 'gb', jurisdiction: 'GB' }), row({ id: 'au', jurisdiction: 'AU' })],
      null,
    )
    expect(plan.updates.map((u) => u.change)).toEqual(['BLOCKED', 'BLOCKED'])
  })

  it('is idempotent — running it twice changes nothing the second time', () => {
    const rows = [row({ id: 'us', jurisdiction: 'US' })]
    const first = planBlockUpdates(rows, approval())

    const applied: OfferGateRow[] = rows.map((entry) => {
      const update = first.updates.find((u) => u.offerId === entry.id)
      return update
        ? {
            ...entry,
            blocked: update.blocked,
            blockReason: update.blockReason,
            blockDetail: update.blockDetail,
            emailStatus: update.emailStatus ?? entry.emailStatus,
          }
        : entry
    })

    expect(planBlockUpdates(applied, approval()).updates).toEqual([])
  })
})

/**
 * `offers.email_status` and `offers.blocked` are written together by the import
 * (WP3) and have to stay written together here, or a row is blocked by one
 * column and sendable by the other.
 */
describe('planBlockUpdates keeps email_status in step with the block flag', () => {
  it('marks a newly blocked draft as BLOCKED', () => {
    const plan = planBlockUpdates(
      [row({ id: 'us', jurisdiction: 'US', emailStatus: 'DRAFT' })],
      approval(),
    )
    expect(plan.updates[0]).toMatchObject({ blocked: true, emailStatus: 'BLOCKED' })
  })

  it('returns a cleared recipient to DRAFT so a send list can see them', () => {
    const plan = planBlockUpdates(
      [
        row({
          id: 'us',
          jurisdiction: 'US',
          blocked: true,
          blockReason: 'JURISDICTION_NOT_APPROVED',
          emailStatus: 'BLOCKED',
        }),
      ],
      approval(['GB', 'US']),
    )
    expect(plan.updates[0]).toMatchObject({ blocked: false, emailStatus: 'DRAFT' })
  })

  it('repairs a row whose flag and status disagree', () => {
    const plan = planBlockUpdates(
      [
        row({
          id: 'us',
          jurisdiction: 'US',
          blocked: true,
          blockReason: 'JURISDICTION_NOT_APPROVED',
          // Byte-identical to what the planner would write, so the only thing
          // left out of step is the status.
          blockDetail:
            'United States (US) is not on the compliance-approved jurisdiction list ' +
            '(GB, AU, FR, TH). This recipient is held on their own; every other ' +
            'recipient is unaffected.',
          emailStatus: 'DRAFT',
        }),
      ],
      approval(),
    )
    expect(plan.updates).toHaveLength(1)
    expect(plan.updates[0]).toMatchObject({ blocked: true, emailStatus: 'BLOCKED' })
  })

  it('never rewrites a message that has already been sent or has failed', () => {
    for (const status of ['SENT', 'FAILED'] as const) {
      const plan = planBlockUpdates(
        [row({ id: 'us', jurisdiction: 'US', emailStatus: status })],
        approval(),
      )
      expect(plan.updates[0]).toMatchObject({ blocked: true, emailStatus: null })
    }
  })
})
