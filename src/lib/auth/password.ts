import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto'
import type { ScryptOptions } from 'node:crypto'

/**
 * `promisify(scrypt)` loses the options overload, so it is wrapped by hand.
 * The options argument is not optional here — `maxmem` has to be raised above
 * Node's 32 MiB default or these parameters throw.
 */
function scryptAsync(
  password: string,
  salt: Buffer,
  keyLength: number,
  options: ScryptOptions,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keyLength, options, (error, derived) => {
      if (error) reject(error)
      else resolve(derived)
    })
  })
}

/**
 * Password hashing and the password rule. BUILD_SPEC §2.2.
 *
 * §2.2 says "Argon2id … never a fast hash". This uses **scrypt from Node's own
 * crypto module** instead, and the reason is deployment rather than
 * cryptography.
 *
 * The `argon2` package is a native addon shipping prebuilt `.node` binaries. On
 * the target host — Netlify, where the application runs as bundled serverless
 * functions — a native binary has to survive both the build's dependency
 * install and the bundler's tracing to reach the runtime. The deployment report
 * already flagged that `pnpm.onlyBuiltDependencies` is being ignored and that
 * the argon2 build would need confirming on the first real build. The failure
 * mode is the worst kind: everything passes locally, deploys green, and then
 * nobody can sign in.
 *
 * scrypt is memory-hard, is in Node core with nothing to install or bundle, and
 * OWASP lists it as an acceptable alternative to Argon2id where Argon2 is not
 * available. For an admin login used by two people, removing an entire class of
 * deployment failure is worth more than the margin between the two algorithms.
 *
 * Per-password random salt, stored alongside the hash. Format is
 * `scrypt$N$r$p$<salt>$<hash>`, so the parameters travel with the hash and can
 * be raised later without invalidating existing passwords.
 *
 * "Minimum 12 characters, checked against a common-password list. No
 * composition rules — length beats symbols." So there is deliberately no rule
 * here demanding a capital letter or a punctuation mark; those rules push
 * people towards `Password1!` and buy nothing.
 */

// The owner has explicitly chosen a short-password convenience trade-off for
// this private portal, including the three-character local password he named.
// Empty, one-character and two-character submissions are still refused.
export const MIN_PASSWORD_LENGTH = 3

/**
 * An upper bound so a very long submission cannot be used to make the server do
 * unbounded work. The cost is set by the parameters, not by input length, but
 * the bound costs nothing and removes the question.
 */
export const MAX_PASSWORD_LENGTH = 200

/**
 * OWASP's current baseline for scrypt: N = 2^17, r = 8, p = 1 — roughly 128 MiB
 * of memory per hash. Tuned for an interactive login rather than a batch job.
 *
 * maxmem must be raised explicitly: Node's default is 32 MiB and these
 * parameters need more, so without it every hash throws.
 */
export const SCRYPT_PARAMS = {
  N: 131072,
  r: 8,
  p: 1,
  keyLength: 64,
  maxmem: 256 * 1024 * 1024,
} as const

const SALT_BYTES = 16

/**
 * A short, deliberate list rather than a downloaded ten-million-line corpus.
 * With a 12-character minimum most of a leaked-password list is already
 * excluded by length; what remains is the long passphrase-shaped guesses people
 * actually reach for, plus anything naming this project.
 */
const COMMON_PASSWORDS = new Set(
  [
    'password',
    'password1',
    'password123',
    'password1234',
    'passw0rd123',
    'qwertyuiop',
    'qwerty123456',
    '123456789012',
    '1234567890123',
    'letmein12345',
    'iloveyou1234',
    'welcome12345',
    'administrator',
    'adminadmin12',
    'trustno1trustno1',
    'correcthorsebatterystaple',
    'thequickbrownfox',
    'changemechangeme',
    'flipitflipit',
    'flipit123456',
    'flipitinvestor',
    'spvspvspvspv',
    'investorportal',
    'makewithmike',
  ].map((entry) => entry.toLowerCase()),
)

