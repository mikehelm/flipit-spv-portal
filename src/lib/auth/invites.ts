import { and, desc, eq, isNull } from 'drizzle-orm'
import { db } from '@/db'
import { operatorInvites } from '@/db/schema'
import { audit } from '@/lib/audit'
import { hashToken, issueToken, tokensMatch } from '@/lib/crypto'
import { resolveRole } from '@/lib/roles'
import type { AdminIdentity } from './guards'

/**
 * Single-use, expiring, hashed operator invites. BUILD_SPEC §3 step 3, §15.
 *
 * Only the hash is stored. The token is shown to the owner exactly once, at the
 * moment it is issued, and cannot be recovered afterwards — if it is lost, the
 * owner issues a new one, which revokes the old.
 *
 * The invite is not the access control. The allowlist is (§2). An invite to an
 * address that is not on the operator allowlist would be a link to a sign-in
 * that gets refused, so issuing one is refused instead.
 */

/**
 * Three days. The spec says "single-use, expiring" without a duration, so this
 * is the conservative reading: long enough to be practical across a weekend,
 * short enough that a link sitting in an old inbox stops working. Re-issuing
 * costs the owner one click.
 */
export const OPERATOR_INVITE_TTL_HOURS = 72

export type InviteRefusal =
  | 'NOT_FOUND'
  | 'WRONG_ACCOUNT'
  | 'REVOKED'
  | 'ALREADY_USED'
  | 'EXPIRED'

export interface InviteSnapshot {
  email: string
  expiresAt: Date
  usedAt: Date | null
  revokedAt: Date | null
}

export type InviteAssessment = { ok: true } | { ok: false; reason: InviteRefusal }

/**
 * Pure. The order matters: whether the token belongs to the signed-in person is
 * settled before anything about the invite's state is revealed, so presenting
 * someone else's token tells you nothing about whether it was valid.
 */
export function assessInvite(input: {
  invite: InviteSnapshot | null
  signedInEmail: string
  now: Date
}): InviteAssessment {
  const { invite, now } = input
  if (!invite) return { ok: false, reason: 'NOT_FOUND' }

  const signedInEmail = input.signedInEmail.trim().toLowerCase()
  if (invite.email.trim().toLowerCase() !== signedInEmail) {
    return { ok: false, reason: 'WRONG_ACCOUNT' }
  }

  if (invite.revokedAt !== null) return { ok: false, reason: 'REVOKED' }
  if (invite.usedAt !== null) return { ok: false, reason: 'ALREADY_USED' }
  if (invite.expiresAt.getTime() <= now.getTime()) return { ok: false, reason: 'EXPIRED' }

  return { ok: true }
}

export function inviteExpiryFrom(now: Date): Date {
  return new Date(now.getTime() + OPERATOR_INVITE_TTL_HOURS * 60 * 60 * 1000)
}

export interface IssuedInvite {
  id: string
  email: string
  expiresAt: Date
  /** Shown once. Never stored, never recoverable. */
  token: string
}

/**
 * Owner-only — the caller must have established that. Any outstanding invite
 * for the same address is revoked first, so there is never more than one live
 * invite per address to reason about.
 */
export async function issueOperatorInvite(input: {
  owner: AdminIdentity
  email: string
  now?: Date
}): Promise<IssuedInvite> {
  const email = input.email.trim().toLowerCase()
  const now = input.now ?? new Date()

  if (resolveRole(email) !== 'OPERATOR') {
    throw new Error(
      'That address is not on the operator allowlist, so an invitation to it could ' +
        'never be accepted. Add it to OPERATOR_EMAILS first.',
    )
  }

  const superseded = await db
    .update(operatorInvites)
    .set({ revokedAt: now })
    .where(
      and(
        eq(operatorInvites.email, email),
        isNull(operatorInvites.usedAt),
        isNull(operatorInvites.revokedAt),
      ),
    )
    .returning({ id: operatorInvites.id })

  const { token, hash } = issueToken()
  const expiresAt = inviteExpiryFrom(now)

  const [row] = await db
    .insert(operatorInvites)
    .values({
      email,
      tokenHash: hash,
      expiresAt,
      createdById: input.owner.id,
    })
    .returning()

  await audit({
    actor: { kind: 'user', id: input.owner.id, label: input.owner.email },
    entityType: 'operator_invite',
    entityId: row.id,
    action: 'operator_invite.issued',
    metadata: {
      invitedEmail: email,
      expiresAt: expiresAt.toISOString(),
      supersededCount: superseded.length,
    },
  })

  return { id: row.id, email, expiresAt, token }
}

