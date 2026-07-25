'use server'

import Decimal from 'decimal.js'
import { eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { actionError, actionOk, type ActionState } from '@/components/admin/action-state'
import { db } from '@/db'
import { serviceConfig } from '@/db/schema'
import { audit } from '@/lib/audit'
import { requireOwner } from '@/lib/auth/guards'
import { isPlausibleContactNumber } from '@/lib/auth/onboarding'
import { SERVICE_CONFIG_ID, readServiceConfig } from '@/lib/auth/service-config'
import { encrypt } from '@/lib/crypto'
import { checkbox, optionalText, zodFieldErrors as fieldErrors } from '@/lib/form-values'

/**
 * Owner-only service configuration. BUILD_SPEC §7, §9.1, §10, §11.2, §6.7.5.
 *
 * What is deliberately NOT here: the compliance approval (§8.2). Recording,
 * amending and voiding an approval is owner-only and is WP6's, and putting any
 * part of it on this page would put it one role check away from the operator.
 * Sending is gated on that approval, not on anything set below.
 *
 * The approved-jurisdiction list here is configuration, not authority. It
 * cannot clear a recipient; only a recorded compliance approval does that.
 */

const SETTINGS_PATH = '/admin/settings'

/** §7: moving to `disabled` requires a recent export or a logged override. */
const EXPORT_FRESHNESS_DAYS = 7

// ---------------------------------------------------------------------------
// Service mode and portal behaviour
// ---------------------------------------------------------------------------

const serviceSchema = z.object({
  serviceMode: z.enum(['ACTIVE', 'READ_ONLY', 'SUNSET', 'DISABLED']),
  closedAccountAccess: z.enum(['READ_ONLY', 'NONE']),
  qaVisibleDuringRaise: z.boolean(),
  decimalPlaces: z.coerce
    .number()
    .int('Decimal places must be a whole number.')
    .min(0, 'Decimal places cannot be negative.')
    .max(6, 'More than six decimal places is not meaningful here.'),
  sunsetClosingDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the date picker.')
    .nullable(),
  serviceContactEmail: z.email('Enter a valid contact address.').nullable(),
  overrideReason: z.string().trim().min(10).nullable(),
})

export async function updateServiceSettingsAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const owner = await requireOwner()

  const parsed = serviceSchema.safeParse({
    serviceMode: formData.get('serviceMode'),
    closedAccountAccess: formData.get('closedAccountAccess'),
    qaVisibleDuringRaise: checkbox(formData.get('qaVisibleDuringRaise')),
    decimalPlaces: formData.get('decimalPlaces'),
    sunsetClosingDate: optionalText(formData.get('sunsetClosingDate')),
    serviceContactEmail: optionalText(formData.get('serviceContactEmail')),
    overrideReason: optionalText(formData.get('overrideReason')),
  })

  if (!parsed.success) {
    return actionError('These settings could not be saved.', fieldErrors(parsed.error))
  }

  const next = parsed.data
  const current = await readServiceConfig()

  if (next.serviceMode === 'SUNSET' && next.sunsetClosingDate === null) {
    return actionError(
      'Sunset needs a closing date. The portal tells investors when it closes so they can download their records first.',
      { sunsetClosingDate: 'Set the closing date.' },
    )
  }

  if (
    (next.serviceMode === 'SUNSET' || next.serviceMode === 'DISABLED') &&
    next.serviceContactEmail === null
  ) {
    return actionError(
      'That mode shows investors a contact address instead of their portal. Set one that someone will still be reading.',
      { serviceContactEmail: 'Set a contact address.' },
    )
  }

  // §7: "Moving to `disabled` requires a completed export within the preceding
  // 7 days, or an explicit owner override that is logged with a reason."
  let overrideUsed = false
  if (next.serviceMode === 'DISABLED' && current.serviceMode !== 'DISABLED') {
    const cutoff = Date.now() - EXPORT_FRESHNESS_DAYS * 24 * 60 * 60 * 1000
    const exportIsFresh =
      current.lastExportAt !== null && current.lastExportAt.getTime() >= cutoff

    if (!exportIsFresh) {
      if (next.overrideReason === null) {
        return actionError(
          `There has been no completed export in the last ${EXPORT_FRESHNESS_DAYS} days. Run one first, or record a reason for overriding this.`,
          { overrideReason: 'Give a reason of at least ten characters, or export first.' },
        )
      }
      overrideUsed = true
    }
  }

  await db
    .update(serviceConfig)
    .set({
      serviceMode: next.serviceMode,
      closedAccountAccess: next.closedAccountAccess,
      qaVisibleDuringRaise: next.qaVisibleDuringRaise,
      decimalPlaces: next.decimalPlaces,
      sunsetClosingDate: next.sunsetClosingDate,
      serviceContactEmail: next.serviceContactEmail,
    })
    .where(eq(serviceConfig.id, SERVICE_CONFIG_ID))

  await audit({
    actor: { kind: 'user', id: owner.id, label: owner.email },
    entityType: 'service_config',
    entityId: SERVICE_CONFIG_ID,
    action: 'service_config.updated',
    metadata: {
      fromServiceMode: current.serviceMode,
      toServiceMode: next.serviceMode,
      closedAccountAccess: next.closedAccountAccess,
      qaVisibleDuringRaise: next.qaVisibleDuringRaise,
      decimalPlaces: next.decimalPlaces,
      exportPreconditionOverridden: overrideUsed,
      overrideReason: overrideUsed ? next.overrideReason : null,
    },
  })

  revalidatePath(SETTINGS_PATH)
  return actionOk(
    overrideUsed
      ? 'Saved. The export precondition was overridden and the reason is on the audit log.'
      : 'Saved.',
  )
}

