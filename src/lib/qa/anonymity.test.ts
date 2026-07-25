import { describe, expect, it } from 'vitest'
import {
  coarsePeriod,
  orderPublicEntries,
  publishBlock,
  requiresAnonymityAcknowledgement,
  scanForIdentifyingDetail,
  toPublicEntry,
  type QaEntrySource,
} from './anonymity'

/**
 * BUILD_SPEC §6.7.3 — "the anonymity that has to be real".
 *
 * These are the tests that must fail loudly if someone later widens the public
 * projection or softens the scan.
 */

function entry(overrides: Partial<QaEntrySource> = {}): QaEntrySource {
  return {
    id: 'entry-1',
    questionOriginal: 'What happens if the round does not fill?',
    questionPublic: 'What happens if the round does not fill?',
    answer: 'The SPV does not proceed and nothing is drawn down.',
    askedByAccountId: 'account-1',
    isPublished: true,
    publishedAt: new Date('2026-07-14T11:32:07Z'),
    unpublishedAt: null,
    pinned: false,
    sortOrder: 0,
    updatedAtLabel: null,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// The public projection is structural
// ---------------------------------------------------------------------------

describe('the published entry cannot carry an identity', () => {
  it('exposes exactly six fields and no more', () => {
    const published = toPublicEntry(entry())
    expect(published).not.toBeNull()

    // Not `toContain` — an exact set. A field added to `PublicQaEntry` without
    // a deliberate decision fails here rather than shipping to investors.
    expect(Object.keys(published!).sort()).toEqual([
      'answer',
      'id',
      'pinned',
      'publishedPeriod',
      'question',
      'updatedPeriod',
    ])
  })

  it('carries no account id anywhere in its serialised form', () => {
    const serialised = JSON.stringify(toPublicEntry(entry({ askedByAccountId: 'account-99' })))
    expect(serialised).not.toContain('account-99')
    expect(serialised).not.toContain('askedBy')
  })

  it('publishes the rewritten wording, never the original', () => {
    const published = toPublicEntry(
      entry({
        questionOriginal: 'As we discussed on Tuesday, can I put in more than the 5% you offered me?',
        questionPublic: 'Can an investor increase their allocation?',
      }),
    )

    expect(published!.question).toBe('Can an investor increase their allocation?')
    expect(published!.question).not.toContain('Tuesday')
    expect(published!.question).not.toContain('5%')
  })

  it('returns null for an entry that is not published', () => {
    expect(toPublicEntry(entry({ isPublished: false }))).toBeNull()
  })

  it('returns null for a withdrawn entry even if the flag was left set', () => {
    // The query filters withdrawn entries too. This is the second lock: a
    // caller that forgets the `unpublishedAt is null` clause still gets nothing.
    expect(
      toPublicEntry(entry({ isPublished: true, unpublishedAt: new Date('2026-08-01T00:00:00Z') })),
    ).toBeNull()
  })

  it('returns null rather than throwing when a published row is unpublishable', () => {
    // One bad row must not take the shared page down for everybody.
    expect(toPublicEntry(entry({ answer: null }))).toBeNull()
    expect(toPublicEntry(entry({ questionPublic: null }))).toBeNull()
  })
})

describe('the published date is not precise enough to identify (§6.7.3)', () => {
  it('coarsens a timestamp to a month and a year', () => {
    expect(coarsePeriod(new Date('2026-07-14T11:32:07Z'))).toBe('July 2026')
  })

  it('never leaks a day', () => {
    const published = toPublicEntry(entry())
    expect(published!.publishedPeriod).toBe('July 2026')
    expect(published!.publishedPeriod).not.toMatch(/\d{1,2}\b(?!\d)(?:st|nd|rd|th)?\s/)
    expect(JSON.stringify(published)).not.toContain('14')
  })

  it('handles a missing or invalid date without inventing one', () => {
    expect(coarsePeriod(null)).toBeNull()
    expect(coarsePeriod(new Date('not a date'))).toBeNull()
  })

  it('stamps an edited entry as updated, also to the month', () => {
    const published = toPublicEntry(
      entry({ updatedAtLabel: new Date('2026-09-02T08:00:00Z') }),
    )
    expect(published!.updatedPeriod).toBe('September 2026')
  })
})

// ---------------------------------------------------------------------------
// Publish preconditions
// ---------------------------------------------------------------------------

describe('what stops an entry publishing', () => {
  it('refuses an entry with no answer', () => {
    expect(publishBlock(entry({ answer: null }))).toBe('NO_ANSWER')
    expect(publishBlock(entry({ answer: '   ' }))).toBe('NO_ANSWER')
  })

  it('requires a public rewrite for an investor-asked question', () => {
    expect(publishBlock(entry({ questionPublic: null }))).toBe('NO_PUBLIC_QUESTION')
  })

  it('does not require a rewrite for an entry the operator wrote himself', () => {
    expect(
      publishBlock(entry({ askedByAccountId: null, questionPublic: null })),
    ).toBeNull()
  })

  it('never falls back to the original wording for an investor-asked entry', () => {
    // The tempting shortcut is `questionPublic ?? questionOriginal`. That is
    // the version that publishes somebody's own words the first time the
    // operator forgets to rewrite them.
    const withoutRewrite = entry({ questionPublic: null })
    expect(toPublicEntry(withoutRewrite)).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// The scan
// ---------------------------------------------------------------------------

describe('the identifying-detail scan (§6.7.3)', () => {
  it('catches the example the spec gives verbatim', () => {
    const findings = scanForIdentifyingDetail(
      "As we discussed on Tuesday, I'd want to put in more than the 5% you offered me…",
    )

    const kinds = findings.map((finding) => finding.kind)
    expect(kinds).toContain('PERCENTAGE')
    expect(kinds).toContain('SPECIFIC_DATE')
    expect(kinds).toContain('PRIVATE_CONVERSATION')
    expect(requiresAnonymityAcknowledgement(findings)).toBe(true)
  })

  it('catches money in several shapes', () => {
    for (const text of ['$5,000', '5000 USD', '£2,500', '1,000 dollars']) {
      const kinds = scanForIdentifyingDetail(text).map((finding) => finding.kind)
      expect(kinds, text).toContain('MONEY_AMOUNT')
    }
  })

  it('catches percentages written as words', () => {
    const kinds = scanForIdentifyingDetail('about 30 per cent of the company').map(
      (finding) => finding.kind,
    )
    expect(kinds).toContain('PERCENTAGE')
  })

  it('catches an email address and a telephone number', () => {
    const kinds = scanForIdentifyingDetail(
      'Write to jane.doe@example.com or call +44 20 7946 0958.',
    ).map((finding) => finding.kind)

    expect(kinds).toContain('EMAIL_ADDRESS')
    expect(kinds).toContain('TELEPHONE_NUMBER')
  })

  it('catches first-person references to a holding', () => {
    const kinds = scanForIdentifyingDetail('Can I increase my allocation later?').map(
      (finding) => finding.kind,
    )
    expect(kinds).toContain('FIRST_PERSON_HOLDING')
  })

  it('finds nothing in genuinely general wording', () => {
    const findings = scanForIdentifyingDetail(
      'What is an SPV, and who holds the shares?',
      'The SPV is a company formed to hold a single asset on behalf of its members.',
    )
    expect(findings).toEqual([])
    expect(requiresAnonymityAcknowledgement(findings)).toBe(false)
  })

  it('does not skip matches on a second call', () => {
    // A shared global regex carries `lastIndex` between calls and would find
    // nothing every second time. The rules are rebuilt per call for this.
    const once = scanForIdentifyingDetail('$5,000')
    const twice = scanForIdentifyingDetail('$5,000')
    expect(twice).toEqual(once)
    expect(twice.length).toBeGreaterThan(0)
  })

  it('reports one line per distinct finding, not one per occurrence', () => {
    const findings = scanForIdentifyingDetail('5% here and 5% there')
    const percentages = findings.filter((finding) => finding.kind === 'PERCENTAGE')
    expect(percentages).toHaveLength(1)
  })

  it('scans the answer as well as the question', () => {
    const findings = scanForIdentifyingDetail(
      'Can allocations change?',
      'Yours specifically was $5,000.',
    )
    expect(findings.map((finding) => finding.kind)).toContain('MONEY_AMOUNT')
  })

  it('ignores empty input', () => {
    expect(scanForIdentifyingDetail('', null, undefined)).toEqual([])
  })
})

describe('ordering', () => {
  it('puts pinned entries first and is stable otherwise', () => {
    const a = toPublicEntry(entry({ id: 'a' }))!
    const b = toPublicEntry(entry({ id: 'b', pinned: true }))!
    const c = toPublicEntry(entry({ id: 'c' }))!

    expect(orderPublicEntries([a, b, c]).map((item) => item.id)).toEqual(['b', 'a', 'c'])
  })
})
