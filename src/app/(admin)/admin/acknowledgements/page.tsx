import type { Metadata } from 'next'
import { asc } from 'drizzle-orm'
import {
  addAcknowledgementAction,
  archiveAcknowledgementAction,
  updateAcknowledgementAction,
} from '@/actions/acknowledgements'
import { ActionForm } from '@/components/admin/action-form'
import {
  Card,
  Checkbox,
  Field,
  Notice,
  Pill,
  SectionHeading,
  TextInput,
} from '@/components/admin/ui'
import { db } from '@/db'
import { acknowledgementItems } from '@/db/schema'
import { requireOwner } from '@/lib/auth/guards'
import {
  ACKNOWLEDGEMENT_HEADING,
  ACKNOWLEDGEMENT_STANDING_LINE,
  FORBIDDEN_IN_ACKNOWLEDGEMENT,
} from '@/lib/portal/acknowledgements'

export const metadata: Metadata = {
  title: 'Acknowledgements — Flipit SPV',
  robots: { index: false, follow: false, nocache: true },
}

export const dynamic = 'force-dynamic'

/**
 * The acknowledgement wording. BUILD_SPEC §13, §8.2.
 *
 * Owner only. §8.2's fourth clause keeps compliance out of the operator's
 * hands, and wording an approver cleared is the same kind of thing as the
 * approval itself.
 *
 * The standing line is shown here, uneditable, so whoever is writing wording
 * can see the sentence it will sit above — and can see that it is not one of
 * the things they can change.
 */
export default async function AcknowledgementsPage() {
  await requireOwner()

  const items = await db
    .select()
    .from(acknowledgementItems)
    .orderBy(asc(acknowledgementItems.sortOrder), asc(acknowledgementItems.createdAt))

  const live = items.filter((item) => item.archivedAt === null)
  const archived = items.filter((item) => item.archivedAt !== null)

  return (
    <>
      <SectionHeading eyebrow="Owner only" title="Acknowledgements">
        The checkboxes an investor ticks before recording an interest. Approved wording
        can be updated here without a code change. This is the only place these words
        are managed.
      </SectionHeading>

      <div className="space-y-4">
        <Card title="What sits beneath them, always">
          <p className="text-sm leading-relaxed text-silver2">
            {ACKNOWLEDGEMENT_STANDING_LINE}
          </p>
          <div className="mt-4">
            <Notice>
              This line is fixed. There is no setting that removes it, and archiving every
              acknowledgement does not remove it either. A tick is never treated as a
              binding subscription unless the final legal documents expressly make it so.
              That protection cannot be switched off here.
            </Notice>
          </div>
        </Card>

        <Card
          title="What an investor sees now"
          description={
            live.length === 0
              ? 'Nothing. With none configured the section does not appear on the portal at all, and an interest can be recorded without ticking anything.'
              : `${live.length} ${live.length === 1 ? 'box' : 'boxes'}, under the heading “${ACKNOWLEDGEMENT_HEADING}”, in this order.`
          }
        >
          {live.length > 0 ? (
            <ul className="space-y-2">
              {live.map((item) => (
                <li
                  key={item.id}
                  className="rounded-sm border hairline bg-bg2 px-4 py-3 text-sm leading-relaxed text-silver2"
                >
                  <span className="mr-2 text-muted">☐</span>
                  {item.label}
                  {!item.required ? (
                    <span className="ml-2 text-[10px] font-bold uppercase tracking-wider text-muted">
                      Optional
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}

          <div className="mt-4">
            <Notice>
              These are shown, and required, only when somebody records an interest.
              Declining and asking a question never require them &mdash; making a person
              tick boxes before they may say &ldquo;no&rdquo; would push them toward saying
              nothing instead, and silence is not a decline.
            </Notice>
          </div>
        </Card>

        {/* ------------------------------------------------------------- */}
        <Card
          title="Add an acknowledgement"
          description="The approver's wording, as they wrote it."
        >
          <ActionForm action={addAcknowledgementAction} submitLabel="Add it">
            <Field
              label="Wording"
              name="label"
              hint={`10 to 400 characters. Refused outright: anything that reads as an undertaking rather than an acknowledgement — ${FORBIDDEN_IN_ACKNOWLEDGEMENT.slice(0, 5).join(', ')} and the like.`}
            >
              <TextInput
                name="label"
                maxLength={400}
                required
                placeholder="I have read and understood that this is a private invitation and not an offer to the public."
              />
            </Field>
            <Checkbox
              name="required"
              id="required-new"
              defaultChecked
              label="Must be ticked before an interest can be recorded"
            />
          </ActionForm>
        </Card>

        {/* ------------------------------------------------------------- */}
        {live.map((item) => (
          <Card key={item.id} title={`Revision ${item.revision}`}>
            <div className="mb-4 flex flex-wrap items-center gap-2">
              {item.required ? (
                <Pill tone="accent">Required</Pill>
              ) : (
                <Pill tone="neutral">Optional</Pill>
              )}
              <Pill tone="neutral">On the portal</Pill>
            </div>

            <ActionForm
              action={updateAcknowledgementAction}
              submitLabel="Save this wording"
              hidden={{ itemId: item.id }}
            >
              <Field
                label="Wording"
                name={`label-${item.id}`}
                hint="Changing the words makes a new revision. Anything already ticked keeps the words it was ticked under."
              >
                <TextInput
                  name="label"
                  id={`label-${item.id}`}
                  defaultValue={item.label}
                  maxLength={400}
                  required
                />
              </Field>

              <Checkbox
                name="required"
                id={`required-${item.id}`}
                defaultChecked={item.required}
                label="Must be ticked before an interest can be recorded"
              />
            </ActionForm>

            <div className="mt-6 border-t hairline pt-4">
              <p className="mb-3 text-xs leading-relaxed text-dim">
                Archiving takes it off the portal. Everything already ticked under it stays
                on the record, with the words as they were shown. There is no delete.
              </p>
              <ActionForm
                action={archiveAcknowledgementAction}
                submitLabel="Archive it"
                tone="danger"
                hidden={{ itemId: item.id }}
              />
            </div>
          </Card>
        ))}

        {/* ------------------------------------------------------------- */}
        {archived.length > 0 ? (
          <Card
            title="Archived"
            description="Off the portal, kept as the record of what was on it."
          >
            <ul className="space-y-2">
              {archived.map((item) => (
                <li
                  key={item.id}
                  className="rounded-sm border hairline bg-bg2 px-4 py-3 text-sm leading-relaxed text-dim"
                >
                  {item.label}
                  <span className="ml-2 text-[10px] font-bold uppercase tracking-wider text-muted">
                    Revision {item.revision}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        ) : null}
      </div>
    </>
  )
}
