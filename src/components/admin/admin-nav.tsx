'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { PrivilegedRole } from '@/lib/roles'

/**
 * Admin navigation.
 *
 * Owner-only destinations are hidden from the operator here, and refused again
 * on the server by `requireOwner()`. The hiding is manners; the refusal is the
 * access control.
 *
 * Compliance approval (BUILD_SPEC §8.2) is linked here for the OWNER only. The
 * link is not what restricts it: `/compliance` calls `requireOwner()` itself
 * and audits anyone else's attempt before turning them away. It is deliberately
 * absent from the settings page, so that no future change to who reaches
 * settings can hand the approval control to the operator.
 */

interface NavItem {
  href: string
  label: string
  roles: PrivilegedRole[]
}

const ITEMS: NavItem[] = [
  { href: '/admin', label: 'Overview', roles: ['OWNER', 'OPERATOR'] },
  { href: '/recipients', label: 'Review and send', roles: ['OWNER', 'OPERATOR'] },
  { href: '/investors', label: 'Investors', roles: ['OWNER', 'OPERATOR'] },
  { href: '/import', label: 'Import', roles: ['OWNER', 'OPERATOR'] },
  { href: '/templates', label: 'Email templates', roles: ['OWNER', 'OPERATOR'] },
  { href: '/round', label: 'The round', roles: ['OWNER', 'OPERATOR'] },
  { href: '/updates', label: 'Updates', roles: ['OWNER', 'OPERATOR'] },
  { href: '/questions', label: 'Questions', roles: ['OWNER', 'OPERATOR'] },
  { href: '/reminders', label: 'Reminders', roles: ['OWNER', 'OPERATOR'] },
  { href: '/register', label: 'Register', roles: ['OWNER', 'OPERATOR'] },
  { href: '/compliance', label: 'Compliance', roles: ['OWNER'] },
  // §8.2 puts the acknowledgement wording under compliance — "approved wording
  // applied without a code change" — and §8.2's fourth clause keeps compliance
  // out of the operator's hands. Owner only, for the reason the approval is.
  { href: '/admin/acknowledgements', label: 'Acknowledgements', roles: ['OWNER'] },
  { href: '/admin/security', label: 'Two-factor', roles: ['OWNER', 'OPERATOR'] },
  { href: '/admin/onboarding', label: 'Setup', roles: ['OPERATOR'] },
  { href: '/admin/invites', label: 'Operator access', roles: ['OWNER'] },
  { href: '/audit', label: 'Audit log', roles: ['OWNER'] },
  // Both roles. The operator is the person who would have to act on almost
  // everything this page reports — a stopped scheduler, a stuck reminder, a mail
  // credential that expired — so hiding it from him would be hiding it from the
  // only person likely to look.
  { href: '/health', label: 'System health', roles: ['OWNER', 'OPERATOR'] },
  { href: '/admin/roadmap', label: 'Portal tiles', roles: ['OWNER'] },
  // §13.2 names both roles for the media library. §13.3's video is the
  // operator's own — the owner sees this entry so he can watch the preview,
  // and every control that writes on that page refuses him server-side.
  { href: '/admin/media', label: 'Media', roles: ['OWNER', 'OPERATOR'] },
  { href: '/admin/video', label: 'Video', roles: ['OWNER', 'OPERATOR'] },
  { href: '/admin/settings', label: 'Settings', roles: ['OWNER'] },
]

export function AdminNav({ role }: { role: PrivilegedRole }) {
  const pathname = usePathname()
  const items = ITEMS.filter((item) => item.roles.includes(role))

  return (
    <nav aria-label="Admin sections" className="-mx-1 overflow-x-auto">
      <ul className="flex min-w-max gap-1 px-1">
        {items.map((item) => {
          const active =
            pathname === item.href ||
            (item.href !== '/admin' && pathname.startsWith(`${item.href}/`))

          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={`inline-flex min-h-11 items-center rounded-sm px-3 text-sm font-medium transition-colors ${
                  active
                    ? 'bg-orange/12 text-orange'
                    : 'text-dim hover:text-ftext'
                }`}
              >
                {item.label}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
