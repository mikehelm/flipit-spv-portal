/**
 * Paper-review markup: the pure part.
 *
 * Everything a pencil mark needs to be decided — which words a reviewer would
 * have struck or underlined, what the balloon is allowed to claim, and the
 * geometry of a hand-drawn stroke — is computed here, with no React and no
 * randomness. Two reasons:
 *
 * 1. It is the only part of the paper view that can be wrong in a way a
 *    screenshot will not show, so it is the part worth testing.
 * 2. The "hand-drawn" wobble is seeded from the change id rather than
 *    `Math.random()`. A random path renders differently on the server and in
 *    the browser, which React reports as a hydration mismatch, and it would
 *    also mean the same passage was circled differently every time the page
 *    was opened. A reviewer's marks do not move.
 */

import type {
  EmailReviewClause,
  EmailReviewEvidenceKind,
} from '@/lib/email-review/document'
import type { EmailDiffKind, EmailDiffUnit } from '@/lib/email-review/segments'

export type PaperSide = 'original' | 'current'
export type TokenState = 'same' | 'added' | 'removed'

export interface MarkToken {
  text: string
  state: TokenState
}

export interface AnnotationEntry {
  clauseId: string
  title: string
  evidenceKind: EmailReviewEvidenceKind
  /** Null whenever nothing was actually recorded. Never a placeholder. */
  reason: string | null
  evidence: string | null
}

export interface PassageAnnotation {
  unitId: string
  kind: EmailDiffKind
  status: string
  title: string
  entries: AnnotationEntry[]
  /** True when no recorded reason explains this passage at all. */
  unverified: boolean
}

export const PASSAGE_STATUS: Record<EmailDiffKind, string> = {
  UNCHANGED: 'Unchanged',
  ADDED: 'Added',
  REMOVED: 'Removed',
  CHANGED: 'Changed',
}

/**
 * The rationale record stores the literal sentence "Reason not recorded
 * anywhere." for the six clauses nobody has explained. Showing that string in
 * the slot labelled "Recorded reason" would read as a reason. It is not one,
 * so it is turned back into an absence here and the balloon says UNVERIFIED.
 */
const NOT_RECORDED = /not recorded/i

export function recordedText(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (trimmed.length === 0) return null
  if (NOT_RECORDED.test(trimmed)) return null
  return trimmed
}

export function annotationEntry(clause: EmailReviewClause): AnnotationEntry {
  const unverified = clause.evidenceKind === 'UNVERIFIED'
  return {
    clauseId: clause.id,
    title: clause.title,
    evidenceKind: clause.evidenceKind,
    reason: unverified ? null : recordedText(clause.reason),
    evidence: unverified ? null : recordedText(clause.evidence),
  }
}

function firstLine(values: readonly string[]): string | null {
  const value = values[0]?.trim()
  if (!value) return null
  return value.length > 64 ? `${value.slice(0, 61)}…` : value
}

export function passageTitle(
  unit: EmailDiffUnit,
  clauses: readonly EmailReviewClause[],
): string {
  return (
    clauses[0]?.title ??
    firstLine(unit.current) ??
    firstLine(unit.original) ??
    PASSAGE_STATUS[unit.kind]
  )
}

export function buildPassageAnnotation(
  unit: EmailDiffUnit,
  allClauses: readonly EmailReviewClause[],
): PassageAnnotation {
  const clauses = allClauses.filter((clause) =>
    unit.clauseIds.includes(clause.id),
  )
  const entries = clauses.map(annotationEntry)
  return {
    unitId: unit.id,
    kind: unit.kind,
    status: PASSAGE_STATUS[unit.kind],
    title: passageTitle(unit, clauses),
    entries,
    unverified: entries.every((entry) => entry.reason === null),
  }
}

/* ------------------------------------------------------------------ words */

interface Piece {
  text: string
  space: boolean
  key: string
}

/**
 * Above this, the quadratic word alignment stops being worth its cost and the
 * marks stop being readable anyway — a reviewer does not underline four
 * hundred words individually, they bracket the paragraph. The fallback marks
 * the whole passage, which is what the eye wants at that length.
 */
