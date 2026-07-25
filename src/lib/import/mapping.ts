/**
 * Column mapping — proposing it, checking it, answering its questions, and
 * applying it. BUILD_SPEC §9.1.
 *
 * The proposal is a suggestion and nothing else. It is shown to the operator
 * beside the first few converted values and it is never applied until he
 * confirms every column. This file has no idea whether the proposal came from
 * a language model or from the header-name heuristic below, and that is the
 * point — the two paths converge here, so the figures they produce cannot
 * differ (AC27).
 */

import {
  detectAmountAmbiguity,
  detectDateAmbiguity,
  detectPercentageAmbiguity,
  type Ambiguity,
  type DateFieldOrder,
  type DecimalSeparator,
  type PercentageInterpretation,
} from '@/lib/money'
import {
  FIELD_KIND,
  HEADER_SYNONYMS,
  REQUIRED_FIELDS,
  TARGET_FIELDS,
  type TargetField,
  isTargetField,
} from './fields'
import { resolveJurisdiction } from './iso-countries'
import { columnValues, type SheetTable } from './table'

export type ProposalSource = 'AI' | 'HEURISTIC'

export interface ProposedColumn {
  sourceColumn: string
  /** null means "do not import this column". */
  targetField: TargetField | null
  /** LOW / MEDIUM / HIGH. Displayed; never used to skip the confirmation. */
  confidence: 'LOW' | 'MEDIUM' | 'HIGH'
  /** Why the proposal thinks so, in one line. */
  rationale?: string
}

export interface MappingProposal {
  source: ProposalSource
  columns: ProposedColumn[]
  /** Model identifier when `source` is AI, otherwise a constant. */
  model: string
  /** Anything the proposer wants the operator to look at. */
  notes: string[]
}

/** The operator's answers to this column's ambiguity questions. */
export interface ColumnAnswer {
  percentageInterpretation?: PercentageInterpretation
  decimalSeparator?: DecimalSeparator
  dateOrder?: DateFieldOrder
}

export type ColumnAnswers = Record<string, ColumnAnswer>

/** The confirmed mapping. Only this is ever applied to a file. */
export interface ConfirmedMapping {
  assignments: Array<{ sourceColumn: string; targetField: TargetField }>
  answers: ColumnAnswers
}

// ---------------------------------------------------------------------------
// The deterministic fallback proposal — no key required
// ---------------------------------------------------------------------------