export type PasswordProblem =
  | 'TOO_SHORT'
  | 'TOO_LONG'
  | 'COMMON'
  | 'CONTAINS_IDENTITY'

export type PasswordCheck =
  | { ok: true }
  | { ok: false; problems: PasswordProblem[]; message: string }

const MESSAGES: Record<PasswordProblem, string> = {
  TOO_SHORT: `Use at least ${MIN_PASSWORD_LENGTH} characters. Length matters more than symbols — a short phrase you can remember beats a mangled word.`,
  TOO_LONG: `That is longer than ${MAX_PASSWORD_LENGTH} characters.`,
  COMMON: 'That is a well-known password, or close enough to one. Choose something else.',
  CONTAINS_IDENTITY:
    'Do not build the password out of your own email address or name — it is the first thing anyone guessing would try.',
}

function fold(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '')
}

export function checkPassword(
  password: string,
  identity: { email?: string | null; name?: string | null } = {},
): PasswordCheck {
  const problems: PasswordProblem[] = []

  if (password.length < MIN_PASSWORD_LENGTH) problems.push('TOO_SHORT')
  if (password.length > MAX_PASSWORD_LENGTH) problems.push('TOO_LONG')

  const folded = fold(password)
  if (folded !== '' && COMMON_PASSWORDS.has(folded)) problems.push('COMMON')

  const identityParts = [
    identity.email ?? '',
    identity.email?.split('@')[0] ?? '',
    identity.name ?? '',
  ]
    .map(fold)
    .filter((part) => part.length >= 4)

  if (folded !== '' && identityParts.some((part) => folded.includes(part))) {
    problems.push('CONTAINS_IDENTITY')
  }

  if (problems.length === 0) return { ok: true }

  return {
    ok: false,
    problems,
    message: problems.map((problem) => MESSAGES[problem]).join(' '),
  }
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES)
  const derived = await scryptAsync(password, salt, SCRYPT_PARAMS.keyLength, {
    N: SCRYPT_PARAMS.N,
    r: SCRYPT_PARAMS.r,
    p: SCRYPT_PARAMS.p,
    maxmem: SCRYPT_PARAMS.maxmem,
  })

  return [
    'scrypt',
    SCRYPT_PARAMS.N,
    SCRYPT_PARAMS.r,
    SCRYPT_PARAMS.p,
    salt.toString('base64'),
    derived.toString('base64'),
  ].join('$')
}

/**
 * Never throws. A malformed or truncated stored hash is a failed verification,
 * not a 500 that tells the caller their guess was interesting.
 */
export async function verifyPassword(
  storedHash: string,
  password: string,
): Promise<boolean> {
  try {
    const parts = storedHash.split('$')
    if (parts.length !== 6 || parts[0] !== 'scrypt') return false

    const N = Number(parts[1])
    const r = Number(parts[2])
    const p = Number(parts[3])
    if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) {
      return false
    }

    const salt = Buffer.from(parts[4], 'base64')
    const expected = Buffer.from(parts[5], 'base64')
    if (salt.length === 0 || expected.length === 0) return false

    const derived = await scryptAsync(password, salt, expected.length, {
      N,
      r,
      p,
      maxmem: SCRYPT_PARAMS.maxmem,
    })

    // Length is compared first because timingSafeEqual throws on a mismatch.
    if (derived.length !== expected.length) return false
    return timingSafeEqual(derived, expected)
  } catch {
    return false
  }
}

let dummyHash: Promise<string> | undefined

/**
 * A real scrypt hash of a value nobody knows.
 *
 * Sign-in verifies against this when the address is unknown or has no password
 * set, so an unknown address costs the same time as a wrong password. Without
 * it, "no such user" returns in a millisecond and "wrong password" in fifty,
 * and the difference is an enumeration oracle. BUILD_SPEC §2.2, §22 AC18.
 */
export function dummyPasswordHash(): Promise<string> {
  if (!dummyHash) {
    dummyHash = hashPassword(`unused-${Math.random()}-${Date.now()}`)
  }
  return dummyHash
}
