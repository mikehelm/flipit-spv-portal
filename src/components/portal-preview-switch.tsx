'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { JOHN_DOE_PREVIEW_PATH } from '@/lib/portal/demo'
import type { PrivilegedRole } from '@/lib/roles'

const VIEWS = [
  {
    id: 'MIKE',
    name: 'Mike',
    description: 'Owner overview',
    href: '/admin',
  },
  {
    id: 'DAVID',
    name: 'David',
    description: 'Email review workspace',
    href: '/admin/email-review',
  },
  {
    id: 'JOHN',
    name: 'John Doe',
    description: 'Investor preview',
    href: JOHN_DOE_PREVIEW_PATH,
  },
] as const

type ViewId = (typeof VIEWS)[number]['id']

export function PortalPreviewSwitch({
  mode,
  role,
}: {
  mode: 'ADMIN' | 'INVESTOR'
  role: PrivilegedRole
}) {
  const pathname = usePathname()
  const rootRef = useRef<HTMLDivElement>(null)
  const [nearCorner, setNearCorner] = useState(false)
  const [focused, setFocused] = useState(false)
  const [open, setOpen] = useState(false)

  const currentView: ViewId =
    mode === 'INVESTOR'
      ? 'JOHN'
      : pathname.startsWith('/admin/email-review') || role === 'OPERATOR'
        ? 'DAVID'
        : 'MIKE'
  const current = VIEWS.find((view) => view.id === currentView) ?? VIEWS[0]

  useEffect(() => {
    const revealNearCorner = (event: PointerEvent) => {
      setNearCorner(
        event.clientX <= Math.min(440, window.innerWidth * 0.45) &&
          event.clientY >= window.innerHeight - 220,
      )
    }

    window.addEventListener('pointermove', revealNearCorner, { passive: true })
    return () => window.removeEventListener('pointermove', revealNearCorner)
  }, [])

  useEffect(() => {
    setOpen(false)
  }, [pathname])

  useEffect(() => {
    if (!open) return

    const closeOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const closeWithEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }

    window.addEventListener('pointerdown', closeOutside)
    window.addEventListener('keydown', closeWithEscape)
    return () => {
      window.removeEventListener('pointerdown', closeOutside)
      window.removeEventListener('keydown', closeWithEscape)
    }
  }, [open])

  return (
    <div
      ref={rootRef}
      className={`fixed bottom-4 left-14 z-40 transition-all duration-300 motion-reduce:transition-none ${
        nearCorner || focused || open
          ? 'translate-x-0 opacity-100'
          : '-translate-x-2 opacity-25'
      }`}
      onFocusCapture={() => setFocused(true)}
      onBlurCapture={() => setFocused(false)}
    >
      {open ? (
        <div
          className="absolute bottom-[calc(100%+0.5rem)] left-0 w-[min(22rem,calc(100vw-4.5rem))] rounded-sm border hairline bg-bg2/96 p-2 shadow-2xl backdrop-blur-md"
          role="menu"
          aria-label="Choose a portal view"
        >
          {VIEWS.map((view) => (
            <Link
              key={view.id}
              href={view.href}
              role="menuitem"
              aria-current={currentView === view.id ? 'page' : undefined}
              onClick={() => setOpen(false)}
              className={`flex min-h-11 items-center justify-between gap-4 rounded-sm px-3 py-2 transition-colors hover:bg-orange/10 ${
                currentView === view.id ? 'bg-orange/10 text-orange' : 'text-ftext'
              }`}
            >
              <span className="font-semibold">{view.name}</span>
              <span className="text-right text-xs text-dim">{view.description}</span>
            </Link>
          ))}
        </div>
      ) : null}

      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label="Open the Mike, David, and John Doe view switcher"
        className="group inline-flex min-h-11 items-center gap-3 rounded-full border hairline bg-bg2/90 px-3 py-2 shadow-lg backdrop-blur-md transition-colors hover:border-orange/50"
      >
        <span
          aria-hidden="true"
          className={`relative h-7 w-12 shrink-0 rounded-full border transition-colors ${
            currentView === 'JOHN'
              ? 'border-orange/60 bg-orange/20'
              : 'border-edge bg-bg'
          }`}
        >
          <span
            className={`absolute top-1 h-5 w-5 rounded-full shadow-md transition-transform ${
              currentView === 'JOHN'
                ? 'translate-x-6 bg-orange'
                : currentView === 'DAVID'
                  ? 'translate-x-3 bg-orange-soft'
                  : 'translate-x-1 bg-silver2 group-hover:bg-silver1'
            }`}
          />
        </span>
        <span className="text-left leading-tight">
          <span className="block text-[10px] font-bold uppercase tracking-[0.16em] text-orange">
            Current view
          </span>
          <span className="block text-xs text-ftext">{current.name}</span>
        </span>
      </button>
    </div>
  )
}
