/**
 * AI-assisted column mapping. BUILD_SPEC §9.1.
 *
 * What the model is allowed to do, in full: look at the column headers and at
 * most five sample rows, and say which source column it thinks corresponds to
 * which target field. That is the entire job.
 *
 * What it is not allowed to do, enforced here rather than asked for politely:
 *
 *   - It never computes. No amount, percentage, total or indirect figure comes
 *     back from the model, and nothing in its response is read as a number.
 *     Only column names cross back over this boundary (AC27).
 *   - It never sees the full list. `MAX_SAMPLE_ROWS` is 5 and is applied to
 *     the payload, not merely requested in the prompt.
 *   - It never decides what is acceptable. Validation (§9) runs afterwards,
 *     identically to a hand-mapped file.
 *   - It is optional. With no key configured the header-name heuristic takes
 *     over and the operator maps manually.
 *
 * The provider sits behind `MappingProposer` so it can be swapped, and ships
 * as OpenAI per the decision in §9.1.
 */

import OpenAI from 'openai'
import { z } from 'zod'
import { TARGET_FIELDS, FIELD_LABEL, FIELD_HELP, isTargetField } from './fields'
import type { MappingProposal, ProposedColumn } from './mapping'
import type { SheetTable } from './table'

/** Hard ceiling on rows leaving the system. BUILD_SPEC §9.1. */
export const MAX_SAMPLE_ROWS = 5
/** Beyond this many columns the file is not what it claims to be. */
export const MAX_HEADERS = 100
/** Per-import token cap, so a runaway loop cannot quietly spend the owner's money. */
export const MAX_COMPLETION_TOKENS = 900
/** Cells longer than this are truncated before they are sent. */
const MAX_CELL_LENGTH = 120

export interface ProposerInput {
  headers: string[]
  /** At most `MAX_SAMPLE_ROWS`, and empty when `headersOnly` is set. */
  sampleRows: string[][]
  headersOnly: boolean
}

export interface ProposerOutcome {
  proposal: MappingProposal
  /** Non-secret description of what was sent, for `ai_proposals.prompt_summary`. */
  promptSummary: string
  /** The model's raw response, stored so a mis-import can be traced (§9.1). */
  raw: string
}

export interface MappingProposer {
  readonly model: string
  propose(input: ProposerInput): Promise<ProposerOutcome>
}

/**
 * Build the sample that is allowed to leave the system.
 *
 * Truncation and the row cap happen here, on the data, so no prompt wording
 * can be the only thing standing between the recipient list and the provider.
 */
export function buildSample(table: SheetTable, headersOnly: boolean): ProposerInput {
  const headers = table.headers.slice(0, MAX_HEADERS)
  if (headersOnly) return { headers, sampleRows: [], headersOnly: true }

  const sampleRows = table.rows.slice(0, MAX_SAMPLE_ROWS).map((row) =>
    headers.map((_, index) => {
      const cell = row[index] ?? ''
      return cell.length > MAX_CELL_LENGTH ? `${cell.slice(0, MAX_CELL_LENGTH)}…` : cell
    }),
  )
  return { headers, sampleRows, headersOnly: false }
}

const SYSTEM_PROMPT = [
  'You map spreadsheet columns to a fixed set of field names for an investor import.',
  'You are reading a spreadsheet, not interpreting an offer.',
  'Rules:',
  '- Return one entry for every source column, in the order given.',
  '- target_field must be exactly one of the allowed field names, or null if the column does not correspond to any of them.',
  '- Never map two source columns to the same target field. If two could match, map the better one and return null for the other, and say why in the rationale.',
  '- Do not calculate anything. Do not return any amounts, percentages, totals or converted values. Column names only.',
  '- Do not invent columns that are not in the list you were given.',
  'Answer with JSON only, in this shape:',
  '{"mappings":[{"source_column":"...","target_field":"..."|null,"confidence":"HIGH"|"MEDIUM"|"LOW","rationale":"one short sentence"}],"notes":["..."]}',
].join('\n')

export function buildUserPrompt(input: ProposerInput): string {
  const fieldList = TARGET_FIELDS.map(
    (field) => `- ${field} — ${FIELD_LABEL[field]}. ${FIELD_HELP[field]}`,
  ).join('\n')

  const parts = [
    'Allowed target fields:',
    fieldList,
    '',
    'Source columns:',
    ...input.headers.map((header) => `- ${JSON.stringify(header)}`),
  ]

  if (!input.headersOnly && input.sampleRows.length > 0) {
    parts.push(
      '',
      `Sample of the first ${input.sampleRows.length} data row(s), aligned to the source columns above:`,
      ...input.sampleRows.map((row) => JSON.stringify(row)),
    )
  } else {
    parts.push('', 'No sample rows are available. Map from the column names alone.')
  }

  return parts.join('\n')
}

