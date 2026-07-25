import type { VerifyResult } from './types'

/**
 * How the outcome of a connection check is written to and read back from
 * `service_config.smtp_last_verify_result`.
 *
 * The column is free text, which is a problem: the send guard has to decide
 * whether the last check passed, and "it looked like it said OK" is not a
 * basis for deciding whether a securities offer may be sent. So the encoding
 * is fixed here, both directions live in one file, and anything the parser
 * does not recognise counts as a FAILURE rather than a pass.
 *
 * BUILD_SPEC §8.1: "Block sending when the credential is missing, rejected, or
 * has failed its most recent check."
 */

const OK_PREFIX = 'OK'
const FAIL_PREFIX = 'FAILED'

export interface ParsedVerifyResult {
  ok: boolean
  detail: string | null
}

export function encodeVerifyResult(result: VerifyResult): string {
  const detail = result.detail.replace(/\s+/g, ' ').trim().slice(0, 500)
  if (result.ok) {
    return detail ? `${OK_PREFIX}: ${detail}` : OK_PREFIX
  }
  const kind = result.failure?.kind === 'PERMANENT' ? 'FAILED_PERMANENT' : 'FAILED_TRANSIENT'
  return detail ? `${kind}: ${detail}` : kind
}

/**
 * `null` means never checked, which is NOT the same as failed and must not be
 * flattened into it — the operator needs to be told "test the connection", not
 * "the connection is broken".
 */
export function parseVerifyResult(stored: string | null | undefined): ParsedVerifyResult | null {
  if (stored === null || stored === undefined) return null
  const value = stored.trim()
  if (value === '') return null

  const separator = value.indexOf(':')
  const head = (separator === -1 ? value : value.slice(0, separator)).trim().toUpperCase()
  const detail = separator === -1 ? null : value.slice(separator + 1).trim() || null

  if (head === OK_PREFIX) return { ok: true, detail }
  if (head.startsWith(FAIL_PREFIX)) return { ok: false, detail }

  // Unrecognised. Refuse to read it as a pass.
  return {
    ok: false,
    detail: `Unrecognised verification result on record ("${value.slice(0, 80)}"). Test the connection again.`,
  }
}
