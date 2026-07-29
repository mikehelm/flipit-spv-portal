import { createHmac } from 'node:crypto'
import { and, count, desc, eq, inArray, sql } from 'drizzle-orm'
import { db } from '@/db'
import { accessRequestAttempts, accessRequests } from '@/db/schema'
import { env } from '@/lib/env'
import type { AccessRequestInput, AccessRequestStatus } from './policy'
import {
  editCapabilityRequestId,
  issueEditCapability,
  verifiesEditCapability,
} from './edit-capability'

const SOURCE_WINDOW_MS = 60 * 60 * 1_000
const SOURCE_LIMIT = 8

export interface AccessRequestRecord {
  id: string
  firstName: string
  lastName: string
  email: string
  phone: string
  status: AccessRequestStatus
  lastSubmittedAt: Date
  verifiedAt: Date | null
  closedAt: Date | null
  createdAt: Date
}

function hashSource(source: string): string {
  return createHmac('sha256', env().AUTH_SECRET)
    .update(`access-request:${source}`)
    .digest('hex')
}

/**
 * Records a public request without ever turning it into an account.
 *
 * The return value is for the audit layer only. The browser receives the same
 * message for a new request, a duplicate, a decided request, and a throttled
 * source so it cannot use this form to discover addresses already on file.
 */
