'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { AdminRole } from '@/lib/roles'

interface JobDestination {
  href: string
  label: string
  matches: string[]
  roles: AdminRole[]
  pending?: number
}

function matchesPath(pathname: string, paths: string[]): boolean {
  return paths.some(
    (path) => pathname === path || (path !== '/admin' && pathname.startsWith(`${path}/`)),
  )
}

/**
 * Five job-based destinations. The specialist routes still exist and keep their
 * server guards; they are linked from the relevant landing page instead of
 * asking Mike or David to learn the application's internal architecture.
 */
export function AdminNav({
  role,
  emailReviewPendingCount = 0,
}: {
  role: AdminRole
  emailReviewPendingCount?: number
}) {
  const pathname = usePathname()

  const destinations: JobDestination[] = [
    {
      href: '/admin',
      label: 'Start',
      matches: ['/admin'],
      roles: ['OWNER', 'OPERATOR', 'VIEWER'],
    },
    {
      href: '/recipients',
      label: 'People',
      matches: ['/recipients', '/import', '/investors', '/register', '/round'],
      roles: ['OWNER', 'OPERATOR', 'VIEWER'],
    },
    {
      href: role === 'VIEWER' ? '/admin/email-review' : '/templates',
      label: 'Message',
      matches: ['/templates', '/admin/email-review'],
      roles: ['OWNER', 'OPERATOR', 'VIEWER'],
      pending: emailReviewPendingCount,
    },
    {
      href: '/follow-up',
      label: 'Follow-up',
      matches: ['/follow-up', '/questions', '/updates', '/reminders'],
      roles: ['OWNER', 'OPERATOR', 'VIEWER'],
    },
    {
      href: '/more',
      label: 'More',
      matches: [
        '/more',
        '/access-requests',
        '/compliance',
        '/audit',
        '/health',
        '/admin/settings',
        '/admin/security',
        '/admin/password',
        '/admin/invites',
        '/admin/onboarding',
        '/admin/media',
        '/admin/video',
        '/admin/roadmap',
        '/admin/acknowledgements',
      ],
      roles: ['OWNER', 'OPERATOR', 'VIEWER'],
    },
  ]

  return (
    <nav aria-label="Admin sections">
      <ul className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
        {destinations
          .filter((destination) => destination.roles.includes(role))
          .map((destination) => {
            const active = matchesPath(pathname, destination.matches)
            return (
              <li key={destination.href}>
                <Link
                  href={destination.href}
                  aria-current={active ? 'page' : undefined}
                  className={`flex min-h-11 items-center justify-center gap-2 rounded-sm border px-4 text-sm font-semibold transition-colors ${
                    active
                      ? 'border-orange/40 bg-orange/12 text-orange'
                      : 'hairline bg-bg2 text-dim hover:border-orange/40 hover:text-ftext'
                  }`}
                >
                  {destination.label}
                  {destination.pending && destination.pending > 0 ? (
                    <span className="rounded-full bg-orange px-2 py-0.5 text-[9px] font-bold text-ink">
                      {destination.pending}
                    </span>
                  ) : null}
                </Link>
              </li>
            )
          })}
      </ul>
    </nav>
  )
}
