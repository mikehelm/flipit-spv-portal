import type { Metadata } from 'next'
import { eq } from 'drizzle-orm'
import QRCode from 'qrcode'
import {
  confirmTotpEnrolmentAction,
  disableTotpAction,
  regenerateRecoveryCodesAction,
  startTotpEnrolmentAction,
} from '@/actions/second-factor'
import { ActionForm } from '@/components/admin/action-form'
import { Card, Field, Notice, Pill, SectionHeading, TextInput } from '@/components/admin/ui'
import { db } from '@/db'
import { users } from '@/db/schema'
import { requireAdmin } from '@/lib/auth/guards'
import { ISSUER, RECOVERY_CODE_COUNT } from '@/lib/auth/totp'
import { decrypt } from '@/lib/crypto'
import { env } from '@/lib/env'

export const metadata: Metadata = {
  title: 'Security — Flipit SPV',
  robots: { index: false, follow: false, nocache: true },
}

export const dynamic = 'force-dynamic'

/**
 * Two-factor for your own account. BUILD_SPEC §2.2.
 *
 * Each administrator manages their own, and there is deliberately no screen on
 * which the owner switches two-factor on or off for the operator: a second
 * factor somebody else can remove is not a second factor. Recovering an account
 * whose device and codes are both gone is a database change, made deliberately.
 *
 * The QR is rendered as a data URL on the server. It is the secret in visual
 * form, so it is never fetched from a URL that could be logged by a proxy, and
 * it exists only between starting enrolment and confirming it.
 */
