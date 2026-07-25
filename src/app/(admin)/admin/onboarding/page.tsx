import {
  acknowledgeQaAction,
  acknowledgeTestInvitationAction,
  completeOnboardingAction,
  confirmDisplayNameAction,
  connectSendingAccountAction,
  recordVideoChoiceAction,
  setContactMethodAction,
} from '@/actions/onboarding'
import { ActionForm } from '@/components/admin/action-form'
import { MailConnectionPanel } from '@/components/admin/mail-connection-panel'
import {
  Card,
  Field,
  Notice,
  Pill,
  SectionHeading,
  SecretState,
  Select,
  TextInput,
} from '@/components/admin/ui'
import { requireOperator } from '@/lib/auth/guards'
import {
  CONTACT_METHOD_LABELS,
  QA_EXPLANATION,
  VIDEO_CHOICE_LABELS,
  onboardingProgress,
  type OnboardingStepId,
} from '@/lib/auth/onboarding'
import { readOnboardingSnapshot } from '@/lib/auth/onboarding-store'
import { readServiceConfig } from '@/lib/auth/service-config'
import { maskConfigured } from '@/lib/crypto'
import { describeMailConnection } from '@/lib/email/transport'

/**
 * Operator onboarding. BUILD_SPEC §2.1 — five steps plus 4b.
 *
 * Resumable by construction. Nothing is held in a wizard; each step's progress
 * is re-derived from what has been stored, so closing the tab halfway loses
 * only the step in progress.
 *
 * Every step is visible at once, with the next incomplete one marked. Hiding
 * later steps would make the setup feel longer than it is and would stop him
 * going back to change an answer.
 */

