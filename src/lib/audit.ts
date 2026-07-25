import { db } from '@/db'
import { auditEvents } from '@/db/schema'

/**
 * The single audit entry point. BUILD_SPEC §16.
 *
 * Called from the same layer as the mutation it records — never from a React
 * component, never from the UI. Append-only: there is deliberately no update
 * or delete helper in this file, and nothing else in the codebase should write
 * to `audit_events` directly.
 *
 * What gets recorded includes actions the application REFUSED. A blocked send
 * with its reason is more useful after the fact than a successful one.
 */

export type Actor =
  | { kind: 'user'; id: string; label: string }
  | { kind: 'investor'; id: string; label: string }
  | { kind: 'system'; label: string }

export interface AuditInput {
  actor: Actor
  entityType: string
  entityId?: string | null
  action: string
  /** Non-secret only. See `assertNoSecrets`. */
  metadata?: Record<string, unknown>
}

/**
 * Keys that must never reach the audit log. BUILD_SPEC §15: never log a
 * credential, an email body, or an API key.
 *
 * This throws rather than redacting. A silent redaction teaches nobody; a
 * failing test teaches the next person not to pass the whole object in.
 */
const FORBIDDEN_KEY = /(password|secret|token|apikey|api_key|credential|htmlbody|textbody|body|transcript)/i

export function assertNoSecrets(metadata: Record<string, unknown> | undefined): void {
  if (!metadata) return
  const offenders = Object.keys(metadata).filter((key) => FORBIDDEN_KEY.test(key))
  if (offenders.length > 0) {
    throw new Error(
      `Audit metadata must not contain secrets or message bodies. Offending keys: ${offenders.join(', ')}. ` +
        'Record an identifier or a hash instead.',
    )
  }
}

export async function audit(input: AuditInput): Promise<void> {
  assertNoSecrets(input.metadata)

  await db.insert(auditEvents).values({
    actorUserId: input.actor.kind === 'user' ? input.actor.id : null,
    actorAccountId: input.actor.kind === 'investor' ? input.actor.id : null,
    actorLabel: input.actor.label,
    entityType: input.entityType,
    entityId: input.entityId ?? null,
    action: input.action,
    metadata: input.metadata ?? null,
  })
}

/** Convenience for the system actor, used by scheduled work such as reminders. */
export const systemActor: Actor = { kind: 'system', label: 'system' }
