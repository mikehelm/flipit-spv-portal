'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { reminderSchedules } from '@/db/schema'
import { actionError, actionOk, type ActionState } from '@/components/admin/action-state'
import { audit } from '@/lib/audit'
import { currentAdmin } from '@/lib/auth/guards'
import { checkbox, requiredText, zodFieldErrors } from '@/lib/form-values'
import { canManageQa } from '@/lib/qa/authority'
import {
  REMINDERS_PATH,
  cancelMany,
  cancelReminder,
  currentRound,
  refreshQueue,
  rescheduleReminder,
} from '@/lib/reminders/queue'

/**
 * The reminder queue. BUILD_SPEC §6.5.
 *
 * Note what is absent from this file, deliberately: **there is no action that
 * sends a reminder.** Reminders are the one unattended sender in the system and
 * they go out from the scheduled job, under the constraints in §6.5. Giving the
 * operator a "send it now" button would create a second path into the same
 * transport with a different set of checks in front of it, which is exactly the
 * kind of second path that eventually diverges from the first.
 *
 * What the operator can do here is what §6.5 says he can do: see the queue,
 * cancel, and reschedule.
 */

interface Authorized {
  ok: true
  admin: { id: string; email: string }
}

async function authorize(action: string): Promise<Authorized | { ok: false; state: ActionState }> {
  const admin = await currentAdmin()

  if (admin && canManageQa(admin.role)) {
    return { ok: true, admin: { id: admin.id, email: admin.email } }
  }

  await audit({
    actor: admin
      ? { kind: 'user', id: admin.id, label: admin.email }
      : { kind: 'system', label: 'unauthenticated' },
    entityType: 'reminder',
    entityId: null,
    action: 'reminder.refused',
    metadata: { attemptedAction: action },
  })

  return {
    ok: false,
    state: actionError(
      'You are not signed in as an administrator, so you cannot change the reminder queue. ' +
        'Sign in first. Nothing has been changed.',
    ),
  }
}

export async function cancelReminderAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const auth = await authorize('CANCEL')
  if (!auth.ok) return auth.state

  const reminderId = requiredText(formData.get('reminderId'))
  if (reminderId === '') return actionError('That reminder could not be found.')

  const result = await cancelReminder({
    reminderId,
    actorUserId: auth.admin.id,
    actor: { kind: 'user', id: auth.admin.id, label: auth.admin.email },
  })
  if (!result.ok) return actionError(result.message)

  revalidatePath(REMINDERS_PATH)
  return actionOk('Cancelled. It will not be recreated, and nothing was sent.')
}

/**
 * Cancel several at once. §6.5 allows this explicitly — "individually or in
 * bulk" — and it is worth saying why it does not contradict §14: it removes
 * messages. There is no counterpart that sends several.
 */
export async function cancelManyAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const auth = await authorize('CANCEL_MANY')
  if (!auth.ok) return auth.state

  const reminderIds = formData.getAll('reminderIds').map(String).filter((id) => id !== '')
  if (reminderIds.length === 0) {
    return actionError('Nothing was selected, so nothing was cancelled.')
  }

  const { cancelled } = await cancelMany({
    reminderIds,
    actorUserId: auth.admin.id,
    actor: { kind: 'user', id: auth.admin.id, label: auth.admin.email },
  })

  revalidatePath(REMINDERS_PATH)
  return actionOk(
    `${cancelled} ${cancelled === 1 ? 'reminder was' : 'reminders were'} cancelled. Nothing was sent.`,
  )
}

const rescheduleSchema = z.object({
  reminderId: z.string().min(1),
  scheduledFor: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, 'Choose a date and a time.'),
})

export async function rescheduleReminderAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const auth = await authorize('RESCHEDULE')
  if (!auth.ok) return auth.state

  const parsed = rescheduleSchema.safeParse({
    reminderId: requiredText(formData.get('reminderId')),
    scheduledFor: requiredText(formData.get('scheduledFor')),
  })
  if (!parsed.success) {
    return actionError('It was not moved.', zodFieldErrors(parsed.error))
  }

  const result = await rescheduleReminder({
    reminderId: parsed.data.reminderId,
    // The picker gives local wall-clock time with no zone. Treated as UTC,
    // which is what everything else in this application stores.
    scheduledFor: new Date(`${parsed.data.scheduledFor}:00.000Z`),
    actor: { kind: 'user', id: auth.admin.id, label: auth.admin.email },
  })
  if (!result.ok) return actionError(result.message)

  revalidatePath(REMINDERS_PATH)
  return actionOk('Moved.')
}

