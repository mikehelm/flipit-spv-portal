/**
 * The shapes the import server actions return.
 *
 * They live here rather than in the action file because a `'use server'`
 * module may only export async functions, and because the client wizard needs
 * the types without pulling the server code in with them.
 *
 * Nothing in any of these shapes is a secret: no API key, no credential, no
 * decrypted value. `aiConfigured` is a boolean, never the key (AC25).
 */

import type { ColumnQuestion, MappingProposal } from './mapping'
import type { FileError, ImportWarning, PreparedRow } from './validate'

export interface ActionFailure {
  ok: false
  /** Shown to the operator. Always says what happened and what to do. */
  message: string
  code:
    | 'UNAUTHORIZED'
    | 'SERVICE_MODE'
    | 'BAD_REQUEST'
    | 'FILE_UNREADABLE'
    | 'NO_ROUND'
    | 'JOB_MISMATCH'
    | 'MAPPING_INVALID'
    | 'NOT_VALIDATED'
    | 'ALREADY_CONFIRMED'
    | 'FAILED'
}

export interface AnalysisSuccess {
  ok: true
  importJobId: string
  roundName: string
  filename: string
  headers: string[]
  /** At most five rows, for the mapping screen. Never the whole file. */
  sampleRows: string[][]
  rowCount: number
  sheetNames: string[]
  sheetName: string | null
  notices: string[]
  proposal: MappingProposal
  /** Questions raised by the PROPOSED mapping. Recomputed on every check. */
  questions: ColumnQuestion[]
  aiConfigured: boolean
  aiUsed: boolean
  aiProposalId: string | null
  aiMessage: string | null
}

export type AnalysisResult = AnalysisSuccess | ActionFailure

export interface PreviewSuccess {
  ok: true
  importJobId: string
  /** Empty when the mapping is complete and every question is answered. */
  mappingProblems: Array<{ code: string; message: string; sourceColumn?: string }>
  questions: ColumnQuestion[]
  fileErrors: FileError[]
  warnings: ImportWarning[]
  rows: PreparedRow[]
  totals: {
    proposedAmountUsd: string
    spvPercentage: string
    rowCount: number
    blockedCount: number
  }
  totalsDisplay: { proposedAmountUsd: string; spvPercentage: string }
  canImport: boolean
  approvedJurisdictions: string[]
}

export type PreviewResult = PreviewSuccess | ActionFailure

export interface ConfirmSuccess {
  ok: true
  importJobId: string
  createdRecipients: number
  createdAccounts: number
  reusedAccounts: number
  createdOffers: number
  blockedOffers: number
}

export type ConfirmResult = ConfirmSuccess | ActionFailure
