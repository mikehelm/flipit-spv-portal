import { inspect } from 'node:util'
import { decrypt } from '@/lib/crypto'
import { Secret } from './secret'

/**
 * The sending credential, decrypted for use and inert everywhere else.
 *
 * BUILD_SPEC §8.1: "The app password is encrypted at rest, write-only in the
 * UI, and never logged or exported."
 *
 * Both halves are treated as the credential, not just the password. The pair is
 * what authenticates; the address on its own is what an attacker needs the
 * other half of. So the whole object refuses to serialise, and the address is
 * reachable only through a named getter that the connection-health surface
 * calls deliberately (§8.1 requires the dashboard to show it).
 */
export class SmtpCredential {
  readonly #user: string
  readonly #password: Secret

  constructor(user: string, password: string) {
    this.#user = user
    this.#password = new Secret(password)
  }

  /** The authenticated Gmail address. Shown on the dashboard, never logged. */
  get user(): string {
    return this.#user
  }

  get password(): Secret {
    return this.#password
  }

  toString(): string {
    return '[redacted]'
  }

  toJSON(): string {
    return '[redacted]'
  }

  [inspect.custom](): string {
    return '[redacted]'
  }
}

export interface StoredSmtpCredential {
  smtpUserEncrypted: string | null
  smtpPasswordEncrypted: string | null
}

/**
 * `null` when nothing is stored — that is a configuration state the guard
 * reports, not an error.
 *
 * A stored value that will not decrypt IS an error, and a loud one: it means
 * `ENCRYPTION_KEY` has changed under a live database, and silently treating it
 * as "not configured" would invite someone to paste the app password in again
 * on top of rows that are now unreadable.
 */
export function readSmtpCredential(stored: StoredSmtpCredential): SmtpCredential | null {
  if (!stored.smtpUserEncrypted || !stored.smtpPasswordEncrypted) return null

  try {
    return new SmtpCredential(
      decrypt(stored.smtpUserEncrypted),
      decrypt(stored.smtpPasswordEncrypted),
    )
  } catch {
    // The caught error is deliberately not re-thrown or included: it comes from
    // the crypto layer and there is no reason to move ciphertext around.
    throw new Error(
      'The stored sending credential could not be decrypted. ENCRYPTION_KEY has changed ' +
        'since it was saved, or the row is corrupt. Reconnect the sending account with a ' +
        'fresh Google app password — the stored one is unrecoverable.',
    )
  }
}