export const MAX_ALIGNED_WORDS = 400

function split(value: string): Piece[] {
  return (value.match(/\s+|\S+/g) ?? []).map((text) => ({
    text,
    space: /^\s+$/.test(text),
    key: text.toLowerCase().replace(/[^a-z0-9{}]+/g, ''),
  }))
}

function longestCommonPairs(a: string[], b: string[]): Array<[number, number]> {
  const rows = a.length + 1
  const cols = b.length + 1
  const table = new Uint16Array(rows * cols)
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      table[i * cols + j] =
        a[i] === b[j]
          ? table[(i + 1) * cols + j + 1] + 1
          : Math.max(table[(i + 1) * cols + j], table[i * cols + j + 1])
    }
  }
  const pairs: Array<[number, number]> = []
  let i = 0
  let j = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      pairs.push([i, j])
      i += 1
      j += 1
    } else if (table[(i + 1) * cols + j] >= table[i * cols + j + 1]) {
      i += 1
    } else {
      j += 1
    }
  }
  return pairs
}

function assemble(
  pieces: Piece[],
  same: Set<number>,
  mark: TokenState,
): MarkToken[] {
  const states: TokenState[] = []
  let word = 0
  for (const piece of pieces) {
    if (piece.space) {
      states.push('same')
      continue
    }
    states.push(same.has(word) ? 'same' : mark)
    word += 1
  }

  // A run of struck words reads as one stroke, so the spaces inside it are
  // struck too. A space at either end of the run is not.
  for (let index = 0; index < pieces.length; index += 1) {
    if (!pieces[index].space) continue
    let before = index - 1
    while (before >= 0 && pieces[before].space) before -= 1
    let after = index + 1
    while (after < pieces.length && pieces[after].space) after += 1
    // A paragraph break is never inside a stroke. Carrying a strike across a
    // blank line draws a rule through the gap between two paragraphs.
    if (pieces[index].text.includes('\n')) continue
    const left = before >= 0 ? states[before] : 'same'
    const right = after < pieces.length ? states[after] : 'same'
    if (left !== 'same' && left === right) states[index] = left
  }

  const tokens: MarkToken[] = []
  for (let index = 0; index < pieces.length; index += 1) {
    const last = tokens[tokens.length - 1]
    if (last && last.state === states[index]) last.text += pieces[index].text
    else tokens.push({ text: pieces[index].text, state: states[index] })
  }
  return tokens.filter((token) => token.text.length > 0)
}

function whole(value: string, state: TokenState): MarkToken[] {
  if (value.length === 0) return []
  return [{ text: value, state }]
}

/**
 * Word-level alignment of the two sides of one paired change, so the original
 * sheet can be struck exactly where words left and the current sheet
 * underlined exactly where words arrived.
 */
export function markPassage(
  original: string,
  current: string,
): { original: MarkToken[]; current: MarkToken[] } {
  if (original.length === 0) {
    return { original: [], current: whole(current, 'added') }
  }
  if (current.length === 0) {
    return { original: whole(original, 'removed'), current: [] }
  }

  const leftPieces = split(original)
  const rightPieces = split(current)
  const leftWords = leftPieces.filter((piece) => !piece.space)
  const rightWords = rightPieces.filter((piece) => !piece.space)

  if (
    leftWords.length > MAX_ALIGNED_WORDS ||
    rightWords.length > MAX_ALIGNED_WORDS
  ) {
    return {
      original: whole(original, 'removed'),
      current: whole(current, 'added'),
    }
  }

  const pairs = longestCommonPairs(
    leftWords.map((piece) => piece.key),
    rightWords.map((piece) => piece.key),
  )
  const sameLeft = new Set(pairs.map(([index]) => index))
  const sameRight = new Set(pairs.map(([, index]) => index))

  return {
    original: assemble(leftPieces, sameLeft, 'removed'),
    current: assemble(rightPieces, sameRight, 'added'),
  }
}

export function passageText(values: readonly string[]): string {
  return values.join('\n\n')
}

