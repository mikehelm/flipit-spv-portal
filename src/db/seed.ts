/**
 * Seed. Idempotent — safe to run repeatedly.
 *
 * Creates only what the application needs to boot: the privileged users from
 * the environment allowlist, the service configuration singleton, the first
 * round, and a reminder schedule. It creates no investors, no recipients and
 * no offers. Test data is a separate concern and must never be confusable
 * with real investor records.
 */

import 'dotenv/config'
import { eq, isNull } from 'drizzle-orm'
import { issueAdminSetupLink } from '@/lib/auth/bootstrap'
import { db } from './index'
import {
  featureFlags,
  reminderSchedules,
  roadmapTiles,
  rounds,
  serviceConfig,
  users,
} from './schema'
import { env } from '@/lib/env'

async function seedUsers() {
  const config = env()
  const wanted: Array<{ email: string; role: 'OWNER' | 'OPERATOR' }> = [
    ...config.ownerEmails.map((email) => ({ email, role: 'OWNER' as const })),
    ...config.operatorEmails.map((email) => ({ email, role: 'OPERATOR' as const })),
  ]

  for (const entry of wanted) {
    const existing = await db.query.users.findFirst({
      where: eq(users.email, entry.email),
    })
    if (existing) {
      if (existing.role !== entry.role) {
        await db.update(users).set({ role: entry.role }).where(eq(users.id, existing.id))
        console.log(`  updated role for ${entry.email} → ${entry.role}`)
      }
      continue
    }
    await db.insert(users).values({ email: entry.email, role: entry.role })
    console.log(`  created ${entry.role.toLowerCase()} ${entry.email}`)
  }
}

async function seedServiceConfig() {
  const existing = await db.query.serviceConfig.findFirst()
  if (existing) return

  await db.insert(serviceConfig).values({
    id: 'singleton',
    serviceMode: 'ACTIVE',
    // Empty on purpose. Until a compliance approval names the cleared
    // countries, no recipient can be sent to. BUILD_SPEC §8.2.
    approvedJurisdictions: [],
    aggregateRaiseUsd: '30000',
    decimalPlaces: 3,
    qaVisibleDuringRaise: true,
    emailTransport: 'SMTP',
  })
  console.log('  created service configuration')
}

async function seedFirstRound() {
  const existing = await db.query.rounds.findFirst()
  if (existing) return existing

  const [round] = await db
    .insert(rounds)
    .values({
      name: 'Flipit Global SPV — first round',
      aggregateTargetUsd: '30000',
      // The SPV may acquire up to 30% of Flipit Global Limited.
      flipitShare: '0.300000',
    })
    .returning()

  console.log('  created first round')

  await db.insert(reminderSchedules).values({
    roundId: round.id,
    daysBefore: [7, 2],
    maxPerRecipient: 2,
    enabled: true,
  })
  console.log('  created reminder schedule (7 and 2 days before, cap 2)')

  return round
}

async function seedRoadmapTiles() {
  const existing = await db.query.roadmapTiles.findFirst()
  if (existing) return

  // Names only. No dates, no descriptions, no promises. BUILD_SPEC §13.1.
  const labels = [
    'Holdings & documents',
    'Company updates',
    'Direct line to David',
    'Reporting',
  ]
  await db.insert(roadmapTiles).values(
    labels.map((label, index) => ({ label, sortOrder: index, isLive: false })),
  )
  console.log(`  created ${labels.length} roadmap tiles`)
}

async function seedFeatureFlags() {
  const flags = [
    { key: 'register_of_interest', enabled: true, note: 'BUILD_SPEC §5.2' },
    { key: 'operator_video', enabled: true, note: 'BUILD_SPEC §13.3' },
    { key: 'qa_shared', enabled: true, note: 'BUILD_SPEC §6.7' },
    { key: 'roadmap_tiles', enabled: true, note: 'BUILD_SPEC §13.1' },
  ]
  for (const flag of flags) {
    const existing = await db.query.featureFlags.findFirst({
      where: eq(featureFlags.key, flag.key),
    })
    if (!existing) await db.insert(featureFlags).values(flag)
  }
}

/**
 * BUILD_SPEC §2.2, "First run": the seed prints a one-time expiring setup link
 * to the console for any allowlisted account that has no password yet.
 *
 * The link is printed here and nowhere else. It is not emailed, not written to
 * a file, and not put in an environment variable — a password never arrives by
 * any of those routes. Only the hash of the token is stored, so re-running the
 * seed mints a fresh link and revokes the previous one rather than reprinting
 * something it could not recover anyway.
 *
 * An account that already has a password gets no link, so this is safe to run
 * against a live database.
 */
async function printSetupLinks() {
  const withoutPassword = await db.query.users.findMany({
    where: isNull(users.passwordHash),
    columns: { email: true, role: true },
  })

  if (withoutPassword.length === 0) {
    console.log('  every administrator already has a password — no setup links issued')
    return
  }

  console.log('')
  console.log('  One-time setup links. Each works once, expires, and is not recoverable:')

  for (const user of withoutPassword) {
    const link = await issueAdminSetupLink(user.email)
    console.log('')
    console.log(`    ${user.email} (${user.role.toLowerCase()})`)
    console.log(`    ${link.url}`)
    console.log(`    expires ${link.expiresAt.toISOString()}`)
  }
  console.log('')
}

async function main() {
  console.log('Seeding…')
  await seedUsers()
  await seedServiceConfig()
  await seedFirstRound()
  await seedRoadmapTiles()
  await seedFeatureFlags()
  await printSetupLinks()
  console.log('Done.')
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Seed failed:', error)
    process.exit(1)
  })
