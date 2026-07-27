'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { actionError, actionOk, type ActionState } from '@/components/admin/action-state'
import { audit } from '@/lib/audit'
import {
  closeAccessRequest,
  deleteAccessRequest,
  markAccessRequestVerified,
} from '@/lib/access-requests/store'
import { requireOnboardedAdmin, requireOwner } from '@/lib/auth/guards'

const requestIdSchema = z.object({ requestId: z.string().min(1) })

function refreshQueue(): void {
  revalidatePath('/access-requests')
  revalidatePath('/admin')
}

export async function verifyAccessRequestAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const admin = await requireOnboardedAdmin()
  const parsed = requestIdSchema.safeParse({ requestId: formData.get('requestId') })
  if (!parsed.success) return actionError('That request could not be identified.')

  const changed = await markAccessRequestVerified(parsed.data.requestId, admin.id)
  if (!changed) {
    refreshQueue()
    return actionError('That request is no longer pending. Nothing was changed.')
  }

  await audit({
    actor: { kind: 'user', id: admin.id, label: admin.email },
    entityType: 'access_request',
    entityId: parsed.data.requestId,
    action: 'access_request.phone_verified',
    metadata: { status: 'VERIFIED' },
  })

  refreshQueue()
  return actionOk(
    'Phone verification recorded. Access was not granted and no invitation was sent.',
  )
}

export async function closeAccessRequestAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const admin = await requireOnboardedAdmin()
  const parsed = requestIdSchema.safeParse({ requestId: formData.get('requestId') })
  if (!parsed.success) return actionError('That request could not be identified.')

  const changed = await closeAccessRequest(parsed.data.requestId, admin.id)
  if (!changed) {
    refreshQueue()
    return actionError('That request is already closed. Nothing was changed.')
  }

  await audit({
    actor: { kind: 'user', id: admin.id, label: admin.email },
    entityType: 'access_request',
    entityId: parsed.data.requestId,
    action: 'access_request.closed',
    metadata: { status: 'CLOSED' },
  })

  refreshQueue()
  return actionOk('Request closed. Access was not granted and no invitation was sent.')
}

export async function deleteAccessRequestAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const owner = await requireOwner()
  const parsed = requestIdSchema.safeParse({ requestId: formData.get('requestId') })
  if (!parsed.success) return actionError('That request could not be identified.')

  const deleted = await deleteAccessRequest(parsed.data.requestId)
  if (!deleted) {
    refreshQueue()
    return actionError('That request no longer exists. Nothing was changed.')
  }

  await audit({
    actor: { kind: 'user', id: owner.id, label: owner.email },
    entityType: 'access_request',
    entityId: parsed.data.requestId,
    action: 'access_request.personal_data_deleted',
    metadata: { reason: 'DATA_SUBJECT_REQUEST' },
  })

  refreshQueue()
  return actionOk('The submitted name, email address and phone number were deleted.')
}
