/**
 * The jurisdiction half of the compliance gate. BUILD_SPEC §8.2 item 3, §8.3.
 *
 * Two jobs, both deliberately dull:
 *
 *   1. Turn what the owner typed into the approval into a stored list of ISO
 *      3166-1 alpha-2 codes, with blocs expanded and anything ambiguous
 *      refused rather than guessed at.
 *   2. Answer one question at send time — is THIS recipient's code on THAT
 *      approval's list — with no cleverness whatsoever.
 *
 * Everything here is pure. No database, no session, no clock.
 */

import { countryName, isIsoAlpha2 } from '@/lib/import/iso-countries'
import { lookupBloc } from './blocs'

/**
 * An approval, reduced to the two fields the gate actually reads.
 *
 * Taking a structural type rather than the Drizzle row means the gate can be
 * tested without a database, and — more usefully — means nothing can pass a
 * half-built object in and have it silently treated as an approval.
 */
export interface JurisdictionAuthority {
  approvedJurisdictions: readonly string[]
  voidedAt: Date | null
}

/** Upper-case, trimmed, and a real ISO 3166-1 alpha-2 code — or null. */
export function normaliseJurisdiction(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null
  const upper = raw.trim().toUpperCase()
  if (upper.length !== 2) return null
  return isIsoAlpha2(upper) ? upper : null
}

/**
 * The whole question, in one function.
 *
 * Fails closed on every ambiguity: no approval, a voided approval, a blank
 * jurisdiction, a jurisdiction that is not a real country code — all `false`.
 * There is no branch in here that returns `true` for a reason other than "this
 * exact code is on that list".
 */
export function isJurisdictionApproved(
  code: string | null | undefined,
  approval: JurisdictionAuthority | null | undefined,
): boolean {
  if (!approval) return false
  if (approval.voidedAt !== null) return false

  const normalised = normaliseJurisdiction(code)
  if (normalised === null) return false

  for (const approved of approval.approvedJurisdictions) {
    if (normaliseJurisdiction(approved) === normalised) return true
  }
  return false
}

/** Country name for display, falling back to the code itself. */
export function jurisdictionLabel(code: string): string {
  const normalised = normaliseJurisdiction(code)
  if (normalised === null) return code
  const name = countryName(normalised)
  return name ? `${name} (${normalised})` : normalised
}

// ---------------------------------------------------------------------------
// Recording: what the owner typed -> what gets stored
// ---------------------------------------------------------------------------

export interface BlocExpansion {
  token: string
  label: string
  members: readonly string[]
}

export interface JurisdictionParseResult {
  /** Deduplicated, sorted, ready to store. */
  codes: string[]
  /** Every bloc that was expanded, so the UI can show what it did. */
  expansions: BlocExpansion[]
  /** Tokens that are neither a country code nor a defined bloc. */
  rejected: Array<{ token: string; message: string }>
}

/**
 * Parse the jurisdiction field of an approval form.
 *
 * Accepts commas, semicolons, newlines and spaces as separators, because the
 * value is usually pasted out of a letter. Country names are NOT accepted:
 * the importer resolves names for a spreadsheet cell because a spreadsheet is
 * someone else's format, but an approval is typed here, once, by the owner,
 * and "Guinea" versus "Guinea-Bissau" is not a guess worth making on a
 * securities approval. Codes and defined blocs only.
 */
export function parseApprovedJurisdictions(raw: string): JurisdictionParseResult {
  const tokens = raw
    .split(/[,;\n\r]+/)
    .map((token) => token.trim())
    .filter((token) => token !== '')
    // A space-separated list is the other common shape: "GB AU FR".
    .flatMap((token) => (token.includes(' ') && !lookupBloc(token) ? token.split(/\s+/) : [token]))
    .map((token) => token.trim())
    .filter((token) => token !== '')

  const codes = new Set<string>()
  const expansions: BlocExpansion[] = []
  const rejected: Array<{ token: string; message: string }> = []

  for (const token of tokens) {
    const code = normaliseJurisdiction(token)
    if (code !== null) {
      codes.add(code)
      continue
    }

    const bloc = lookupBloc(token)
    if (bloc) {
      for (const member of bloc.members) codes.add(member)
      expansions.push({ token: bloc.token, label: bloc.label, members: bloc.members })
      continue
    }

    rejected.push({
      token,
      message:
        `"${token}" is not an ISO 3166-1 alpha-2 country code and is not a bloc with a ` +
        'defined membership (EU, EEA, EFTA). Name the countries individually — an ' +
        'approval is the last place in this application that should be interpreting ' +
        'shorthand.',
    })
  }

  return {
    codes: [...codes].sort(),
    expansions,
    rejected,
  }
}

/**
 * An individual jurisdiction clearance is only real if a reference to it was
 * recorded. BUILD_SPEC §8.3: "A recipient can be individually approved against
 * a recorded approval reference." There is deliberately no blanket unblock and
 * no empty-string escape hatch.
 */
export const MIN_APPROVAL_REFERENCE_LENGTH = 6

export function hasRecordedOverride(reference: string | null | undefined): boolean {
  if (typeof reference !== 'string') return false
  return reference.trim().length >= MIN_APPROVAL_REFERENCE_LENGTH
}
