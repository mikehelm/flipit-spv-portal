import { describe, expect, it } from 'vitest'
import { hashTemplateSource } from '@/lib/crypto'
import { INVITATION_TEMPLATE, REMINDER_TEMPLATE } from '@/lib/email/templates'
import { diffTemplateSource } from './diff'
import { evaluateDrift } from './drift'

/**
 * BUILD_SPEC §8.2 item 2 — "Template drift voids approval. Any mismatch — a
 * changed word, a changed subject — disables sending until a new approval is
 * recorded."
 */

const live = {
  subject: INVITATION_TEMPLATE.subject,
  htmlSource: INVITATION_TEMPLATE.htmlSource,
  textSource: INVITATION_TEMPLATE.textSource,
}

describe('evaluateDrift', () => {
  it('permits sending when the live hash equals the approved hash', () => {
    const result = evaluateDrift({
      approvedHash: INVITATION_TEMPLATE.hash,
      liveHash: INVITATION_TEMPLATE.hash,
      templateKind: 'INVITATION',
    })
    expect(result.state).toBe('APPROVED')
    expect(result.sendingPermitted).toBe(true)
  })

  it('refuses when no approval hash exists, and says so specifically', () => {
    const result = evaluateDrift({
      approvedHash: null,
      liveHash: INVITATION_TEMPLATE.hash,
      templateKind: 'INVITATION',
    })
    expect(result.state).toBe('NO_APPROVAL')
    expect(result.sendingPermitted).toBe(false)
    expect(result.message).toMatch(/No compliance approval/)
    expect(result.message).not.toMatch(/something went wrong/i)
  })

  it('treats an empty-string approved hash as no approval, not as a match', () => {
    const result = evaluateDrift({
      approvedHash: '',
      liveHash: '',
      templateKind: 'INVITATION',
    })
    expect(result.state).toBe('NO_APPROVAL')
    expect(result.sendingPermitted).toBe(false)
  })

  // The headline test of the whole package.
  it('one changed character in the body voids the approval', () => {
    const approvedHash = INVITATION_TEMPLATE.hash

    const tampered = {
      ...live,
      textSource: `${live.textSource} `,
    }
    const liveHash = hashTemplateSource(tampered)

    expect(liveHash).not.toBe(approvedHash)

    const result = evaluateDrift({
      approvedHash,
      liveHash,
      templateKind: 'INVITATION',
    })
    expect(result.state).toBe('DRIFTED')
    expect(result.sendingPermitted).toBe(false)
    expect(result.message).toMatch(/until a new approval is recorded/)
  })

  it('one changed character in the subject voids the approval', () => {
    const liveHash = hashTemplateSource({ ...live, subject: `${live.subject}.` })
    const result = evaluateDrift({
      approvedHash: INVITATION_TEMPLATE.hash,
      liveHash,
      templateKind: 'INVITATION',
    })
    expect(result.state).toBe('DRIFTED')
  })

  it('one changed character in the HTML voids the approval', () => {
    const liveHash = hashTemplateSource({
      ...live,
      htmlSource: live.htmlSource.replace('<', ' <'),
    })
    expect(
      evaluateDrift({
        approvedHash: INVITATION_TEMPLATE.hash,
        liveHash,
        templateKind: 'INVITATION',
      }).state,
    ).toBe('DRIFTED')
  })

  it('does not accept the reminder hash for the invitation approval', () => {
    // Two templates, two hashes, two approvals (§6.5, §8.2). One is never the other.
    expect(REMINDER_TEMPLATE.hash).not.toBe(INVITATION_TEMPLATE.hash)
    expect(
      evaluateDrift({
        approvedHash: INVITATION_TEMPLATE.hash,
        liveHash: REMINDER_TEMPLATE.hash,
        templateKind: 'REMINDER',
      }).state,
    ).toBe('DRIFTED')
  })

  it('the drift carries enough detail to show what changed', () => {
    const changed = { ...live, subject: 'Something else entirely' }
    const diff = diffTemplateSource(live, changed)

    expect(diff.changedParts).toEqual(['SUBJECT'])
    expect(diff.parts.find((part) => part.part === 'SUBJECT')!.lines).not.toHaveLength(0)
  })
})
