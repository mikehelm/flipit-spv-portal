import type { z } from 'zod'

/**
 * Reading a `FormData` field, in one place.
 *
 * Two work packages arrived with byte-identical private copies of these four
 * helpers. That is harmless right up to the moment one copy is changed — a
 * settings form and a compliance form disagreeing about whether a blank field
 * is `''` or `null`, or about which value counts as a ticked box, is exactly
 * the sort of difference that shows up as one screen silently storing an empty
 * string where the other stores nothing.
 *
 * Trimming is deliberate and applies everywhere: a jurisdiction list, a
 * reference number or a sender address with a stray trailing space is the same
 * value, and every one of these fields is typed by a human.
 */

/** Trimmed, or `null` when blank or absent. Blank means "not set", never `''`. */
export function optionalText(value: FormDataEntryValue | null): string | null {
  const text = typeof value === 'string' ? value.trim() : ''
  return text === '' ? null : text
}

/** Trimmed, or `''`. For fields a schema is about to require anyway. */
export function requiredText(value: FormDataEntryValue | null): string {
  return typeof value === 'string' ? value.trim() : ''
}

/**
 * An unticked checkbox is absent from `FormData` entirely, so anything that is
 * not an explicit "on"/"true" is false. Never coerce truthiness here: the
 * string "false" is what an unticked hidden field posts.
 */
export function checkbox(value: FormDataEntryValue | null): boolean {
  return value === 'on' || value === 'true'
}

/** Zod issues keyed by field name, for `ActionState.fieldErrors`. */
export function zodFieldErrors(error: z.ZodError): Record<string, string> {
  const result: Record<string, string> = {}
  for (const issue of error.issues) {
    result[String(issue.path[0] ?? 'form')] = issue.message
  }
  return result
}
