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
const FORBIDDEN_KEY =
  /(password|passphrase|secret|token|apikey|api_key|openai|credential|htmlbody|textbody|body|transcript)/i

/**
 * Which key names are read, and which values a bad name actually condemns.
 *
 * Three rules, and each of them was learnt from a specific failure:
 *
 * 1. *Keys, never values.* A sign-in legitimately records
 *    `{ method: 'password' }` — the authentication method, which is exactly
 *    what an audit log exists to record. `scripts/verify-export.ts` scanned
 *    values once and refused that entry; a false alarm on a real check is how
 *    the check ends up switched off.
 *
 * 2. *Every depth, not just the top.* `metadata` is serialised verbatim into
 *    the audit export cell, so a credential nested one level down leaves the
 *    building by the same door a top-level one would.
 *
 * 3. *A booleaned key is a fact, not a secret.* `{ openAiKeyReplaced: true }`
 *    records that the owner changed the key, which is the whole point of
 *    auditing the settings screen. A boolean, a number, null or an empty
 *    string cannot carry a credential, so a matching name over one of those
 *    is admitted. Anything with text under it is refused.
 */
function couldCarryASecret(value: unknown): boolean {
  if (value === null || value === undefined) return false
  if (typeof value === 'boolean' || typeof value === 'number') return false
  if (typeof value === 'string') return value.length > 0
  return true
}

function offendingKeys(value: unknown, path: string[] = [], found: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const entry of value) offendingKeys(entry, path, found)
    return found
  }
  if (value === null || typeof value !== 'object') return found

  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    const here = [...path, key]
    if (FORBIDDEN_KEY.test(key) && couldCarryASecret(nested)) found.push(here.join('.'))
    offendingKeys(nested, here, found)
  }
  return found
}

export function assertNoSecrets(metadata: Record<string, unknown> | undefined): void {
  if (!metadata) return
  const offenders = offendingKeys(metadata)
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
