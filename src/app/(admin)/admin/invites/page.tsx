import { issueOperatorInviteAction, revokeOperatorInviteAction } from '@/actions/auth'
import { ActionForm } from '@/components/admin/action-form'
import { Card, Field, Notice, Pill, SectionHeading, TextInput } from '@/components/admin/ui'
import { requireOwner } from '@/lib/auth/guards'
import {
  OPERATOR_INVITE_TTL_HOURS,
  inviteStatus,
  listOperatorInvites,
  type InviteStatus,
} from '@/lib/auth/invites'
import { env } from '@/lib/env'

/**
 * Operator access. Owner-only. BUILD_SPEC §3 step 3, §15.
 *
 * The invite is single-use, expiring, and stored only as a hash. Issuing a new
 * one for the same address revokes any invite still outstanding for it.
 */

const STATUS_TONE: Record<InviteStatus, 'ok' | 'warn' | 'neutral' | 'accent'> = {
  ACCEPTED: 'ok',
  PENDING: 'accent',
  REVOKED: 'neutral',
  EXPIRED: 'warn',
}

function utc(date: Date): string {
  return `${date.toISOString().slice(0, 16).replace('T', ' ')} UTC`
}

export default async function InvitesPage() {
  await requireOwner()

  const invites = await listOperatorInvites()
  const now = new Date()
  const allowlisted = env().operatorEmails

  return (
    <>
      <SectionHeading eyebrow="Owner only" title="Operator access">
        An invitation is a formality on top of the allowlist, not a substitute for it. An
        address that is not in <code className="text-silver2">OPERATOR_EMAILS</code>{' '}
        cannot sign in whatever invitation it holds, so issuing one to such an address is
        refused rather than left to fail later.
      </SectionHeading>

      <div className="space-y-4">
        <Card
          title="Issue an invitation"
          description={
            <>
              Valid for {OPERATOR_INVITE_TTL_HOURS} hours, usable once, and only by the
              address it names. Currently on the operator allowlist:{' '}
              {allowlisted.length > 0 ? (
                <span className="text-ftext">{allowlisted.join(', ')}</span>
              ) : (
                <span className="text-warn">nobody</span>
              )}
              .
            </>
          }
        >
          <ActionForm action={issueOperatorInviteAction} submitLabel="Issue invitation">
            <Field
              label="Operator email"
              name="email"
              hint="The link is shown once, here. Only a hash of it is stored."
            >
              <TextInput
                name="email"
                type="email"
                autoComplete="off"
                placeholder="serenedavid@gmail.com"
                required
              />
            </Field>
          </ActionForm>
        </Card>

        <Card title="Invitations">
          {invites.length === 0 ? (
            <p className="text-sm text-dim">None issued yet.</p>
          ) : (
            <ul className="space-y-3">
              {invites.map((invite) => {
                const status = inviteStatus(invite, now)
                return (
                  <li
                    key={invite.id}
                    className="rounded-sm border hairline bg-bg2 p-3"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="break-all text-sm text-ftext">
                        {invite.email}
                      </span>
                      <Pill tone={STATUS_TONE[status]}>{status.replace('_', ' ')}</Pill>
                    </div>
                    <dl className="mt-2 grid gap-1 text-xs text-dim sm:grid-cols-[7rem_1fr]">
                      <dt>Issued</dt>
                      <dd>{utc(invite.createdAt)}</dd>
                      <dt>Expires</dt>
                      <dd>{utc(invite.expiresAt)}</dd>
                      {invite.usedAt ? (
                        <>
                          <dt>Accepted</dt>
                          <dd>{utc(invite.usedAt)}</dd>
                        </>
                      ) : null}
                      {invite.revokedAt ? (
                        <>
                          <dt>Revoked</dt>
                          <dd>{utc(invite.revokedAt)}</dd>
                        </>
                      ) : null}
                    </dl>

                    {status === 'PENDING' ? (
                      <div className="mt-3">
                        <ActionForm
                          action={revokeOperatorInviteAction}
                          submitLabel="Revoke"
                          tone="danger"
                          hidden={{ inviteId: invite.id }}
                        />
                      </div>
                    ) : null}
                  </li>
                )
              })}
            </ul>
          )}
        </Card>

        <Notice>
          Compliance approval is not on this page and is not delegable. Recording,
          amending or voiding an approval is owner-only, and an operator attempting it is
          refused and logged.
        </Notice>
      </div>
    </>
  )
}