const scheduleSchema = z.object({
  daysBefore: z
    .string()
    .trim()
    .regex(/^\s*\d+(\s*,\s*\d+)*\s*$/, 'A comma-separated list of whole numbers, e.g. 7, 2.'),
  maxPerRecipient: z.coerce
    .number()
    .int('A whole number.')
    .min(0, 'Zero means no reminders at all.')
    .max(10, 'More than ten reminders to one person is not a reminder.'),
  enabled: z.boolean(),
})

/**
 * Change the schedule for the open round.
 *
 * Lowering the cap does not retract reminders already sent — nothing can — but
 * the queue is rebuilt immediately afterwards, so anything now over the cap
 * stops being planned.
 */
export async function updateScheduleAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const auth = await authorize('UPDATE_SCHEDULE')
  if (!auth.ok) return auth.state

  const parsed = scheduleSchema.safeParse({
    daysBefore: requiredText(formData.get('daysBefore')),
    maxPerRecipient: requiredText(formData.get('maxPerRecipient')),
    enabled: checkbox(formData.get('enabled')),
  })
  if (!parsed.success) {
    return actionError('The schedule was not changed.', zodFieldErrors(parsed.error))
  }

  const round = await currentRound()
  if (!round) return actionError('There is no open round to schedule reminders for.')

  const daysBefore = parsed.data.daysBefore
    .split(',')
    .map((part) => Number.parseInt(part.trim(), 10))
    .filter((value) => Number.isInteger(value) && value >= 0)

  if (daysBefore.length === 0) {
    return actionError('Give at least one number of days, for example 7, 2.')
  }

  const existing = await db.query.reminderSchedules.findFirst({
    where: eq(reminderSchedules.roundId, round.id),
  })

  if (existing) {
    await db
      .update(reminderSchedules)
      .set({
        daysBefore,
        maxPerRecipient: parsed.data.maxPerRecipient,
        enabled: parsed.data.enabled,
      })
      .where(eq(reminderSchedules.id, existing.id))
  } else {
    await db.insert(reminderSchedules).values({
      roundId: round.id,
      daysBefore,
      maxPerRecipient: parsed.data.maxPerRecipient,
      enabled: parsed.data.enabled,
    })
  }

  const actor = { kind: 'user' as const, id: auth.admin.id, label: auth.admin.email }

  await audit({
    actor,
    entityType: 'round',
    entityId: round.id,
    action: 'reminder.schedule_updated',
    metadata: {
      daysBefore,
      maxPerRecipient: parsed.data.maxPerRecipient,
      enabled: parsed.data.enabled,
    },
  })

  const outcome = await refreshQueue({ roundId: round.id, actor })

  revalidatePath(REMINDERS_PATH)

  return actionOk(
    parsed.data.enabled
      ? `Schedule saved. The queue was rebuilt: ${outcome.created} planned, ${outcome.removed} removed.`
      : 'Reminders are switched off for this round. Nothing queued will send, and the queue ' +
          'stays visible so you can see what would have.',
  )
}

/** Rebuild the queue by hand. Creates plans; sends nothing. */
export async function refreshQueueAction(
  _previous: ActionState,
  _formData: FormData,
): Promise<ActionState> {
  const auth = await authorize('REFRESH')
  if (!auth.ok) return auth.state

  const round = await currentRound()
  if (!round) return actionError('There is no open round.')

  const outcome = await refreshQueue({
    roundId: round.id,
    actor: { kind: 'user', id: auth.admin.id, label: auth.admin.email },
  })

  revalidatePath(REMINDERS_PATH)

  return actionOk(
    `Queue rebuilt. ${outcome.created} planned, ${outcome.removed} removed, ` +
      `${outcome.ineligible} recipients are not eligible for a reminder. Nothing was sent — ` +
      'reminders go out from the scheduled job, never from this page.',
  )
}
