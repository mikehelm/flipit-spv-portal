import { requestEmailChangeAction } from '@/actions/portal'
import { ActionForm } from '@/components/admin/action-form'
import type { PendingEmailChange } from '@/lib/portal/email-change'

/**
 * Changing the contact address. BUILD_SPEC §13.
 *
 * The section shows the address the record currently uses — the investor's own,
 * and the one every message about their record goes to, so seeing it is half
 * the feature. Nothing else on this section comes from the database.
 *
 * The pending line shows the address they asked for, which is safe because they
 * typed it. It exists because the gap between asking and confirming is where
 * somebody concludes nothing happened: without it, a request whose email has
 * not arrived yet looks identical to a request that was never made.
 */
export function EmailSection({
  currentEmail,
  pending,
  canChange,
}: {
  currentEmail: string
  pending: PendingEmailChange | null
  canChange: boolean
}) {
  return (
    <section className="mt-12">
      <h2 className="text-sm font-semibold text-white">Your contact address</h2>

      <div className="mt-4 rounded-sm border hairline bg-paper p-5">
        <p className="text-sm leading-relaxed text-ftext">
          Everything about your record is sent to{' '}
          <span className="font-semibold break-words text-white">{currentEmail}</span>.
        </p>

        {pending ? (
          <p className="mt-3 border-l-2 border-orange bg-orange/6 p-3 text-sm leading-relaxed text-silver2">
            You asked to change this to{' '}
            <span className="font-semibold break-words text-white">{pending.newEmail}</span>.
            We have emailed a confirmation link there. Your record still uses the address
            above until that link is opened, and the link expires on its own.
          </p>
        ) : null}

        {canChange ? (
          <div className="mt-5 border-t hairline pt-5">
            <p className="text-xs leading-relaxed text-dim">
              To move to a different address, enter it below. We will email a confirmation
              link to the new address — the change only takes effect once you open it, which
              is how we know the address reaches you. For safety, confirming a new address
              signs you out everywhere and stops any older sign-in links from working.
            </p>

            <div className="mt-4">
              <ActionForm
                action={requestEmailChangeAction}
                submitLabel="Send a confirmation link"
              >
                <label
                  htmlFor="newEmail"
                  className="block text-xs font-semibold uppercase tracking-wider text-silver2"
                >
                  New contact address
                </label>
                <input
                  id="newEmail"
                  name="newEmail"
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  required
                  maxLength={320}
                  className="mt-2 w-full min-h-11 rounded-sm border hairline bg-bg2 px-3 py-2.5 text-sm text-ftext placeholder:text-muted focus:border-orange"
                />
              </ActionForm>
            </div>
          </div>
        ) : (
          <p className="mt-4 text-xs leading-relaxed text-dim">
            The contact address cannot be changed while this portal is read-only.
          </p>
        )}
      </div>
    </section>
  )
}
