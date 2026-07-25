import { documentSizeLabel, type DocumentRecord } from '@/lib/documents/data'
import { env } from '@/lib/env'

/**
 * The investor's own documents. BUILD_SPEC §5 status 3, §13.
 *
 * *"Documents issued to them, downloadable."*
 *
 * Rendered only when there is at least one issued document — so an investor
 * who has not reached that step sees nothing about documents at all, rather
 * than an empty heading telling them something is missing. The same rule as
 * §13.3's video, for the same reason.
 *
 * Everything here belongs to the person reading it. There is no count of
 * anybody else's documents, no template name shared with another investor, and
 * nothing that implies a second recipient exists (§15).
 */

function formatDate(value: Date | null): string {
  if (!value) return ''
  return value.toISOString().slice(0, 10)
}

export function DocumentsSection({ documents }: { documents: DocumentRecord[] }) {
  if (documents.length === 0) return null

  return (
    <section className="mt-10">
      <div className="rounded-sm border hairline bg-paper p-5">
        <h2 className="text-sm font-semibold text-white">Your documents</h2>
        <p className="mt-2 text-sm leading-relaxed text-dim">
          Issued to you as part of this process. They remain here for your records.
        </p>

        <ul className="mt-4 space-y-3">
          {documents.map((document) => (
            <li key={document.id} className="border-t hairline pt-3 first:border-t-0 first:pt-0">
              <a
                href={`${env().BASE_PATH}/portal/document/${document.id}`}
                className="inline-flex min-h-11 items-center text-sm font-semibold text-orange underline-offset-4 hover:underline"
              >
                {document.title}
              </a>
              {document.description ? (
                <p className="mt-1 text-sm leading-relaxed text-silver2">
                  {document.description}
                </p>
              ) : null}
              <p className="mt-1 text-xs text-muted">
                PDF · {documentSizeLabel(document.sizeBytes)} · issued{' '}
                {formatDate(document.issuedAt)}
              </p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}
