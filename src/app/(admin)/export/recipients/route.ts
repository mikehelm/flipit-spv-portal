import { requireOnboardedAdmin } from '@/lib/auth/guards'
import { exportRecipientsCsv, exportRecipientsXlsx } from '@/lib/export'
import { loadRecipientExportRows, recordExport, roundExists } from '@/lib/export/data'

export const dynamic = 'force-dynamic'

/**
 * The recipient export. BUILD_SPEC §20.
 *
 * Either role may run it. §20 makes only the *audit* export owner-only, and the
 * operator needs the recipient data to do his job — it is the same information
 * the review screen already shows him.
 *
 * `recordExport` runs after the bytes exist, not before. §7 makes moving to
 * `disabled` conditional on a completed export in the preceding seven days, and
 * an export that threw halfway is not a completed export.
 */
export async function GET(request: Request) {
  const admin = await requireOnboardedAdmin()

  const url = new URL(request.url)
  const roundId = url.searchParams.get('round') ?? ''
  const format = url.searchParams.get('format') === 'xlsx' ? 'XLSX' : 'CSV'

  if (roundId === '' || !(await roundExists(roundId))) {
    return new Response('Choose a round to export.', { status: 400 })
  }

  const rows = await loadRecipientExportRows(roundId)
  const body = format === 'XLSX' ? exportRecipientsXlsx(rows) : exportRecipientsCsv(rows)

  await recordExport({
    kind: 'RECIPIENTS',
    format,
    rows: rows.length,
    bytes: body.length,
    actor: { kind: 'user', id: admin.id, label: admin.email },
  })

  const stamp = new Date().toISOString().slice(0, 10)

  return new Response(new Uint8Array(body), {
    status: 200,
    headers: {
      'Content-Type':
        format === 'XLSX'
          ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
          : 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="flipit-recipients-${stamp}.${format.toLowerCase()}"`,
      'Cache-Control': 'private, no-store',
      'X-Robots-Tag': 'noindex, nofollow',
    },
  })
}
