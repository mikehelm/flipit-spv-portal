import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { serviceConfig } from '@/db/schema'

/**
 * Reads of the `service_config` singleton. BUILD_SPEC §7.
 *
 * It lives under `lib/auth` because WP2 owns the settings surface that writes
 * it. If a shared configuration module appears later, this belongs there.
 *
 * Nothing in here ever returns an encrypted credential to a caller that could
 * put it on a page. `settingsView()` is what the settings and onboarding pages
 * render, and it carries booleans where the secrets are.
 */

export const SERVICE_CONFIG_ID = 'singleton'

export type ServiceConfigRow = typeof serviceConfig.$inferSelect

export async function readServiceConfig(): Promise<ServiceConfigRow> {
  const row = await db.query.serviceConfig.findFirst({
    where: eq(serviceConfig.id, SERVICE_CONFIG_ID),
  })

  if (!row) {
    throw new Error(
      'Service configuration row is missing. Run `pnpm db:seed` — the application ' +
        'will not guess at a default service mode, decimal precision or jurisdiction list.',
    )
  }

  return row
}

export function isSendingAccountConfigured(row: ServiceConfigRow): boolean {
  return Boolean(row.smtpUserEncrypted) && Boolean(row.smtpPasswordEncrypted)
}
