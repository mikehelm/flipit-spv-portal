'use server'

import { eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { actionError, actionOk, type ActionState } from '@/components/admin/action-state'
import { db } from '@/db'
import { serviceConfig, users } from '@/db/schema'
import { audit } from '@/lib/audit'
import { requireOperator } from '@/lib/auth/guards'
import {
  isPlausibleContactNumber,
  normaliseContactValue,
  onboardingProgress,
} from '@/lib/auth/onboarding'
import { ONBOARDING_ACTIONS, readOnboardingSnapshot } from '@/lib/auth/onboarding-store'
import { SERVICE_CONFIG_ID } from '@/lib/auth/service-config'
import { encrypt } from '@/lib/crypto'

/**
 * The five-step operator onboarding of BUILD_SPEC §2.1, plus step 4b.
 *
 * Each step is its own action and its own write, which is what makes the flow
 * resumable: there is no wizard state to lose, only facts that are either
 * stored or not. Progress is re-derived on every page load.
 *
 * Every action calls `requireOperator()` first. The owner is refused here, not
 * because he is less trusted but because these answers belong on David's user
 * row and to David's sending account — the owner walking the flow would write
 * his own name onto investment correspondence.
 */

const ONBOARDING_PATH = '/admin/onboarding'

// ---------------------------------------------------------------------------
// Step 1 — display name
// ---------------------------------------------------------------------------

const displayNameSchema = z.object({
  displayName: z
    .string()
    .trim()
    .min(2, 'Enter the name as it should appear on investment correspondence.')
    .max(120, 'That name is too long for an email signature.'),
})

export async function confirmDisplayNameAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const operator = await requireOperator()

  const parsed = displayNameSchema.safeParse({ displayName: formData.get('displayName') })
  if (!parsed.success) {
    return actionError('That name could not be saved.', {
      displayName: parsed.error.issues[0]?.message ?? 'Enter a name.',
    })
  }

  await db
    .update(users)
    .set({ displayName: parsed.data.displayName })
    .where(eq(users.id, operator.id))

  // Integration: §11.2 resolves `sender_name` from the row, then from
  // `service_config.default_sender_name` — it never reads `users.display_name`,
  // and it must not, because a fallback chain that quietly reaches into a user
  // row is a chain nobody can predict. But §2.1 step 1 asks for exactly this
  // name, "as it should appear on investment correspondence", so the answer is
  // written into the configuration the renderer reads rather than left in a
  // column the renderer cannot see. Explicit write, not an implicit fallback.
  await db
    .update(serviceConfig)
    .set({ defaultSenderName: parsed.data.displayName })
    .where(eq(serviceConfig.id, SERVICE_CONFIG_ID))

  await audit({
    actor: { kind: 'user', id: operator.id, label: operator.email },
    entityType: 'user',
    entityId: operator.id,
    action: ONBOARDING_ACTIONS.displayName,
    metadata: { displayName: parsed.data.displayName, senderNameDefaultUpdated: true },
  })

  revalidatePath(ONBOARDING_PATH)
  return actionOk(
    'Display name saved. It is also now the default sender name on the invitation, ' +
      'which the owner can change in Settings.',
  )
}

// ---------------------------------------------------------------------------
// Step 2 — contact method
// ---------------------------------------------------------------------------

const contactSchema = z.object({
  contactMethod: z.enum(['PHONE', 'WHATSAPP', 'EMAIL_ONLY']),
  contactValue: z.string().optional(),
})

export async function setContactMethodAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const operator = await requireOperator()

  const parsed = contactSchema.safeParse({
    contactMethod: formData.get('contactMethod'),
    contactValue: formData.get('contactValue') ?? undefined,
  })
  if (!parsed.success) {
    return actionError('Choose phone, WhatsApp, or email only.')
  }

  const { contactMethod } = parsed.data
  const contactValue = normaliseContactValue(contactMethod, parsed.data.contactValue)

  if (contactMethod !== 'EMAIL_ONLY') {
    if (contactValue === null) {
      return actionError('That contact method needs a number.', {
        contactValue: 'Enter the number investors should use.',
      })
    }
    if (!isPlausibleContactNumber(contactValue)) {
      return actionError('That number does not look like a phone number.', {
        contactValue:
          'Use digits, spaces, brackets and hyphens only, with the country code — for example +66 81 234 5678.',
      })
    }
  }

  await db
    .update(users)
    // Email-only stores null, not an empty string. A blank value would render
    // as a blank phone line; null removes the line from the template entirely.
    .set({ contactMethod, contactValue })
    .where(eq(users.id, operator.id))

  // Same integration as step 1, and the one WP4 flagged: §11.2 gives
  // `sender_phone` the chain row -> service_config and no automatic fallback,
  // so the number David just gave has to be written to the configuration or the
  // invitation blocks at pre-flight with "the operator has not set a number"
  // while the operator is looking at the number he set. Email-only clears it,
  // because the phone line is removed from the email entirely in that case and
  // leaving a stale number in the configuration would be a value nobody chose.
  await db
    .update(serviceConfig)
    .set({ defaultSenderPhone: contactValue })
    .where(eq(serviceConfig.id, SERVICE_CONFIG_ID))

  await audit({
    actor: { kind: 'user', id: operator.id, label: operator.email },
    entityType: 'user',
    entityId: operator.id,
    action: ONBOARDING_ACTIONS.contactMethod,
    metadata: {
      contactMethod,
      valueCaptured: contactValue !== null,
      senderPhoneDefaultUpdated: true,
    },
  })

  revalidatePath(ONBOARDING_PATH)
  return actionOk(
    contactMethod === 'EMAIL_ONLY'
      ? 'Saved. No number is stored, and the phone line is removed from the invitation entirely. Changing this later is a template change and needs re-approval.'
      : 'Saved. Changing this later is a template change and needs a fresh compliance approval, because it alters what recipients receive.',
  )
}