export default async function SecurityPage() {
  const admin = await requireAdmin()
  const config = env()

  const user = await db.query.users.findFirst({ where: eq(users.id, admin.id) })

  const enabled = user?.totpConfirmedAt != null
  const enrolling = !enabled && user?.totpSecretEncrypted != null

  let qrDataUrl: string | null = null
  let manualKey: string | null = null

  if (enrolling && user?.totpSecretEncrypted) {
    try {
      const secret = decrypt(user.totpSecretEncrypted)
      const uri = createTotpEnrolmentUri(admin.email, secret)
      qrDataUrl = await QRCode.toDataURL(uri, { margin: 1, width: 240 })
      manualKey = secret
    } catch {
      // An unreadable secret is an enrolment to start again, not a crash.
      qrDataUrl = null
      manualKey = null
    }
  }

  return (
    <>
      <SectionHeading eyebrow="Your account" title="Two-factor">
        A code from an authenticator app, in addition to your password. The
        specification makes this <strong className="text-ftext">mandatory before the
        production deployment sends anything real</strong>, so it is a release gate rather
        than a preference — and this application refuses a real send from an account
        without it.
      </SectionHeading>

      <div className="space-y-4">
        <Card title="Where this account stands">
          <div className="flex flex-wrap items-center gap-3">
            {enabled ? (
              <Pill tone="ok">Switched on</Pill>
            ) : enrolling ? (
              <Pill tone="accent">Half set up</Pill>
            ) : (
              <Pill tone="warn">Not set up</Pill>
            )}
            <span className="text-sm text-dim">{admin.email}</span>
          </div>

          {!enabled ? (
            <div className="mt-4">
              <Notice tone="warn">
                {config.isProductionDeployment
                  ? 'This is the production deployment. Real invitations cannot be sent from this account until two-factor is switched on.'
                  : 'Real invitations cannot be sent from this account on the production deployment until two-factor is switched on. Test sends to your own address are unaffected.'}
              </Notice>
            </div>
          ) : null}
        </Card>

        {/* ---------------------------------------------------------------- */}
        {!enabled ? (
          <Card
            title={enrolling ? 'Finish setting it up' : 'Set it up'}
            description={
              enrolling
                ? 'Scan this with any authenticator app — Google Authenticator, 1Password, Authy, Bitwarden. Then type what it shows.'
                : `Any standard authenticator app will do. You will get ${RECOVERY_CODE_COUNT} recovery codes once it is on, shown once.`
            }
          >
            {enrolling && qrDataUrl ? (
              <div className="mb-5">
                {/*
                  A plain <img>, not next/image. The source is a data URL
                  generated on this request and gone on the next one; there is
                  nothing for an image optimiser to fetch, cache or resize, and
                  a remote pattern for `data:` would be a configuration entry
                  that exists to satisfy a lint rule.
                */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={qrDataUrl}
                  alt={`QR code enrolling ${admin.email} in ${ISSUER} two-factor`}
                  width={240}
                  height={240}
                  className="rounded-sm bg-white p-2"
                />
                <p className="mt-3 text-xs leading-relaxed text-dim">
                  Cannot scan it? Type this key into the app instead:
                </p>
                <code className="mt-1 block break-all rounded-sm border hairline bg-bg2 p-3 font-mono text-xs text-ftext">
                  {manualKey}
                </code>
                <p className="mt-2 text-xs leading-relaxed text-muted">
                  This is the whole secret. It is shown here and on no other screen,
                  and it is stored encrypted.
                </p>
              </div>
            ) : null}

            {enrolling ? (
              <ActionForm
                action={confirmTotpEnrolmentAction}
                submitLabel="Switch two-factor on"
              >
                <Field
                  label="The six digits your app shows"
                  name="code"
                  hint="Codes change every 30 seconds. If it is refused, wait for the next one and try that."
                >
                  <TextInput
                    name="code"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={16}
                    required
                  />
                </Field>
              </ActionForm>
            ) : (
              <ActionForm
                action={startTotpEnrolmentAction}
                submitLabel="Start setting up two-factor"
              />
            )}

            {enrolling ? (
              <div className="mt-6 border-t hairline pt-4">
                <p className="mb-3 text-xs leading-relaxed text-dim">
                  Lost the code before scanning it? Start again — this replaces the
                  half-finished enrolment.
                </p>
                <ActionForm
                  action={startTotpEnrolmentAction}
                  submitLabel="Start again with a new code"
                  tone="quiet"
                />
              </div>
            ) : null}
          </Card>
        ) : null}

        {/* ---------------------------------------------------------------- */}
        {enabled ? (
          <>
            <Card
              title="Recovery codes"
              description={`${user?.recoveryCodesHashed.length ?? 0} of ${RECOVERY_CODE_COUNT} unused. Each works once. Only a hash of each is stored, so they cannot be shown to you again — reissue them if you have lost the list.`}
            >
              <ActionForm
                action={regenerateRecoveryCodesAction}
                submitLabel="Issue a new set"
                tone="quiet"
              >
                <Field
                  label="A current code from your app"
                  name="code"
                  hint="Proving you still hold the second factor is the relevant question here, so this asks for a code rather than your password."
                >
                  <TextInput
                    name="code"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={16}
                    required
                  />
                </Field>
              </ActionForm>
            </Card>

            <Card
              title="Turn two-factor off"
              tone="warn"
              description="This asks for your password rather than a code. A session is a bearer token on a machine you may have walked away from; your password is not."
            >
              <ActionForm
                action={disableTotpAction}
                submitLabel="Turn two-factor off"
                tone="danger"
              >
                <Field label="Your password" name="password">
                  <TextInput
                    name="password"
                    type="password"
                    autoComplete="current-password"
                    required
                  />
                </Field>
              </ActionForm>
            </Card>
          </>
        ) : null}
      </div>
    </>
  )
}

/**
 * Rebuilds the `otpauth://` URI from a stored secret.
 *
 * `createTotpEnrolment` mints a new secret, which is not what is wanted when
 * somebody reloads the enrolment page — a new secret every reload would mean
 * the QR they scanned two seconds ago was already dead.
 */
function createTotpEnrolmentUri(email: string, secret: string): string {
  const label = encodeURIComponent(`${ISSUER}:${email}`)
  const params = new URLSearchParams({ secret, issuer: ISSUER })
  return `otpauth://totp/${label}?${params.toString()}`
}
