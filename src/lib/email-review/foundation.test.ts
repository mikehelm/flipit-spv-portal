import { describe, expect, it } from 'vitest'
import { INVITATION_TEMPLATE } from '@/lib/email/templates'
import {
  blockingPolicyFailures,
  evaluateInvitationPolicy,
} from '@/lib/email/policy'
import { EMAIL_REVIEW_DOCUMENT } from './document'
import {
  applySectionReplacement,
  readableInvitationSource,
  resolveEmailReviewSections,
} from './sections'
import { buildPairedEmailDiff } from './segments'

describe('email-review foundation', () => {
  it('the shipped sendable invitation passes the runtime policy', () => {
    expect(blockingPolicyFailures(evaluateInvitationPolicy(INVITATION_TEMPLATE))).toEqual([])
  })

  it('blocks wording that reveals other investors', () => {
    const candidate = applySectionReplacement(
      INVITATION_TEMPLATE,
      'offer-intro',
      'We will allocate this after hearing from all the other investors.',
    )
    expect(
      blockingPolicyFailures(evaluateInvitationPolicy(candidate)).map((entry) => entry.id),
    ).toContain('no-other-investors')
  })

  it('changes the actual HTML and text sources together', () => {
    const candidate = applySectionReplacement(
      INVITATION_TEMPLATE,
      'opening-context',
      'Flipit is beginning its next carefully planned operating phase.',
    )
    expect(candidate.htmlSource).toContain(
      'Flipit is beginning its next carefully planned operating phase.',
    )
    expect(candidate.textSource).toContain(
      'Flipit is beginning its next carefully planned operating phase.',
    )
    expect(candidate.htmlSource).not.toContain(
      'Flipit has completed an extended period of development',
    )
  })

  it('can safely replace wording that was promoted in an earlier version', () => {
    const firstWording = 'Flipit is beginning its next carefully planned operating phase.'
    const first = applySectionReplacement(
      INVITATION_TEMPLATE,
      'opening-context',
      firstWording,
    )
    const sections = resolveEmailReviewSections(
      first,
      new Map([['opening-context', [firstWording]]]),
    )
    expect(
      sections.find((section) => section.id === 'opening-context')?.currentText,
    ).toBe(firstWording)

    const secondWording = 'Flipit is moving into its commercial operating phase.'
    const second = applySectionReplacement(
      first,
      'opening-context',
      secondWording,
      firstWording,
    )
    expect(second.htmlSource).toContain(secondWording)
    expect(second.textSource).toContain(secondWording)
    expect(second.textSource).not.toContain(firstWording)
  })

  it('builds paired, selectable units from the preserved original and live source', () => {
    const units = buildPairedEmailDiff(
      EMAIL_REVIEW_DOCUMENT.original.text,
      readableInvitationSource(INVITATION_TEMPLATE),
      EMAIL_REVIEW_DOCUMENT.clauses,
    )
    expect(units.length).toBeGreaterThan(5)
    expect(units.some((unit) => unit.kind !== 'UNCHANGED')).toBe(true)
    expect(units.some((unit) => unit.editableSectionId !== null)).toBe(true)
  })
})
