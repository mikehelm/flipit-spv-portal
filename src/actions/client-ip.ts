import { headers } from 'next/headers'

/**
 * The address a request appears to come from, for rate limiting.
 *
 * `x-forwarded-for` is trusted here because the deployment sits behind a proxy
 * that sets it. It is a rate-limit key and nothing more — no decision about
 * who somebody is ever rests on it, so a spoofed value costs an attacker the
 * counter they were sharing with everyone else and gains them nothing.
 *
 * Extracted from actions/auth.ts in WP-2FA so the second-factor step can key
 * on exactly the same counters as the first. Two throttles keyed differently
 * would leave one of the two steps effectively unthrottled.
 */
export async function clientIp(): Promise<string> {
  const headerList = await headers()
  const forwarded = headerList.get('x-forwarded-for')
  if (forwarded) return forwarded.split(',')[0]!.trim()
  return headerList.get('x-real-ip') ?? 'unknown'
}
