import type { Metadata } from 'next'
import {
  closeAccessRequestAction,
  deleteAccessRequestAction,
  verifyAccessRequestAction,
} from '@/actions/access-requests'
import { ActionForm } from '@/components/admin/action-form'
import { Notice, Pill, SectionHeading } from '@/components/admin/ui'
import { listAccessRequests, type AccessRequestRecord } from '@/lib/access-requests/store'
import { requireOnboardedAdmin } from '@/lib/auth/guards'

export const metadata: Metadata = {
  title: 'Access requests',
  robots: { index: false, follow: false, nocache: true },
}

export const dynamic = 'force-dynamic'

function when(value: Date): string {
  return new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Bangkok',
  }).format(value)
}

function RequestCard({
  request,
  canDelete,
}: {
  request: AccessRequestRecord
  canDelete: boolean
}) {
  const tone =
    request.status === 'PENDING'
      ? 'warn'
      : request.status === 'VERIFIED'
        ? 'ok'
        : 'neutral'

  return (
    <article className="rounded-sm border hairline bg-paper p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-white">
            {request.firstName} {request.lastName}
          </h2>
          <p className="mt-1 break-all text-sm text-ftext">
            <a href={`mailto:${request.email}`} className="text-orange">
              {request.email}
            </a>
          </p>
          <p className="mt-1 text-sm text-ftext">
            <a href={`tel:${request.phone}`} className="text-orange">
              {request.phone}
            </a>
          </p>
        </div>
        <Pill tone={tone}>{request.status}</Pill>
      </div>

      <dl className="mt-4 grid grid-cols-1 gap-3 text-xs text-dim sm:grid-cols-2">
        <div>
          <dt>First submitted</dt>
          <dd className="mt-1 text-ftext">{when(request.createdAt)}</dd>
        </div>
        <div>
          <dt>Most recent submission</dt>
          <dd className="mt-1 text-ftext">{when(request.lastSubmittedAt)}</dd>
        </div>
        {request.verifiedAt ? (
          <div>
            <dt>Phone verified</dt>
            <dd className="mt-1 text-ftext">{when(request.verifiedAt)}</dd>
          </div>
        ) : null}
        {request.closedAt ? (
          <div>
            <dt>Closed</dt>
            <dd className="mt-1 text-ftext">{when(request.closedAt)}</dd>
          </div>
        ) : null}
      </dl>

      {request.status !== 'CLOSED' ? (
        <div className="mt-5 flex flex-col gap-3 sm:flex-row">
          {request.status === 'PENDING' ? (
            <ActionForm
              action={verifyAccessRequestAction}
              submitLabel="Record phone verification"
              hidden={{ requestId: request.id }}
            />
          ) : null}
          <ActionForm
            action={closeAccessRequestAction}
            submitLabel="Close request"
            tone="quiet"
            hidden={{ requestId: request.id }}
          />
        </div>
      ) : null}

      {canDelete ? (
        <div className="mt-4 border-t hairline pt-4">
          <p className="mb-3 text-xs leading-relaxed text-dim">
            Owner only: use this when the person asks for their submitted personal
            data to be deleted. This cannot be undone.
          </p>
          <ActionForm
            action={deleteAccessRequestAction}
            submitLabel="Permanently delete personal data"
            tone="quiet"
            hidden={{ requestId: request.id }}
          />
        </div>
      ) : null}
    </article>
  )
}

export default async function AccessRequestsPage() {
  const admin = await requireOnboardedAdmin()
  const requests = await listAccessRequests()
  const pending = requests.filter((request) => request.status === 'PENDING')
  const decided = requests.filter((request) => request.status !== 'PENDING')

  return (
    <>
      <SectionHeading eyebrow="Private queue" title="Access requests">
        Contact details submitted at the public front door. Call the person using
        the number shown and record the verification here before considering any
        separate account or invitation action.
      </SectionHeading>

      <div className="mb-6">
        <Notice tone="warn">
          Recording a phone verification does not create an account, add an
          allowlist entry, issue a setup link, or send an email.
        </Notice>
      </div>

      <section aria-labelledby="pending-heading">
        <h2 id="pending-heading" className="text-lg font-semibold text-white">
          Pending ({pending.length})
        </h2>
        {pending.length > 0 ? (
          <div className="mt-4 grid grid-cols-1 gap-4">
            {pending.map((request) => (
              <RequestCard
                key={request.id}
                request={request}
                canDelete={admin.role === 'OWNER'}
              />
            ))}
          </div>
        ) : (
          <p className="mt-3 text-sm text-dim">No requests are waiting for a call.</p>
        )}
      </section>

      {decided.length > 0 ? (
        <section aria-labelledby="decided-heading" className="mt-10">
          <h2 id="decided-heading" className="text-lg font-semibold text-white">
            Verified or closed
          </h2>
          <div className="mt-4 grid grid-cols-1 gap-4">
            {decided.map((request) => (
              <RequestCard
                key={request.id}
                request={request}
                canDelete={admin.role === 'OWNER'}
              />
            ))}
          </div>
        </section>
      ) : null}
    </>
  )
}
