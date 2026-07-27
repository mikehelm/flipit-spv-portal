'use server'

import { audit } from '@/lib/audit'
import {
  ACCESS_REQUEST_RECORDED_MESSAGE,
  MINIMUM_VALID_SUBMISSION_MS,
  accessRequestSchema,
} from '@/lib/access-requests/policy'
import { recordAccessRequest } from '@/lib/access-requests/store'
import { clientIp } from '@/actions/client-ip'

export interface SubmittedAccessRequestDetails {
  firstName: string
  lastName: string
  email: string
  phone: string
}

export type AccessRequestActionState =
  | { status: 'idle' }
  | {
      status: 'ok'
      message: string
      details: SubmittedAccessRequestDetails | null
      editCapability: string | null
    }
  | {
      status: 'error'
      message: string
      fieldErrors: Record<string, string>
      submittedDetails: SubmittedAccessRequestDetails | null
      editCapability: string | null
    }

function fieldErrors(issues: Array<{ path: PropertyKey[]; message: string }>) {
  const errors: Record<string, string> = {}
  for (const issue of issues) {
    const field = String(issue.path[0] ?? '')
    if (field && !errors[field]) errors[field] = issue.message
  }
  return errors
}

export async function submitAccessRequestAction(
  previous: AccessRequestActionState,
  formData: FormData,
): Promise<AccessRequestActionState> {
  // A quiet honeypot. Humans never see or fill it; automated submissions get
  // the same success response and no durable record.
  if (String(formData.get('website') ?? '').trim() !== '') {
    return {
      status: 'ok',
      message: ACCESS_REQUEST_RECORDED_MESSAGE,
      details: null,
      editCapability: null,
    }
  }

  const parsed = accessRequestSchema.safeParse({
    firstName: formData.get('firstName'),
    lastName: formData.get('lastName'),
    email: formData.get('email'),
    phone: formData.get('phone'),
  })

  if (!parsed.success) {
    const submittedDetails =
      previous.status === 'ok'
        ? previous.details
        : previous.status === 'error'
          ? previous.submittedDetails
          : null
    const editCapability =
      previous.status === 'idle' ? null : previous.editCapability
    return {
      status: 'error',
      message: 'Check the highlighted details and try again.',
      fieldErrors: fieldErrors(parsed.error.issues),
      submittedDetails,
      editCapability,
    }
  }

  const startedAt = Date.now()
  const suppliedCapability = String(formData.get('editCapability') ?? '') || null
  const retainedCapability =
    previous.status === 'idle' ? null : previous.editCapability
  const result = await recordAccessRequest(
    parsed.data,
    await clientIp(),
    suppliedCapability ?? retainedCapability,
  )

  if (result.changed && result.id) {
    await audit({
      actor: { kind: 'system', label: 'public access request' },
      entityType: 'access_request',
      entityId: result.id,
      action: 'access_request.submitted',
      metadata: {
        status: 'PENDING',
        submission: result.created ? 'CREATED' : 'EDITED',
      },
    })
  }

  // This is deliberately last, after the conditional audit write. A new or
  // edited request must not return one database operation later than a
  // duplicate, decided request or throttled source, because that difference
  // would reveal whether the address already exists.
  const remaining = MINIMUM_VALID_SUBMISSION_MS - (Date.now() - startedAt)
  if (remaining > 0) {
    await new Promise((resolve) => setTimeout(resolve, remaining))
  }

  // Deliberately the same for new, duplicate, decided, honeypot, and throttled
  // submissions. This form never confirms whether an address is known.
  return {
    status: 'ok',
    message: ACCESS_REQUEST_RECORDED_MESSAGE,
    details: parsed.data,
    editCapability: result.editCapability,
  }
}
