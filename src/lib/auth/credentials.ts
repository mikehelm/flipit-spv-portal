import type { AdminRole } from '@/lib/roles'
import type { AdminCredential, CredentialStore } from './credential-store'
import { dummyPasswordHash, verifyPassword } from './password'
import {
  checkRateLimit,
  clearFailures,
  recordFailure,
  signInKeys,
  type RateLimitStore,
} from './rate-limit'
import { evaluateAllowlist } from './sign-in-policy'

/**
 * Email-and-password sign-in. BUILD_SPEC §2.2, §22 AC18.
 *
 * The whole design goal of this function is that every way of being wrong looks
 * the same from outside:
 *
 *   - an address that is not on the allowlist,
 *   - an allowlisted address with no password set yet,
 *   - an allowlisted address with the wrong password,
 *
 * all return `INVALID_CREDENTIALS`, all pay the same scrypt verification cost
 * (against a dummy hash when there is no real one), and all leave the same
 * rate-limit trace. Inside, they are audited distinctly, because the owner
 * needs to be able to tell them apart afterwards even though an attacker must
 * not be able to tell them apart at the time.
 *
 * Storage is injected, so these rules can be tested exhaustively without a
 * database. See `credential-store.ts`.
 */

export type SignInFailure = 'INVALID_CREDENTIALS' | 'LOCKED' | 'UNAVAILABLE'

export type SignInResult =
  // Signing in is not acting. A viewer holds a real session and a real role;
  // what they may do with it is the guards' question, not this one's.
  | { ok: true; userId: string; email: string; role: AdminRole }
  | { ok: false; reason: SignInFailure; lockedUntil?: number; detail: SignInDetail }

/** Never leaves the server. For the audit log only. */
export type SignInDetail =
  | 'OK'
  | 'NOT_ALLOWLISTED'
  | 'MISSING_EMAIL'
  | 'NO_PASSWORD_SET'
  | 'WRONG_PASSWORD'
  | 'RATE_LIMITED'
  | 'STORAGE_UNAVAILABLE'

export interface SignInDeps {
  store: CredentialStore
  rateLimit: RateLimitStore
  sleep?: (ms: number) => Promise<void>
  now?: () => number
}

const defaultSleep = (ms: number) =>
  ms <= 0 ? Promise.resolve() : new Promise<void>((resolve) => setTimeout(resolve, ms))

export async function attemptPasswordSignIn(
  input: { email: string; password: string; ip: string },
  deps: SignInDeps,
): Promise<SignInResult> {
  const sleep = deps.sleep ?? defaultSleep
  const now = deps.now?.() ?? Date.now()

  const decision = evaluateAllowlist(input.email)
  const email = decision.allowed ? decision.email : (decision.email ?? '')

  // Counters are keyed on the attempted address whether or not it exists, so a
  // stranger and the owner are throttled identically.
  const keys = signInKeys(email, input.ip)

  const verdict = await checkRateLimit(deps.rateLimit, keys, now)
  if (verdict.locked) {
    return {
      ok: false,
      reason: 'LOCKED',
      lockedUntil: verdict.lockedUntil ?? undefined,
      detail: 'RATE_LIMITED',
    }
  }

  await sleep(verdict.delayMs)

  // The lookup runs for EVERY attempted address, including one that is not on
  // the allowlist.
  //
  // It is tempting to skip it when the allowlist has already said no — the
  // answer cannot change the outcome, and it saves a query. It also makes the
  // storage layer observable: an earlier version looked up only allowlisted
  // addresses, so when the store failed, an allowlisted address returned
  // UNAVAILABLE while every other address returned INVALID_CREDENTIALS. Two
  // different answers, keyed exactly on allowlist membership, readable by
  // anyone with a browser. Whatever the storage layer does, it now does it for
  // every address alike.
  let credential: AdminCredential | null = null
  let storageFailed = false
  try {
    credential = await deps.store.findByEmail(email)
  } catch {
    storageFailed = true
  }

  // An address off the allowlist can never sign in, whatever the store said.
  if (!decision.allowed) credential = null

  if (storageFailed) {
    // A real outage, identical for every caller. Saying so plainly is honest
    // and — because it no longer depends on who is asking — tells an attacker
    // nothing they could not learn by watching the service fail.
    return { ok: false, reason: 'UNAVAILABLE', detail: 'STORAGE_UNAVAILABLE' }
  }

  // Always verify something. An unknown address must cost what a known one does.
  const hash = credential?.passwordHash ?? (await dummyPasswordHash())
  const passwordMatches = await verifyPassword(hash, input.password)

  if (
    decision.allowed &&
    credential !== null &&
    credential.passwordHash !== null &&
    passwordMatches
  ) {
    await clearFailures(deps.rateLimit, keys)
    return {
      ok: true,
      userId: credential.userId,
      email: decision.email,
      role: decision.role,
    }
  }

  await recordFailure(deps.rateLimit, keys, now)

  const detail: SignInDetail = !decision.allowed
    ? decision.reason === 'MISSING_EMAIL'
      ? 'MISSING_EMAIL'
      : 'NOT_ALLOWLISTED'
    : credential === null || credential.passwordHash === null
      ? 'NO_PASSWORD_SET'
      : 'WRONG_PASSWORD'

  return { ok: false, reason: 'INVALID_CREDENTIALS', detail }
}

/**
 * The one sentence every failed sign-in shows, whatever went wrong.
 * BUILD_SPEC §22 AC18 — "an unknown address and a wrong password fail
 * identically".
 */
export const SIGN_IN_FAILED_MESSAGE =
  'That email address and password combination was not accepted.'

export const SIGN_IN_LOCKED_MESSAGE =
  'Too many attempts. Sign-in from here is paused for a short while. If this was not you, tell the portal owner.'

export const SIGN_IN_UNAVAILABLE_MESSAGE =
  'Password sign-in is not available on this deployment yet. Use the one-time setup link.'
