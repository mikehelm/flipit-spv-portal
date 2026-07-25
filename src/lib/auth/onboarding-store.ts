import { and, desc, eq, inArray } from 'drizzle-orm'
import { db } from '@/db'
import { auditEvents, users } from '@/db/schema'
import type {
  ContactMethod,
  OnboardingSnapshot,
  VideoChoice,
} from './onboarding'
import { isSendingAccountConfigured, readServiceConfig } from './service-config'

/**
 * Where onboarding progress is read from.
 *
 * Three of the six steps have a natural home on an existing row:
 *
 *   1. display name          → `users.display_name`
 *   2. contact method        → `users.contact_method` / `users.contact_value`
 *   3. sending account       → `service_config.smtp_*_encrypted`
 *
 * The other three record a decision or an acknowledgement rather than a value —
 * "skip the video", "yes I understand how the Q&A works", "yes I will send
 * myself a test first" — and WP1's schema has no column for any of them.
 * Rather than add one (the schema is frozen for this package) they are read
 * back out of the append-only audit log, which is already the authoritative
 * record of who did what and when. It costs one indexed query, and it means
 * the onboarding trail and the audit trail cannot disagree with each other.
 */

export const ONBOARDING_ACTIONS = {
  displayName: 'operator_onboarding.display_name_confirmed',
  contactMethod: 'operator_onboarding.contact_method_set',
  sendingAccount: 'operator_onboarding.sending_account_connected',
  video: 'operator_onboarding.video_choice',
  qa: 'operator_onboarding.qa_acknowledged',
  testInvitation: 'operator_onboarding.test_invitation_acknowledged',
  completed: 'operator_onboarding.completed',
  reopened: 'operator_onboarding.reopened',
} as const

const ACKNOWLEDGEMENT_ACTIONS = [
  ONBOARDING_ACTIONS.video,
  ONBOARDING_ACTIONS.qa,
  ONBOARDING_ACTIONS.testInvitation,
]

const VIDEO_CHOICES: readonly VideoChoice[] = ['RECORD_NOW', 'UPLOAD_LATER', 'SKIP']

function readVideoChoice(metadata: unknown): VideoChoice | null {
  if (typeof metadata !== 'object' || metadata === null) return null
  const choice = (metadata as Record<string, unknown>).choice
  return typeof choice === 'string' && VIDEO_CHOICES.includes(choice as VideoChoice)
    ? (choice as VideoChoice)
    : null
}

export async function readOnboardingSnapshot(
  userId: string,
): Promise<OnboardingSnapshot> {
  const [user, config, acknowledgements] = await Promise.all([
    db.query.users.findFirst({ where: eq(users.id, userId) }),
    readServiceConfig(),
    db
      .select({ action: auditEvents.action, metadata: auditEvents.metadata })
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.entityType, 'user'),
          eq(auditEvents.entityId, userId),
          inArray(auditEvents.action, ACKNOWLEDGEMENT_ACTIONS),
        ),
      )
      .orderBy(desc(auditEvents.createdAt)),
  ])

  if (!user) {
    throw new Error('Cannot read onboarding progress for a user that does not exist.')
  }

  const videoEvent = acknowledgements.find((e) => e.action === ONBOARDING_ACTIONS.video)

  return {
    displayName: user.displayName,
    contactMethod: user.contactMethod as ContactMethod | null,
    contactValue: user.contactValue,
    sendingAccountConfigured: isSendingAccountConfigured(config),
    videoChoice: videoEvent ? readVideoChoice(videoEvent.metadata) : null,
    qaAcknowledged: acknowledgements.some((e) => e.action === ONBOARDING_ACTIONS.qa),
    testInvitationAcknowledged: acknowledgements.some(
      (e) => e.action === ONBOARDING_ACTIONS.testInvitation,
    ),
    completedAt: user.onboardingCompletedAt,
  }
}
