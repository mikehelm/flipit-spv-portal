import { generateSecret, generateSync, generateURI, verifySync } from 'otplib'
import { hashToken, tokensMatch } from '@/lib/crypto'

/**
 * TOTP two-factor, and the recovery codes beside it. BUILD_SPEC §2.2.
 *
 * *"**TOTP two-factor** for both privileged accounts. Optional in v1 and
 * strongly recommended, **mandatory before the production deployment sends
 * anything real**. Standard authenticator apps; recovery codes issued once at
 * setup."*
 *
 * That last clause of the first sentence is why this is a release gate rather
 * than a setting. §2.2 opens by naming the trade it is paying for: dropping
 * OAuth means *"the password becomes the only thing between an attacker and
 * investor names, amounts, and the ability to send mail as the operator."*
 * Two-factor is the part of that payment that was still outstanding.
 *
 * This module is pure. No database, no session, no clock of its own — the
 * caller passes `epoch`, which is what makes drift, replay and the acceptance
 * window testable rather than asserted.
 */

/** RFC 6238's default, and what every authenticator app assumes. */
export const PERIOD_SECONDS = 30

/**
 * One period either side of now, and no more.
 *
 * A phone whose clock is a minute out will fail, and that is the right trade:
 * ±30 seconds already covers the time between reading a code and typing it,
 * and every additional period widens the window in which a code shoulder-read
 * from a screen is still worth something. `otplib`'s own `window` option is a
 * tolerance in seconds whose behaviour was not what its name suggested when
 * measured, so the periods are enumerated here where they can be seen.
 */
export const ACCEPTED_STEPS = [-1, 0, 1] as const

export const ISSUER = 'Flipit SPV'

/** Ten, issued once. Enough to survive losing a phone; few enough to print. */
export const RECOVERY_CODE_COUNT = 10

export interface TotpEnrolment {
  /** Base32. Encrypted before it is stored, and never returned to a client
   *  again after the enrolment screen that created it. */
  secret: string
  /** `otpauth://` — what the QR code encodes. */
  uri: string
}

export function createTotpEnrolment(email: string): TotpEnrolment {
  const secret = generateSecret()
  return {
    secret,
    uri: generateURI({ secret, label: email, issuer: ISSUER }),
  }
}

/** The six digits an authenticator would be showing at `epoch`. Test-only in
 *  production terms — nothing in the application generates a code. */
export function codeAt(secret: string, epoch: number): string {
  return generateSync({ secret, epoch })
}

/**
 * Digits only, whitespace ignored. Authenticator apps display `123 456` and
 * people paste it that way; refusing that is a support call rather than a
 * security measure.
 */
export function normaliseCode(raw: string): string {
  return raw.replace(/\D/g, '')
}

export type TotpVerdict = 'OK' | 'MALFORMED' | 'WRONG'

/**
 * Verifies a code against the accepted window.
 *
 * Returns which kind of wrong it was for the audit log, and the caller shows
 * one sentence for both — the same rule as every other refusal in this
 * application.
 */
export function verifyTotp(
  secret: string,
  rawCode: string,
  epochSeconds: number,
): TotpVerdict {
  const code = normaliseCode(rawCode)
  if (code.length !== 6) return 'MALFORMED'

  for (const step of ACCEPTED_STEPS) {
    const epoch = epochSeconds + step * PERIOD_SECONDS
    // A malformed secret would throw. A throw here must not be the difference
    // between a valid and an invalid answer, so it is a refusal like any other.
    try {
      if (verifySync({ token: code, secret, epoch }).valid) return 'OK'
    } catch {
      return 'WRONG'
    }
  }

  return 'WRONG'
}

// ---------------------------------------------------------------------------
// Recovery codes
// ---------------------------------------------------------------------------

/**
 * The alphabet excludes `0`, `1`, `I`, `O`, `L` and `U`.
 *
 * The first five because they are read wrongly off paper by people who are
 * already having a bad day — which is the only day anybody ever uses one of
 * these. `U` because it turns a random string into a word more often than the
 * others.
 */
const ALPHABET = '23456789ABCDEFGHJKMNPQRSTVWXYZ'

function randomCode(bytes: Uint8Array): string {
  let out = ''
  for (let i = 0; i < bytes.length; i += 1) {
    // Modulo bias over a 30-character alphabet from 256 values is under 7% on
    // six of the characters. That matters for a key and does not matter for a
    // ten-code list whose entropy is dominated by its length; a rejection loop
    // here would be theatre. Stated so nobody has to work it out again.
    out += ALPHABET[bytes[i]! % ALPHABET.length]
    if (out.length === 5) out += '-'
  }
  return out
}

export interface RecoveryCodes {
  /** Shown once, at setup, and never again. */
  plain: string[]
  /** `hashToken` of each. What is stored. */
  hashed: string[]
}

/**
 * §2.2: *"recovery codes issued once at setup."*
 *
 * Ten codes of ten characters from a thirty-character alphabet — a little over
 * 49 bits each, which is far beyond guessing against a rate-limited form.
 *
 * `randomBytes` is injected so a test can pin the output; production passes
 * nothing and gets `crypto.getRandomValues`.
 */
export function generateRecoveryCodes(
  randomBytes: (length: number) => Uint8Array = (length) =>
    crypto.getRandomValues(new Uint8Array(length)),
): RecoveryCodes {
  const plain: string[] = []
  for (let i = 0; i < RECOVERY_CODE_COUNT; i += 1) {
    plain.push(randomCode(randomBytes(10)))
  }

  return { plain, hashed: plain.map((code) => hashToken(normaliseRecoveryCode(code))) }
}

/** Case-insensitive, and the hyphen is decoration. */
export function normaliseRecoveryCode(raw: string): string {
  return raw.replace(/[^0-9a-zA-Z]/g, '').toUpperCase()
}

export interface RecoveryConsumption {
  ok: boolean
  /** What to write back. One shorter on success; unchanged on failure. */
  remaining: string[]
}

/**
 * Spends a recovery code. **Single use** — a spent code is removed from the
 * stored list rather than marked, so there is no state in which a used code
 * could be reinstated by an update that forgets a flag.
 *
 * The comparison is constant-time against every stored hash, and it does not
 * stop at the first match, so the time taken does not say how far down the list
 * the code was.
 */
export function consumeRecoveryCode(
  storedHashes: string[],
  rawCode: string,
): RecoveryConsumption {
  const candidate = normaliseRecoveryCode(rawCode)
  if (candidate.length === 0) return { ok: false, remaining: storedHashes }

  let matchedIndex = -1
  for (let i = 0; i < storedHashes.length; i += 1) {
    if (tokensMatch(candidate, storedHashes[i]!)) matchedIndex = i
  }

  if (matchedIndex === -1) return { ok: false, remaining: storedHashes }

  return {
    ok: true,
    remaining: storedHashes.filter((_, i) => i !== matchedIndex),
  }
}

// ---------------------------------------------------------------------------
// The messages
// ---------------------------------------------------------------------------

/**
 * One sentence for every way of failing the second step, exactly as §2.2's
 * sign-in has one sentence for every way of failing the first. A message that
 * distinguished "wrong code" from "expired code" from "not a recovery code"
 * would tell somebody holding a stolen password which of the two factors they
 * had got past.
 */
export const SECOND_FACTOR_FAILED_MESSAGE =
  'That code was not accepted. Codes change every 30 seconds — check your ' +
  'authenticator app and try the current one, or use one of your recovery codes.'

export const SECOND_FACTOR_REQUIRED_MESSAGE =
  'Enter the six-digit code from your authenticator app to finish signing in.'
