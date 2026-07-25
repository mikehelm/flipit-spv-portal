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
import { eq } from 'drizzle-orm'
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

async function main() {
  console.log('Seeding…')
  await seedUsers()
  await seedServiceConfig()
  await seedFirstRound()
  await seedRoadmapTiles()
  await seedFeatureFlags()
  console.log('Done.')
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Seed failed:', error)
    process.exit(1)
  })
