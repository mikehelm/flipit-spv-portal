'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import type { AdminRole } from '@/lib/roles'

interface NavItem {
  href: string
  label: string
  roles: AdminRole[]
}

interface MenuSection {
  label?: string
  items: NavItem[]
}

interface Menu {
  id: string
  label: string
  sections: MenuSection[]
}

const OVERVIEW: NavItem = {
  href: '/admin',
  label: 'Overview',
  roles: ['OWNER', 'OPERATOR', 'VIEWER'],
}

const MENUS: Menu[] = [
  {
    id: 'work',
    label: 'Investor work',
    sections: [
      {
        items: [
          {
            href: '/recipients',
            label: 'Review and send',
            roles: ['OWNER', 'OPERATOR', 'VIEWER'],
          },
          {
            href: '/investors',
            label: 'Investors',
            roles: ['OWNER', 'OPERATOR', 'VIEWER'],
          },
          {
            href: '/access-requests',
            label: 'Access requests',
            roles: ['OWNER', 'OPERATOR'],
          },
          { href: '/import', label: 'Import', roles: ['OWNER', 'OPERATOR'] },
          { href: '/register', label: 'Register', roles: ['OWNER', 'OPERATOR'] },
          {
            href: '/round',
            label: 'The round',
            roles: ['OWNER', 'OPERATOR', 'VIEWER'],
          },
        ],
      },
    ],
  },
  {
    id: 'communication',
    label: 'Communication',
    sections: [
      {
        items: [
          {
            href: '/templates',
            label: 'Email templates',
            roles: ['OWNER', 'OPERATOR'],
          },
          {
            href: '/admin/email-review',
            label: 'David’s email review',
            roles: ['OWNER', 'OPERATOR'],
          },
          {
            href: '/updates',
            label: 'Updates',
            roles: ['OWNER', 'OPERATOR', 'VIEWER'],
          },
          {
            href: '/questions',
            label: 'Questions',
            roles: ['OWNER', 'OPERATOR', 'VIEWER'],
          },
          { href: '/reminders', label: 'Reminders', roles: ['OWNER', 'OPERATOR'] },
          {
            href: '/admin/media',
            label: 'Media library',
            roles: ['OWNER', 'OPERATOR'],
          },
          {
            href: '/admin/video',
            label: 'Personal video',
            roles: ['OWNER', 'OPERATOR'],
          },
        ],
      },
    ],
  },
  {
    id: 'manage',
    label: 'Manage',
    sections: [
      {
        label: 'Account and system',
        items: [
          {
            href: '/admin/security',
            label: 'Two-factor security',
            roles: ['OWNER', 'OPERATOR', 'VIEWER'],
          },
          {
            href: '/admin/password',
            label: 'Password',
            roles: ['OWNER', 'OPERATOR', 'VIEWER'],
          },
          { href: '/health', label: 'System health', roles: ['OWNER', 'OPERATOR'] },
        ],
      },
      {
        label: 'Just for Mike',
        items: [
          { href: '/compliance', label: 'Compliance approvals', roles: ['OWNER'] },
          {
            href: '/admin/acknowledgements',
            label: 'Acknowledgement wording',
            roles: ['OWNER'],
          },
          { href: '/admin/invites', label: 'David’s access', roles: ['OWNER'] },
          { href: '/audit', label: 'Audit log', roles: ['OWNER'] },
          { href: '/admin/roadmap', label: 'Portal tiles', roles: ['OWNER'] },
          { href: '/admin/settings', label: 'Settings', roles: ['OWNER'] },
        ],
      },
      {
        label: 'Just for David',
        items: [{ href: '/admin/onboarding', label: 'My setup', roles: ['OPERATOR'] }],
      },
    ],
  },
]

function isActive(pathname: string, href: string): boolean {
  return pathname === href || (href !== '/admin' && pathname.startsWith(`${href}/`))
}

