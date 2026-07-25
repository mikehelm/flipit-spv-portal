import argon2 from 'argon2'

/**
 * Password hashing and the password rule. BUILD_SPEC §2.2.
 *
 * "Argon2id password hashing, per-user salt, sensible cost parameters. Never a
 * fast hash." Argon2 generates and embeds its own random salt per hash, so
 * there is no salt to manage here and no salt column to get wrong.
 *
 * "Minimum 12 characters, checked against a common-password list. No
 * composition rules — length beats symbols." So there is deliberately no rule
 * here demanding a capital letter or a punctuation mark; those rules push
 * people towards `Password1!` and buy nothing.
 */

export const MIN_PASSWORD_LENGTH = 12

/**
 * An upper bound so a very long submission cannot be used to make the server do
 * unbounded work. Argon2's cost is set by its parameters, not by input length,
 * but the bound costs nothing and removes the question.
 */
export const MAX_PASSWORD_LENGTH = 200

/**
 * OWASP's current baseline for Argon2id: 19 MiB, 2 iterations, 1 lane. Tuned
 * for an interactive login on a small server rather than for a batch job.
 */
export const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
} as const

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
  return argon2.hash(password, ARGON2_OPTIONS)
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
    return await argon2.verify(storedHash, password)
  } catch {
    return false
  }
}

let dummyHash: Promise<string> | undefined

/**
 * A real Argon2id hash of a value nobody knows.
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