function normaliseHeader(header: string): string {
  return header
    .toLowerCase()
    .replace(/[_\-/\\]+/g, ' ')
    .replace(/[^a-z0-9%& ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Header-name matching. Runs when no AI key is configured, and also runs
 * alongside AI so the operator has something sensible if the model is
 * unreachable. BUILD_SPEC §9.1 — "The app must work fully without a key."
 */
export function proposeMappingFromHeaders(table: SheetTable): MappingProposal {
  const taken = new Set<TargetField>()
  const columns: ProposedColumn[] = []

  const scored: Array<{
    header: string
    field: TargetField
    score: number
    rationale: string
  }> = []

  for (const header of table.headers) {
    const normalised = normaliseHeader(header)
    const values = columnValues(table, header)

    for (const field of TARGET_FIELDS) {
      const synonyms = HEADER_SYNONYMS[field]
      let score = 0
      if (synonyms.includes(normalised)) score = 3
      else if (
        synonyms.some((synonym) => normalised === `${synonym} usd` || normalised === `${synonym} %`)
      )
        score = 3
      else if (synonyms.some((synonym) => normalised.includes(synonym))) score = 2
      if (score > 0) {
        scored.push({ header, field, score, rationale: `The column name looks like ${field}.` })
      }
    }

    // Content signals, for the three shapes a value states about itself. They
    // outrank header names because a header can say anything.
    const shape = describeShape(values)
    if (shape === 'EMAIL') {
      scored.push({
        header,
        field: 'recipient_email',
        score: 4,
        rationale: 'The values in this column are email addresses.',
      })
    }
    if (shape === 'DATE') {
      scored.push({
        header,
        field: 'response_deadline',
        score: 4,
        rationale: 'The values in this column are dates.',
      })
    }
    if (shape === 'COUNTRY') {
      scored.push({
        header,
        field: 'recipient_jurisdiction',
        score: 4,
        rationale: 'The values in this column are countries.',
      })
    }
  }

  scored.sort((a, b) => b.score - a.score || a.header.localeCompare(b.header))

  const chosen = new Map<string, { field: TargetField; score: number; rationale: string }>()
  for (const candidate of scored) {
    if (chosen.has(candidate.header)) continue
    if (taken.has(candidate.field)) continue
    chosen.set(candidate.header, {
      field: candidate.field,
      score: candidate.score,
      rationale: candidate.rationale,
    })
    taken.add(candidate.field)
  }

  for (const header of table.headers) {
    const match = chosen.get(header)
    columns.push({
      sourceColumn: header,
      targetField: match?.field ?? null,
      confidence: match ? (match.score >= 4 ? 'HIGH' : match.score === 3 ? 'MEDIUM' : 'LOW') : 'LOW',
      rationale: match?.rationale,
    })
  }

  const missing = REQUIRED_FIELDS.filter((field) => !taken.has(field))
  const notes =
    missing.length > 0
      ? [`Could not find a column for: ${missing.join(', ')}. Choose them yourself below.`]
      : []

  return { source: 'HEURISTIC', columns, model: 'header-name matching', notes }
}

/**
 * What a column's own values say about it. Only the three shapes that are
 * unmistakable: an address, a date, a country. Amounts and percentages are
 * deliberately NOT inferred from content — telling 5 (percent) from 5 (dollars)
 * by looking at it is exactly the guess this importer refuses to make.
 */
function describeShape(values: string[]): 'EMAIL' | 'DATE' | 'COUNTRY' | null {
  const present = values.map((value) => value.trim()).filter((value) => value !== '')
  if (present.length === 0) return null

  const share = (predicate: (value: string) => boolean) =>
    present.filter(predicate).length / present.length

  if (share((value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) >= 0.6) return 'EMAIL'
  if (
    share(
      (value) =>
        /^\d{4}-\d{1,2}-\d{1,2}$/.test(value) ||
        /^\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}$/.test(value) ||
        /^\d{1,2}[ -][A-Za-z]{3,}[ -]\d{4}$/.test(value),
    ) >= 0.6
  ) {
    return 'DATE'
  }
  if (share((value) => resolveJurisdiction(value).ok) >= 0.6) return 'COUNTRY'
  return null
}

// ---------------------------------------------------------------------------
// Checking a mapping before it is used
// ---------------------------------------------------------------------------

export interface MappingProblem {
  code:
    | 'UNKNOWN_COLUMN'
    | 'UNKNOWN_FIELD'
    | 'DUPLICATE_FIELD'
    | 'MISSING_REQUIRED_FIELD'
    | 'UNANSWERED_QUESTION'
  message: string
  sourceColumn?: string
  targetField?: TargetField
}

/**
 * Every required field mapped exactly once, every source column real, and
 * every ambiguity answered. Runs on the server on the confirmed mapping — the
 * UI having disabled the button is not a check.
 */
export function checkMapping(
  table: SheetTable,
  mapping: ConfirmedMapping,
): MappingProblem[] {
  const problems: MappingProblem[] = []
  const seen = new Map<TargetField, string>()

  for (const assignment of mapping.assignments) {
    if (!table.headers.includes(assignment.sourceColumn)) {
      problems.push({
        code: 'UNKNOWN_COLUMN',
        message: `The file has no column called "${assignment.sourceColumn}".`,
        sourceColumn: assignment.sourceColumn,
      })
      continue
    }
    if (!isTargetField(assignment.targetField)) {
      problems.push({
        code: 'UNKNOWN_FIELD',
        message: `"${assignment.targetField}" is not a field this importer knows.`,
        sourceColumn: assignment.sourceColumn,
      })
      continue
    }
    const existing = seen.get(assignment.targetField)
    if (existing) {
      problems.push({
        code: 'DUPLICATE_FIELD',
        message: `Both "${existing}" and "${assignment.sourceColumn}" are mapped to ${assignment.targetField}. Choose one.`,
        targetField: assignment.targetField,
        sourceColumn: assignment.sourceColumn,
      })
      continue
    }
    seen.set(assignment.targetField, assignment.sourceColumn)
  }

  for (const field of REQUIRED_FIELDS) {
    if (!seen.has(field)) {
      problems.push({
        code: 'MISSING_REQUIRED_FIELD',
        message: `No column is mapped to ${field}, and it is required.`,
        targetField: field,
      })
    }
  }

  for (const question of buildQuestions(table, mapping.assignments)) {
    const answer = mapping.answers[question.sourceColumn]
    const answered =
      (question.ambiguity.kind === 'PERCENTAGE_SCALE' && answer?.percentageInterpretation) ||
      (question.ambiguity.kind === 'DECIMAL_SEPARATOR' && answer?.decimalSeparator) ||
      (question.ambiguity.kind === 'DATE_FIELD_ORDER' && answer?.dateOrder)
    if (!answered) {
      problems.push({
        code: 'UNANSWERED_QUESTION',
        message: `"${question.sourceColumn}" is ambiguous and the question has not been answered: ${question.ambiguity.question}`,
        sourceColumn: question.sourceColumn,
        targetField: question.targetField,
      })
    }
  }

  return problems
}

// ---------------------------------------------------------------------------
// Questions
// ---------------------------------------------------------------------------

export interface ColumnQuestion {
  sourceColumn: string
  targetField: TargetField
  ambiguity: Ambiguity
}

/**
 * The explicit questions for this mapping. One answer per column, applied to
 * the whole column. BUILD_SPEC §9.1 — nothing here is ever answered by a
 * default.
 */
export function buildQuestions(
  table: SheetTable,
  assignments: Array<{ sourceColumn: string; targetField: TargetField }>,
): ColumnQuestion[] {
  const questions: ColumnQuestion[] = []

  for (const assignment of assignments) {
    if (!isTargetField(assignment.targetField)) continue
    if (!table.headers.includes(assignment.sourceColumn)) continue
    const values = columnValues(table, assignment.sourceColumn)
    const kind = FIELD_KIND[assignment.targetField]

    if (kind === 'percentage') {
      const ambiguity = detectPercentageAmbiguity(values)
      if (ambiguity) {
        questions.push({ ...assignment, ambiguity })
      }
    }

    if (kind === 'money') {
      const ambiguity = detectAmountAmbiguity(values)
      if (ambiguity) {
        questions.push({ ...assignment, ambiguity })
      }
    }

    if (kind === 'date') {
      const ambiguity = detectDateAmbiguity(values)
      if (ambiguity) {
        questions.push({ ...assignment, ambiguity })
      }
    }
  }

  return questions
}

// ---------------------------------------------------------------------------
// Applying it
// ---------------------------------------------------------------------------

export interface MappedRow {
  /** 1-based row number in the source file, as the operator sees it. */
  sourceRowNumber: number
  /** Raw cell text, keyed by target field. Untouched, unparsed. */
  values: Partial<Record<TargetField, string>>
}

/**
 * Pull the mapped columns out of the table. No parsing, no coercion — this
 * step only decides which cell belongs to which field.
 */
export function applyMapping(table: SheetTable, mapping: ConfirmedMapping): MappedRow[] {
  const indexes: Array<{ field: TargetField; column: number }> = []
  for (const assignment of mapping.assignments) {
    const column = table.headers.indexOf(assignment.sourceColumn)
    if (column === -1 || !isTargetField(assignment.targetField)) continue
    indexes.push({ field: assignment.targetField, column })
  }

  return table.rows.map((row, rowIndex) => {
    const values: Partial<Record<TargetField, string>> = {}
    for (const { field, column } of indexes) {
      values[field] = (row[column] ?? '').trim()
    }
    return { sourceRowNumber: table.sourceRowNumbers[rowIndex] ?? rowIndex + 1, values }
  })
}

/** The answer that applies to whichever column feeds a given field. */
export function answerForField(
  mapping: ConfirmedMapping,
  field: TargetField,
): ColumnAnswer {
  const assignment = mapping.assignments.find((entry) => entry.targetField === field)
  if (!assignment) return {}
  return mapping.answers[assignment.sourceColumn] ?? {}
}