export async function recordAccessRequest(
  input: AccessRequestInput,
  source: string,
  editCapability?: string | null,
): Promise<{
  changed: boolean
  created: boolean
  id: string | null
  editCapability: string | null
}> {
  const now = new Date()
  const windowStartIso = new Date(now.getTime() - SOURCE_WINDOW_MS).toISOString()
  const nowIso = now.toISOString()
  const sourceHash = hashSource(source)

  return db.transaction(async (tx) => {
  // Serialise submissions from the same keyed source before counting. Without
  // this transaction-scoped advisory lock, concurrent requests could all see
  // seven rows and each insert an eighth.
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${sourceHash}, 0))`,
  )

  // Count every submission attempt before looking up an address. Otherwise a
  // source can bypass the limit by repeating the same address forever.
  const [attempt] = await tx
    .insert(accessRequestAttempts)
    .values({
      sourceHash,
      windowStartedAt: now,
      attemptCount: 1,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: accessRequestAttempts.sourceHash,
      set: {
        windowStartedAt: sql`case
          when ${accessRequestAttempts.windowStartedAt} <= ${windowStartIso}::timestamptz
          then ${nowIso}::timestamptz
          else ${accessRequestAttempts.windowStartedAt}
        end`,
        attemptCount: sql`case
          when ${accessRequestAttempts.windowStartedAt} <= ${windowStartIso}::timestamptz
          then 1
          else ${accessRequestAttempts.attemptCount} + 1
        end`,
        updatedAt: now,
      },
    })
    .returning({ value: accessRequestAttempts.attemptCount })

  if (Number(attempt?.value ?? SOURCE_LIMIT + 1) > SOURCE_LIMIT) {
    return { changed: false, created: false, id: null, editCapability: null }
  }

  const managedId = editCapabilityRequestId(editCapability)
  const managed = managedId
    ? await tx.query.accessRequests.findFirst({
        where: eq(accessRequests.id, managedId),
      })
    : undefined

  if (
    managed &&
    managed.status === 'PENDING' &&
    verifiesEditCapability(
      editCapability,
      managed.id,
      managed.email,
      env().AUTH_SECRET,
    )
  ) {
    const emailConflict =
      managed.email === input.email
        ? undefined
        : await tx.query.accessRequests.findFirst({
            where: eq(accessRequests.email, input.email),
          })

    if (emailConflict) {
      return {
        changed: false,
        created: false,
        id: managed.id,
        editCapability: editCapability ?? null,
      }
    }

    const detailsChanged =
      managed.firstName !== input.firstName ||
      managed.lastName !== input.lastName ||
      managed.email !== input.email ||
      managed.phone !== input.phone

    if (detailsChanged) {
      const updated = await tx
        .update(accessRequests)
        .set({
          firstName: input.firstName,
          lastName: input.lastName,
          email: input.email,
          phone: input.phone,
          sourceHash,
          lastSubmittedAt: now,
          updatedAt: now,
        })
        .where(
          and(
            eq(accessRequests.id, managed.id),
            eq(accessRequests.status, 'PENDING'),
          ),
        )
        .returning({ id: accessRequests.id })

      if (updated.length !== 1) {
        return {
          changed: false,
          created: false,
          id: managed.id,
          editCapability: null,
        }
      }
    }

    return {
      changed: detailsChanged,
      created: false,
      id: managed.id,
      editCapability: issueEditCapability(
        managed.id,
        input.email,
        env().AUTH_SECRET,
      ),
    }
  }

  const existing = await tx.query.accessRequests.findFirst({
    where: eq(accessRequests.email, input.email),
  })

  if (existing) {
    const mayEdit =
      existing.status === 'PENDING' &&
      verifiesEditCapability(
        editCapability,
        existing.id,
        existing.email,
        env().AUTH_SECRET,
      )

    // This branch should be unreachable for a valid capability because the
    // managed-id path above handles it. It remains fail-closed if a future
    // capability format or lookup changes.
    if (!mayEdit) {
      return {
        changed: false,
        created: false,
        id: existing.id,
        editCapability: null,
      }
    }

    return {
      changed: false,
      created: false,
      id: existing.id,
      editCapability: null,
    }
  }

  const inserted = await tx
    .insert(accessRequests)
    .values({
      ...input,
      sourceHash,
      lastSubmittedAt: now,
    })
    .onConflictDoNothing({ target: accessRequests.email })
    .returning({ id: accessRequests.id })

  return {
    changed: inserted.length === 1,
    created: inserted.length === 1,
    id: inserted[0]?.id ?? null,
    editCapability: inserted[0]?.id
      ? issueEditCapability(inserted[0].id, input.email, env().AUTH_SECRET)
      : null,
  }
  })
}

export async function listAccessRequests(): Promise<AccessRequestRecord[]> {
  const rows = await db
    .select({
      id: accessRequests.id,
      firstName: accessRequests.firstName,
      lastName: accessRequests.lastName,
      email: accessRequests.email,
      phone: accessRequests.phone,
      status: accessRequests.status,
      lastSubmittedAt: accessRequests.lastSubmittedAt,
      verifiedAt: accessRequests.verifiedAt,
      closedAt: accessRequests.closedAt,
      createdAt: accessRequests.createdAt,
    })
    .from(accessRequests)
    .orderBy(desc(accessRequests.lastSubmittedAt))

  return rows
}

export async function countPendingAccessRequests(): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(accessRequests)
    .where(eq(accessRequests.status, 'PENDING'))
  return Number(row?.value ?? 0)
}

export async function markAccessRequestVerified(
  id: string,
  actorId: string,
): Promise<boolean> {
  const changed = await db
    .update(accessRequests)
    .set({
      status: 'VERIFIED',
      verifiedAt: new Date(),
      verifiedById: actorId,
      updatedAt: new Date(),
    })
    .where(and(eq(accessRequests.id, id), eq(accessRequests.status, 'PENDING')))
    .returning({ id: accessRequests.id })

  return changed.length === 1
}

export async function closeAccessRequest(
  id: string,
  actorId: string,
): Promise<boolean> {
  const changed = await db
    .update(accessRequests)
    .set({
      status: 'CLOSED',
      closedAt: new Date(),
      closedById: actorId,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(accessRequests.id, id),
        inArray(accessRequests.status, ['PENDING', 'VERIFIED']),
      ),
    )
    .returning({ id: accessRequests.id })

  return changed.length === 1
}

/**
 * Owner-only caller support for a deletion request made by the data subject.
 *
 * There is deliberately no scheduled deletion: BUILD_SPEC §7 sets indefinite
 * retention as the default. This operation is the narrow exception promised
 * by the privacy page, and the action above it requires the Owner.
 */
export async function deleteAccessRequest(id: string): Promise<boolean> {
  const deleted = await db
    .delete(accessRequests)
    .where(eq(accessRequests.id, id))
    .returning({ id: accessRequests.id })

  return deleted.length === 1
}
