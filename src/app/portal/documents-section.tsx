import { documentSizeLabel, type DocumentRecord } from '@/lib/documents/data'
import { lineagesOf, versionLabel } from '@/lib/documents/versions'
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
          {lineagesOf(documents).map(({ current, superseded }) => (
            <li key={current.id} className="border-t hairline pt-3 first:border-t-0 first:pt-0">
              <a
                href={`${env().BASE_PATH}/portal/document/${current.id}`}
                className="inline-flex min-h-11 items-center text-sm font-semibold text-orange underline-offset-4 hover:underline"
              >
                {current.title}
              </a>
              {current.description ? (
                <p className="mt-1 text-sm leading-relaxed text-silver2">{current.description}</p>
              ) : null}
              <p className="mt-1 text-xs text-muted">
                PDF · {documentSizeLabel(current.sizeBytes)} · issued{' '}
                {formatDate(current.issuedAt)}
                {versionLabel(current, superseded.length)
                  ? ` · ${versionLabel(current, superseded.length)}`
                  : ''}
              </p>

              {/*
                §5: a correction is never a silent overwrite. If this document
                replaced one they were given, they are told so plainly, and the
                version they had stays openable — hiding it would not unsend it.
              */}
              {superseded.length > 0 ? (
                <div className="mt-2 rounded-sm border hairline bg-bg2 p-3">
                  <p className="text-xs leading-relaxed text-silver2">
                    This replaced {superseded.length === 1 ? 'an earlier version' : 'earlier versions'}{' '}
                    you were sent. The version above is the current one. What you had before is
                    still here:
                  </p>
                  <ul className="mt-2 space-y-2">
                    {superseded.map((older) => (
                      <li key={older.id}>
                        <a
                          href={`${env().BASE_PATH}/portal/document/${older.id}`}
                          className="inline-flex min-h-11 items-center text-xs font-medium text-silver2 underline-offset-4 hover:underline"
                        >
                          Version {older.version} · issued {formatDate(older.issuedAt)} · replaced{' '}
                          {formatDate(older.supersededAt)}
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}
