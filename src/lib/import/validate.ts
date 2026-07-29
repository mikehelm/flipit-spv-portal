/**
 * Validation — BUILD_SPEC §9, §10.
 *
 * Two severities, and the whole design of this file is keeping them apart:
 *
 *   **FILE-LEVEL errors** stop the entire file. Missing required values,
 *   malformed emails, duplicates against records that already exist,
 *   non-numeric or out-of-range percentages and amounts, invalid supplied
 *   deadlines, and supplied jurisdiction values that are not valid ISO
 *   3166-1 alpha-2 codes. Nothing imports until they are fixed.
 *
 *   **PER-RECIPIENT blocks** import a draft while preventing it from being
 *   sent. A missing deadline, missing jurisdiction, duplicate address within
 *   the same new file, or a valid country outside the approved list stays
 *   visible and editable after import. The send gates remain authoritative.
 *
 * Warnings block nothing. The operator may be modelling (§10).
 *
 * Every figure here is a string or a `Decimal`. The calculation is
 * `computeIndirectPercentage`, which is the only implementation of it in the
 * codebase, so the numbers are identical whether the mapping came from a model
 * or from a dropdown (AC27).
 */

import {
  computeIndirectPercentage,
  formatMoney,
  formatPercentage,
  isoDateIsBefore,
  MONEY_SCALE,
  PERCENTAGE_SCALE,
  parseDate,
  parseMoney,
  parsePercentage,
  sumDecimals,
  toStorageString,
  type ParseNote,
} from '@/lib/money'
import { REQUIRED_FIELDS, type TargetField } from './fields'
import { resolveJurisdiction } from './iso-countries'
import { answerForField, type ConfirmedMapping, type MappedRow } from './mapping'

export interface ImportContext {
  /** Today, as YYYY-MM-DD, in the operator's timezone. */
  today: string
  /** `rounds.flipit_share` — the fraction the SPV acquires, e.g. "0.300000". */
  flipitShare: string
  /** `service_config.approved_jurisdictions`. Empty means nobody is cleared. */
  approvedJurisdictions: readonly string[]
  /** `service_config.aggregate_raise_usd`. */
  aggregateRaiseUsd: string
  /** Emails already on a recipient or investor account. Lowercased. */
  existingEmails: readonly string[]
  /** `service_config.decimal_places`, display only. */
  decimalPlaces: number
}

export type FileErrorCode =
  | 'MISSING_VALUE'
  | 'MALFORMED_EMAIL'
  | 'DUPLICATE_EMAIL_IN_FILE'
  | 'DUPLICATE_EMAIL_EXISTING'
  | 'INVALID_AMOUNT'
  | 'INVALID_PERCENTAGE'
  | 'INVALID_DEADLINE'
  | 'PAST_DEADLINE'
  | 'INVALID_JURISDICTION'
  | 'PRECISION_LOSS'
  | 'NO_ROWS'

export interface FileError {
  code: FileErrorCode
  /** Null for a whole-file problem. */
  sourceRowNumber: number | null
  field: TargetField | null
  message: string
  /** The offending cell exactly as it appeared. Never a computed value. */
  raw?: string
}

export type WarningCode =
  | 'SPV_PERCENTAGE_TOTAL_OVER_100'
  | 'AMOUNT_TOTAL_OVER_AGGREGATE'
  | 'ZERO_PERCENTAGE'
  | 'ZERO_AMOUNT'
  | 'INDIRECT_OVERRIDE_DIFFERS'
  | 'DUPLICATE_EMAIL_REQUIRES_REVIEW'
  | 'MISSING_DEADLINE'
  | 'MISSING_JURISDICTION'

export interface ImportWarning {
  code: WarningCode
  sourceRowNumber: number | null
  message: string
}

/** A row that is ready to become a recipient, an account and an offer. */
export interface PreparedRow {
  sourceRowNumber: number
  name: string
  email: string
  jurisdiction: string | null
  /** Set when the cell was a country name rather than a code, so the UI can show it. */
  jurisdictionReadFrom: string | null

