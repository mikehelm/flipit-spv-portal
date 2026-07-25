/**
 * Where an administrator's password verifier lives.
 *
 * ---------------------------------------------------------------------------
 * BLOCKED — this needs a schema change that WP2 was not permitted to make.
 * ---------------------------------------------------------------------------
 *
 * BUILD_SPEC §2.2 (added mid-build) requires email-and-password sign-in for the
 * owner and operator. The `users` table from WP1 has no column to hold a
 * password hash, and this package was explicitly forbidden from editing
 * `src/db/schema.ts` or writing a migration. So the logic that *uses* a
 * credential is complete and tested against `InMemoryCredentialStore`, and the
 * database-backed implementation refuses loudly rather than inventing a
 * hiding place for a password verifier in a column meant for something else.
 *
 * What the migration needs to add to `users`:
 *
 *   password_hash            text            -- argon2id, null until set
 *   password_set_at          timestamptz     -- null until set
 *   password_changed_at      timestamptz     -- drives "end every other session"
 *   totp_secret_encrypted    text            -- encrypt() from lib/crypto, §2.2
 *   totp_confirmed_at        timestamptz
 *   recovery_codes_hashed    text[]          -- hashToken() of each, single use
 *
 * and, so that rate limiting survives a restart and spans instances:
 *
 *   sign_in_attempts (key text primary key, failures int not null,
 *                     first_failure_at timestamptz not null,
 *                     locked_until timestamptz)
 *
 * Once those exist, `drizzleCredentialStore()` is roughly fifteen lines and
 * nothing else in this package changes.
 */

export interface AdminCredential {
  userId: string
  email: string
  /** Argon2id. Null when the account exists but no password has been chosen. */
  passwordHash: string | null
  passwordSetAt: Date | null
}

export interface CredentialStore {
  findByEmail(email: string): Promise<AdminCredential | null>
  setPasswordHash(userId: string, hash: string, now: Date): Promise<void>
}

export const CREDENTIAL_STORAGE_UNAVAILABLE =
  'Password sign-in is not available yet: the users table has no password_hash column. ' +
  'BUILD_SPEC §2.2 was added after the data model was frozen, and WP2 was not permitted ' +
  'to migrate it. Until the migration lands, sign in with a one-time setup link ' +
  '(see lib/auth/bootstrap.ts). No password is stored anywhere in the meantime.'

export class CredentialStorageUnavailableError extends Error {
  constructor() {
    super(CREDENTIAL_STORAGE_UNAVAILABLE)
    this.name = 'CredentialStorageUnavailableError'
  }
}

/**
 * The database-backed store. Refuses rather than guessing.
 *
 * It would be easy to park an argon2 hash in `oauth_accounts.access_token` and
 * have sign-in "work" today. That column is named for a token, would be treated
 * as one by anyone reading the schema later, and a password verifier sitting in
 * it is exactly the kind of thing nobody finds until it matters.
 */
export function drizzleCredentialStore(): CredentialStore {
  return {
    async findByEmail() {
      throw new CredentialStorageUnavailableError()
    },
    async setPasswordHash() {
      throw new CredentialStorageUnavailableError()
    },
  }
}

export function credentialStorageAvailable(): boolean {
  return false
}

/** Used by the tests, which exercise every rule the real store will obey. */
export class InMemoryCredentialStore implements CredentialStore {
  private readonly byEmail = new Map<string, AdminCredential>()

  constructor(seed: AdminCredential[] = []) {
    for (const credential of seed) {
      this.byEmail.set(credential.email.toLowerCase(), { ...credential })
    }
  }

  async findByEmail(email: string): Promise<AdminCredential | null> {
    return this.byEmail.get(email.trim().toLowerCase()) ?? null
  }

  async setPasswordHash(userId: string, hash: string, now: Date): Promise<void> {
    for (const credential of this.byEmail.values()) {
      if (credential.userId === userId) {
        credential.passwordHash = hash
        credential.passwordSetAt = now
        return
      }
    }
    throw new Error('No such administrator.')
  }
}