// ---------------------------------------------------------------------------
// Step 3 — the sending account
// ---------------------------------------------------------------------------

const sendingAccountSchema = z.object({
  smtpUser: z.email('Enter the full Gmail address mail will be sent from.'),
  smtpPassword: z
    .string()
    .transform((value) => value.replace(/\s+/g, ''))
    .refine((value) => value.length >= 8 && value.length <= 128, {
      message:
        'A Google app password is 16 letters. Paste it here — spaces are removed for you.',
    }),
})

export async function connectSendingAccountAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const operator = await requireOperator()

  const parsed = sendingAccountSchema.safeParse({
    smtpUser: formData.get('smtpUser'),
    smtpPassword: formData.get('smtpPassword'),
  })
  if (!parsed.success) {
    const issues: Record<string, string> = {}
    for (const issue of parsed.error.issues) {
      issues[String(issue.path[0] ?? 'form')] = issue.message
    }
    return actionError('The sending account could not be saved.', issues)
  }

  await db
    .update(serviceConfig)
    .set({
      emailTransport: 'SMTP',
      smtpUserEncrypted: encrypt(parsed.data.smtpUser.trim().toLowerCase()),
      smtpPasswordEncrypted: encrypt(parsed.data.smtpPassword),
      // The credential changed, so any previous verification result is stale.
      // WP5 re-verifies against SMTP before sending is possible.
      smtpLastVerifiedAt: null,
      smtpLastVerifyResult: null,
    })
    .where(eq(serviceConfig.id, SERVICE_CONFIG_ID))

  await audit({
    actor: { kind: 'user', id: operator.id, label: operator.email },
    entityType: 'user',
    entityId: operator.id,
    action: ONBOARDING_ACTIONS.sendingAccount,
    // Neither the address nor the app password goes in the log. The pair is a
    // credential. BUILD_SPEC §15.
    metadata: { transport: 'SMTP' },
  })

  revalidatePath(ONBOARDING_PATH)
  return actionOk(
    'Sending account stored, encrypted. It is never shown again and never leaves the server. ' +
      'Sending stays blocked until the connection has been tested.',
  )
}

// ---------------------------------------------------------------------------
// Step 4 — the personal video
// ---------------------------------------------------------------------------

const videoSchema = z.object({
  choice: z.enum(['RECORD_NOW', 'UPLOAD_LATER', 'SKIP']),
})

export async function recordVideoChoiceAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const operator = await requireOperator()

  const parsed = videoSchema.safeParse({ choice: formData.get('choice') })
  if (!parsed.success) {
    return actionError('Choose one of the three options.')
  }

  await audit({
    actor: { kind: 'user', id: operator.id, label: operator.email },
    entityType: 'user',
    entityId: operator.id,
    action: ONBOARDING_ACTIONS.video,
    metadata: { choice: parsed.data.choice },
  })

  revalidatePath(ONBOARDING_PATH)
  return actionOk(
    parsed.data.choice === 'SKIP'
      ? 'Noted — no video. The portal shows no gap where one would have been, and you can change your mind at any time.'
      : 'Noted. Recording and uploading open once that part of the portal is built; nothing is visible to investors until you publish it.',
  )
}

// ---------------------------------------------------------------------------
// Step 4b — the Q&A
// ---------------------------------------------------------------------------

export async function acknowledgeQaAction(
  _previous: ActionState,
  _formData: FormData,
): Promise<ActionState> {
  const operator = await requireOperator()

  await audit({
    actor: { kind: 'user', id: operator.id, label: operator.email },
    entityType: 'user',
    entityId: operator.id,
    action: ONBOARDING_ACTIONS.qa,
  })

  revalidatePath(ONBOARDING_PATH)
  return actionOk('Noted. You can write your own starter entries whenever you like.')
}

// ---------------------------------------------------------------------------
// Step 5 — the test invitation
// ---------------------------------------------------------------------------

export async function acknowledgeTestInvitationAction(
  _previous: ActionState,
  _formData: FormData,
): Promise<ActionState> {
  const operator = await requireOperator()

  await audit({
    actor: { kind: 'user', id: operator.id, label: operator.email },
    entityType: 'user',
    entityId: operator.id,
    action: ONBOARDING_ACTIONS.testInvitation,
  })

  revalidatePath(ONBOARDING_PATH)
  return actionOk(
    'Noted. Sending to anyone else stays blocked until a test invitation to your own address has actually been sent and reviewed.',
  )
}

// ---------------------------------------------------------------------------
// Finish
// ---------------------------------------------------------------------------

export async function completeOnboardingAction(
  _previous: ActionState,
  _formData: FormData,
): Promise<ActionState> {
  const operator = await requireOperator()

  const snapshot = await readOnboardingSnapshot(operator.id)
  const progress = onboardingProgress(snapshot)

  if (!progress.canComplete) {
    return actionError(
      `Setup is not finished — ${progress.totalCount - progress.completedCount} of ${progress.totalCount} steps still need an answer.`,
    )
  }

  await db
    .update(users)
    .set({ onboardingCompletedAt: new Date() })
    .where(eq(users.id, operator.id))

  await audit({
    actor: { kind: 'user', id: operator.id, label: operator.email },
    entityType: 'user',
    entityId: operator.id,
    action: ONBOARDING_ACTIONS.completed,
  })

  revalidatePath(ONBOARDING_PATH)
  revalidatePath('/admin')
  redirect('/admin')
}
