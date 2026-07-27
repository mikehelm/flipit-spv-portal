import { createHmac, timingSafeEqual } from 'node:crypto'

export const EDIT_CAPABILITY_LIFETIME_MS = 30 * 60 * 1_000
const MAX_CLOCK_SKEW_MS = 60 * 1_000

function signature(
  id: string,
  email: string,
  issuedAt: number,
  secret: string,
): string {
  return createHmac('sha256', secret)
    .update(`access-request-edit:${id}:${email}:${issuedAt}`)
    .digest('base64url')
}

/**
 * A short-lived-in-practice, stateless capability returned only to the browser
 * that created a request. Nothing is stored in a cookie or local storage, and
 * nothing is put in a URL. It lets that same open form correct its own pending
 * details without letting somebody overwrite a request merely by knowing the
 * email address.
 */
export function issueEditCapability(
  id: string,
  email: string,
  secret: string,
  now = Date.now(),
): string {
  return `${id}.${now}.${signature(id, email, now, secret)}`
}

export function editCapabilityRequestId(
  candidate: string | null | undefined,
): string | null {
  if (!candidate) return null
  const signatureSeparator = candidate.lastIndexOf('.')
  const issuedAtSeparator = candidate.lastIndexOf('.', signatureSeparator - 1)
  if (
    issuedAtSeparator <= 0 ||
    signatureSeparator <= issuedAtSeparator + 1 ||
    signatureSeparator === candidate.length - 1
  ) {
    return null
  }
  return candidate.slice(0, issuedAtSeparator)
}

export function verifiesEditCapability(
  candidate: string | null | undefined,
  id: string,
  email: string,
  secret: string,
  now = Date.now(),
): boolean {
  if (!candidate) return false
  const signatureSeparator = candidate.lastIndexOf('.')
  const issuedAtSeparator = candidate.lastIndexOf('.', signatureSeparator - 1)
  if (issuedAtSeparator <= 0 || signatureSeparator <= issuedAtSeparator + 1) {
    return false
  }

  const issuedAt = Number(
    candidate.slice(issuedAtSeparator + 1, signatureSeparator),
  )
  if (
    !Number.isSafeInteger(issuedAt) ||
    issuedAt > now + MAX_CLOCK_SKEW_MS ||
    now - issuedAt > EDIT_CAPABILITY_LIFETIME_MS
  ) {
    return false
  }

  const expected = issueEditCapability(id, email, secret, issuedAt)
  const candidateBytes = Buffer.from(candidate)
  const expectedBytes = Buffer.from(expected)
  return (
    candidateBytes.length === expectedBytes.length &&
    timingSafeEqual(candidateBytes, expectedBytes)
  )
}
