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
 * Right now redeeming a link signs the administrator straight in, because there
 * is nowhere to store the password they would otherwise choose (see
 * `credential-store.ts`). Once that column exists, redemption should land on a
 * "choose a password" screen instead, and this becomes two steps rather than
 * one. The token handling does not change.
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
 * Single use is enforced by the conditional update, not by the read above it,
 * so two simultaneous redemptions cannot both succeed. The caller gets a bare
 * `false` on any failure — an expired link and an invented one look the same
 * from outside.
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

  const [claimed] = await db
    .update(operatorInvites)
    .set({ usedAt: new Date(), acceptedById: user.id })
    .where(
      and(
        eq(operatorInvites.id, invite.id),
        isNull(operatorInvites.usedAt),
        isNull(operatorInvites.revokedAt),
      ),
    )
    .returning()

  if (!claimed) return { ok: false }

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