const responseSchema = z.object({
  mappings: z
    .array(
      z.object({
        source_column: z.string(),
        target_field: z.string().nullable().optional(),
        confidence: z.enum(['HIGH', 'MEDIUM', 'LOW']).optional(),
        rationale: z.string().optional(),
      }),
    )
    .max(MAX_HEADERS * 2),
  notes: z.array(z.string()).optional(),
})

/**
 * Turn whatever the model said into a proposal that is safe to show.
 *
 * Anything unexpected is dropped rather than trusted: a column that is not in
 * the file, a field that does not exist, a second claim on a field already
 * taken. The result is always a complete list, one entry per real column.
 */
export function normaliseProposal(
  headers: string[],
  raw: string,
  model: string,
): MappingProposal {
  const notes: string[] = []
  let parsedJson: unknown
  try {
    parsedJson = JSON.parse(raw)
  } catch {
    return {
      source: 'AI',
      model,
      columns: headers.map((header) => blankColumn(header)),
      notes: ['The model did not return usable JSON. Map the columns yourself below.'],
    }
  }

  const parsed = responseSchema.safeParse(parsedJson)
  if (!parsed.success) {
    return {
      source: 'AI',
      model,
      columns: headers.map((header) => blankColumn(header)),
      notes: ['The model returned an unexpected shape. Map the columns yourself below.'],
    }
  }

  const claimed = new Map<string, ProposedColumn>()
  const taken = new Set<string>()

  for (const entry of parsed.data.mappings) {
    if (!headers.includes(entry.source_column)) {
      notes.push(`Ignored a suggestion for "${entry.source_column}", which is not a column in this file.`)
      continue
    }
    if (claimed.has(entry.source_column)) continue

    const target = entry.target_field ?? null
    if (target === null || target === '') {
      claimed.set(entry.source_column, blankColumn(entry.source_column, entry.rationale))
      continue
    }
    if (!isTargetField(target)) {
      notes.push(`Ignored "${target}" for column "${entry.source_column}" — that is not a field of this import.`)
      claimed.set(entry.source_column, blankColumn(entry.source_column))
      continue
    }
    if (taken.has(target)) {
      notes.push(`Two columns were suggested for ${target}. "${entry.source_column}" was left unmapped for you to decide.`)
      claimed.set(entry.source_column, blankColumn(entry.source_column))
      continue
    }
    taken.add(target)
    claimed.set(entry.source_column, {
      sourceColumn: entry.source_column,
      targetField: target,
      confidence: entry.confidence ?? 'LOW',
      rationale: entry.rationale,
    })
  }

  const columns = headers.map(
    (header) => claimed.get(header) ?? blankColumn(header),
  )

  return {
    source: 'AI',
    model,
    columns,
    notes: [...notes, ...(parsed.data.notes ?? [])].slice(0, 10),
  }
}

function blankColumn(sourceColumn: string, rationale?: string): ProposedColumn {
  return { sourceColumn, targetField: null, confidence: 'LOW', rationale }
}

/** The shipped provider. */
export class OpenAiMappingProposer implements MappingProposer {
  readonly model: string
  private readonly client: OpenAI

  constructor(apiKey: string, model: string) {
    this.model = model
    this.client = new OpenAI({ apiKey, maxRetries: 1, timeout: 30_000 })
  }

  async propose(input: ProposerInput): Promise<ProposerOutcome> {
    const userPrompt = buildUserPrompt(input)

    const completion = await this.client.chat.completions.create({
      model: this.model,
      temperature: 0,
      max_completion_tokens: MAX_COMPLETION_TOKENS,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
    })

    const raw = completion.choices[0]?.message?.content ?? ''
    return {
      proposal: normaliseProposal(input.headers, raw, this.model),
      promptSummary: describePrompt(input, this.model),
      raw,
    }
  }
}

/**
 * What was sent, described without sending it again into the audit log.
 * Column names are structure, not personal data; the sample values are neither
 * repeated here nor logged anywhere.
 */
export function describePrompt(input: ProposerInput, model: string): string {
  return [
    `model=${model}`,
    `columns=${input.headers.length}`,
    `sample_rows_sent=${input.sampleRows.length}`,
    `headers_only=${input.headersOnly}`,
    `max_sample_rows=${MAX_SAMPLE_ROWS}`,
    `headers=${JSON.stringify(input.headers)}`,
  ].join(' ')
}
