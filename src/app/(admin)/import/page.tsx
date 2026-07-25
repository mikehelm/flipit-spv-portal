import type { Metadata } from 'next'
import { requireImportActor } from '@/lib/import/authz'
import { ImportWizard } from './import-wizard'

export const metadata: Metadata = {
  title: 'Import recipients — Flipit SPV',
  robots: { index: false, follow: false },
}

// The file is read on every request; nothing about this page is cacheable.
export const dynamic = 'force-dynamic'

/**
 * Recipient import. BUILD_SPEC §9, §9.1.
 *
 * Authorization happens here AND again inside every action the wizard calls.
 * This check decides what is rendered; it is not what protects the data.
 */
export default async function ImportPage() {
  let actorEmail: string | null = null
  let refusal: string | null = null

  try {
    const actor = await requireImportActor()
    actorEmail = actor.email
  } catch (error) {
    refusal =
      error instanceof Error
        ? error.message
        : 'You do not have access to the recipient import.'
  }

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
      <header className="mb-6">
        <p className="text-xs uppercase tracking-[0.18em] text-dim">Flipit SPV</p>
        <h1 className="mt-1 text-2xl font-semibold text-ftext sm:text-3xl">
          Import recipients
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-dim">
          Upload the spreadsheet in whatever shape it is in. The columns are matched
          for you, you confirm or correct every one of them, and nothing is created
          until you have seen each value exactly as it would be stored.
        </p>
      </header>

      {refusal ? (
        <section
          className="rounded-lg border hairline bg-paper p-5 text-sm leading-relaxed text-ftext"
          role="alert"
        >
          <h2 className="mb-2 font-semibold text-warn">Not available</h2>
          <p className="text-dim">{refusal}</p>
        </section>
      ) : (
        <>
          <p className="mb-4 text-xs text-dim">Signed in as {actorEmail}</p>
          <ImportWizard />
        </>
      )}
    </main>
  )
}
