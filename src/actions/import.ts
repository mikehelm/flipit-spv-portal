'use server'

/**
 * The import server actions. BUILD_SPEC §9, §9.1.
 *
 * Three steps, and the order is the point:
 *
 *   1. `analyseImportFile` — read the file, propose a mapping, raise the
 *      ambiguities. Nothing is written except the `ImportJob` and, if a model
 *      was used, its `AiProposal`.
 *   2. `previewImport` — apply the operator's confirmed mapping, run §9
 *      validation, show every converted value as it would be stored.
 *   3. `confirmImport` — only now do recipients, accounts and offers exist.
 *
 * Every one of them re-authorises, re-parses its input with Zod, re-reads the
 * file from scratch and re-runs every check server-side. Nothing carried over
 * from a previous step is trusted, because between two requests the only thing
 * standing behind a claim is the client that made it.
 *
 * The file itself is not stored between steps. It is re-posted with each
 * request and re-read deterministically, which keeps a list of named
 * individuals and their allocations out of any temporary server-side store.
 * The `ImportJob` row remembers the headers and the row count, and a file
 * whose shape no longer matches is refused rather than imported.
 */

import { z } from 'zod'
import { audit } from '@/lib/audit'
import {
  buildSample,
  normaliseProposal,
  OpenAiMappingProposer,
  type MappingProposer,
} from '@/lib/import/ai'
import {
  ImportAuthorizationError,
  requireImportActor,
  type PrivilegedActor,
} from '@/lib/import/authz'
import { IGNORE_COLUMN, isTargetField, type TargetField } from '@/lib/import/fields'
import {
  applyMapping,
  buildQuestions,
  checkMapping,
  proposeMappingFromHeaders,
  type ConfirmedMapping,
  type MappingProposal,
} from '@/lib/import/mapping'
import {
  createImportJob,
  loadAiConfig,
  loadAiKey,
  loadImportContext,
  loadImportJob,
  loadRound,
  loadServiceMode,
  persistImport,
  recordAiProposal,
  recordAiUsage,
  toAuditActor,
  type RoundSummary,
} from '@/lib/import/persist'
import type {
  ActionFailure,
  AnalysisResult,
  ConfirmResult,
  PreviewResult,
} from '@/lib/import/results'
import { readTable, type SheetTable } from '@/lib/import/table'
import { formatMoney, formatPercentage } from '@/lib/money'
import { validateImport } from '@/lib/import/validate'
import { db } from '@/db'
import { aiProposals } from '@/db/schema'
import { eq } from 'drizzle-orm'

// ---------------------------------------------------------------------------
// Input schemas — parse, never cast
// ---------------------------------------------------------------------------

const fileSchema = z
  .instanceof(File)
  .refine((file) => file.size > 0, 'The file is empty.')
  .refine((file) => file.size <= 5 * 1024 * 1024, 'That file is larger than 5 MB.')
  .refine((file) => file.name.length <= 255, 'That filename is implausibly long.')

const answerSchema = z.object({
  percentageInterpretation: z.enum(['PERCENT', 'FRACTION']).optional(),
  decimalSeparator: z.enum(['.', ',']).optional(),
  dateOrder: z.enum(['DMY', 'MDY']).optional(),
})

const mappingSchema = z.object({
  assignments: z
    .array(
      z.object({
        sourceColumn: z.string().min(1).max(300),
        targetField: z.string().min(1).max(80),
      }),
    )
    .max(200),
  answers: z.record(z.string().max(300), answerSchema).default({}),
})

const analyseSchema = z.object({
  file: fileSchema,
  sheetName: z.string().max(200).optional(),
  /** Absent means "use it if it is configured". Explicit "false" turns it off. */
  useAi: z
    .string()
    .optional()
    .transform((value) => value === undefined || value === 'true'),
})

const previewSchema = z.object({
  file: fileSchema,
  sheetName: z.string().max(200).optional(),
  importJobId: z.string().min(1).max(120),
  mapping: z.string().max(200_000),
})

const confirmSchema = previewSchema.extend({
  aiProposalId: z.string().max(120).optional(),
})

// ---------------------------------------------------------------------------
// Shared plumbing
// ---------------------------------------------------------------------------

function failure(code: ActionFailure['code'], message: string): ActionFailure {
  return { ok: false, code, message }
}

function authorizationFailure(error: unknown): ActionFailure | null {
  if (error instanceof ImportAuthorizationError) {
    return failure('UNAUTHORIZED', error.message)
  }
  return null
}

