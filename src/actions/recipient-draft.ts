'use server'

import { and, count, eq, ne } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { actionError, actionOk, type ActionState } from '@/components/admin/action-state'
import { db } from '@/db'
import { investorAccounts, offers, recipients } from '@/db/schema'
import { audit } from '@/lib/audit'
import { requireOnboardedAdmin } from '@/lib/auth/guards'
import { getCurrentApproval } from '@/lib/compliance/approvals'
import { shortBlockReason } from '@/lib/compliance/explain'
import { isJurisdictionApproved } from '@/lib/compliance/jurisdictions'
import { resolveJurisdiction } from '@/lib/import/iso-countries'
import { isValidEmail } from '@/lib/import/validate'
import { isoToday } from '@/lib/money'

const schema = z.object({
  offerId: z.string().min(1),
  name: z.string().trim().min(1, 'A name is required.').max(240),
  email: z.string().trim().toLowerCase().refine(isValidEmail, 'Use a valid email address.'),
  jurisdiction: z.string().trim().max(120),
  responseDeadline: z.string().trim(),
  changeReason: z.string().trim().max(500),
  confirmed: z.boolean().refine((value) => value, 'Confirm the changes before saving.'),
})

export async function updateRecipientDraftAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const admin = await requireOnboardedAdmin()
  const parsed = schema.safeParse({
    offerId: formData.get('offerId'),
    name: formData.get('name'),
    email: formData.get('email'),
    jurisdiction: formData.get('jurisdiction'),
    responseDeadline: formData.get('responseDeadline'),
    changeReason: formData.get('changeReason'),
    confirmed: formData.get('confirmed') === 'on',
  })

  if (!parsed.success) {
    return actionError('The draft was not updated.', {
      form: parsed.error.issues[0]?.message ?? 'Check the fields and try again.',
    })
  }

  const input = parsed.data
  const row = await db
    .select({
      offer: offers,
      recipient: recipients,
      account: investorAccounts,
    })
    .from(offers)
    .innerJoin(recipients, eq(offers.recipientId, recipients.id))
    .innerJoin(investorAccounts, eq(offers.accountId, investorAccounts.id))
    .where(eq(offers.id, input.offerId))
    .limit(1)

  const current = row[0]
  if (!current) return actionError('That investor draft could not be found.')
  if (current.offer.emailStatus === 'SENT') {
    return actionError(
      'This invitation has already been sent. Use the recorded correction workflow instead.',
    )
  }

  let jurisdiction: string | null = null
  if (input.jurisdiction !== '') {
    const resolved = resolveJurisdiction(input.jurisdiction)
    if (!resolved.ok) return actionError(resolved.message, { jurisdiction: resolved.message })
    jurisdiction = resolved.code
  }

  let responseDeadline: string | null = null
  if (input.responseDeadline !== '') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.responseDeadline)) {
      return actionError('Use the date picker for the response deadline.', {
        responseDeadline: 'Use a date in YYYY-MM-DD form.',
      })
    }
    if (input.responseDeadline < isoToday()) {
      return actionError('The response deadline cannot be in the past.', {
        responseDeadline: 'Choose today or a later date.',
      })
    }
    responseDeadline = input.responseDeadline
  }

  const before = {
    name: current.recipient.name,
    email: current.recipient.email,
    jurisdiction: current.recipient.jurisdiction,
    responseDeadline: current.offer.responseDeadline,
  }
  const after = {
    name: input.name,
    email: input.email,
    jurisdiction,
    responseDeadline,
  }
  const changed = (Object.keys(before) as Array<keyof typeof before>).filter(
    (field) => before[field] !== after[field],
  )

  if (changed.length === 0) {
    return actionOk('Nothing changed. The existing investor record was left as it was.')
  }

  const [duplicate] = await db
    .select({ value: count() })
    .from(recipients)
    .where(
      and(
        eq(recipients.roundId, current.recipient.roundId),
        eq(recipients.email, input.email),
        ne(recipients.id, current.recipient.id),
      ),
    )
  const duplicateEmail = Number(duplicate?.value ?? 0) > 0

  let nextAccountId = current.account.id
  if (input.email !== current.account.email) {
    const matchingAccount = await db.query.investorAccounts.findFirst({
      where: eq(investorAccounts.email, input.email),
    })
    if (matchingAccount) {
      nextAccountId = matchingAccount.id
    } else {
      const [offerCount] = await db
        .select({ value: count() })
        .from(offers)
        .where(eq(offers.accountId, current.account.id))
      if (Number(offerCount?.value ?? 0) === 1) {
        await db
          .update(investorAccounts)
          .set({ email: input.email, name: input.name })
          .where(eq(investorAccounts.id, current.account.id))
      } else {
        const [created] = await db
          .insert(investorAccounts)
          .values({ email: input.email, name: input.name, status: 'INVITED' })
          .returning({ id: investorAccounts.id })
        nextAccountId = created.id
      }
    }
  }

  const missing = [
    jurisdiction === null ? 'jurisdiction' : null,
    responseDeadline === null ? 'response deadline' : null,
  ].filter((value): value is string => value !== null)
  if (duplicateEmail) missing.push('a unique email address')

  const approval = await getCurrentApproval('INVITATION')
  const jurisdictionCleared =
    jurisdiction !== null && isJurisdictionApproved(jurisdiction, approval)

  const blocked = missing.length > 0 || !jurisdictionCleared
  const blockReason =
    missing.length > 0
      ? ('VALIDATION_FAILED' as const)
      : jurisdictionCleared
        ? null
        : ('JURISDICTION_NOT_APPROVED' as const)
  const blockDetail =
    missing.length > 0
      ? `Draft preparation is incomplete: ${missing.join(', ')}. Nothing can be sent.`
      : jurisdictionCleared
        ? null
        : shortBlockReason(jurisdiction ?? '', approval?.approvedJurisdictions ?? [])

  await db.transaction(async (tx) => {
    await tx
      .update(recipients)
      .set({
        name: input.name,
        email: input.email,
        jurisdiction,
      })
      .where(eq(recipients.id, current.recipient.id))

    await tx
      .update(offers)
      .set({
        accountId: nextAccountId,
        responseDeadline,
        originalDeadline: current.offer.originalDeadline ?? responseDeadline,
        blocked,
        blockReason,
        blockDetail,
        emailStatus: blocked ? 'BLOCKED' : 'DRAFT',
      })
      .where(eq(offers.id, current.offer.id))
  })

  await audit({
    actor: { kind: 'user', id: admin.id, label: admin.email },
    entityType: 'offer',
    entityId: current.offer.id,
    action: 'recipient.draft_updated',
    metadata: {
      changed,
      before,
      after,
      reason: input.changeReason || null,
      incompleteFields: missing,
      accountSplit: nextAccountId !== current.account.id,
    },
  })

  revalidatePath('/recipients')
  revalidatePath(`/recipients/${current.offer.id}`)
  return actionOk(
    blocked
      ? 'Draft saved. It remains safely blocked until the outstanding items are complete.'
      : 'Draft saved. Nothing was sent.',
  )
}
