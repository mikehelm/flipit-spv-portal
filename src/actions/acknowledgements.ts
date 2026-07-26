'use server'

import { asc, eq, isNull } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { actionError, actionOk, type ActionState } from '@/components/admin/action-state'
import { db } from '@/db'
import { acknowledgementItems } from '@/db/schema'
import { audit } from '@/lib/audit'
import { requireOwner } from '@/lib/auth/guards'
import { forbiddenWordsInAcknowledgement } from '@/lib/portal/acknowledgements'
import { checkbox, optionalText, zodFieldErrors as fieldErrors } from '@/lib/form-values'

/**
 * The acknowledgement wording. BUILD_SPEC §13, §8.2.
 *
 * §8.2: *"the portal's acknowledgement checkboxes are configurable so that
 * approved wording can be applied without a code change."* This is the screen
 * behind that sentence, and until now there was no table, no column and no
 * checkbox — the requirement was unmet in full.
 *
 * **Owner only, and this is the same rule as §8.2's fourth clause.** The
 * approved wording is part of what the compliance approver signed off; §8.2
 * says *"the operator cannot record or amend"* an approval, and wording an
 * approver cleared is not a different kind of thing. Where the specification
 * gives a role to compliance, that is the role.
 *
 * **The wording gate refuses at write time and names the word.** §13's second
 * clause — a response is *"not to be treated as a binding subscription unless
 * the final legal documents expressly make them so"* — is a constraint on the
 * application, and a settings screen that accepted "I agree to subscribe" would
 * be a way around it that needs no code change at all. So a label is checked
 * before it is stored, out loud.
 *
 * **Archive, never delete.** A row somebody has ticked is evidence. Archiving
 * takes it off the portal and leaves the record intact.
 */

const ACK_PATH = '/admin/acknowledgements'
const PORTAL_PATH = '/portal'

const labelSchema = z
  .string()
  .trim()
  .min(10, 'An acknowledgement needs to be a sentence a person can actually read.')
  // Long enough for approved wording, short enough that nobody is being asked
  // to agree to a page of text next to a tick box.
  .max(400, 'Keep it under 400 characters. Longer wording belongs in the documents.')

function refuseForbiddenWords(label: string): ActionState | null {
  const found = forbiddenWordsInAcknowledgement(label)
  if (found.length === 0) return null

  return actionError(
    `That wording cannot go on the portal: it contains ${found
      .map((word) => `“${word}”`)
      .join(', ')}. §13 says a tick may not be treated as a binding subscription ` +
      'unless the final legal documents expressly make it so — wording that reads as ' +
      'an undertaking would do exactly that, from a settings screen.',
    { label: `Remove ${found.map((word) => `“${word}”`).join(', ')}.` },
  )
}

async function liveItems() {
  return await db
    .select()
    .from(acknowledgementItems)
    .where(isNull(acknowledgementItems.archivedAt))
    .orderBy(asc(acknowledgementItems.sortOrder), asc(acknowledgementItems.createdAt))
}

// ---------------------------------------------------------------------------

const addSchema = z.object({ label: labelSchema, required: z.boolean() })

export async function addAcknowledgementAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const owner = await requireOwner()

  const parsed = addSchema.safeParse({
    label: formData.get('label'),
    required: checkbox(formData.get('required')),
  })
  if (!parsed.success) {
    return actionError('That could not be added.', fieldErrors(parsed.error))
  }

  const refusal = refuseForbiddenWords(parsed.data.label)
  if (refusal) {
    await audit({
      actor: { kind: 'user', id: owner.id, label: owner.email },
      entityType: 'acknowledgement_item',
      action: 'acknowledgement.refused',
      metadata: { reason: 'FORBIDDEN_WORDING' },
    })
    return refusal
  }

  const existing = await liveItems()

  if (existing.some((item) => item.label.toLowerCase() === parsed.data.label.toLowerCase())) {
    return actionError('That wording is already on the portal.', {
      label: 'It is already there.',
    })
  }

  // Eight is well past what anybody reads before ticking. A wall of boxes is
  // how an acknowledgement stops being one.
  if (existing.length >= 8) {
    return actionError(
      'There are already eight acknowledgements. Past this nobody reads them, which ' +
        'defeats the purpose of asking. Archive one before adding another.',
    )
  }

  const nextOrder = existing.reduce((max, item) => Math.max(max, item.sortOrder), -1) + 1

  const [created] = await db
    .insert(acknowledgementItems)
    .values({
      label: parsed.data.label,
      required: parsed.data.required,
      sortOrder: nextOrder,
    })
    .returning()

  await audit({
    actor: { kind: 'user', id: owner.id, label: owner.email },
    entityType: 'acknowledgement_item',
    entityId: created!.id,
    action: 'acknowledgement.added',
    metadata: { required: created!.required, revision: created!.revision },
  })

  revalidatePath(ACK_PATH)
  revalidatePath(PORTAL_PATH)
  return actionOk(
    parsed.data.required
      ? 'Added. Investors must tick it before an interest can be recorded.'
      : 'Added, as optional. Investors see it and are not required to tick it.',
  )
}