async function guard(): Promise<{ actor: PrivilegedActor; round: RoundSummary } | ActionFailure> {
  const actor = await requireImportActor()

  const mode = await loadServiceMode()
  if (mode === 'SUNSET' || mode === 'DISABLED') {
    await audit({
      actor: toAuditActor(actor),
      entityType: 'import_job',
      action: 'import.refused',
      metadata: { reason: 'SERVICE_MODE', mode },
    })
    return failure(
      'SERVICE_MODE',
      `The service is in ${mode.toLowerCase().replace('_', ' ')} mode, so new recipients cannot be imported. ` +
        'The owner can change the service mode in settings.',
    )
  }

  const round = await loadRound()
  if (!round) {
    return failure('NO_ROUND', 'There is no open round to import into.')
  }

  return { actor, round }
}

async function readSubmittedFile(
  file: File,
  sheetName: string | undefined,
): Promise<{ table: SheetTable; notices: string[] } | ActionFailure> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  const read = readTable(file.name, bytes, { sheetName })
  if (!read.ok) return failure('FILE_UNREADABLE', read.message)
  return { table: read.table, notices: read.notices }
}

/**
 * The file posted with a later step must be the file the earlier step read.
 * Headers and row count are compared against the stored `ImportJob` — server
 * state, not something the browser told us.
 */
function matchesJob(
  table: SheetTable,
  job: { sourceHeaders: string[]; rowCount: number },
): boolean {
  if (table.rows.length !== job.rowCount) return false
  if (table.headers.length !== job.sourceHeaders.length) return false
  return table.headers.every((header, index) => header === job.sourceHeaders[index])
}

function parseMapping(raw: string):
  | { mapping: ConfirmedMapping; rejected: string[] }
  | ActionFailure {
  let json: unknown
  try {
    json = JSON.parse(raw)
  } catch {
    return failure('BAD_REQUEST', 'The mapping could not be read. Reload and try again.')
  }

  const parsed = mappingSchema.safeParse(json)
  if (!parsed.success) {
    return failure('BAD_REQUEST', 'The mapping is not in the expected form. Reload and try again.')
  }

  const assignments: Array<{ sourceColumn: string; targetField: TargetField }> = []
  const rejected: string[] = []
  for (const assignment of parsed.data.assignments) {
    if (assignment.targetField === IGNORE_COLUMN) continue
    if (!isTargetField(assignment.targetField)) {
      rejected.push(assignment.targetField)
      continue
    }
    assignments.push({
      sourceColumn: assignment.sourceColumn,
      targetField: assignment.targetField,
    })
  }

  return { mapping: { assignments, answers: parsed.data.answers }, rejected }
}

// ---------------------------------------------------------------------------
// 1. Read the file and propose a mapping
// ---------------------------------------------------------------------------

export async function analyseImportFile(formData: FormData): Promise<AnalysisResult> {
  try {
    const guarded = await guard()
    if ('ok' in guarded) return guarded
    const { actor, round } = guarded

    const parsed = analyseSchema.safeParse({
      file: formData.get('file'),
      sheetName: formData.get('sheetName') ?? undefined,
      useAi: formData.get('useAi') ?? undefined,
    })
    if (!parsed.success) {
      return failure('BAD_REQUEST', parsed.error.issues[0]?.message ?? 'Choose a file to import.')
    }

    const read = await readSubmittedFile(parsed.data.file, parsed.data.sheetName)
    if ('ok' in read) return read
    const { table, notices } = read

    const aiConfig = await loadAiConfig()
    const fallback = proposeMappingFromHeaders(table)

    let proposal: MappingProposal = fallback
    let aiUsed = false
    let aiProposalId: string | null = null
    let aiMessage: string | null = null

    const wantsAi = parsed.data.useAi && aiConfig.configured

    const importJobId = await createImportJob({
      roundId: round.id,
      filename: parsed.data.file.name,
      headers: table.headers,
      rowCount: table.rows.length,
      usedAi: false,
      actor,
    })

    if (wantsAi) {
      const key = await loadAiKey()
      if (!key) {
        aiMessage = 'The stored AI key could not be used. Map the columns yourself below.'
      } else {
        const proposer: MappingProposer = new OpenAiMappingProposer(key.apiKey, key.model)
        const sample = buildSample(table, aiConfig.headersOnly)
        try {
          const outcome = await proposer.propose(sample)
          proposal = outcome.proposal
          aiUsed = true
          await recordAiUsage({
            importJobId,
            model: proposer.model,
            usage: outcome.usage,
            succeeded: true,
          })
          aiProposalId = await recordAiProposal({
            importJobId,
            model: proposer.model,
            promptSummary: outcome.promptSummary,
            raw: outcome.raw,
            actor,
          })
          aiMessage = aiConfig.headersOnly
            ? 'Headers only were sent to the model. No data values left the system.'
            : `The column names and the first ${sample.sampleRows.length} row(s) were sent to the model. Nothing else left the system.`
        } catch {
          // A call that failed still cost money, so it is still counted (§9.1).
          // The token count is unknown — the error carries none — so it is
          // recorded as a call of unknown size rather than one that cost nothing.
          await recordAiUsage({ importJobId, model: proposer.model, succeeded: false })

          // Never surface a provider error verbatim: it can echo the request,
          // and the request contains recipient data.
          aiMessage =
            'The AI service could not be reached, so the columns below were matched by name instead. Check every one.'
        }
      }
    } else if (!aiConfig.configured) {
      aiMessage =
        'No AI key is configured, so the columns below were matched by name. Check every one.'
    }

    const proposedAssignments = proposal.columns
      .filter((column): column is typeof column & { targetField: TargetField } =>
        column.targetField !== null,
      )
      .map((column) => ({ sourceColumn: column.sourceColumn, targetField: column.targetField }))

    return {
      ok: true,
      importJobId,
      roundName: round.name,
      filename: parsed.data.file.name,
      headers: table.headers,
      sampleRows: table.rows.slice(0, 5),
      rowCount: table.rows.length,
      sheetNames: table.sheetNames,
      sheetName: table.sheetName,
      notices,
      proposal,
      questions: buildQuestions(table, proposedAssignments),
      aiConfigured: aiConfig.configured,
      aiUsed,
      aiProposalId,
      aiMessage,
    }
  } catch (error) {
    return authorizationFailure(error) ?? failure('FAILED', 'The file could not be read.')
  }
}

