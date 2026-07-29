import {
  correctDocumentAction,
  issueDocumentAction,
  removeDocumentAction,
  uploadDocumentAction,
  withdrawDocumentAction,
} from '@/actions/documents'
import { ActionForm } from '@/components/admin/action-form'
import { Checkbox, Field, Notice, Pill, TextArea, TextInput } from '@/components/admin/ui'
import { documentSizeLabel, type AccountOfferDocuments } from '@/lib/documents/data'
import { lineagesOf, versionLabel } from '@/lib/documents/versions'
import { MAX_DOCUMENT_BYTES } from '@/lib/media/formats'

/**
 * Document packages on one investor's record. BUILD_SPEC §5 status 3.
 *
 * *"Documents issued · Operator · Date, document list, download links."*
 *
 * The screen is built around the gap between uploading and issuing, because
 * that gap is the feature: a document sits here, openable by the operator and
 * invisible to the investor, until he ticks the confirmation. Every state on
 * the card says which side of that line it is on, in words rather than a
 * colour.
 */

function formatDate(value: Date | null): string {
  return value ? value.toISOString().slice(0, 10) : '—'
}

export function DocumentsPanel({
  offers,
  storeConfigured,
}: {
  offers: AccountOfferDocuments[]
  storeConfigured: boolean
}) {
  if (offers.length === 0) return null

  const issued = offers.reduce(
    (total, offer) => total + offer.documents.filter((d) => d.issuedAt !== null).length,
    0,
  )
  const waiting = offers.reduce(
    (total, offer) => total + offer.documents.filter((d) => d.issuedAt === null).length,
    0,
  )

  return (
    <details className="mt-3 rounded-sm border hairline bg-bg2 p-3">
      <summary className="cursor-pointer text-xs font-semibold text-silver2">
        Documents{' '}
        <span className="font-normal text-dim">
          — {issued} issued
          {waiting > 0 ? `, ${waiting} waiting to be issued` : ''}
        </span>
      </summary>

      {!storeConfigured ? (
        <div className="mt-3">
          <Notice tone="warn">
            There is nowhere to store a file on this deployment, so documents cannot be
            uploaded. Mike needs to connect document storage. Everything else on this
            screen still works.
          </Notice>
        </div>
      ) : null}

      {offers.map((offer) => (
        <section key={offer.offerId} className="mt-4 border-t hairline pt-4 first:border-t-0">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-silver2">
            {offer.roundName ?? 'Their offer'}
          </h3>

          {offer.documents.length === 0 ? (
            <p className="mt-2 text-xs text-dim">Nothing on this record yet.</p>
          ) : (
            <ul className="mt-3 space-y-3">
              {lineagesOf(offer.documents).map(({ current, superseded, pending }) => (
                <li key={current.id} className="rounded-sm border hairline bg-paper p-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-ftext">{current.title}</p>
                      {current.description ? (
                        <p className="mt-1 text-xs leading-relaxed text-dim">
                          {current.description}
                        </p>
                      ) : null}
                      <p className="mt-1 text-xs text-muted">
                        {documentSizeLabel(current.sizeBytes)} · added{' '}
                        {formatDate(current.createdAt)}
                        {current.issuedAt ? ` · issued ${formatDate(current.issuedAt)}` : ''}
                        {versionLabel(current, superseded.length)
                          ? ` · ${versionLabel(current, superseded.length)}`
                          : ''}
                      </p>
                    </div>
                    {current.issuedAt ? (
                      <Pill tone="ok">On their portal</Pill>
                    ) : (
                      <Pill tone="neutral">Not issued</Pill>
                    )}
                  </div>

                  <p className="mt-3">
                    <a
                      href={`/investors/${offer.offerId}/document/${current.id}`}
                      className="inline-flex min-h-11 items-center text-sm font-semibold text-orange underline-offset-4 hover:underline"
                    >
                      Open it
                    </a>
                  </p>

                  {current.issuedAt ? (
                    <div className="mt-3 border-t hairline pt-3">
                      <p className="mb-3 text-xs leading-relaxed text-dim">
                        Withdrawing takes it off their portal. They may already have downloaded
                        it, so if it was wrong, tell them — the log records both events.
                      </p>
                      <ActionForm
                        action={withdrawDocumentAction}
                        submitLabel="Withdraw it"
                        tone="quiet"
                        hidden={{ documentId: current.id }}
                      />
                    </div>
                  ) : (
                    <div className="mt-3 border-t hairline pt-3">
                      <ActionForm
                        action={issueDocumentAction}
                        submitLabel="Issue it"
                        hidden={{ documentId: current.id }}
                      >
                        <Checkbox
                          name="confirm"
                          value="ISSUE"
                          id={`confirm-${current.id}`}
                          label="I have opened it and it is the right file for this person."
                        />
                      </ActionForm>

                      <div className="mt-4">
                        <ActionForm
                          action={removeDocumentAction}
                          submitLabel="Remove it"
                          tone="danger"
                          hidden={{ documentId: current.id }}
                        />
                      </div>
                    </div>
                  )}

                  {/* Earlier versions. §5: never a silent overwrite. */}
                  {superseded.length > 0 ? (
                    <div className="mt-3 border-t hairline pt-3">
                      <p className="text-xs font-semibold uppercase tracking-wider text-silver2">
                        Earlier versions
                      </p>
                      <ul className="mt-2 space-y-1">
                        {superseded.map((older) => (
                          <li key={older.id} className="text-xs text-dim">
                            <a
                              href={`/investors/${offer.offerId}/document/${older.id}`}
                              className="inline-flex min-h-11 items-center underline-offset-4 hover:underline"
                            >
                              Version {older.version} · issued {formatDate(older.issuedAt)} ·
                              replaced {formatDate(older.supersededAt)}
                            </a>
                          </li>
                        ))}
                      </ul>
                      <p className="mt-1 text-xs text-muted">
                        Still on their portal, marked as replaced. They can see what they were
                        given and that it changed.
                      </p>
                    </div>
                  ) : null}

                  {/* A correction uploaded and waiting. */}
                  {pending ? (
                    <div className="mt-3 rounded-sm border hairline bg-bg2 p-3">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <p className="text-xs font-semibold text-silver2">
                          Version {pending.version} is uploaded and waiting
                        </p>
                        <Pill tone="neutral">Not issued</Pill>
                      </div>
                      <p className="mt-2 text-xs leading-relaxed text-dim">
                        The investor still has version {current.version}. Issuing this one
                        replaces it on their portal and marks the old one as superseded, in one
                        step.
                      </p>
                      <p className="mt-2">
                        <a
                          href={`/investors/${offer.offerId}/document/${pending.id}`}
                          className="inline-flex min-h-11 items-center text-sm font-semibold text-orange underline-offset-4 hover:underline"
                        >
                          Open the correction
                        </a>
                      </p>
                      <div className="mt-2">
                        <ActionForm
                          action={issueDocumentAction}
                          submitLabel={`Issue version ${pending.version}`}
                          hidden={{ documentId: pending.id }}
                        >
                          <Checkbox
                            name="confirm"
                            value="ISSUE"
                            id={`confirm-${pending.id}`}
                            label="I have opened it and it is the right corrected file."
                          />
                        </ActionForm>
                      </div>
                      <div className="mt-3">
                        <ActionForm
                          action={removeDocumentAction}
                          submitLabel="Remove the correction"
                          tone="danger"
                          hidden={{ documentId: pending.id }}
                        />
                      </div>
                    </div>
                  ) : null}

                  {/* Uploading a correction, when one is allowed. */}
                  {storeConfigured && !pending && current.issuedAt && !current.supersededAt ? (
                    <details className="mt-3 border-t hairline pt-3">
                      <summary className="cursor-pointer text-xs font-semibold text-silver2">
                        Correct this document
                      </summary>
                      <p className="mt-2 text-xs leading-relaxed text-dim">
                        Uploads version {current.version + 1}. It arrives{' '}
                        <strong className="text-silver2">not issued</strong>, and the investor
                        keeps version {current.version} until you issue the new one. Nothing is
                        overwritten and nothing is deleted.
                      </p>
                      <div className="mt-3">
                        <ActionForm
                          action={correctDocumentAction}
                          submitLabel="Upload the correction"
                          tone="quiet"
                          hidden={{ documentId: current.id }}
                          fileKind="document"
                        >
                          <Field
                            label="Title"
                            name={`correct-title-${current.id}`}
                            hint="Leave as it is unless the document itself is now called something else."
                          >
                            <TextInput
                              name="title"
                              id={`correct-title-${current.id}`}
                              maxLength={120}
                              defaultValue={current.title}
                              required
                            />
                          </Field>
                          <Field
                            label="Description"
                            name={`correct-description-${current.id}`}
                            hint="Optional. Worth saying what changed."
                          >
                            <TextArea
                              name="description"
                              id={`correct-description-${current.id}`}
                              maxLength={600}
                              defaultValue={current.description ?? ''}
                            />
                          </Field>
                          <Field label="Corrected file" name={`correct-file-${current.id}`}>
                            <input
                              type="file"
                              name="file"
                              id={`correct-file-${current.id}`}
                              required
                              accept="application/pdf"
                              className="w-full min-h-11 rounded-sm border hairline bg-bg2 px-3 py-2.5 text-sm text-ftext file:mr-3 file:rounded-sm file:border-0 file:bg-orange file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-ink"
                            />
                          </Field>
                        </ActionForm>
                      </div>
                    </details>
                  ) : null}
                </li>
              ))}
            </ul>
          )}

          {storeConfigured ? (
            <div className="mt-4 rounded-sm border hairline bg-paper p-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-silver2">
                Add a document
              </p>
              <p className="mt-2 text-xs leading-relaxed text-dim">
                PDF only, up to {MAX_DOCUMENT_BYTES / (1024 * 1024)} MB. It arrives{' '}
                <strong className="text-silver2">not issued</strong> — nothing reaches the
                investor until you open it, check it, and issue it.
              </p>

              <div className="mt-3">
                <ActionForm
                  action={uploadDocumentAction}
                  submitLabel="Upload"
                  tone="quiet"
                  hidden={{ offerId: offer.offerId }}
                  fileKind="document"
                >
                  <Field label="Title" name={`title-${offer.offerId}`}>
                    <TextInput
                      name="title"
                      id={`title-${offer.offerId}`}
                      maxLength={120}
                      required
                      placeholder="Subscription agreement"
                    />
                  </Field>
                  <Field
                    label="Description"
                    name={`description-${offer.offerId}`}
                    hint="Optional. What it is and what they need to do with it."
                  >
                    <TextArea
                      name="description"
                      id={`description-${offer.offerId}`}
                      maxLength={600}
                    />
                  </Field>
                  <Field label="File" name={`file-${offer.offerId}`}>
                    <input
                      type="file"
                      name="file"
                      id={`file-${offer.offerId}`}
                      required
                      accept="application/pdf"
                      className="w-full min-h-11 rounded-sm border hairline bg-bg2 px-3 py-2.5 text-sm text-ftext file:mr-3 file:rounded-sm file:border-0 file:bg-orange file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-ink"
                    />
                  </Field>
                </ActionForm>
              </div>
            </div>
          ) : null}
        </section>
      ))}
    </details>
  )
}
