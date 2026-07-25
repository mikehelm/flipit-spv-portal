import { acceptOperatorInviteAction } from '@/actions/auth'
import { ActionForm } from '@/components/admin/action-form'
import { Card, Notice, SectionHeading } from '@/components/admin/ui'
import { requireAdmin } from '@/lib/auth/guards'

/**
 * Accepting an operator invitation. BUILD_SPEC §3 step 4.
 *
 * Two things worth noting:
 *
 *   1. The token is never consumed on GET. Loading this page validates
 *      nothing and spends nothing — a link preview, a scanner or a prefetch
 *      would otherwise burn a single-use invitation before the operator ever
 *      saw it. Acceptance happens on the POST behind the button.
 *
 *   2. It binds to whoever is signed in, and refuses if that is not the address
 *      the invitation names. Getting here at all already required passing the
 *      allowlist gate.
 */
export default async function AcceptInvitePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const admin = await requireAdmin()
  const params = await searchParams
  const raw = params.token
  const token = (Array.isArray(raw) ? raw[0] : raw) ?? ''

  return (
    <>
      <SectionHeading eyebrow="Operator access" title="Accept your invitation">
        You are signed in as {admin.email}. Accepting binds this invitation to that
        account and uses it up — it works exactly once.
      </SectionHeading>

      {token === '' ? (
        <Card tone="warn">
          <p className="text-sm leading-relaxed text-[#e7e9f5]">
            This link is incomplete. Ask the owner to issue a new invitation.
          </p>
        </Card>
      ) : (
        <Card>
          <ActionForm
            action={acceptOperatorInviteAction}
            submitLabel="Accept invitation"
            hidden={{ token }}
          >
            <p className="text-sm leading-relaxed text-[#9498b5]">
              After this you are taken through a short setup: your display name as it
              should appear on investment correspondence, how investors should reach you,
              and the account mail is sent from.
            </p>
          </ActionForm>
        </Card>
      )}

      <div className="mt-4">
        <Notice>
          If this is not your invitation, it will be refused and the attempt recorded. No
          harm done.
        </Notice>
      </div>
    </>
  )
}
