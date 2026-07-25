import type { Metadata } from 'next'
import { SectionHeading } from '@/components/admin/ui'
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
  let refusal: string | null = null

  try {
    await requireImportActor()
  } catch (error) {
    refusal =
      error instanceof Error
        ? error.message
        : 'You do not have access to the recipient import.'
  }

  // The `(admin)` layout supplies the page frame, the signed-in identity and
  // the navigation. This page adds its own heading and nothing else — two
  // wrappers and two "signed in as" lines were the visible seam between two
  // work packages.
  return (
    <>
      <SectionHeading eyebrow="Recipients" title="Import recipients">
        Upload the spreadsheet in whatever shape it is in. The columns are matched
        for you, you confirm or correct every one of them, and nothing is created
        until you have seen each value exactly as it would be stored.
      </SectionHeading>

      {refusal ? (
        <section
          className="rounded-sm border hairline bg-paper p-5 text-sm leading-relaxed text-ftext"
          role="alert"
        >
          <h2 className="mb-2 font-semibold text-warn">Not available</h2>
          <p className="text-dim">{refusal}</p>
        </section>
      ) : (
        <ImportWizard />
      )}
    </>
  )
}
