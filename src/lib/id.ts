import { randomBytes } from 'node:crypto'

/**
 * Collision-resistant, non-sequential identifier.
 *
 * Deliberately not an auto-incrementing integer: sequential ids leak how many
 * investors exist and in what order they were added, which cuts against
 * BUILD_SPEC §13. These never appear in a URL either (§15), but defence in
 * depth is cheap here.
 */
export function createId(): string {
  return randomBytes(16).toString('base64url')
}
