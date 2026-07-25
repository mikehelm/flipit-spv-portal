import type { Metadata } from 'next'
import { Card, Notice, Pill, SectionHeading } from '@/components/admin/ui'
import { requireOnboardedAdmin } from '@/lib/auth/guards'
import {
  addressableAccounts,
  loadOperatorUpdates,
  type OperatorUpdate,
} from '@/lib/updates/data'
import {
  UPDATE_NOTIFICATION_LEAD,
  UPDATE_NOTIFICATION_SECURITY_LINE,
  UPDATE_NOTIFICATION_SUBJECT,
} from '@/lib/updates/notification'
import { DraftForm, NotifyButton, PublishControls, WithdrawForm } from './parts'

export const metadata: Metadata = {
  title: 'Updates — Flipit SPV',
  robots: { index: false, follow: false, nocache: true },
}

export const dynamic = 'force-dynamic'

/**
 * Compose, preview, publish, withdraw. BUILD_SPEC §6.
 *
 * The preview is the whole card body rendered the way the investor will see it,
 * because the alternative — a separate preview screen fed from a different code
 * path — is how a preview stops matching what is published.
 */

function formatDate(value: Date | null): string | null {
  if (!value) return null
  return value.toISOString().slice(0, 10)
}

function UpdateCard({
  update,
  accounts,
}: {
  update: OperatorUpdate
  accounts: Array<{ id: string; name: string; email: string; status: string }>
}) {
  const published = update.publishedAt !== null
  const withdrawn = update.withdrawnAt !== null
  const notified = update.recipients.filter((row) => row.notifiedAt !== null).length

  return (
    <article className="rounded-sm border hairline bg-paper p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-white">{update.title}</p>
          <p className="text-xs text-muted">
            {update.audienceLabel}
            {published ? ` · published ${formatDate(update.publishedAt)}` : ' · draft'}
            {update.authorEmail ? ` · by ${update.authorEmail}` : ''}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {withdrawn ? (
            <Pill tone="warn">Withdrawn</Pill>
          ) : published ? (
            <Pill tone="ok">Published</Pill>
          ) : (
            <Pill tone="accent">Draft</Pill>
          )}
          {published && !withdrawn && update.notifyByEmail ? (
            <Pill tone={notified === update.recipients.length ? 'ok' : 'neutral'}>
              Notified {notified}/{update.recipients.length}
            </Pill>
          ) : null}
        </div>
      </div>

      <div className="mt-4 rounded-sm border hairline bg-bg2 p-4">
        <p className="text-[11px] font-bold uppercase tracking-wider text-muted">
          As the investor sees it
        </p>
        <p className="mt-2 text-sm font-semibold text-white">{update.title}</p>
        <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-silver2">
          {update.body}
        </p>
      </div>

      {withdrawn ? (
        <p className="mt-4 border-l-2 border-warn pl-3 text-xs leading-relaxed text-dim">
          Withdrawn {formatDate(update.withdrawnAt)}. Reason recorded:{' '}
          <span className="text-ftext">{update.withdrawnReason}</span>. It is gone from every
          portal; anyone who had already read it has already read it.
        </p>
      ) : null}

      {!published ? (
        <div className="mt-5 grid gap-4">
          <details className="rounded-sm border hairline bg-bg2 p-4">
            <summary className="cursor-pointer text-sm font-semibold text-white">
              Edit this draft
            </summary>
            <div className="mt-4">
              <DraftForm
                accounts={accounts}
                update={{
                  id: update.id,
                  title: update.title,
                  body: update.body,
                  audience: update.audience,
                  notifyByEmail: update.notifyByEmail,
                }}
              />
            </div>
          </details>
          <PublishControls updateId={update.id} />
        </div>
      ) : null}

      {published && !withdrawn ? (
        <div className="mt-5 grid gap-4">
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-silver2">
              Recipients ({update.recipients.length})
            </p>
            <ul className="grid gap-2">
              {update.recipients.map((recipient) => (
                <li
                  key={recipient.accountId}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-sm border hairline bg-bg2 px-3 py-2.5"
                >
                  <div className="min-w-0">
                    <p className="text-sm text-ftext">{recipient.name}</p>
                    <p className="text-xs text-muted">
                      {recipient.email}
                      {recipient.readAt ? ' · read it' : ' · not opened yet'}
                    </p>
                  </div>
                  {recipient.notifiedAt ? (
                    <Pill tone="ok">Notified {formatDate(recipient.notifiedAt)}</Pill>
                  ) : update.notifyByEmail ? (
                    <div className="w-full sm:w-auto">
                      <NotifyButton updateId={update.id} accountId={recipient.accountId} />
                    </div>
                  ) : (
                    <Pill tone="neutral">No email requested</Pill>
                  )}
                </li>
              ))}
            </ul>
          </div>

          <WithdrawForm updateId={update.id} />
        </div>
      ) : null}
    </article>
  )
}