/* -------------------------------------------------------------- geometry */

export function handSeed(key: string): number {
  let hash = 2166136261
  for (let index = 0; index < key.length; index += 1) {
    hash ^= key.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

/** Deterministic 0–1 from a seed and a step. Same inputs, same stroke. */
export function noise(seed: number, step: number): number {
  let value = (seed + Math.imul(step, 0x9e3779b9)) >>> 0
  value ^= value >>> 15
  value = Math.imul(value, 0x2c1b3c6d)
  value ^= value >>> 12
  value = Math.imul(value, 0x297a2d39)
  value ^= value >>> 15
  return (value >>> 0) / 4294967296
}

function swing(seed: number, step: number, amplitude: number): number {
  return round((noise(seed, step) * 2 - 1) * amplitude)
}

function round(value: number): number {
  return Math.round(value * 100) / 100
}

/**
 * An open loop, drawn clockwise from a point on the top edge and lifted before
 * it closes — the way a pencil circle actually ends. Viewbox 0–100 on both
 * axes, stretched to the passage with `preserveAspectRatio="none"` and a
 * non-scaling stroke.
 */
export function circlePath(seed: number): string {
  const left = round(3 + swing(seed, 1, 1.6))
  const right = round(97 + swing(seed, 2, 1.6))
  const top = round(6 + swing(seed, 3, 3))
  const bottom = round(94 + swing(seed, 4, 3))
  const midY = round(50 + swing(seed, 5, 7))
  const midX = round(50 + swing(seed, 6, 8))
  const start = round(24 + swing(seed, 7, 6))
  const finish = round(start - 11 + swing(seed, 8, 3))
  return [
    `M ${start} ${top}`,
    `C ${round(left + 6)} ${round(top - 1)} ${left} ${round(midY * 0.45)} ${left} ${midY}`,
    `C ${left} ${round(bottom - 4)} ${round(midX * 0.5)} ${bottom} ${midX} ${bottom}`,
    `C ${round(right - 8)} ${bottom} ${right} ${round(midY * 1.35)} ${right} ${midY}`,
    `C ${right} ${round(top + 4)} ${round(midX * 1.3)} ${top} ${finish} ${round(top + swing(seed, 9, 2))}`,
  ].join(' ')
}

/** The vertical pencil line down the margin beside a marked passage. */
export function marginRulePath(seed: number): string {
  const x = (step: number) => round(5 + swing(seed, step, 1.5))
  return [
    `M ${x(11)} 3`,
    `C ${x(12)} 26 ${x(13)} 52 ${x(14)} 74`,
    `S ${x(15)} 92 ${x(16)} 97`,
  ].join(' ')
}

/** The stroke tying a selected passage to its pair on the other sheet. */
export function tiePath(seed: number): string {
  return [
    `M 0 ${round(12 + swing(seed, 21, 1.5))}`,
    `C 28 ${round(12 + swing(seed, 22, 3))}`,
    `62 ${round(12 + swing(seed, 23, 3))}`,
    `100 ${round(12 + swing(seed, 24, 1.5))}`,
  ].join(' ')
}

/** The small proof mark in the margin: insert, delete, revise. */
export function marginGlyphPath(kind: EmailDiffKind, seed: number): string {
  const j = (step: number) => swing(seed, step, 0.7)
  if (kind === 'ADDED') {
    return `M ${round(3 + j(31))} ${round(12 + j(32))} L ${round(8 + j(33))} ${round(4 + j(34))} L ${round(13 + j(35))} ${round(12 + j(36))}`
  }
  if (kind === 'REMOVED') {
    return `M ${round(3 + j(41))} ${round(8 + j(42))} C 6 ${round(6.5 + j(43))} 10 ${round(9.5 + j(44))} ${round(13 + j(45))} ${round(8 + j(46))}`
  }
  if (kind === 'CHANGED') {
    return `M ${round(5 + j(51))} ${round(3 + j(52))} C ${round(10 + j(53))} 6 ${round(4 + j(54))} 10 ${round(9 + j(55))} ${round(13 + j(56))}`
  }
  return ''
}