// ---------------------------------------------------------------------------
// Default sender fields — BUILD_SPEC §11.2
// ---------------------------------------------------------------------------

const senderSchema = z.object({
  defaultSenderName: z.string().trim().min(2).max(120).nullable(),
  defaultSenderEmail: z.email('Enter a valid sender address.').nullable(),
  defaultSenderPhone: z
    .string()
    .trim()
    .refine(isPlausibleContactNumber, 'That does not look like a phone number.')
    .nullable(),
})

export async function updateSenderDefaultsAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const owner = await requireOwner()

  const parsed = senderSchema.safeParse({
    defaultSenderName: optionalText(formData.get('defaultSenderName')),
    defaultSenderEmail: optionalText(formData.get('defaultSenderEmail')),
    defaultSenderPhone: optionalText(formData.get('defaultSenderPhone')),
  })

  if (!parsed.success) {
    return actionError('Sender defaults could not be saved.', fieldErrors(parsed.error))
  }

  await db
    .update(serviceConfig)
    .set(parsed.data)
    .where(eq(serviceConfig.id, SERVICE_CONFIG_ID))

  await audit({
    actor: { kind: 'user', id: owner.id, label: owner.email },
    entityType: 'service_config',
    entityId: SERVICE_CONFIG_ID,
    action: 'service_config.sender_defaults_updated',
    metadata: {
      senderNameSet: parsed.data.defaultSenderName !== null,
      senderEmailSet: parsed.data.defaultSenderEmail !== null,
      senderPhoneSet: parsed.data.defaultSenderPhone !== null,
    },
  })

  revalidatePath(SETTINGS_PATH)
  return actionOk(
    parsed.data.defaultSenderPhone === null
      ? 'Saved. With no default phone number, any recipient whose row does not supply one is blocked at pre-flight — sender_phone has no automatic fallback.'
      : 'Saved.',
  )
}

// ---------------------------------------------------------------------------
// Approved jurisdictions
// ---------------------------------------------------------------------------

export async function updateApprovedJurisdictionsAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const owner = await requireOwner()

  const raw = typeof formData.get('jurisdictions') === 'string'
    ? String(formData.get('jurisdictions'))
    : ''

  const tokens = raw
    .split(/[\s,;]+/)
    .map((token) => token.trim().toUpperCase())
    .filter(Boolean)

  const invalid = tokens.filter((token) => !/^[A-Z]{2}$/.test(token))
  if (invalid.length > 0) {
    return actionError(
      `Not ISO 3166-1 alpha-2 country codes: ${invalid.join(', ')}. Blocs must be expanded to their member codes.`,
      { jurisdictions: 'Two-letter country codes only, separated by commas.' },
    )
  }

  const codes = [...new Set(tokens)].sort()
  const current = await readServiceConfig()

  await db
    .update(serviceConfig)
    .set({ approvedJurisdictions: codes })
    .where(eq(serviceConfig.id, SERVICE_CONFIG_ID))

  await audit({
    actor: { kind: 'user', id: owner.id, label: owner.email },
    entityType: 'service_config',
    entityId: SERVICE_CONFIG_ID,
    action: 'service_config.approved_jurisdictions_updated',
    metadata: { from: current.approvedJurisdictions, to: codes },
  })

  revalidatePath(SETTINGS_PATH)
  return actionOk(
    codes.length === 0
      ? 'Saved — the list is now empty, so no recipient is cleared by configuration.'
      : `Saved: ${codes.join(', ')}. A recorded compliance approval is still what clears a recipient; this list cannot loosen it.`,
  )
}

// ---------------------------------------------------------------------------
// AI provider — BUILD_SPEC §9.1
// ---------------------------------------------------------------------------

const aiSchema = z.object({
  openAiModel: z.string().trim().min(2).max(64),
  aiMonthlyCapUsd: z
    .string()
    .trim()
    .regex(/^\d{1,8}(\.\d{1,2})?$/, 'Enter an amount such as 20 or 20.00.'),
  aiHeadersOnly: z.boolean(),
  openAiKey: z
    .string()
    .trim()
    .refine((value) => value === '' || value.startsWith('sk-'), {
      message: 'An OpenAI key starts with "sk-". Leave the box empty to keep the current one.',
    })
    .refine((value) => value === '' || value.length >= 20, {
      message: 'That key looks truncated.',
    }),
})

export async function updateAiSettingsAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const owner = await requireOwner()

  const parsed = aiSchema.safeParse({
    openAiModel: formData.get('openAiModel'),
    aiMonthlyCapUsd: formData.get('aiMonthlyCapUsd'),
    aiHeadersOnly: checkbox(formData.get('aiHeadersOnly')),
    openAiKey: typeof formData.get('openAiKey') === 'string' ? formData.get('openAiKey') : '',
  })

  if (!parsed.success) {
    return actionError('AI settings could not be saved.', fieldErrors(parsed.error))
  }

  // Money stays a string end to end. decimal.js validates the range; the value
  // written to the database is the string that was typed.
  const cap = new Decimal(parsed.data.aiMonthlyCapUsd)
  if (cap.lessThanOrEqualTo(0)) {
    return actionError('The monthly cap must be greater than zero.', {
      aiMonthlyCapUsd: 'A cap of zero would switch AI assistance off — clear the key instead.',
    })
  }

  const keyProvided = parsed.data.openAiKey !== ''

  await db
    .update(serviceConfig)
    .set({
      openAiModel: parsed.data.openAiModel,
      aiMonthlyCapUsd: parsed.data.aiMonthlyCapUsd,
      aiHeadersOnly: parsed.data.aiHeadersOnly,
      // Empty means "leave the stored key alone" — not "delete it". Deleting is
      // its own deliberate action below.
      ...(keyProvided ? { openAiKeyEncrypted: encrypt(parsed.data.openAiKey) } : {}),
    })
    .where(eq(serviceConfig.id, SERVICE_CONFIG_ID))

  await audit({
    actor: { kind: 'user', id: owner.id, label: owner.email },
    entityType: 'service_config',
    entityId: SERVICE_CONFIG_ID,
    action: 'service_config.ai_settings_updated',
    metadata: {
      model: parsed.data.openAiModel,
      monthlyCapUsd: parsed.data.aiMonthlyCapUsd,
      headersOnly: parsed.data.aiHeadersOnly,
      openAiKeyReplaced: keyProvided,
    },
  })

  revalidatePath(SETTINGS_PATH)
  return actionOk(
    keyProvided
      ? 'Saved. The key is encrypted at rest and is never displayed again, logged, or exported.'
      : 'Saved. The stored key was left untouched.',
  )
}

