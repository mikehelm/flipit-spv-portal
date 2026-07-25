import type { Metadata } from 'next'
import {
  clearRecipientAction,
  recheckJurisdictionsAction,
  revokeRecipientClearanceAction,
} from '@/actions/compliance'
import { ActionForm } from '@/components/admin/action-form'
import { Card, Field, Notice, Pill, SectionHeading, TextInput } from '@/components/admin/ui'
import { requireOwner } from '@/lib/auth/guards'
import { NOT_LEGAL_ADVICE, hasRecordedOverride } from '@/lib/compliance'
import { TEMPLATE_LABEL } from '@/lib/email/templates'
import {
  AmendApprovalForm,
  RecordApprovalForm,
  VoidApprovalForm,
} from './approval-form'
import { loadComplianceOverview } from './data'
import { DiffView, Explanation, Hash, JurisdictionList, KeyValue, StatePill } from './parts'

export const metadata: Metadata = {
  title: 'Compliance — Flipit SPV',
  robots: { index: false, follow: false, nocache: true },
}

export const dynamic = 'force-dynamic'

/**
 * The compliance gate screen. BUILD_SPEC §8.2, §8.3.
 *
 * Owner only. `requireOwner()` runs first and audits the attempt of anyone
 * else before sending them away — the layout guard above is a convenience, not
 * the authorization, and every server action this page renders repeats the
 * check for itself.
 *
 * §8.2 item 5: "The gate screen displays the approval details, the cleared
 * jurisdictions, and a prominent notice that the application does not provide
 * legal advice and does not assess the adequacy of the approval." That notice
 * is the first thing on the page and is repeated beside every blocked
 * recipient.
 */
