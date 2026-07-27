import type { EmailReviewClause } from './document'
import { EMAIL_REVIEW_SECTIONS, type EmailReviewSection } from './sections'

export type EmailDiffKind = 'UNCHANGED' | 'ADDED' | 'REMOVED' | 'CHANGED'

export interface EmailDiffUnit {
  id: string
  kind: EmailDiffKind
  original: string[]
  current: string[]
  clauseIds: string[]
  editableSectionId: string | null
}

function paragraphs(value: string): string[] {
  return value
    .replace(/\r\n/g, '\n')
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter(Boolean)
}

function normalise(value: string): string {
  return value
    .toLowerCase()
    .replace(/\{\{[^}]+\}\}/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function words(value: string): Set<string> {
  return new Set(normalise(value).split(' ').filter((word) => word.length >= 5))
}

function overlap(a: string, b: string): number {
  const left = words(a)
  const right = words(b)
  if (left.size === 0 || right.size === 0) return 0
  return sharedWordCount(left, right) / Math.min(left.size, right.size)
}

function sharedWordCount(left: Set<string>, right: Set<string>): number {
  let shared = 0
  for (const word of left) if (right.has(word)) shared += 1
  return shared
}

function stronglyMatches(a: string, b: string): boolean {
  const left = words(a)
  const right = words(b)
  if (left.size === 0 || right.size === 0) return false
  const shared = sharedWordCount(left, right)
  return shared >= 2 && shared / Math.min(left.size, right.size) >= 0.38
}

function paragraphClauseIds(
  value: string,
  side: 'original' | 'revised',
  clauses: readonly EmailReviewClause[],
): string[] {
  return clauses
    .filter((clause) => stronglyMatches(value, clause[side]))
    .map((clause) => clause.id)
}

function clauseIdsFor(
  original: readonly string[],
  current: readonly string[],
  clauses: readonly EmailReviewClause[],
  sections: readonly EmailReviewSection[],
): string[] {
  const left = original.join(' ')
  const right = current.join(' ')
  const ids = clauses
    .filter((clause) => {
      if (clause.id === 'subject') return /^subject:/i.test(right.trim())
      return (
        stronglyMatches(left, clause.original) ||
        (!isStructuralParagraph(right) &&
          stronglyMatches(right, clause.revised))
      )
    })
    .map((clause) => clause.id)
  const sectionId = editableSectionFor(current, sections)
  if (sectionId && clauses.some((clause) => clause.id === sectionId)) {
    ids.push(sectionId)
  }
  return [...new Set(ids)]
}

function editableSectionFor(
  current: readonly string[],
  sections: readonly EmailReviewSection[],
): string | null {
  if (
    current.length === 1 &&
    isStructuralParagraph(current[0]) &&
    !/^subject:/i.test(current[0].trim())
  ) {
    return null
  }
  const value = normalise(current.join(' '))
  let best: { id: string; score: number } | null = null
  for (const section of sections) {
    if (!section.editable) continue
    const score = overlap(value, section.currentText)
    if (score >= 0.62 && (!best || score > best.score)) {
      best = { id: section.id, score }
    }
  }
  return best?.id ?? null
}

function isStructuralParagraph(value: string): boolean {
  const trimmed = value.trim()
  const letters = trimmed.replace(/[^a-z]/gi, '')
  return (
    /^subject:/i.test(trimmed) ||
    (letters.length >= 8 && letters === letters.toUpperCase()) ||
    /^PROPOSED PARTICIPATION\b/.test(trimmed)
  )
}

export function buildPairedEmailDiff(
  originalText: string,
  currentText: string,
  clauses: readonly EmailReviewClause[],
  sections: readonly EmailReviewSection[] = EMAIL_REVIEW_SECTIONS,
): EmailDiffUnit[] {
  const original = paragraphs(originalText)
  const current = paragraphs(currentText)
  type Direction = 'MATCH' | 'REMOVE' | 'ADD'
  const gapPenalty = -0.38
  const scores: number[][] = Array.from(
    { length: original.length + 1 },
    () => new Array<number>(current.length + 1).fill(Number.NEGATIVE_INFINITY),
  )
  const directions: Array<Array<Direction | null>> = Array.from(
    { length: original.length + 1 },
    () => new Array<Direction | null>(current.length + 1).fill(null),
  )
  scores[0][0] = 0
  for (let i = 1; i <= original.length; i += 1) {
    scores[i][0] = scores[i - 1][0] + gapPenalty
    directions[i][0] = 'REMOVE'
  }
  for (let j = 1; j <= current.length; j += 1) {
    scores[0][j] = scores[0][j - 1] + gapPenalty
    directions[0][j] = 'ADD'
  }

  for (let i = 1; i <= original.length; i += 1) {
    for (let j = 1; j <= current.length; j += 1) {
      const exact = normalise(original[i - 1]) === normalise(current[j - 1])
      const similarity = exact ? 1 : overlap(original[i - 1], current[j - 1])
      const originalClauseIds = paragraphClauseIds(
        original[i - 1],
        'original',
        clauses,
      )
      const currentClauseIds = paragraphClauseIds(
        current[j - 1],
        'revised',
        clauses,
      )
      const currentSectionId = editableSectionFor([current[j - 1]], sections)
      if (
        currentSectionId &&
        clauses.some((clause) => clause.id === currentSectionId)
      ) {
        currentClauseIds.push(currentSectionId)
      }
      const sameRecordedClause = originalClauseIds.some((id) =>
        currentClauseIds.includes(id),
      )
      const sameGreeting =
        /^dear\b/i.test(original[i - 1].trim()) &&
        /^dear\b/i.test(current[j - 1].trim())
      // Two gaps cost -0.76. An unrelated diagonal costs far more, so it
      // cannot manufacture a "changed" pair. Recorded clause identity is the
      // strongest anchor; substantial word overlap is the fallback.
      const pairScore = exact
        ? 2.5
        : sameGreeting
          ? 2.4
        : isStructuralParagraph(current[j - 1])
          ? -2
          : sameRecordedClause
          ? 2 + similarity
          : similarity >= 0.3
            ? similarity
            : -2
      const choices: Array<{ score: number; direction: Direction }> = [
        {
          score: scores[i - 1][j - 1] + pairScore,
          direction: 'MATCH',
        },
        { score: scores[i - 1][j] + gapPenalty, direction: 'REMOVE' },
        { score: scores[i][j - 1] + gapPenalty, direction: 'ADD' },
      ]
      const best = choices.reduce((winner, choice) =>
        choice.score > winner.score ? choice : winner,
      )
      scores[i][j] = best.score
      directions[i][j] = best.direction
    }
  }

  const reversed: Array<{ original: string[]; current: string[] }> = []
  let i = original.length
  let j = current.length
  while (i > 0 || j > 0) {
    const direction = directions[i][j]
    if (direction === 'MATCH') {
      reversed.push({ original: [original[i - 1]], current: [current[j - 1]] })
      i -= 1
      j -= 1
    } else if (direction === 'REMOVE') {
      reversed.push({ original: [original[i - 1]], current: [] })
      i -= 1
    } else {
      reversed.push({ original: [], current: [current[j - 1]] })
      j -= 1
    }
  }
  const raw = reversed.reverse()

  return raw.map((unit, index) => {
    const kind: EmailDiffKind =
      unit.original.length === 0
        ? 'ADDED'
        : unit.current.length === 0
          ? 'REMOVED'
          : normalise(unit.original.join(' ')) === normalise(unit.current.join(' '))
            ? 'UNCHANGED'
            : 'CHANGED'

    return {
      id: `change-${String(index + 1).padStart(2, '0')}`,
      kind,
      original: unit.original,
      current: unit.current,
      clauseIds: clauseIdsFor(unit.original, unit.current, clauses, sections),
      editableSectionId: editableSectionFor(unit.current, sections),
    }
  })
}
