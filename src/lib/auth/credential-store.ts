/**
 * Where an administrator's password verifier lives.
 *
 * BUILD_SPEC §2.2 requires email-and-password sign-in for the owner and the
 * operator. The columns this reads — `password_hash`, `password_set_at`,
 * `password_changed_at` — were added in migration 0001, because §2.2 arrived
 * after WP1 had frozen the data model.
 *
 * The store is injected wherever it is used, so the sign-in rules can be tested
 * exhaustively against `InMemoryCredentialStore` without a database. The two
 * implementations have to agree on one thing above all others:
 *
 *   **An address that does not exist returns null. It does not throw.**
 *
 * A store that throws for one class of address and returns for another is an
 * enumeration oracle no matter how carefully the caller phrases the failure
 * afterwards, and this file is where that guarantee is kept.
 */

import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { sessions, users } from '@/db/schema'

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

/**
 * The database-backed store.
 *
 * `findByEmail` matches on the lower-cased address. Addresses are stored
 * lower-cased by the seed and by the invite flow, and the comparison is done in
 * SQL rather than by loading candidates and filtering in JavaScript, so a
 * lookup for an address that does not exist does exactly the same work as one
 * for an address that does.
 */
export function drizzleCredentialStore(): CredentialStore {
  return {
    async findByEmail(email: string): Promise<AdminCredential | null> {
      const normalised = email.trim().toLowerCase()
      if (normalised === '') return null

      const row = await db.query.users.findFirst({
        where: eq(users.email, normalised),
        columns: {
          id: true,
          email: true,
          passwordHash: true,
          passwordSetAt: true,
        },
      })

      if (!row) return null

      return {
        userId: row.id,
        email: row.email,
        passwordHash: row.passwordHash,
        passwordSetAt: row.passwordSetAt,
      }
    },

    /**
     * Sets or replaces the verifier and ends every session the account holds.
     *
     * §2.2: "changing a password ends every other session immediately". Both
     * halves are done here, in one transaction, because a password change that
     * committed while the session revocation failed would leave the previous
     * password's sessions alive — which is the precise situation someone
     * changing their password under duress is trying to end.
     *
     * `password_changed_at` is written as well as the rows being deleted. The
     * deletion is what ends the sessions; the timestamp is what lets a later
     * read reject a session that was somehow issued from a stale replica.
     */
    async setPasswordHash(userId: string, hash: string, now: Date): Promise<void> {
      await db.transaction(async (tx) => {
        const updated = await tx
          .update(users)
          .set({ passwordHash: hash, passwordSetAt: now, passwordChangedAt: now })
          .where(eq(users.id, userId))
          .returning({ id: users.id })

        if (updated.length === 0) {
          throw new Error('No such administrator.')
        }

        await tx.delete(sessions).where(eq(sessions.userId, userId))
      })
    },
  }
}

/** Used by the tests, which exercise every rule the real store obeys. */
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
