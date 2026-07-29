import { and, desc, eq } from 'drizzle-orm'
import { db } from '@/db'
import { auditEvents } from '@/db/schema'

export const TOHU_DECISION_ACTION = 'investor_plan.tohu_email_decision'
export const TOHU_ALIAS_EMAIL = 'serenedavid+tohu@gmail.com'
export const GMAIL_ALIAS_HELP_URL =
  'https://support.google.com/mail/answer/22370?hl=en'

export const TOHU_DECISIONS = [
  'PLUS_ALIAS',
  'COMBINE',
  'DECIDE_LATER',
] as const

export type TohuDecision = (typeof TOHU_DECISIONS)[number]

export function isTohuDecision(value: unknown): value is TohuDecision {
  return (
    typeof value === 'string' &&
    (TOHU_DECISIONS as readonly string[]).includes(value)
  )
}

function decisionFromMetadata(metadata: unknown): TohuDecision | null {
  if (typeof metadata !== 'object' || metadata === null) return null
  const decision = (metadata as Record<string, unknown>).decision
  return isTohuDecision(decision) ? decision : null
}

export async function readTohuDecision(
  operatorUserId: string,
): Promise<TohuDecision | null> {
  const row = await db.query.auditEvents.findFirst({
    where: and(
      eq(auditEvents.entityType, 'user'),
      eq(auditEvents.entityId, operatorUserId),
      eq(auditEvents.action, TOHU_DECISION_ACTION),
    ),
    orderBy: desc(auditEvents.createdAt),
    columns: { metadata: true },
  })

  return decisionFromMetadata(row?.metadata)
}
