import { and, eq, isNull } from 'drizzle-orm'
import { db } from '@/db'
import { operatorInvites, users } from '@/db/schema'
import { audit } from '@/lib/audit'
import { hashToken, issueToken, tokensMatch } from '@/lib/crypto'
import { env } from '@/lib/env'
import { assessInvite, inviteExpiryFrom } from './invites'
import { createAdminSession } from './session'
import { evaluateAllowlist } from './sign-in-policy'

/**
 * First-run access. BUILD_SPEC §2.2, "First run".
 *
 * "The seed creates the allowlisted accounts with no password set. It prints a
 * one-time, expiring setup link to the console."
 *
 * That link is what this module mints and redeems. It rides on the existing
 * `operator_invites` table, which is already what §15 asks for — a single-use,
 * expiring, hashed admin invite — so no new storage was needed for it.
 *
 * Redeeming a link establishes a session but does not spend the link yet. That
 * session can reach exactly one page — "choose a password" — because `requirePasswordSet` in
 * lib/auth/guards.ts sends an account with no verifier there and nowhere else.
 * The link is spent only after a valid password has actually been stored.
 * Reloading, using the wrong local hostname, or correcting a rejected password
 * therefore cannot strand the account halfway through setup.
 *
 * The same route redeems an operator invitation (§3 step 3). Both are rows in
 * `operator_invites`, both are single-use hashed tokens, and both have to work
 * for somebody who has no other way to sign in — which is the point of them.
 *
 * The link is printed to a console the owner is already looking at. It is never
 * emailed from here, never placed in an environment variable, and only its hash
 * is stored.
 */

export interface AdminSetupLink {
  url: string
  email: string
  expiresAt: Date
}

/**
 * Mints a one-time link for an allowlisted administrator.
 *
 * Not reachable from the web. It is called by a seed or an operator on the
 * server console — there is no route that issues one of these to an
 * unauthenticated visitor, which would be a permanent way in.
 */
export async function issueAdminSetupLink(rawEmail: string): Promise<AdminSetupLink> {
  const decision = evaluateAllowlist(rawEmail)
  if (!decision.allowed) {
    throw new Error(
      `${rawEmail} is not on the owner or operator allowlist, so it can never sign in. ` +
        'Add it to OWNER_EMAILS or OPERATOR_EMAILS first.',
    )
  }

  const user = await db.query.users.findFirst({ where: eq(users.email, decision.email) })
  if (!user) {
    throw new Error(
      `No user row exists for ${decision.email}. Run \`pnpm db:seed\` — this function ` +
        'deliberately creates no accounts of its own.',
    )
  }

  const now = new Date()

  await db
    .update(operatorInvites)
    .set({ revokedAt: now })
    .where(
      and(
        eq(operatorInvites.email, decision.email),
        isNull(operatorInvites.usedAt),
        isNull(operatorInvites.revokedAt),
      ),
    )

  const { token, hash } = issueToken()
  const expiresAt = inviteExpiryFrom(now)

  const [row] = await db
    .insert(operatorInvites)
    .values({
      email: decision.email,
      tokenHash: hash,
      expiresAt,
      // Self-issued: there is no other administrator to attribute it to on
      // first run, and the column will not take a null.
      createdById: user.id,
    })
    .returning()

  await audit({
    actor: { kind: 'system', label: 'console' },
    entityType: 'operator_invite',
    entityId: row.id,
    action: 'admin_setup_link.issued',
    metadata: { email: decision.email, role: decision.role },
  })

  const base = env().APP_URL.replace(/\/+$/, '')

  return {
    url: `${base}/api/auth/setup?token=${encodeURIComponent(token)}`,
    email: decision.email,
    expiresAt,
  }
}

export type RedeemResult =
  | { ok: true; userId: string; email: string }
  | { ok: false }

/**
 * Redeems a setup link and establishes a session.
 *
 * The caller gets a bare `false` on any failure — an expired link and an
 * invented one look the same from outside. A valid unspent link may be opened
 * repeatedly until the account has successfully chosen its first password.
 */
export async function redeemAdminSetupLink(rawToken: string): Promise<RedeemResult> {
  const token = rawToken.trim()
  if (token === '') return { ok: false }

  const invite = await db.query.operatorInvites.findFirst({
    where: eq(operatorInvites.tokenHash, hashToken(token)),
  })

  if (!invite || !tokensMatch(token, invite.tokenHash)) return { ok: false }

  const decision = evaluateAllowlist(invite.email)
  if (!decision.allowed) return { ok: false }

  const user = await db.query.users.findFirst({ where: eq(users.email, decision.email) })
  if (!user) return { ok: false }
  if (user.passwordHash !== null) return { ok: false }

  // Reuse the invite rules exactly: revoked, used and expired all refuse.
  const assessment = assessInvite({
    invite,
    signedInEmail: decision.email,
    now: new Date(),
  })

  if (!assessment.ok) {
    await audit({
      actor: { kind: 'system', label: 'console' },
      entityType: 'operator_invite',
      entityId: invite.id,
      action: 'admin_setup_link.refused',
      metadata: { reason: assessment.reason },
    })
    return { ok: false }
  }

  await createAdminSession(user.id)

  await audit({
    actor: { kind: 'user', id: user.id, label: user.email },
    entityType: 'user',
    entityId: user.id,
    action: 'access.sign_in',
    metadata: { method: 'setup_link', role: decision.role },
  })

  return { ok: true, userId: user.id, email: user.email }
}

/**
 * Spend every live setup link only after the first password is safely stored.
 * The password itself never reaches this function.
 */
export async function completeAdminSetup(userId: string, email: string): Promise<void> {
  const now = new Date()
  await db
    .update(operatorInvites)
    .set({ usedAt: now, acceptedById: userId })
    .where(
      and(
        eq(operatorInvites.email, email),
        isNull(operatorInvites.usedAt),
        isNull(operatorInvites.revokedAt),
      ),
    )
}