export default async function UpdatesPage() {
  await requireOnboardedAdmin()

  const updates = await loadOperatorUpdates()
  const accounts = await addressableAccounts()

  const drafts = updates.filter((update) => update.publishedAt === null)
  const live = updates.filter(
    (update) => update.publishedAt !== null && update.withdrawnAt === null,
  )
  const withdrawn = updates.filter((update) => update.withdrawnAt !== null)

  return (
    <>
      <SectionHeading eyebrow="Updates" title="Updates">
        Notices and progress reports. They appear in each investor&rsquo;s portal newest first,
        and once published they cannot be changed — a correction is a new update.
      </SectionHeading>

      <div className="mb-6">
        <Notice>
          Publishing puts the update on the portals. It sends nothing. Notifications go one
          recipient at a time from the list on each published update, the same rule as
          invitations — there is no button anywhere that emails everybody at once.
        </Notice>
      </div>

      <div className="grid gap-6">
        <Card
          title="Write an update"
          description="Saved as a draft. Nothing reaches anybody until you publish it."
        >
          <DraftForm accounts={accounts} />
        </Card>

        <Card
          title="The notification email, in full"
          description="Every recipient gets exactly this. It carries no amounts, no percentages and nothing personal — there is no way to put any of them in it, because the function that builds it takes only the two links."
        >
          <dl className="text-xs text-dim">
            <div className="flex gap-2">
              <dt className="font-semibold text-silver2">Subject</dt>
              <dd className="text-ftext">{UPDATE_NOTIFICATION_SUBJECT}</dd>
            </div>
          </dl>
          <p className="mt-3 text-sm leading-relaxed text-silver2">
            {UPDATE_NOTIFICATION_LEAD}
          </p>
          <p className="mt-2 text-sm leading-relaxed text-dim">
            [link to the portal]
          </p>
          <p className="mt-2 text-xs leading-relaxed text-muted">
            {UPDATE_NOTIFICATION_SECURITY_LINE}
          </p>
        </Card>

        {drafts.length > 0 ? (
          <section>
            <h2 className="mb-3 text-sm font-semibold text-white">Drafts ({drafts.length})</h2>
            <div className="grid gap-4">
              {drafts.map((update) => (
                <UpdateCard key={update.id} update={update} accounts={accounts} />
              ))}
            </div>
          </section>
        ) : null}

        <section>
          <h2 className="mb-3 text-sm font-semibold text-white">
            Published{live.length > 0 ? ` (${live.length})` : ''}
          </h2>
          {live.length === 0 ? (
            <Card>
              <p className="text-sm text-dim">
                Nothing has been published yet. Investors see an empty updates section with a
                note that they will be told when one appears.
              </p>
            </Card>
          ) : (
            <div className="grid gap-4">
              {live.map((update) => (
                <UpdateCard key={update.id} update={update} accounts={accounts} />
              ))}
            </div>
          )}
        </section>

        {withdrawn.length > 0 ? (
          <section>
            <h2 className="mb-3 text-sm font-semibold text-white">
              Withdrawn ({withdrawn.length})
            </h2>
            <div className="grid gap-4">
              {withdrawn.map((update) => (
                <UpdateCard key={update.id} update={update} accounts={accounts} />
              ))}
            </div>
          </section>
        ) : null}
      </div>
    </>
  )
}