export async function revokeOperatorInvite(input: {
  owner: AdminIdentity
  inviteId: string
}): Promise<boolean> {
  const [row] = await db
    .update(operatorInvites)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(operatorInvites.id, input.inviteId),
        isNull(operatorInvites.usedAt),
        isNull(operatorInvites.revokedAt),
      ),
    )
    .returning()

  await audit({
    actor: { kind: 'user', id: input.owner.id, label: input.owner.email },
    entityType: 'operator_invite',
    entityId: input.inviteId,
    action: row ? 'operator_invite.revoked' : 'operator_invite.revoke_refused',
    metadata: row ? undefined : { reason: 'already used, revoked, or not found' },
  })

  return Boolean(row)
}

export type AcceptResult =
  | { ok: true; inviteId: string }
  | { ok: false; reason: InviteRefusal }

/**
 * Binds the invite to the signed-in user.
 *
 * The single-use guarantee is enforced by the database, not by the read above
 * it: the update only matches a row that is still unused and unrevoked, so two
 * simultaneous accepts cannot both succeed.
 */
export async function acceptOperatorInvite(input: {
  user: AdminIdentity
  token: string
  now?: Date
}): Promise<AcceptResult> {
  const now = input.now ?? new Date()
  const candidate = input.token.trim()

  const invite = candidate
    ? await db.query.operatorInvites.findFirst({
        where: eq(operatorInvites.tokenHash, hashToken(candidate)),
      })
    : undefined

  // Belt and braces: the lookup is already by hash, but a constant-time
  // comparison on a token-bearing route costs nothing.
  const matched = invite && tokensMatch(candidate, invite.tokenHash) ? invite : null

  const assessment = assessInvite({
    invite: matched,
    signedInEmail: input.user.email,
    now,
  })

  if (!assessment.ok) {
    await audit({
      actor: { kind: 'user', id: input.user.id, label: input.user.email },
      entityType: 'operator_invite',
      entityId: matched?.id ?? null,
      action: 'operator_invite.accept_refused',
      metadata: { reason: assessment.reason },
    })
    return { ok: false, reason: assessment.reason }
  }

  const accepted = matched as NonNullable<typeof matched>

  const [row] = await db
    .update(operatorInvites)
    .set({ usedAt: now, acceptedById: input.user.id })
    .where(
      and(
        eq(operatorInvites.id, accepted.id),
        isNull(operatorInvites.usedAt),
        isNull(operatorInvites.revokedAt),
      ),
    )
    .returning()

  if (!row) {
    // Lost a race with another accept. Treat it as already used.
    await audit({
      actor: { kind: 'user', id: input.user.id, label: input.user.email },
      entityType: 'operator_invite',
      entityId: accepted.id,
      action: 'operator_invite.accept_refused',
      metadata: { reason: 'ALREADY_USED' },
    })
    return { ok: false, reason: 'ALREADY_USED' }
  }

  await audit({
    actor: { kind: 'user', id: input.user.id, label: input.user.email },
    entityType: 'operator_invite',
    entityId: accepted.id,
    action: 'operator_invite.accepted',
    metadata: { invitedEmail: accepted.email },
  })

  return { ok: true, inviteId: accepted.id }
}

export type InviteStatus = 'PENDING' | 'ACCEPTED' | 'REVOKED' | 'EXPIRED'

export function inviteStatus(invite: InviteSnapshot, now: Date): InviteStatus {
  if (invite.usedAt !== null) return 'ACCEPTED'
  if (invite.revokedAt !== null) return 'REVOKED'
  if (invite.expiresAt.getTime() <= now.getTime()) return 'EXPIRED'
  return 'PENDING'
}

export async function listOperatorInvites() {
  return db
    .select({
      id: operatorInvites.id,
      email: operatorInvites.email,
      expiresAt: operatorInvites.expiresAt,
      usedAt: operatorInvites.usedAt,
      revokedAt: operatorInvites.revokedAt,
      createdAt: operatorInvites.createdAt,
    })
    .from(operatorInvites)
    .orderBy(desc(operatorInvites.createdAt))
    .limit(50)
}

/** Whether the signed-in operator has ever accepted an invite. */
export async function hasAcceptedInvite(userId: string): Promise<boolean> {
  const row = await db.query.operatorInvites.findFirst({
    where: eq(operatorInvites.acceptedById, userId),
  })
  return Boolean(row)
}