// ---------------------------------------------------------------------------
// 2. Apply the confirmed mapping and validate — nothing is written
// ---------------------------------------------------------------------------

export async function previewImport(formData: FormData): Promise<PreviewResult> {
  try {
    const guarded = await guard()
    if ('ok' in guarded) return guarded
    const { round } = guarded

    const parsed = previewSchema.safeParse({
      file: formData.get('file'),
      sheetName: formData.get('sheetName') ?? undefined,
      importJobId: formData.get('importJobId'),
      mapping: formData.get('mapping'),
    })
    if (!parsed.success) {
      return failure('BAD_REQUEST', 'That request was incomplete. Reload the page and start again.')
    }

    const job = await loadImportJob(parsed.data.importJobId)
    if (!job || job.roundId !== round.id) {
      return failure('JOB_MISMATCH', 'That import could not be found. Upload the file again.')
    }

    const read = await readSubmittedFile(parsed.data.file, parsed.data.sheetName)
    if ('ok' in read) return read
    const { table } = read

    if (!matchesJob(table, job)) {
      return failure(
        'JOB_MISMATCH',
        'The file has changed since it was read. Upload it again so the mapping is checked against what is actually in it.',
      )
    }

    const mappingResult = parseMapping(parsed.data.mapping)
    if ('ok' in mappingResult) return mappingResult
    const { mapping } = mappingResult

    const problems = checkMapping(table, mapping)
    const questions = buildQuestions(table, mapping.assignments)

    const context = await loadImportContext(round)

    if (problems.length > 0) {
      return {
        ok: true,
        importJobId: job.id,
        mappingProblems: problems.map((problem) => ({
          code: problem.code,
          message: problem.message,
          sourceColumn: problem.sourceColumn,
        })),
        questions,
        fileErrors: [],
        warnings: [],
        rows: [],
        totals: { proposedAmountUsd: '0.00', spvPercentage: '0.000000', rowCount: 0, blockedCount: 0 },
        totalsDisplay: { proposedAmountUsd: formatMoney('0', { currencyCode: 'USD' }), spvPercentage: formatPercentage('0') },
        canImport: false,
        approvedJurisdictions: [...context.approvedJurisdictions],
      }
    }

    const result = validateImport(applyMapping(table, mapping), mapping, context)

    return {
      ok: true,
      importJobId: job.id,
      mappingProblems: [],
      questions,
      fileErrors: result.fileErrors.slice(0, 200),
      warnings: result.warnings,
      rows: result.rows,
      totals: result.totals,
      totalsDisplay: {
        proposedAmountUsd: formatMoney(result.totals.proposedAmountUsd, { currencyCode: 'USD' }),
        spvPercentage: formatPercentage(result.totals.spvPercentage, {
          decimalPlaces: context.decimalPlaces,
        }),
      },
      canImport: result.canImport,
      approvedJurisdictions: [...context.approvedJurisdictions],
    }
  } catch (error) {
    return authorizationFailure(error) ?? failure('FAILED', 'The file could not be checked.')
  }
}