export default async function OnboardingPage() {
  const operator = await requireOperator()
  const snapshot = await readOnboardingSnapshot(operator.id)
  const config = await readServiceConfig()
  const progress = onboardingProgress(snapshot)

  const stateOf = (id: OnboardingStepId) => {
    const step = progress.steps.find((s) => s.id === id)
    if (step?.complete) return { tone: 'ok' as const, label: 'Done' }
    if (step?.current) return { tone: 'accent' as const, label: 'Now' }
    return { tone: 'neutral' as const, label: 'Later' }
  }

  const stepHeader = (id: OnboardingStepId) => {
    const step = progress.steps.find((s) => s.id === id)
    const state = stateOf(id)
    return (
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-white">
          <span className="text-orange">{step?.number}.</span> {step?.title}
        </h2>
        <Pill tone={state.tone}>{state.label}</Pill>
      </div>
    )
  }

  return (
    <>
      <SectionHeading eyebrow="Setup" title="A few things before anything is sent">
        {progress.complete
          ? 'Your setup is complete. Anything below can still be changed.'
          : `Six short steps, ${progress.completedCount} of ${progress.totalCount} done. You can stop at any point and come back — nothing is lost.`}
      </SectionHeading>

      <div className="space-y-4">
        {/* ---------------------------------------------------------------- */}
        <Card>
          {stepHeader('DISPLAY_NAME')}
          <p className="text-sm leading-relaxed text-dim">
            This is the name investors see on the invitation and throughout their portal.
            Use it exactly as it should appear on investment correspondence.
          </p>
          <div className="mt-4">
            <ActionForm action={confirmDisplayNameAction} submitLabel="Save name">
              <Field label="Display name" name="displayName">
                <TextInput
                  name="displayName"
                  defaultValue={snapshot.displayName ?? operator.name ?? ''}
                  autoComplete="name"
                  required
                />
              </Field>
            </ActionForm>
          </div>
        </Card>

        {/* ---------------------------------------------------------------- */}
        <Card>
          {stepHeader('CONTACT_METHOD')}
          <p className="text-sm leading-relaxed text-dim">
            This changes the invitation itself. Phone renders a phone line, WhatsApp
            renders a WhatsApp contact with a wa.me link in the portal, and email only
            removes the phone line from the template entirely rather than leaving it
            blank.
          </p>
          <div className="mt-4">
            <ActionForm action={setContactMethodAction} submitLabel="Save contact method">
              <Field label="How investors reach you" name="contactMethod">
                <Select
                  name="contactMethod"
                  defaultValue={snapshot.contactMethod ?? 'PHONE'}
                  options={Object.entries(CONTACT_METHOD_LABELS).map(([value, label]) => ({
                    value,
                    label,
                  }))}
                />
              </Field>
              <Field
                label="Number"
                name="contactValue"
                hint="Include the country code. Leave blank if you chose email only — nothing is stored in that case."
              >
                <TextInput
                  name="contactValue"
                  defaultValue={snapshot.contactValue ?? ''}
                  inputMode="tel"
                  autoComplete="tel"
                  placeholder="+66 81 234 5678"
                />
              </Field>
            </ActionForm>
          </div>
          <div className="mt-4">
            <Notice>
              Changing this after the email has been approved is a template change and
              needs a fresh compliance approval, because it alters what recipients
              receive.
            </Notice>
          </div>
        </Card>

        {/* ---------------------------------------------------------------- */}
        <Card>
          {stepHeader('SENDING_ACCOUNT')}
          <p className="text-sm leading-relaxed text-dim">
            Mail goes out over Gmail&rsquo;s own servers from your address, using a
            16-letter <strong className="text-ftext">app password</strong> — not your
            Google account password, which this application never asks for and could not
            use. Turn on 2-Step Verification first, then generate an app password at{' '}
            <a
              href="https://myaccount.google.com/apppasswords"
              target="_blank"
              rel="noreferrer noopener"
              className="text-orange"
            >
              myaccount.google.com/apppasswords
            </a>
            . You can revoke it there at any moment, and it can only send — it cannot
            read your mail.
          </p>

          <div className="mt-4">
            <SecretState
              label="Stored app password"
              state={maskConfigured(config.smtpPasswordEncrypted)}
            />
          </div>

          <div className="mt-4">
            <ActionForm
              action={connectSendingAccountAction}
              submitLabel="Save sending account"
            >
              <Field label="Sending Gmail address" name="smtpUser">
                <TextInput
                  name="smtpUser"
                  type="email"
                  autoComplete="off"
                  placeholder="serenedavid@gmail.com"
                  required
                />
              </Field>
              <Field
                label="App password"
                name="smtpPassword"
                hint="Encrypted at rest, never displayed again, never written to a log or an export. Spaces are removed for you."
              >
                <TextInput
                  name="smtpPassword"
                  type="password"
                  autoComplete="new-password"
                  required
                />
              </Field>
            </ActionForm>
          </div>

          <div className="mt-4">
            <Notice tone="warn">
              An app password is a static credential. If this server were ever
              compromised, it could be used to send as you until you revoke it. Treat it
              like any other secret, and revoke it at Google the moment it is no longer
              needed.
            </Notice>
          </div>

          {/*
            Saving the password is not the same as it working. §8.1 asks for a
            test that authenticates without sending, and §19's pre-flight
            refuses to send unless one has passed recently — so the test has to
            be reachable from the step that sets the credential.
          */}
          <div className="mt-6">
            <MailConnectionPanel health={describeMailConnection(config)} showDisconnect />
          </div>
        </Card>

        {/* ---------------------------------------------------------------- */}
        <Card>
          {stepHeader('VIDEO')}
          <p className="text-sm leading-relaxed text-dim">
            A short personal video in the portal is optional and entirely your call.
            Nobody sees it until you publish it — you preview it in the real portal layout
            first and can replace it as many times as you like. If you never record one,
            the portal shows no gap where it would have been.
          </p>
          <div className="mt-4">
            <ActionForm action={recordVideoChoiceAction} submitLabel="Save choice">
              <Field label="Your choice" name="choice">
                <Select
                  name="choice"
                  defaultValue={snapshot.videoChoice ?? 'UPLOAD_LATER'}
                  options={Object.entries(VIDEO_CHOICE_LABELS).map(([value, label]) => ({
                    value,
                    label,
                  }))}
                />
              </Field>
            </ActionForm>
          </div>
          <div className="mt-4">
            <Notice>
              Recording and uploading are not built yet. Your answer is recorded now so
              the flow does not stall on a feature that is still arriving.
            </Notice>
          </div>
        </Card>

        {/* ---------------------------------------------------------------- */}
        <Card>
          {stepHeader('QA')}
          {QA_EXPLANATION.map((sentence) => (
            <p key={sentence} className="mb-2 text-sm leading-relaxed text-dim">
              {sentence}
            </p>
          ))}
          <p className="mt-3 text-sm leading-relaxed text-dim">
            You can also write entries yourself with no question behind them, which is how
            the section looks answered on day one rather than empty. Three or four
            starters are usually enough: what the SPV is, what the 30% means, when
            documents arrive, and who to contact.
          </p>
          <div className="mt-4">
            <ActionForm
              action={acknowledgeQaAction}
              submitLabel={snapshot.qaAcknowledged ? 'Understood — noted again' : 'Understood'}
              tone="quiet"
            />
          </div>
        </Card>

        {/* ---------------------------------------------------------------- */}
        <Card>
          {stepHeader('TEST_INVITATION')}
          <p className="text-sm leading-relaxed text-dim">
            Before anything goes to a real recipient, send yourself the complete
            invitation and read it as they will. Sending to anyone else stays blocked
            until that has actually happened — this step is you agreeing to it, not a
            substitute for it.
          </p>
          <div className="mt-4">
            <ActionForm
              action={acknowledgeTestInvitationAction}
              submitLabel={
                snapshot.testInvitationAcknowledged ? 'Noted again' : 'I will send myself a test first'
              }
              tone="quiet"
            />
          </div>
        </Card>

        {/* ---------------------------------------------------------------- */}
        {progress.canComplete && !progress.complete ? (
          <Card title="That is everything" tone="ok">
            <ActionForm action={completeOnboardingAction} submitLabel="Finish setup" />
          </Card>
        ) : null}
      </div>
    </>
  )
}
