import { requireOwner } from '@/lib/auth/guards'
import { exportAuditLogCsv, exportAuditLogXlsx } from '@/lib/export'
import { loadAuditRows, recordExport } from '@/lib/export/data'

export const dynamic = 'force-dynamic'

/**
 * The audit-log export. BUILD_SPEC §20: "An audit-log export is available
 * separately to the owner."
 *
 * `requireOwner()` is the access control, and it audits an operator's attempt
 * before turning them away. The link is hidden from the operator too; the
 * hiding is manners.
 *
 * The formatter takes `requestedByRole: 'OWNER'` as a literal in its schema, so
 * a caller that reached here without being the owner would fail validation as
 * well as having failed the guard. Two locks on the same door, deliberately.
 */
export async function GET(request: Request) {
  const owner = await requireOwner()

  const url = new URL(request.url)
  const format = url.searchParams.get('format') === 'xlsx' ? 'XLSX' : 'CSV'

  const rows = await loadAuditRows({
    actor: url.searchParams.get('actor'),
    entityType: url.searchParams.get('entity'),
    action: url.searchParams.get('action'),
    from: url.searchParams.get('from'),
    to: url.searchParams.get('to'),
    limit: 50000,
  })

  const request_ = {
    requestedByRole: 'OWNER' as const,
    rows: rows.map((row) => ({
      id: row.id,
      actorLabel: row.actorLabel,
      actorUserId: row.actorUserId,
      actorAccountId: row.actorAccountId,
      entityType: row.entityType,
      entityId: row.entityId,
      action: row.action,
      metadata: row.metadata ?? null,
      createdAt: row.createdAt.toISOString(),
    })),
  }

  const body = format === 'XLSX' ? exportAuditLogXlsx(request_) : exportAuditLogCsv(request_)

  await recordExport({
    kind: 'AUDIT',
    format,
    rows: rows.length,
    bytes: body.length,
    actor: { kind: 'user', id: owner.id, label: owner.email },
  })

  const stamp = new Date().toISOString().slice(0, 10)

  return new Response(new Uint8Array(body), {
    status: 200,
    headers: {
      'Content-Type':
        format === 'XLSX'
          ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
          : 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="flipit-audit-${stamp}.${format.toLowerCase()}"`,
      'Cache-Control': 'private, no-store',
      'X-Robots-Tag': 'noindex, nofollow',
    },
  })
}