// ---------------------------------------------------------------------------
// 3. Create the records
// ---------------------------------------------------------------------------

export async function confirmImport(formData: FormData): Promise<ConfirmResult> {
  try {
    const guarded = await guard()
    if ('ok' in guarded) return guarded
    const { actor, round } = guarded

    const parsed = confirmSchema.safeParse({
      file: formData.get('file'),
      sheetName: formData.get('sheetName') ?? undefined,
      importJobId: formData.get('importJobId'),
      mapping: formData.get('mapping'),
      aiProposalId: formData.get('aiProposalId') ?? undefined,
    })
    if (!parsed.success) {
      return failure('BAD_REQUEST', 'That request was incomplete. Reload the page and start again.')
    }

    const job = await loadImportJob(parsed.data.importJobId)
    if (!job || job.roundId !== round.id) {
      return failure('JOB_MISMATCH', 'That import could not be found. Upload the file again.')
    }
    if (job.confirmedAt) {
      return failure('ALREADY_CONFIRMED', 'This file has already been imported.')
    }

    const read = await readSubmittedFile(parsed.data.file, parsed.data.sheetName)
    if ('ok' in read) return read
    const { table } = read

    if (!matchesJob(table, job)) {
      return failure(
        'JOB_MISMATCH',
        'The file has changed since it was reviewed. Upload it again and re-check it before importing.',
      )
    }

    const mappingResult = parseMapping(parsed.data.mapping)
    if ('ok' in mappingResult) return mappingResult
    const { mapping } = mappingResult

    const problems = checkMapping(table, mapping)
    if (problems.length > 0) {
      return failure('MAPPING_INVALID', problems[0].message)
    }

    const context = await loadImportContext(round)
    const result = validateImport(applyMapping(table, mapping), mapping, context)

    // The gate. Re-run here rather than trusting that step 2 said yes.
    if (!result.canImport) {
      await audit({
        actor: toAuditActor(actor),
        entityType: 'import_job',
        entityId: job.id,
        action: 'import.refused',
        metadata: {
          reason: 'FILE_LEVEL_ERRORS',
          errorCount: result.fileErrors.length,
          codes: [...new Set(result.fileErrors.map((error) => error.code))],
        },
      })
      return failure(
        'NOT_VALIDATED',
        `This file still has ${result.fileErrors.length} error(s) that stop the whole file. Fix them and upload it again.`,
      )
    }

    const provenance = await deriveProvenance(
      table,
      mapping,
      parsed.data.aiProposalId && job.usedAi ? parsed.data.aiProposalId : null,
    )

    const outcome = await persistImport({
      round,
      importJobId: job.id,
      rows: result.rows,
      mapping,
      proposedColumns: provenance.columns,
      actor,
      usedAi: provenance.usedAi,
      aiProposalId: provenance.aiProposalId,
    })

    return { ok: true, ...outcome }
  } catch (error) {
    return (
      authorizationFailure(error) ??
      failure('FAILED', 'The import could not be completed. Nothing was created.')
    )
  }
}

/**
 * Which mappings the operator accepted and which he corrected — worked out
 * from the stored proposal, not from anything the browser claims. BUILD_SPEC
 * §9.1: "Every proposal, every correction, and every confirmation is
 * audit-logged with the actor."
 */
async function deriveProvenance(
  table: SheetTable,
  mapping: ConfirmedMapping,
  aiProposalId: string | null,
): Promise<{
  columns: Array<{
    sourceColumn: string
    targetField: string
    wasProposed: boolean
    wasCorrected: boolean
  }>
  usedAi: boolean
  aiProposalId: string | null
}> {
  let proposal: MappingProposal | null = null
  let usedAi = false
  let resolvedProposalId: string | null = null

  if (aiProposalId) {
    const rows = await db
      .select()
      .from(aiProposals)
      .where(eq(aiProposals.id, aiProposalId))
      .limit(1)
    const stored = rows[0]
    if (stored) {
      proposal = normaliseProposal(table.headers, stored.rawProposal, stored.model)
      usedAi = true
      resolvedProposalId = stored.id
    }
  }

  if (!proposal) proposal = proposeMappingFromHeaders(table)

  const proposedByColumn = new Map(
    proposal.columns.map((column) => [column.sourceColumn, column.targetField]),
  )

  const columns = mapping.assignments.map((assignment) => {
    const proposed = proposedByColumn.get(assignment.sourceColumn) ?? null
    return {
      sourceColumn: assignment.sourceColumn,
      targetField: assignment.targetField,
      wasProposed: proposed === assignment.targetField,
      wasCorrected: proposed !== assignment.targetField,
    }
  })

  return { columns, usedAi, aiProposalId: resolvedProposalId }
}