export async function removeOpenAiKeyAction(
  _previous: ActionState,
  _formData: FormData,
): Promise<ActionState> {
  const owner = await requireOwner()

  await db
    .update(serviceConfig)
    .set({ openAiKeyEncrypted: null })
    .where(eq(serviceConfig.id, SERVICE_CONFIG_ID))

  await audit({
    actor: { kind: 'user', id: owner.id, label: owner.email },
    entityType: 'service_config',
    entityId: SERVICE_CONFIG_ID,
    action: 'service_config.ai_key_removed',
  })

  revalidatePath(SETTINGS_PATH)
  return actionOk(
    'Key removed. Import still works — the operator maps columns manually instead.',
  )
}

// ---------------------------------------------------------------------------
// The maker's credit — BUILD_SPEC §13.2
// ---------------------------------------------------------------------------

/**
 * §13.2: *"Configurable so it can be switched off per-surface if it ever feels
 * wrong beside the offer figures."*
 *
 * Two switches, one for each surface, and no third for the invitation email or
 * the participation certificate. §13.2 rules those out in a sentence that
 * gives no discretion — *"Those are formal instruments about someone's money,
 * and a maker's credit does not belong on either"* — so there is no column,
 * no field, and nothing here that could turn it on.
 *
 * This is a separate action rather than three more fields on the service form
 * because the service form carries the mode change, and moving to `disabled`
 * has an export precondition (§7). Anyone toggling a footer credit should not
 * be one submit away from that.
 */
const attributionSchema = z.object({
  attributionOnAdmin: z.boolean(),
  attributionOnPortal: z.boolean(),
  attributionUrl: z
    .url('Enter a full web address, or leave it blank.')
    .refine(
      (value) => value.startsWith('http://') || value.startsWith('https://'),
      'Only http and https addresses are accepted here.',
    )
    .nullable(),
})

export async function updateAttributionAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const owner = await requireOwner()

  const parsed = attributionSchema.safeParse({
    attributionOnAdmin: checkbox(formData.get('attributionOnAdmin')),
    attributionOnPortal: checkbox(formData.get('attributionOnPortal')),
    attributionUrl: optionalText(formData.get('attributionUrl')),
  })

  if (!parsed.success) {
    return actionError('That could not be saved.', fieldErrors(parsed.error))
  }

  const next = parsed.data

  await db
    .update(serviceConfig)
    .set({
      attributionOnAdmin: next.attributionOnAdmin,
      attributionOnPortal: next.attributionOnPortal,
      attributionUrl: next.attributionUrl,
    })
    .where(eq(serviceConfig.id, SERVICE_CONFIG_ID))

  await audit({
    actor: { kind: 'user', id: owner.id, label: owner.email },
    entityType: 'service_config',
    entityId: SERVICE_CONFIG_ID,
    action: 'service_config.attribution_updated',
    metadata: {
      attributionOnAdmin: next.attributionOnAdmin,
      attributionOnPortal: next.attributionOnPortal,
      attributionLinkSet: next.attributionUrl !== null,
    },
  })

  revalidatePath(SETTINGS_PATH)
  return actionOk('Saved.')
}
