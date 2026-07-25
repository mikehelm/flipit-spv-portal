import Link from 'next/link'
import { Card, SectionHeading } from '@/components/admin/ui'
import { requireAdmin } from '@/lib/auth/guards'

/**
 * Where a role check sends someone who is signed in but not entitled.
 *
 * It says plainly what happened, because a blocked action that reads as a
 * generic failure is a bug. The attempt itself is already on the audit log.
 */
export default async function NoAccessPage() {
  const admin = await requireAdmin()

  return (
    <>
      <SectionHeading eyebrow="Access" title="That area is not yours">
        You are signed in as {admin.email}, which holds the{' '}
        {admin.role === 'OWNER' ? 'owner' : 'operator'} role. The page you asked for is
        restricted to a different role, and the attempt has been recorded.
      </SectionHeading>

      <Card title="What this covers">
        <ul className="list-disc space-y-2 pl-5 text-sm leading-relaxed text-[#9498b5]">
          <li>
            Compliance approval, service configuration, the AI key and operator access
            are owner-only.
          </li>
          <li>
            Operator setup — display name, contact method, sending account — belongs to
            the operator&rsquo;s own account and cannot be completed on their behalf.
          </li>
        </ul>
        <p className="mt-4">
          <Link href="/admin" className="text-sm font-semibold text-[#F59A23]">
            Back to the overview
          </Link>
        </p>
      </Card>
    </>
  )
}
