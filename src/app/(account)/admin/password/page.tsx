import type { Metadata } from 'next'
import { changePasswordAction, choosePasswordAction } from '@/actions/password'
import { ActionForm } from '@/components/admin/action-form'
import { Card, Field, Notice, SectionHeading, TextInput } from '@/components/admin/ui'
import { drizzleCredentialStore } from '@/lib/auth/credential-store'
import { requireOwnAccount } from '@/lib/auth/guards'
import { MIN_PASSWORD_LENGTH } from '@/lib/auth/password'

export const metadata: Metadata = {
  title: 'Password — Flipit SPV',
  robots: { index: false, follow: false, nocache: true },
}

/**
 * Choosing a first password, and changing an existing one. BUILD_SPEC §2.2.
 *
 * This is the only page an administrator with no password set can reach — see
 * `requirePasswordSet` in lib/auth/guards.ts. Redeeming the one-time setup link
 * lands here, which is how a password gets into the system at all: it is never
 * read from an environment variable or a configuration file.
 *
 * Two things about it are load-bearing and neither shows in the markup.
 *
 * **It renders in `(account)`, not in `(admin)`.** The admin shell guards
 * itself with `requireReader()`, which sends any account without a password to
 * this exact path — including a request for this path. Rendering inside that
 * shell was an infinite redirect standing in front of every administrator's
 * first sign-in, the owner's included.
 *
 * **It guards with `requireOwnAccount()`, so a viewer reaches it.** A password
 * belongs to the account rather than to the role. `requireAdmin()` refuses a
 * read-only administrator, and a viewer arrives here with no password at all,
 * so that refusal locked the role out of the application entirely.
 */
export default async function PasswordPage() {
  const admin = await requireOwnAccount()

  const credential = await drizzleCredentialStore().findByEmail(admin.email)
  const alreadySet = credential?.passwordHash != null

  return (
    <>
      <SectionHeading
        eyebrow="Your account"
        title={alreadySet ? 'Change your password' : 'Choose your password'}
      >
        {alreadySet
          ? `Signed in as ${admin.email}. Changing your password signs out every session, including this one.`
          : `Signed in as ${admin.email} through a one-time setup link. Choose a password to finish setting up the account — the link you used has already been spent.`}
      </SectionHeading>

      {!alreadySet ? (
        <div className="mb-6">
          <Notice tone="warn">
            You will be signed out as soon as the password is saved, and can sign back in
            with it straight away. The setup link that got you here does not work a second
            time.
          </Notice>
        </div>
      ) : null}

      <Card title={alreadySet ? 'New password' : 'Password'}>
        <p className="mb-5 text-sm leading-relaxed text-dim">
          At least {MIN_PASSWORD_LENGTH} characters. There are no rules about capitals or
          punctuation — a phrase you can actually remember is stronger than a mangled
          word. It is checked against a list of well-known passwords, and it may not be
          built out of your own address or name.
        </p>

        <ActionForm
          action={alreadySet ? changePasswordAction : choosePasswordAction}
          submitLabel={alreadySet ? 'Change password' : 'Save password'}
        >
          {alreadySet ? (
            <Field label="Current password" name="currentPassword">
              <TextInput
                name="currentPassword"
                type="password"
                autoComplete="current-password"
                required
              />
            </Field>
          ) : null}

          <Field label={alreadySet ? 'New password' : 'Password'} name="newPassword">
            <TextInput
              name="newPassword"
              type="password"
              autoComplete="new-password"
              minLength={MIN_PASSWORD_LENGTH}
              required
            />
          </Field>

          <Field label="Type it again" name="confirmation">
            <TextInput
              name="confirmation"
              type="password"
              autoComplete="new-password"
              minLength={MIN_PASSWORD_LENGTH}
              required
            />
          </Field>
        </ActionForm>
      </Card>
    </>
  )
}
