import { and, desc, eq, gte, lt } from 'drizzle-orm'
import { db } from '@/db'
import { usabilityEvents, users } from '@/db/schema'

export const DAVID_EMAIL = 'serenedavid@gmail.com'
export const USABILITY_RETENTION_DAYS = 7
export const USABILITY_RETENTION_MS =
  USABILITY_RETENTION_DAYS * 24 * 60 * 60 * 1000

export interface UsabilitySignalInput {
  actorUserId: string
  pagePath: string
  durationMs: number
  clickCount: number
  rapidClickCount: number
  browserErrorCount: number
  now?: Date
}

export interface UsabilitySignal {
  id: string
  pagePath: string
  durationMs: number
  clickCount: number
  rapidClickCount: number
  browserErrorCount: number
  createdAt: Date
}

export function retentionCutoff(now = new Date()): Date {
  return new Date(now.getTime() - USABILITY_RETENTION_MS)
}

const SAFE_PAGE_SEGMENTS = new Set([
  'access-requests',
  'acknowledgements',
  'admin',
  'audit',
  'compliance',
  'document',
  'email-review',
  'health',
  'import',
  'investors',
  'invites',
  'media',
  'onboarding',
  'password',
  'questions',
  'recipients',
  'register',
  'reminders',
  'roadmap',
  'round',
  'security',
  'settings',
  'templates',
  'updates',
  'usability',
  'video',
])

/**
 * Removes identifiers embedded in dynamic routes before a path is stored.
 * The report needs to say "Investors" or "Question detail", not which record
 * David opened.
 */
export function coarsePagePath(pathname: string): string {
  const clean = pathname.split(/[?#]/, 1)[0]?.replace(/\/+$/, '') || '/'
  const parts = clean.split('/').filter(Boolean)
  const safe = parts.map((part) =>
    SAFE_PAGE_SEGMENTS.has(part) ? part : ':item',
  )
  return `/${safe.join('/')}`.slice(0, 160) || '/'
}

export async function pruneUsabilityEvents(now = new Date()): Promise<number> {
  const removed = await db
    .delete(usabilityEvents)
    .where(lt(usabilityEvents.createdAt, retentionCutoff(now)))
    .returning({ id: usabilityEvents.id })
  return removed.length
}

export async function recordUsabilitySignal(
  input: UsabilitySignalInput,
): Promise<void> {
  const now = input.now ?? new Date()
  await db.transaction(async (tx) => {
    await tx
      .delete(usabilityEvents)
      .where(lt(usabilityEvents.createdAt, retentionCutoff(now)))
    await tx.insert(usabilityEvents).values({
      actorUserId: input.actorUserId,
      pagePath: coarsePagePath(input.pagePath),
      durationMs: input.durationMs,
      clickCount: input.clickCount,
      rapidClickCount: input.rapidClickCount,
      browserErrorCount: input.browserErrorCount,
      createdAt: now,
    })
  })
}

export async function loadUsabilitySignals(
  actorUserId: string,
  now = new Date(),
): Promise<UsabilitySignal[]> {
  return db
    .select({
      id: usabilityEvents.id,
      pagePath: usabilityEvents.pagePath,
      durationMs: usabilityEvents.durationMs,
      clickCount: usabilityEvents.clickCount,
      rapidClickCount: usabilityEvents.rapidClickCount,
      browserErrorCount: usabilityEvents.browserErrorCount,
      createdAt: usabilityEvents.createdAt,
    })
    .from(usabilityEvents)
    .where(
      and(
        eq(usabilityEvents.actorUserId, actorUserId),
        gte(usabilityEvents.createdAt, retentionCutoff(now)),
      ),
    )
    .orderBy(desc(usabilityEvents.createdAt))
    .limit(500)
}

export async function loadDavidUsabilitySignals(
  now = new Date(),
): Promise<UsabilitySignal[]> {
  const [david] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, DAVID_EMAIL))
    .limit(1)
  if (!david) return []
  return loadUsabilitySignals(david.id, now)
}