export function AdminNav({ role }: { role: AdminRole }) {
  const pathname = usePathname()
  const navRef = useRef<HTMLElement>(null)
  const [opened, setOpened] = useState<{ id: string; pathname: string } | null>(null)
  const openMenu = opened?.pathname === pathname ? opened.id : null

  const menus = MENUS.map((menu) => ({
    ...menu,
    sections: menu.sections
      .map((section) => ({
        ...section,
        items: section.items.filter((item) => item.roles.includes(role)),
      }))
      .filter((section) => section.items.length > 0),
  })).filter((menu) => menu.sections.length > 0)

  useEffect(() => {
    const closeOutside = (event: PointerEvent) => {
      if (!navRef.current?.contains(event.target as Node)) setOpened(null)
    }
    const closeWithEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpened(null)
    }

    document.addEventListener('pointerdown', closeOutside)
    document.addEventListener('keydown', closeWithEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOutside)
      document.removeEventListener('keydown', closeWithEscape)
    }
  }, [])

  return (
    <nav ref={navRef} aria-label="Admin sections">
      <ul className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
        <li>
          <Link
            href={OVERVIEW.href}
            aria-current={isActive(pathname, OVERVIEW.href) ? 'page' : undefined}
            onClick={() => setOpened(null)}
            className={`flex min-h-11 items-center justify-center rounded-sm border px-4 text-sm font-semibold transition-colors ${
              isActive(pathname, OVERVIEW.href)
                ? 'border-orange/40 bg-orange/12 text-orange'
                : 'hairline bg-bg2 text-dim hover:border-orange/40 hover:text-ftext'
            }`}
          >
            Overview
          </Link>
        </li>

        {menus.map((menu, index) => {
          const items = menu.sections.flatMap((section) => section.items)
          const active = items.some((item) => isActive(pathname, item.href))
          const open = openMenu === menu.id
          const alignRight = index === menus.length - 1

          return (
            <li key={menu.id} className="relative">
              <button
                type="button"
                aria-expanded={open}
                aria-controls={`admin-menu-${menu.id}`}
                onClick={() =>
                  setOpened(open ? null : { id: menu.id, pathname })
                }
                className={`flex min-h-11 w-full items-center justify-center gap-2 rounded-sm border px-4 text-sm font-semibold transition-colors sm:w-auto ${
                  active || open
                    ? 'border-orange/40 bg-orange/12 text-orange'
                    : 'hairline bg-bg2 text-dim hover:border-orange/40 hover:text-ftext'
                }`}
              >
                {menu.label}
                <span
                  aria-hidden="true"
                  className={`text-[9px] transition-transform ${open ? 'rotate-180' : ''}`}
                >
                  ▼
                </span>
              </button>

              {open ? (
                <div
                  id={`admin-menu-${menu.id}`}
                  className={`absolute top-[calc(100%+0.45rem)] z-30 w-[min(22rem,calc(100vw-2rem))] rounded-sm border hairline bg-bg2/98 p-3 shadow-2xl backdrop-blur-md ${
                    alignRight ? 'right-0' : 'left-0'
                  }`}
                >
                  {menu.sections.map((section, sectionIndex) => (
                    <section
                      key={section.label ?? `${menu.id}-${sectionIndex}`}
                      className={sectionIndex > 0 ? 'mt-3 border-t hairline pt-3' : ''}
                    >
                      {section.label ? (
                        <p className="px-2 pb-1 text-[10px] font-bold uppercase tracking-[0.18em] text-orange">
                          {section.label}
                        </p>
                      ) : null}
                      <ul className="grid grid-cols-1 gap-1 sm:grid-cols-2">
                        {section.items.map((item) => {
                          const itemActive = isActive(pathname, item.href)
                          return (
                            <li key={item.href}>
                              <Link
                                href={item.href}
                                aria-current={itemActive ? 'page' : undefined}
                                onClick={() => setOpened(null)}
                                className={`flex min-h-11 items-center rounded-sm px-3 text-sm transition-colors ${
                                  itemActive
                                    ? 'bg-orange/12 font-semibold text-orange'
                                    : 'text-dim hover:bg-white/5 hover:text-ftext'
                                }`}
                              >
                                {item.label}
                              </Link>
                            </li>
                          )
                        })}
                      </ul>
                    </section>
                  ))}
                </div>
              ) : null}
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
