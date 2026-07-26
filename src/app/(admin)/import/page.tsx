import type { Metadata } from 'next'
import { SectionHeading } from '@/components/admin/ui'
import { currentIdentity } from '@/lib/auth/guards'
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
 *
 * The refusal is rendered in place rather than redirected, which is right: this
 * page has a heading worth keeping and a wizard worth withholding. But
 * `requireImportActor` answers `NOT_SIGNED_IN` for three different people — a
 * stranger, an administrator who has not chosen a password, and a read-only
 * administrator — because `currentAdmin()` is deliberately `null` for all
 * three. Printing its message verbatim told a signed-in viewer to *sign in*,
 * which reads as the application being broken rather than as a boundary.
 *
 * So the wording is chosen here, after the refusal, from an identity read that
 * decides nothing. The authorization is unchanged and still `requireImportActor`
 * alone; this only picks the sentence.
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

    const identity = await currentIdentity()
    if (identity) {
      refusal =
        identity.role === 'VIEWER'
          ? 'Your account has read-only access. The import creates investor records, ' +
            'so it is not open to it. The recipients themselves are on the investors ' +
            'page, where you can read every one of them.'
          : 'Your account does not have access to the recipient import.'
    }
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