export default async function CompliancePage() {
  await requireOwner()

  const overview = await loadComplianceOverview()
  const invitation = overview.kinds.find((entry) => entry.kind === 'INVITATION')

  return (
    <div className="space-y-8">
      <SectionHeading eyebrow="Gate" title="Compliance approval">
        <p>
          This email is an offer of securities. Nothing sends until a qualified person has
          signed off the exact wording and the owner has recorded that sign-off here,
          naming the countries it covers. Changing one character of the template voids it.
        </p>
      </SectionHeading>

      <Card tone="warn" title="This application does not give legal advice">
        <p className="text-sm leading-relaxed text-[#cbd1de]">{NOT_LEGAL_ADVICE}</p>
        <p className="mt-3 text-sm leading-relaxed text-[#9498b5]">
          It does not assess whether the approval recorded below is adequate, whether the
          approver is qualified, or whether the jurisdictions listed are the right ones. It
          records what you tell it and refuses to send anything the record does not cover.
        </p>
      </Card>

      {/* ------------------------------------------------------------------ */}
      {/* Blocked recipients — first, because §8.3 says prominently          */}
      {/* ------------------------------------------------------------------ */}

      <section>
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <h2 className="text-lg font-bold text-white">Recipients held by the gate</h2>
          {overview.blocked.length === 0 ? (
            <Pill tone="ok">None held</Pill>
          ) : (
            <Pill tone="warn">{overview.blocked.length} held</Pill>
          )}
          <span className="text-sm text-[#9498b5]">
            {overview.sendableCount} of {overview.recipients.length} recipients pass the gate.
          </span>
        </div>

        {overview.recipients.length === 0 ? (
          <Card>
            <p className="text-sm text-[#9498b5]">
              No recipients have been imported yet, so there is nothing for the gate to
              decide.
            </p>
          </Card>
        ) : null}

        <div className="space-y-4">
          {overview.blocked.map(({ offer, decision }) => {
            if (decision.allowed) return null
            return (
              <Card key={offer.id} tone="warn" title={offer.recipientName}>
                <dl className="mb-4">
                  <KeyValue label="Jurisdiction">
                    {offer.jurisdiction ? (
                      <JurisdictionList codes={[offer.jurisdiction]} />
                    ) : (
                      <span className="text-[#ff5b52]">None recorded</span>
                    )}
                  </KeyValue>
                  <KeyValue label="Reason">
                    <span className="font-mono text-xs">{decision.reason}</span>
                  </KeyValue>
                  <KeyValue label="What this means">{decision.message}</KeyValue>
                  {offer.jurisdictionApprovalRef ? (
                    <KeyValue label="Clearance on file">
                      {offer.jurisdictionApprovalRef}
                    </KeyValue>
                  ) : null}
                </dl>

                {decision.explanation ? (
                  <div className="border-t hairline pt-4">
                    <Explanation explanation={decision.explanation} />
                  </div>
                ) : null}

                {decision.reason === 'JURISDICTION_NOT_APPROVED' ? (
                  <div className="mt-5 border-t hairline pt-4">
                    <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-[#F59A23]">
                      Clear this recipient alone
                    </p>
                    <ActionForm
                      action={clearRecipientAction}
                      submitLabel="Record clearance for this recipient"
                      tone="quiet"
                      hidden={{ offerId: offer.id }}
                    >
                      <Field
                        label="Approval reference"
                        name={`reference-${offer.id}`}
                        hint="The letter reference, email subject and date, or document id from whoever cleared this person. There is no way to unblock a recipient without one, and no setting anywhere that unblocks a jurisdiction for everybody."
                      >
                        <TextInput
                          name="reference"
                          id={`reference-${offer.id}`}
                          autoComplete="off"
                          required
                        />
                      </Field>
                    </ActionForm>
                  </div>
                ) : null}
              </Card>
            )
          })}
        </div>

        {/* Recipients cleared individually, so nobody is quietly forgotten. */}
        {overview.recipients.some(
          (entry) => entry.decision.allowed && hasRecordedOverride(entry.offer.jurisdictionApprovalRef),
        ) ? (
          <div className="mt-6">
            <Card title="Cleared individually">
              <p className="mb-4 text-sm text-[#9498b5]">
                These recipients are sendable because a specific approval reference was
                recorded for them, not because their country is on the approved list.
              </p>
              <div className="space-y-4">
                {overview.recipients
                  .filter(
                    (entry) =>
                      entry.decision.allowed &&
                      hasRecordedOverride(entry.offer.jurisdictionApprovalRef),
                  )
                  .map(({ offer }) => (
                    <div key={offer.id} className="border-t hairline pt-3">
                      <p className="text-sm font-semibold text-white">
                        {offer.recipientName}{' '}
                        <span className="font-normal text-[#9498b5]">
                          — {offer.jurisdiction ?? 'no jurisdiction'}
                        </span>
                      </p>
                      <p className="mt-1 text-sm break-words text-[#cbd1de]">
                        Reference: {offer.jurisdictionApprovalRef}
                      </p>
                      <div className="mt-3">
                        <ActionForm
                          action={revokeRecipientClearanceAction}
                          submitLabel="Withdraw this clearance"
                          tone="danger"
                          hidden={{ offerId: offer.id }}
                        />
                      </div>
                    </div>
                  ))}
              </div>
            </Card>
          </div>
        ) : null}
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* Approvals, per template kind                                       */}
      {/* ------------------------------------------------------------------ */}

      {overview.kinds.map(({ kind, drift, history }) => {
        const approval = drift.approval

        return (
          <section key={kind} className="space-y-4">
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="text-lg font-bold text-white">
                {TEMPLATE_LABEL[kind]} template
              </h2>
              <StatePill state={drift.state} />
            </div>

            <Card tone={drift.state === 'APPROVED' ? 'ok' : 'warn'}>
              <p className="text-sm leading-relaxed text-[#cbd1de]">{drift.message}</p>

              <dl className="mt-4">
                <KeyValue label="Live template hash">
                  <Hash value={drift.liveHash} />
                </KeyValue>
                <KeyValue label="Approved hash">
                  <Hash value={drift.approvedHash} />
                </KeyValue>
                <KeyValue label="Source in use">
                  {drift.live.origin === 'STORED'
                    ? `Stored version ${drift.live.version ?? '?'}`
                    : 'Built-in default'}
                </KeyValue>
              </dl>

              {approval ? (
                <dl className="mt-4">
                  <KeyValue label="Approver">
                    {approval.approverName}, {approval.approverRole}
                    {approval.approverFirm ? ` — ${approval.approverFirm}` : ''}
                  </KeyValue>
                  <KeyValue label="Approval date">
                    {approval.approvedAt.toISOString().slice(0, 10)}
                  </KeyValue>
                  <KeyValue label="Evidence reference">
                    {approval.evidenceReference}
                  </KeyValue>
                  <KeyValue label="Jurisdictions cleared">
                    <JurisdictionList codes={approval.approvedJurisdictions} />
                  </KeyValue>
                  <KeyValue label="Conditions">
                    {approval.conditions ?? 'None recorded.'}
                  </KeyValue>
                  <KeyValue label="Recorded">
                    {approval.createdAt.toISOString().slice(0, 16).replace('T', ' ')} UTC by{' '}
                    {history.find((entry) => entry.approval.id === approval.id)
                      ?.recordedByEmail ?? 'the owner'}
                  </KeyValue>
                </dl>
              ) : null}
            </Card>

            {drift.state === 'DRIFTED' && drift.diff ? (
              <Card title="What changed since approval" tone="warn">
                <DiffView diff={drift.diff} />
              </Card>
            ) : null}

            {drift.state === 'DRIFTED' && !drift.diff ? (
              <Card title="What changed since approval" tone="warn">
                <p className="text-sm leading-relaxed text-[#cbd1de]">
                  {drift.diffUnavailableReason}
                </p>
              </Card>
            ) : null}

            {approval ? (
              <>
                <Card title="Amend this approval">
                  <AmendApprovalForm
                    kind={kind}
                    templateHash={drift.liveHash}
                    defaults={{
                      approverName: approval.approverName,
                      approverRole: approval.approverRole,
                      approverFirm: approval.approverFirm,
                      jurisdictions: approval.approvedJurisdictions,
                      conditions: approval.conditions,
                    }}
                  />
                </Card>

                <Card title="Withdraw this approval">
                  <VoidApprovalForm approvalId={approval.id} kind={kind} />
                </Card>
              </>
            ) : (
              <Card
                title={`Record the ${TEMPLATE_LABEL[kind].toLowerCase()} approval`}
                description="Owner only. Recording this is what makes sending possible."
              >
                <RecordApprovalForm kind={kind} templateHash={drift.liveHash} />
              </Card>
            )}

            {history.length > 0 ? (
              <Card title="History">
                <ul className="space-y-3 text-sm">
                  {history.map(({ approval: entry, recordedByEmail }) => (
                    <li key={entry.id} className="border-t hairline pt-3">
                      <div className="flex flex-wrap items-center gap-2">
                        {entry.voidedAt ? (
                          <Pill tone="neutral">Voided</Pill>
                        ) : (
                          <Pill tone="ok">In force</Pill>
                        )}
                        <span className="text-[#e7e9f5]">
                          {entry.approverName} — {entry.approvedAt.toISOString().slice(0, 10)}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-[#9498b5]">
                        {entry.approvedJurisdictions.join(', ')} · recorded by{' '}
                        {recordedByEmail ?? 'the owner'} on{' '}
                        {entry.createdAt.toISOString().slice(0, 10)}
                      </p>
                      {entry.voidedReason ? (
                        <p className="mt-1 text-xs text-[#9498b5]">
                          Voided: {entry.voidedReason}
                        </p>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </Card>
            ) : null}
          </section>
        )
      })}

      {/* ------------------------------------------------------------------ */}

      <Card
        title="Re-apply the gate"
        description="Re-checks every recipient against the approval in force. It can only add holds or lift ones the jurisdiction gate itself placed — it never lifts a hold put there by validation, an unresolved variable, or a manual decision."
      >
        <ActionForm
          action={recheckJurisdictionsAction}
          submitLabel="Re-check every recipient"
          tone="quiet"
        />
      </Card>

      <Notice>
        {invitation && invitation.drift.state === 'APPROVED'
          ? 'The invitation template is approved. Recipients outside the cleared list are still held individually, and the mail connection has its own separate gate.'
          : 'Sending is disabled. Test sends to the operator’s own address remain available so the template can be prepared while approval is pending.'}
      </Notice>
    </div>
  )
}