// ---------------------------------------------------------------------------

const updateSchema = z.object({
  itemId: z.string().min(1),
  label: labelSchema,
  required: z.boolean(),
})

export async function updateAcknowledgementAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const owner = await requireOwner()

  const parsed = updateSchema.safeParse({
    itemId: optionalText(formData.get('itemId')),
    label: formData.get('label'),
    required: checkbox(formData.get('required')),
  })
  if (!parsed.success) {
    return actionError('That could not be saved.', fieldErrors(parsed.error))
  }

  const refusal = refuseForbiddenWords(parsed.data.label)
  if (refusal) {
    await audit({
      actor: { kind: 'user', id: owner.id, label: owner.email },
      entityType: 'acknowledgement_item',
      entityId: parsed.data.itemId,
      action: 'acknowledgement.refused',
      metadata: { reason: 'FORBIDDEN_WORDING' },
    })
    return refusal
  }

  const before = await db.query.acknowledgementItems.findFirst({
    where: eq(acknowledgementItems.id, parsed.data.itemId),
  })
  if (!before) return actionError('That acknowledgement no longer exists.')
  if (before.archivedAt !== null) {
    return actionError('That acknowledgement is archived. Archived wording is not edited.')
  }

  // The revision moves only when the words move. Making a box optional is a
  // change to the process, not to what anybody agreed to, and bumping the
  // revision for it would make the audit trail claim the wording changed.
  const wordsChanged = before.label !== parsed.data.label

  await db
    .update(acknowledgementItems)
    .set({
      label: parsed.data.label,
      required: parsed.data.required,
      revision: wordsChanged ? before.revision + 1 : before.revision,
      updatedAt: new Date(),
    })
    .where(eq(acknowledgementItems.id, parsed.data.itemId))

  await audit({
    actor: { kind: 'user', id: owner.id, label: owner.email },
    entityType: 'acknowledgement_item',
    entityId: parsed.data.itemId,
    action: 'acknowledgement.amended',
    // The revision and whether the words moved. Not the wording itself: the
    // audit log is exported, and approved wording has one home.
    metadata: {
      wordsChanged,
      fromRevision: before.revision,
      toRevision: wordsChanged ? before.revision + 1 : before.revision,
      required: parsed.data.required,
    },
  })

  revalidatePath(ACK_PATH)
  revalidatePath(PORTAL_PATH)
  return actionOk(
    wordsChanged
      ? 'Saved as a new revision. Everything already ticked keeps the words it was ' +
          'ticked under — nothing already agreed to has been rewritten.'
      : 'Saved. The wording is unchanged, so the revision has not moved.',
  )
}

// ---------------------------------------------------------------------------

const archiveSchema = z.object({ itemId: z.string().min(1) })

/**
 * Takes wording off the portal without destroying what was agreed under it.
 *
 * There is deliberately no delete. Every acknowledgement carries its own copy
 * of the words, so removing the row would not corrupt the evidence — but it
 * would remove the only place the operator can see what was on the portal at
 * the time, and that is worth keeping for a table this small.
 */
export async function archiveAcknowledgementAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const owner = await requireOwner()

  const parsed = archiveSchema.safeParse({ itemId: optionalText(formData.get('itemId')) })
  if (!parsed.success) return actionError('That could not be archived.')

  const before = await db.query.acknowledgementItems.findFirst({
    where: eq(acknowledgementItems.id, parsed.data.itemId),
  })
  if (!before) return actionError('That acknowledgement no longer exists.')
  if (before.archivedAt !== null) return actionOk('It was already archived.')

  await db
    .update(acknowledgementItems)
    .set({ archivedAt: new Date(), updatedAt: new Date() })
    .where(eq(acknowledgementItems.id, parsed.data.itemId))

  await audit({
    actor: { kind: 'user', id: owner.id, label: owner.email },
    entityType: 'acknowledgement_item',
    entityId: parsed.data.itemId,
    action: 'acknowledgement.archived',
    metadata: { revision: before.revision },
  })

  revalidatePath(ACK_PATH)
  revalidatePath(PORTAL_PATH)
  return actionOk(
    'Archived. It has gone from the portal, and everything already ticked under it is ' +
      'still on the record.',
  )
}
