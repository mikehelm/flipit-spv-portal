import { inspect } from 'node:util'

/**
 * A value that must never be serialised, logged, or shown.
 *
 * BUILD_SPEC §8.1: "The app password is encrypted at rest, write-only in the
 * UI, and never logged or exported."
 *
 * The rule is easy to state and easy to break by accident — a stray
 * `console.log(transport)`, a `JSON.stringify` of an error, a server action
 * returning an object that happens to carry the credential. This class makes
 * all three inert:
 *
 *   - the value lives in a `#private` field, so `JSON.stringify` cannot reach
 *     it even if `toJSON` were removed;
 *   - `toJSON`, `toString` and Node's inspect hook all return `[redacted]`,
 *     so template literals and `console.log` are safe too;
 *   - getting the real value requires calling `expose()`, which is greppable.
 */
export class Secret {
  readonly #value: string

  constructor(value: string) {
    this.#value = value
  }

  /** The only way out. Deliberately named so it shows up in a review. */
  expose(): string {
    return this.#value
  }

  get length(): number {
    return this.#value.length
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

const REDACTED = '[redacted]'

/**
 * Remove any occurrence of a secret from text that is about to be stored or
 * shown.
 *
 * SMTP servers do not echo credentials back, so in practice this should never
 * fire. It exists because "in practice it should never" is not the standard
 * this application is held to: an error object from a transport library is not
 * something we control, and it is the last thing between a credential and the
 * audit log.
 */
export function scrubSecrets(text: string, secrets: readonly (string | Secret | null | undefined)[]): string {
  let result = text
  for (const secret of secrets) {
    if (!secret) continue
    const raw = secret instanceof Secret ? secret.expose() : secret
    // Ignore trivially short values — replacing every "a" would be worse than
    // useless. A Google app password is 16 characters.
    if (raw.length < 6) continue
    result = result.split(raw).join(REDACTED)
  }
  return result
}
