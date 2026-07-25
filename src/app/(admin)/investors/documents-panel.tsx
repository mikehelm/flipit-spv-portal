import {
  issueDocumentAction,
  removeDocumentAction,
  uploadDocumentAction,
  withdrawDocumentAction,
} from '@/actions/documents'
import { ActionForm } from '@/components/admin/action-form'
import { Checkbox, Field, Notice, Pill, TextArea, TextInput } from '@/components/admin/ui'
import { documentSizeLabel, type AccountOfferDocuments } from '@/lib/documents/data'
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
            uploaded. Set <code>MEDIA_STORE</code> and <code>MEDIA_DIR</code>. Everything else
            on this screen works.
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
              {offer.documents.map((document) => (
                <li key={document.id} className="rounded-sm border hairline bg-paper p-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-ftext">{document.title}</p>
                      {document.description ? (
                        <p className="mt-1 text-xs leading-relaxed text-dim">
                          {document.description}
                        </p>
                      ) : null}
                      <p className="mt-1 text-xs text-muted">
                        {documentSizeLabel(document.sizeBytes)} · added{' '}
                        {formatDate(document.createdAt)}
                        {document.issuedAt ? ` · issued ${formatDate(document.issuedAt)}` : ''}
                      </p>
                    </div>
                    {document.issuedAt ? (
                      <Pill tone="ok">On their portal</Pill>
                    ) : (
                      <Pill tone="neutral">Not issued</Pill>
                    )}
                  </div>

                  <p className="mt-3">
                    <a
                      href={`/investors/${offer.offerId}/document/${document.id}`}
                      className="inline-flex min-h-11 items-center text-sm font-semibold text-orange underline-offset-4 hover:underline"
                    >
                      Open it
                    </a>
                  </p>

                  {document.issuedAt ? (
                    <div className="mt-3 border-t hairline pt-3">
                      <p className="mb-3 text-xs leading-relaxed text-dim">
                        Withdrawing takes it off their portal. They may already have downloaded
                        it, so if it was wrong, tell them — the log records both events.
                      </p>
                      <ActionForm
                        action={withdrawDocumentAction}
                        submitLabel="Withdraw it"
                        tone="quiet"
                        hidden={{ documentId: document.id }}
                      />
                    </div>
                  ) : (
                    <div className="mt-3 border-t hairline pt-3">
                      <ActionForm
                        action={issueDocumentAction}
                        submitLabel="Issue it"
                        hidden={{ documentId: document.id }}
                      >
                        <Checkbox
                          name="confirm"
                          value="ISSUE"
                          id={`confirm-${document.id}`}
                          label="I have opened it and it is the right file for this person."
                        />
                      </ActionForm>

                      <div className="mt-4">
                        <ActionForm
                          action={removeDocumentAction}
                          submitLabel="Remove it"
                          tone="danger"
                          hidden={{ documentId: document.id }}
                        />
                      </div>
                    </div>
                  )}
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
