import type { Metadata } from 'next'
import Link from 'next/link'
import { Card, SectionHeading } from '@/components/admin/ui'
import { requireReader } from '@/lib/auth/guards'
import type { AdminRole } from '@/lib/roles'

export const metadata: Metadata = {
  title: 'More — Flipit SPV',
  robots: { index: false, follow: false, nocache: true },
}

type MoreLink = {
  href: string
  label: string
  description: string
  roles: AdminRole[]
}

const LINKS: MoreLink[] = [
  {
    href: '/admin/onboarding',
    label: 'My setup',
    description: 'Your saved identity and contact setup.',
    roles: ['OPERATOR'],
  },
  {
    href: '/access-requests',
    label: 'Access requests',
    description: 'Review people asking for access.',
    roles: ['OWNER', 'OPERATOR'],
  },
  {
    href: '/compliance',
    label: 'Approvals',
    description: 'Record or review the approval that controls sending.',
    roles: ['OWNER'],
  },
  {
    href: '/admin/settings',
    label: 'Settings',
    description: 'Connections, jurisdictions and service configuration.',
    roles: ['OWNER'],
  },
  {
    href: '/health',
    label: 'System health',
    description: 'Only open this when the service says something needs attention.',
    roles: ['OWNER', 'OPERATOR'],
  },
  {
    href: '/audit',
    label: 'Audit history',
    description: 'The attributable record of important decisions and changes.',
    roles: ['OWNER'],
  },
  {
    href: '/admin/invites',
    label: 'David’s access',
    description: 'Manage the operator’s access.',
    roles: ['OWNER'],
  },
  {
    href: '/admin/acknowledgements',
    label: 'Acknowledgement wording',
    description: 'Owner-controlled wording used with investor responses.',
    roles: ['OWNER'],
  },
  {
    href: '/admin/security',
    label: 'Two-factor security',
    description: 'Protect your own account.',
    roles: ['OWNER', 'OPERATOR', 'VIEWER'],
  },
  {
    href: '/admin/password',
    label: 'Password',
    description: 'Change your password or reminder hint.',
    roles: ['OWNER', 'OPERATOR', 'VIEWER'],
  },
  {
    href: '/admin/media',
    label: 'Media library',
    description: 'Optional material for a later portal experience.',
    roles: ['OWNER', 'OPERATOR'],
  },
  {
    href: '/admin/video',
    label: 'Personal video',
    description: 'Optional personal introduction.',
    roles: ['OWNER', 'OPERATOR'],
  },
  {
    href: '/admin/roadmap',
    label: 'Portal tiles',
    description: 'Optional future-service messages.',
    roles: ['OWNER'],
  },
]

export default async function MorePage() {
  const admin = await requireReader()
  const visible = LINKS.filter((item) => item.roles.includes(admin.role))
  const account = visible.filter((item) =>
    ['/admin/security', '/admin/password', '/admin/onboarding'].includes(item.href),
  )
  const operations = visible.filter((item) => !account.includes(item))

  return (
    <>
      <SectionHeading eyebrow="More" title="Setup and records">
        These tools support the main workflow. Most people will rarely need them.
      </SectionHeading>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card title="Your account">
          <ul className="grid grid-cols-1 gap-2">
            {account.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className="block rounded-sm border hairline bg-bg2 px-4 py-3 transition-colors hover:border-orange/50"
                >
                  <span className="text-sm font-semibold text-ftext">{item.label}</span>
                  <span className="mt-1 block text-xs leading-relaxed text-dim">
                    {item.description}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>

        {operations.length > 0 ? (
          <Card title={admin.role === 'OWNER' ? 'Owner tools' : 'Operational tools'}>
            <ul className="grid grid-cols-1 gap-2">
              {operations.map((item) => (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className="block rounded-sm border hairline bg-bg2 px-4 py-3 transition-colors hover:border-orange/50"
                  >
                    <span className="text-sm font-semibold text-ftext">{item.label}</span>
                    <span className="mt-1 block text-xs leading-relaxed text-dim">
                      {item.description}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        ) : null}
      </div>
    </>
  )
}
