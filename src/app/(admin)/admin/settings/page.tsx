import {
  removeOpenAiKeyAction,
  updateAiSettingsAction,
  updateApprovedJurisdictionsAction,
  updateAttributionAction,
  updateSenderDefaultsAction,
  updateServiceSettingsAction,
} from '@/actions/settings'
import { ActionForm } from '@/components/admin/action-form'
import {
  Card,
  Checkbox,
  Field,
  Notice,
  SectionHeading,
  SecretState,
  Select,
  TextArea,
  TextInput,
} from '@/components/admin/ui'
import { requireOwner } from '@/lib/auth/guards'
import { readServiceConfig } from '@/lib/auth/service-config'
import { maskConfigured } from '@/lib/crypto'
import { readSpendSummary } from '@/lib/import/persist'

/**
 * Owner-only settings. BUILD_SPEC §7, §9.1, §10, §11.2, §6.7.5.
 *
 * What is deliberately absent: every compliance approval control. Recording,
 * amending and voiding an approval is owner-only and is built separately, and
 * it is not on this page precisely so that no future change to who can reach
 * settings can quietly hand it to the operator.
 */

export default async function SettingsPage() {
  await requireOwner()
  const config = await readServiceConfig()
  // §9.1 — usage shown on the settings page, not merely capped.
  const spend = await readSpendSummary()

  return (
    <>
      <SectionHeading eyebrow="Owner only" title="Settings">
        Service configuration, sender defaults, and the AI key. The operator has none of
        this — they get AI assistance without ever seeing or handling the key.
      </SectionHeading>

      <div className="space-y-4">
        {/* -------------------------------------------------------------- */}
        <Card
          title="Service mode and portal behaviour"
          description="Sending requires active. Inviting someone into a portal that will not accept their response is a contradiction the application makes impossible rather than leaving to discipline."
        >
          <ActionForm action={updateServiceSettingsAction} submitLabel="Save service settings">
            <Field label="Service mode" name="serviceMode">
              <Select
                name="serviceMode"
                defaultValue={config.serviceMode}
                options={[
                  { value: 'ACTIVE', label: 'Active — full function' },
                  { value: 'READ_ONLY', label: 'Read-only — viewing but no submissions' },
                  { value: 'SUNSET', label: 'Sunset — read-only with a closing date' },
                  { value: 'DISABLED', label: 'Disabled — neutral closed page' },
                ]}
              />
            </Field>

            <Field
              label="Sunset closing date"
              name="sunsetClosingDate"
              hint="Required in sunset. Investors are told when the portal closes so they can download their records first."
            >
              <TextInput
                name="sunsetClosingDate"
                type="date"
                defaultValue={config.sunsetClosingDate ?? ''}
              />
            </Field>

            <Field
              label="Service contact address"
              name="serviceContactEmail"
              hint="Shown once the portal is closed, after the operator's own address stops being monitored — and offered underneath the sending address on a suspended or concluded account, for the case where nobody answers. Required for sunset and disabled."
            >
              <TextInput
                name="serviceContactEmail"
                type="email"
                defaultValue={config.serviceContactEmail ?? ''}
              />
            </Field>

            <Field
              label="Closed account access"
              name="closedAccountAccess"
              hint="An investor who has sent money should not lose the record of it, which is why read-only is the default."
            >
              <Select
                name="closedAccountAccess"
                defaultValue={config.closedAccountAccess}
                options={[
                  { value: 'READ_ONLY', label: 'Read-only — they can still see their own record' },
                  { value: 'NONE', label: 'None — a neutral closed page' },
                ]}
              />
            </Field>

            <Field
              label="Decimal places"
              name="decimalPlaces"
              hint="Display only. Stored values are always exact — rounding happens at render time."
            >
              <TextInput
                name="decimalPlaces"
                type="number"
                min={0}
                max={6}
                defaultValue={String(config.decimalPlaces)}
              />
            </Field>

            <div className="mb-4">
              <Checkbox
                name="qaVisibleDuringRaise"
                defaultChecked={config.qaVisibleDuringRaise}
                label="Shared Q&A visible during the raise"
              />
              <p className="mt-2 text-xs leading-relaxed text-dim">
                A shared Q&amp;A names nobody, but its existence implies other recipients.
                Switch it off and private answers still work exactly as before —
                publishing simply queues entries until the round closes.
              </p>
            </div>

            <Field
              label="Override reason"
              name="overrideReason"
              hint="Only needed when moving to disabled without a completed export in the last 7 days. The reason is written to the audit log."
            >
              <TextArea name="overrideReason" placeholder="" />
            </Field>
          </ActionForm>
        </Card>

        {/* -------------------------------------------------------------- */}
        <Card
          title="Default sender fields"
          description="Used when an uploaded row does not supply its own. Sender email falls back once more, to the authenticated sending address; sender phone has no fallback at all."
        >
          <ActionForm action={updateSenderDefaultsAction} submitLabel="Save sender defaults">
            <Field label="Default sender name" name="defaultSenderName">
              <TextInput
                name="defaultSenderName"
                defaultValue={config.defaultSenderName ?? ''}
              />
            </Field>
            <Field label="Default sender email" name="defaultSenderEmail">
              <TextInput
                name="defaultSenderEmail"
                type="email"
                defaultValue={config.defaultSenderEmail ?? ''}
              />
            </Field>
            <Field
              label="Default sender phone"
              name="defaultSenderPhone"
              hint="Leave this empty and any recipient whose row has no phone is caught at pre-flight, before the batch starts."
            >
              <TextInput
                name="defaultSenderPhone"
                inputMode="tel"
                defaultValue={config.defaultSenderPhone ?? ''}
              />
            </Field>
          </ActionForm>
        </Card>

        {/* -------------------------------------------------------------- */}
        <Card
          title="Approved jurisdictions"
          description="ISO 3166-1 alpha-2 codes, comma separated. Blocs must be expanded to their member codes so the list is always comparable to a recipient's field value."
        >
          <ActionForm
            action={updateApprovedJurisdictionsAction}
            submitLabel="Save jurisdictions"
          >
            <Field label="Country codes" name="jurisdictions">
              <TextArea
                name="jurisdictions"
                defaultValue={config.approvedJurisdictions.join(', ')}
                placeholder="AU, FR, GB, TH"
              />
            </Field>
          </ActionForm>

          <div className="mt-4">
            <Notice tone="warn">
              This list is configuration, not authority. What actually clears a recipient
              is a recorded compliance approval naming the jurisdictions it covers, and
              that control is not on this page. Adding a code here does not unblock
              anyone, and the application does not assess whether an approval is adequate.
            </Notice>
          </div>
        </Card>

        {/* -------------------------------------------------------------- */}
        <Card
          title="AI-assisted import"
          description="An accelerator, never a dependency. Without a key the operator maps columns from dropdowns and the import behaves identically — the model reads a spreadsheet, it never computes a figure."
        >
          <SecretState label="OpenAI key" state={maskConfigured(config.openAiKeyEncrypted)} />

          <div className="mt-4">
            <ActionForm action={updateAiSettingsAction} submitLabel="Save AI settings">
              <Field
                label="OpenAI key"
                name="openAiKey"
                hint="Write-only. Once saved it is encrypted at rest and never displayed again, never logged, never exported. Leave empty to keep the current key."
              >
                <TextInput
                  name="openAiKey"
                  type="password"
                  autoComplete="off"
                  placeholder={config.openAiKeyEncrypted ? '•••••••• (unchanged)' : 'sk-…'}
                />
              </Field>

              <Field label="Model" name="openAiModel">
                <TextInput name="openAiModel" defaultValue={config.openAiModel} />
              </Field>

              <Field
                label="Monthly spend cap (USD)"
                name="aiMonthlyCapUsd"
                hint="At 15–40 recipients real usage is pennies, which is exactly why a runaway loop would go unnoticed until the bill arrived. The cap warns; it does not stop an import."
              >
                <TextInput
                  name="aiMonthlyCapUsd"
                  inputMode="decimal"
                  defaultValue={config.aiMonthlyCapUsd}
                />
              </Field>

              {/*
                §9.1 asks for usage to be shown here, not only for a cap to be
                settable. The figure is an estimate from a published price list
                rather than a bill, and it says so — a number that looks like an
                invoice and is not one is worse than an obvious estimate.
              */}
              <div
                className={`mb-4 rounded-sm border-l-2 p-3 ${
                  spend.state === 'OVER_CAP'
                    ? 'border-l-warn bg-warn/6'
                    : spend.state === 'APPROACHING_CAP'
                      ? 'border-l-orange bg-orange/6'
                      : 'border-l-edge'
                }`}
              >
                <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-dim">
                  This month, so far
                </p>
                <p className="mt-1.5 text-lg font-bold tabular-nums text-white">
                  ${spend.spentUsd}
                  <span className="ml-2 text-xs font-normal text-muted">
                    of ${spend.capUsd}
                  </span>
                </p>
                <p className="mt-2 text-xs leading-relaxed text-dim">{spend.message}</p>
                <p className="mt-2 text-[10px] leading-relaxed text-muted">
                  An estimate, calculated from published per-token prices at the time of
                  each call. It is not a bill, and OpenAI&rsquo;s invoice is the figure
                  that counts.
                </p>
              </div>

              <div className="mb-4">
                <Checkbox
                  name="aiHeadersOnly"
                  defaultChecked={config.aiHeadersOnly}
                  label="Headers-only mode — send column names but no sample rows"
                />
                <p className="mt-2 text-xs leading-relaxed text-dim">
                  Normally the column headers and a small bounded sample of rows leave
                  this system and go to OpenAI. Never the full list. Headers-only mode is
                  for when even that sample is not acceptable.
                </p>
              </div>
            </ActionForm>
          </div>

          {config.openAiKeyEncrypted ? (
            <div className="mt-6 border-t hairline pt-4">
              <ActionForm
                action={removeOpenAiKeyAction}
                submitLabel="Remove the stored key"
                tone="danger"
              />
            </div>
          ) : null}
        </Card>

        {/* -------------------------------------------------------------- */}
        <Card
          title="The maker's credit"
          description={
            <>
              BUILD_SPEC §13.2 asks for a quiet &ldquo;Made by Make with Mike&rdquo; in the
              footer, switchable per surface. It never appears in an invitation email or on
              a participation certificate &mdash; those are formal instruments about
              someone&rsquo;s money, and there is no setting here that would put it on
              either.
            </>
          }
        >
          <ActionForm action={updateAttributionAction} submitLabel="Save the credit">
            <div className="space-y-3">
              <Checkbox
                name="attributionOnAdmin"
                defaultChecked={config.attributionOnAdmin}
                label="Show it on the admin side"
              />
              <Checkbox
                name="attributionOnPortal"
                defaultChecked={config.attributionOnPortal}
                label="Show it on the investor portal"
              />
            </div>

            <div className="mt-4">
              <Field
                label="Link (optional)"
                name="attributionUrl"
                hint="Opens in a new tab, styled exactly like the surrounding text. Leave blank for plain text. Only http and https addresses are accepted."
              >
                <TextInput
                  name="attributionUrl"
                  type="url"
                  inputMode="url"
                  placeholder="https://"
                  defaultValue={config.attributionUrl ?? ''}
                />
              </Field>
            </div>
          </ActionForm>
        </Card>
      </div>
    </>
  )
}
