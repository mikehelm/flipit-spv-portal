import type { ReactNode } from 'react'
import Link from 'next/link'
import {
  acknowledgeQaAction,
  acknowledgeTestInvitationAction,
  completeOnboardingAction,
  confirmDisplayNameAction,
  recordVideoChoiceAction,
  setContactMethodAction,
} from '@/actions/onboarding'
import { ActionForm } from '@/components/admin/action-form'
import { Status, type HumanStatus } from '@/components/admin/guided'
import {
  Card,
  Field,
  Notice,
  SectionHeading,
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
import {
  PERSONAL_ONBOARDING_STEPS,
  canOfferOnboardingFinish,
  nextPersonalOnboardingStep,
} from '@/lib/auth/onboarding-guidance'
import { readOnboardingSnapshot } from '@/lib/auth/onboarding-store'
import { readServiceConfig } from '@/lib/auth/service-config'
import { describeMailConnection } from '@/lib/email/transport'

function PersonalStep({
  id,
  number,
  title,
  status,
  quiet = false,
  children,
}: {
  id: OnboardingStepId
  number: string
  title: string
  status: HumanStatus
  quiet?: boolean
  children: ReactNode
}) {
  const heading = (
    <div className="flex flex-1 flex-wrap items-center justify-between gap-3">
      <h2 className="text-sm font-semibold text-white">
        <span className="text-orange">{number}.</span> {title}
      </h2>
      <Status status={status} />
    </div>
  )

  if (quiet) {
    return (
      <details
        className="group rounded-sm border hairline bg-paper"
        data-onboarding-step={id}
      >
        <summary className="flex min-h-14 cursor-pointer list-none items-center gap-3 px-4 py-3 marker:content-none sm:px-5">
          {heading}
          <span
            aria-hidden="true"
            className="text-xs text-orange transition-transform group-open:rotate-180"
          >
            ▼
          </span>
        </summary>
        <div className="border-t hairline p-4 sm:p-5">{children}</div>
      </details>
    )
  }

  return (
    <Card>
      <div data-onboarding-step={id}>{heading}</div>
      <div className="mt-4">{children}</div>
    </Card>
  )
}

/**
 * Operator onboarding. BUILD_SPEC §2.1 — five David-owned tasks and one
 * owner-managed sending dependency.
 *
 * Progress still comes entirely from the existing snapshot and
 * `onboardingProgress`; this page only changes how that truth is presented.
 * David sees one personal action first, can quietly revisit every other
 * personal task, and is never offered the owner's mail controls.
 */
export default async function OnboardingPage() {
  const operator = await requireOperator()
  const snapshot = await readOnboardingSnapshot(operator.id)
  const config = await readServiceConfig()
  const progress = onboardingProgress(snapshot)
  const mail = describeMailConnection(config)
  const nextPersonalStep = nextPersonalOnboardingStep(progress)
  const personalSteps = PERSONAL_ONBOARDING_STEPS.map((id) => {
    const step = progress.steps.find((entry) => entry.id === id)
    if (!step) throw new Error(`Onboarding step ${id} is missing.`)
    return step
  })
  const personalCompletedCount = personalSteps.filter((step) => step.complete).length
  const mailHealthy = mail.state === 'HEALTHY'
  const canOfferFinish = canOfferOnboardingFinish(progress, mailHealthy)

  const stepContent = (id: OnboardingStepId): ReactNode => {
    switch (id) {
      case 'DISPLAY_NAME':
        return (
          <>
            <p className="text-sm leading-relaxed text-dim">
              This is the name investors see on the invitation and throughout their
              portal. Use it exactly as it should appear on investment correspondence.
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
          </>
        )
      case 'CONTACT_METHOD':
        return (
          <>
            <p className="text-sm leading-relaxed text-dim">
              This changes the invitation itself. Phone adds a phone line, WhatsApp adds
              a direct contact link, and email only removes the phone line entirely.
            </p>
            <div className="mt-4">
              <ActionForm
                action={setContactMethodAction}
                submitLabel="Save contact method"
              >
                <Field label="How investors reach you" name="contactMethod">
                  <Select
                    name="contactMethod"
                    defaultValue={snapshot.contactMethod ?? 'PHONE'}
                    options={Object.entries(CONTACT_METHOD_LABELS).map(
                      ([value, label]) => ({ value, label }),
                    )}
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
                Changing this after the email has been approved changes the invitation
                and requires fresh compliance approval.
              </Notice>
            </div>
          </>
        )
      case 'VIDEO':
        return (
          <>
            <p className="text-sm leading-relaxed text-dim">
              A short personal video is optional. Nobody sees it until you publish it,
              and the portal leaves no empty gap if you skip it.
            </p>
            <div className="mt-4">
              <ActionForm action={recordVideoChoiceAction} submitLabel="Save choice">
                <Field label="Your choice" name="choice">
                  <Select
                    name="choice"
                    defaultValue={snapshot.videoChoice ?? 'UPLOAD_LATER'}
                    options={Object.entries(VIDEO_CHOICE_LABELS).map(
                      ([value, label]) => ({ value, label }),
                    )}
                  />
                </Field>
              </ActionForm>
            </div>
            <div className="mt-4">
              <Notice>
                Recording and uploading are not built yet. Your choice is saved so this
                does not stop the rest of your preparation.
              </Notice>
            </div>
          </>
        )
      case 'QA':
        return (
          <>
            {QA_EXPLANATION.map((sentence) => (
              <p key={sentence} className="mb-2 text-sm leading-relaxed text-dim">
                {sentence}
              </p>
            ))}
            <p className="mt-3 text-sm leading-relaxed text-dim">
              Three or four starters are usually enough: what the SPV is, what the 30%
              means, when documents arrive, and who to contact.
            </p>
            <div className="mt-4">
              <ActionForm
                action={acknowledgeQaAction}
                submitLabel={
                  snapshot.qaAcknowledged ? 'Understood — noted again' : 'Understood'
                }
                tone="quiet"
              />
            </div>
          </>
        )
      case 'TEST_INVITATION':
        return (
          <>
            <p className="text-sm leading-relaxed text-dim">
              Before anything goes to a real recipient, send yourself the complete
              invitation and read it as they will. This acknowledgement does not replace
              the real test-send gate.
            </p>
            <div className="mt-4">
              <ActionForm
                action={acknowledgeTestInvitationAction}
                submitLabel={
                  snapshot.testInvitationAcknowledged
                    ? 'Noted again'
                    : 'I will send myself a test first'
                }
                tone="quiet"
              />
            </div>
          </>
        )
      case 'SENDING_ACCOUNT':
        return null
    }
  }

  return (
    <>
      <SectionHeading eyebrow="Your setup" title="One useful step at a time">
        {progress.complete
          ? 'Your setup is complete. You can still reopen any personal answer below.'
          : `${personalCompletedCount} of ${PERSONAL_ONBOARDING_STEPS.length} personal tasks complete. Your answers are saved as you go.`}
      </SectionHeading>

      <div className="space-y-6">
        {nextPersonalStep ? (
          <section aria-labelledby="personal-next-step">
            <p className="mb-3 text-[11px] font-bold uppercase tracking-[0.2em] text-orange">
              Recommended now
            </p>
            <div id="personal-next-step">
              {personalSteps
                .filter((step) => step.id === nextPersonalStep)
                .map((step) => (
                  <PersonalStep
                    key={step.id}
                    id={step.id}
                    number={step.number}
                    title={step.title}
                    status="Needs you"
                  >
                    {stepContent(step.id)}
                  </PersonalStep>
                ))}
            </div>
          </section>
        ) : null}

        <section aria-labelledby="mail-dependency">
          <Card>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-silver2">
                  Mike’s responsibility
                </p>
                <h2 id="mail-dependency" className="mt-1 text-sm font-semibold text-white">
                  Sending account
                </h2>
              </div>
              <Status status={mailHealthy ? 'Complete' : 'Waiting'} />
            </div>

            {mailHealthy ? (
              <p className="mt-4 text-sm leading-relaxed text-dim">
                Mike has connected and verified the shared sending account
                {mail.authenticatedAddress
                  ? ` for ${mail.authenticatedAddress}`
                  : ''}
                . No action is needed from you here.
              </p>
            ) : (
              <>
                <p className="mt-4 text-sm leading-relaxed text-dim">
                  {mail.summary} Mike must connect or re-verify the shared sending
                  account. You cannot enter, test, replace or disconnect that credential.
                </p>
                <div className="mt-4">
                  <Notice tone="warn">
                    This does not stop your personal setup or email review. Real sending
                    remains blocked until Mike resolves it.
                  </Notice>
                </div>
                <Link
                  href="/admin/email-review"
                  className="mt-4 inline-flex min-h-11 items-center text-sm font-semibold text-orange"
                >
                  Continue with the email review
                </Link>
              </>
            )}
          </Card>
        </section>

        {nextPersonalStep ? (
          <section aria-labelledby="other-personal-steps">
            <h2 id="other-personal-steps" className="text-sm font-semibold text-ftext">
              Your other setup tasks
            </h2>
            <p className="mt-1 text-xs leading-relaxed text-dim">
              Completed answers and later tasks stay available if you want to review or
              change them.
            </p>
            <div className="mt-3 space-y-3">
              {personalSteps
                .filter((step) => step.id !== nextPersonalStep)
                .map((step) => (
                  <PersonalStep
                    key={step.id}
                    id={step.id}
                    number={step.number}
                    title={step.title}
                    status={step.complete ? 'Complete' : 'Ready'}
                    quiet
                  >
                    {stepContent(step.id)}
                  </PersonalStep>
                ))}
            </div>
          </section>
        ) : (
          <section aria-labelledby="personal-answers">
            <h2 id="personal-answers" className="text-sm font-semibold text-ftext">
              Your saved answers
            </h2>
            <p className="mt-1 text-xs leading-relaxed text-dim">
              Everything personal is saved. Open any task to review or change it.
            </p>
            <div className="mt-3 space-y-3">
              {personalSteps.map((step) => (
                <PersonalStep
                  key={step.id}
                  id={step.id}
                  number={step.number}
                  title={step.title}
                  status="Complete"
                  quiet
                >
                  {stepContent(step.id)}
                </PersonalStep>
              ))}
            </div>
          </section>
        )}

        {canOfferFinish ? (
          <Card title="Everything required is saved" tone="ok">
            <p className="text-sm leading-relaxed text-dim">
              Confirm once to finish setup. This uses the existing completion check; it
              does not bypass any requirement.
            </p>
            <div className="mt-4">
              <ActionForm action={completeOnboardingAction} submitLabel="Finish setup" />
            </div>
          </Card>
        ) : null}

        {progress.complete ? (
          <Card tone="ok">
            <div className="flex flex-wrap items-center gap-3">
              <Status status="Complete" />
              <p className="text-sm font-semibold text-white">Your setup is complete</p>
            </div>
          </Card>
        ) : null}
      </div>
    </>
  )
}