  /** Storage strings — exact, already at the column's scale. */
  proposedAmountUsd: string
  spvPercentage: string
  indirectPercentage: string
  indirectOverridden: boolean

  responseDeadline: string | null
  senderName: string | null
  senderEmail: string | null
  senderPhone: string | null
  internalNotes: string | null

  /** Per-recipient block. The row imports; only this row cannot be sent to. */
  blocked: boolean
  blockReason: 'JURISDICTION_NOT_APPROVED' | 'VALIDATION_FAILED' | null
  blockDetail: string | null

  /** What the parser had to do, shown beside the row before import. */
  notes: ParseNote[]
  /** The row exactly as it will read in the review table. */
  display: {
    amount: string
    spvPercentage: string
    indirectPercentage: string
    deadline: string
  }
}

export interface ValidationResult {
  fileErrors: FileError[]
  warnings: ImportWarning[]
  rows: PreparedRow[]
  totals: {
    proposedAmountUsd: string
    spvPercentage: string
    rowCount: number
    blockedCount: number
  }
  /** False whenever there is a single file-level error. */
  canImport: boolean
}

/**
 * Deliberately strict, and deliberately not a full RFC 5322 implementation —
 * an address that does not match this shape is one nobody should be sending a
 * securities invitation to.
 */
const EMAIL = /^[^\s@,;:<>()[\]\\"]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?)+$/

export function isValidEmail(value: string): boolean {
  const trimmed = value.trim()
  return trimmed.length <= 254 && EMAIL.test(trimmed)
}

export function validateImport(
  rows: MappedRow[],
  mapping: ConfirmedMapping,
  context: ImportContext,
): ValidationResult {
  const fileErrors: FileError[] = []
  const warnings: ImportWarning[] = []
  const prepared: PreparedRow[] = []

  const amountAnswer = answerForField(mapping, 'investment_amount_usd')
  const spvAnswer = answerForField(mapping, 'spv_percentage')
  const overrideAnswer = answerForField(mapping, 'indirect_flipit_percentage_override')
  const deadlineAnswer = answerForField(mapping, 'response_deadline')

  const approved = new Set(
    context.approvedJurisdictions.map((code) => code.trim().toUpperCase()).filter(Boolean),
  )
  const existing = new Set(context.existingEmails.map((email) => email.trim().toLowerCase()))
  const seenInFile = new Map<string, number>()

  if (rows.length === 0) {
    fileErrors.push({
      code: 'NO_ROWS',
      sourceRowNumber: null,
      field: null,
      message: 'The file has no data rows.',
    })
  }

  for (const row of rows) {
    const at = row.sourceRowNumber
    const notes: ParseNote[] = []
    let rowFailed = false

    const missing = (field: TargetField) => {
      fileErrors.push({
        code: 'MISSING_VALUE',
        sourceRowNumber: at,
        field,
        message: `Row ${at} has no ${field}, and it is required.`,
      })
      rowFailed = true
    }

    for (const field of REQUIRED_FIELDS) {
      const value = row.values[field]
      if (value === undefined || value.trim() === '') missing(field)
    }

    const name = (row.values.recipient_name ?? '').trim()
    const emailRaw = (row.values.recipient_email ?? '').trim()
    const email = emailRaw.toLowerCase()

    if (emailRaw !== '' && !isValidEmail(emailRaw)) {
      fileErrors.push({
        code: 'MALFORMED_EMAIL',
        sourceRowNumber: at,
        field: 'recipient_email',
        message: `Row ${at}: "${emailRaw}" is not a valid email address.`,
        raw: emailRaw,
      })
      rowFailed = true
    } else if (email !== '') {
      const firstSeenAt = seenInFile.get(email)
      if (firstSeenAt !== undefined) {
        warnings.push({
          code: 'DUPLICATE_EMAIL_REQUIRES_REVIEW',
          sourceRowNumber: at,
          message:
            `Row ${at} shares an email with row ${firstSeenAt}. Both rows will be imported as held drafts ` +
            'and must be separated or deliberately combined before sending.',
        })
      } else {
        seenInFile.set(email, at)
      }
      if (existing.has(email)) {
        fileErrors.push({
          code: 'DUPLICATE_EMAIL_EXISTING',
          sourceRowNumber: at,
          field: 'recipient_email',
          message: `Row ${at}: this address is already on the list from an earlier import.`,
          raw: emailRaw,
        })
        rowFailed = true
      }
    }

    // --- amount -----------------------------------------------------------
    let proposedAmountUsd = ''
    const amountRaw = (row.values.investment_amount_usd ?? '').trim()
    if (amountRaw !== '') {
      const parsed = parseMoney(amountRaw, {
        decimalSeparator: amountAnswer.decimalSeparator,
        allowNegative: false,
      })
      if (!parsed.ok) {
        fileErrors.push({
          code: 'INVALID_AMOUNT',
          sourceRowNumber: at,
          field: 'investment_amount_usd',
          message: `Row ${at}: ${parsed.message} (value: "${amountRaw}")`,
          raw: amountRaw,
        })
        rowFailed = true
      } else {
        notes.push(...parsed.notes)
        const stored = toStorageString(parsed.value, MONEY_SCALE)
        if (!stored.ok) {
          fileErrors.push({
            code: 'PRECISION_LOSS',
            sourceRowNumber: at,
            field: 'investment_amount_usd',
            message: `Row ${at}: ${stored.message} (value: "${amountRaw}")`,
            raw: amountRaw,
          })
          rowFailed = true
        } else {
          proposedAmountUsd = stored.value
          if (parsed.value.isZero()) {
            warnings.push({
              code: 'ZERO_AMOUNT',
              sourceRowNumber: at,
              message: `Row ${at} proposes an amount of zero.`,
            })
          }
        }
      }
    }

    // --- SPV percentage ---------------------------------------------------
    let spvPercentage = ''
    const spvRaw = (row.values.spv_percentage ?? '').trim()
    if (spvRaw !== '') {
      const parsed = parsePercentage(spvRaw, {
        interpretation: spvAnswer.percentageInterpretation,
        decimalSeparator: spvAnswer.decimalSeparator,
      })
      if (!parsed.ok) {
        fileErrors.push({
          code: 'INVALID_PERCENTAGE',
          sourceRowNumber: at,
          field: 'spv_percentage',
          message: `Row ${at}: ${parsed.message} (value: "${spvRaw}")`,
          raw: spvRaw,
        })
        rowFailed = true
      } else {
        notes.push(...parsed.notes)
        const stored = toStorageString(parsed.value, PERCENTAGE_SCALE)
        if (!stored.ok) {
          fileErrors.push({
            code: 'PRECISION_LOSS',
            sourceRowNumber: at,
            field: 'spv_percentage',
            message: `Row ${at}: ${stored.message} (value: "${spvRaw}")`,
            raw: spvRaw,
          })
          rowFailed = true
        } else {
          spvPercentage = stored.value
          if (parsed.value.isZero()) {
            warnings.push({
              code: 'ZERO_PERCENTAGE',
              sourceRowNumber: at,
              message: `Row ${at} has an SPV percentage of zero.`,
            })
          }
        }
      }
    }

    // --- the calculation, §10 ---------------------------------------------
    let indirectPercentage = ''
    let indirectOverridden = false
    const overrideRaw = (row.values.indirect_flipit_percentage_override ?? '').trim()

    if (spvPercentage !== '') {
      const computed = computeIndirectPercentage(spvPercentage, context.flipitShare)
      const stored = toStorageString(computed, PERCENTAGE_SCALE)
      if (!stored.ok) {
        fileErrors.push({
          code: 'PRECISION_LOSS',
          sourceRowNumber: at,
          field: 'spv_percentage',
          message:
            `Row ${at}: ${spvPercentage}% of the SPV works out as ${computed}% of Flipit, ` +
            `which needs more decimal places than can be stored. Round the SPV percentage in the file.`,
          raw: spvRaw,
        })
        rowFailed = true
      } else {
        indirectPercentage = stored.value
      }
    }

    if (overrideRaw !== '') {
      const parsed = parsePercentage(overrideRaw, {
        interpretation: overrideAnswer.percentageInterpretation,
        decimalSeparator: overrideAnswer.decimalSeparator,
      })
      if (!parsed.ok) {
        fileErrors.push({
          code: 'INVALID_PERCENTAGE',
          sourceRowNumber: at,
          field: 'indirect_flipit_percentage_override',
          message: `Row ${at}: ${parsed.message} (value: "${overrideRaw}")`,
          raw: overrideRaw,
        })
        rowFailed = true
      } else {
        const stored = toStorageString(parsed.value, PERCENTAGE_SCALE)
        if (!stored.ok) {
          fileErrors.push({
            code: 'PRECISION_LOSS',
            sourceRowNumber: at,
            field: 'indirect_flipit_percentage_override',
            message: `Row ${at}: ${stored.message} (value: "${overrideRaw}")`,
            raw: overrideRaw,
          })
          rowFailed = true
        } else {
          if (indirectPercentage !== '' && stored.value !== indirectPercentage) {
            warnings.push({
              code: 'INDIRECT_OVERRIDE_DIFFERS',
              sourceRowNumber: at,
              message:
                `Row ${at}: the override of ${stored.value}% replaces the calculated ` +
                `${indirectPercentage}%. The override is what will be sent and stored.`,
            })
          }
          indirectPercentage = stored.value
          indirectOverridden = true
        }
      }
    }

    // --- deadline ---------------------------------------------------------
    let responseDeadline: string | null = null
    const deadlineRaw = (row.values.response_deadline ?? '').trim()
    if (deadlineRaw !== '') {
      const parsed = parseDate(deadlineRaw, { order: deadlineAnswer.dateOrder })
      if (!parsed.ok) {
        fileErrors.push({
          code: 'INVALID_DEADLINE',
          sourceRowNumber: at,
          field: 'response_deadline',
          message: `Row ${at}: ${parsed.message} (value: "${deadlineRaw}")`,
          raw: deadlineRaw,
        })
        rowFailed = true
      } else {
        notes.push(...parsed.notes)
        if (isoDateIsBefore(parsed.value, context.today)) {
          fileErrors.push({
            code: 'PAST_DEADLINE',
            sourceRowNumber: at,
            field: 'response_deadline',
            message: `Row ${at}: the deadline ${parsed.value} has already passed.`,
            raw: deadlineRaw,
          })
          rowFailed = true
        } else {
          responseDeadline = parsed.value
        }
      }
    } else {
      warnings.push({
        code: 'MISSING_DEADLINE',
        sourceRowNumber: at,
        message: `Row ${at} has no response deadline yet. It will be imported as a held draft.`,
      })
    }

    // --- jurisdiction: the two severities meet here -----------------------
    let jurisdiction: string | null = null
    let jurisdictionReadFrom: string | null = null
    let blocked = false
    let blockDetail: string | null = null
    const jurisdictionRaw = (row.values.recipient_jurisdiction ?? '').trim()

    if (jurisdictionRaw !== '') {
      const resolved = resolveJurisdiction(jurisdictionRaw)
      if (!resolved.ok) {
        // FILE-LEVEL: not a valid ISO code at all. Blocks everything (AC22).
        fileErrors.push({
          code: 'INVALID_JURISDICTION',
          sourceRowNumber: at,
          field: 'recipient_jurisdiction',
          message: `Row ${at}: ${resolved.message}`,
          raw: jurisdictionRaw,
        })
        rowFailed = true
      } else {
        jurisdiction = resolved.code
        if (resolved.from !== 'CODE') jurisdictionReadFrom = jurisdictionRaw
        if (!approved.has(resolved.code)) {
          // PER-RECIPIENT: a real code, simply not cleared. This row imports
          // and is blocked alone; the rest of the batch is untouched (AC7).
          blocked = true
          blockDetail =
            `${resolved.name} (${resolved.code}) is not on the compliance-approved jurisdiction list. ` +
            'This recipient is imported and held; every other recipient is unaffected.'
        }
      }
    } else {
      warnings.push({
        code: 'MISSING_JURISDICTION',
        sourceRowNumber: at,
        message: `Row ${at} has no jurisdiction yet. It will be imported as a held draft.`,
      })
    }

    if (rowFailed) continue

    const missingDraftFields = [
      responseDeadline === null ? 'response deadline' : null,
      jurisdiction === null ? 'jurisdiction' : null,
    ].filter((value): value is string => value !== null)

    if (missingDraftFields.length > 0) {
      blocked = true
      blockDetail =
        `Draft preparation is incomplete: ${missingDraftFields.join(' and ')} ` +
        `${missingDraftFields.length === 1 ? 'is' : 'are'} still needed. Nothing can be sent.`
    }

    prepared.push({
      sourceRowNumber: at,
      name,
      email,
      jurisdiction,
      jurisdictionReadFrom,
      proposedAmountUsd,
      spvPercentage,
      indirectPercentage,
      indirectOverridden,
      responseDeadline,
      senderName: emptyToNull(row.values.sender_name),
      senderEmail: emptyToNull(row.values.sender_email),
      senderPhone: emptyToNull(row.values.sender_phone),
      internalNotes: emptyToNull(row.values.internal_notes),
      blocked,
      blockReason:
        missingDraftFields.length > 0
          ? 'VALIDATION_FAILED'
          : blocked
            ? 'JURISDICTION_NOT_APPROVED'
            : null,
      blockDetail,
      notes: dedupe(notes),
      display: {
        amount: formatMoney(proposedAmountUsd, { currencyCode: 'USD' }),
        spvPercentage: formatPercentage(spvPercentage, {
          decimalPlaces: context.decimalPlaces,
        }),
        indirectPercentage: formatPercentage(indirectPercentage, {
          decimalPlaces: context.decimalPlaces,
        }),
        deadline: responseDeadline ?? 'Not set',
      },
    })
  }

  // A sender email that is present but malformed is a file-level error too —
  // it would fail at send time, which is far too late.
  for (const row of rows) {
    const senderEmail = (row.values.sender_email ?? '').trim()
    if (senderEmail !== '' && !isValidEmail(senderEmail)) {
      fileErrors.push({
        code: 'MALFORMED_EMAIL',
        sourceRowNumber: row.sourceRowNumber,
        field: 'sender_email',
        message: `Row ${row.sourceRowNumber}: the sender address "${senderEmail}" is not valid.`,
        raw: senderEmail,
      })
    }
  }

  const amountTotal = sumDecimals(prepared.map((row) => row.proposedAmountUsd || '0'))
  const spvTotal = sumDecimals(prepared.map((row) => row.spvPercentage || '0'))

  // §10 — warn, never block. The operator may be modelling.
  if (spvTotal.greaterThan('100')) {
    warnings.push({
      code: 'SPV_PERCENTAGE_TOTAL_OVER_100',
      sourceRowNumber: null,
      message: `The SPV percentages in this file add up to ${formatPercentage(spvTotal, {
        decimalPlaces: context.decimalPlaces,
      })}, which is more than the whole SPV.`,
    })
  }
  if (amountTotal.greaterThan(context.aggregateRaiseUsd)) {
    warnings.push({
      code: 'AMOUNT_TOTAL_OVER_AGGREGATE',
      sourceRowNumber: null,
      message: `The amounts in this file total ${formatMoney(amountTotal, {
        currencyCode: 'USD',
      })}, which is more than the stated raise of ${formatMoney(context.aggregateRaiseUsd, {
        currencyCode: 'USD',
      })}.`,
    })
  }

  const canImport = fileErrors.length === 0 && prepared.length > 0

  return {
    fileErrors,
    warnings,
    rows: prepared,
    totals: {
      proposedAmountUsd: amountTotal.toFixed(MONEY_SCALE),
      spvPercentage: spvTotal.toFixed(PERCENTAGE_SCALE),
      rowCount: prepared.length,
      blockedCount: prepared.filter((row) => row.blocked).length,
    },
    canImport,
  }
}

function emptyToNull(value: string | undefined): string | null {
  const trimmed = (value ?? '').trim()
  return trimmed === '' ? null : trimmed
}

function dedupe(notes: ParseNote[]): ParseNote[] {
  return [...new Set(notes)]
}
