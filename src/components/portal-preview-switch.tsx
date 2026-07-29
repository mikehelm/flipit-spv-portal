'use client'

import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { TextSizeButtons } from '@/components/text-size-control'
import { JOHN_DOE_PREVIEW_PATH } from '@/lib/portal/demo'
import type { AdminRole } from '@/lib/roles'

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
interface ViewOption {
  id: ViewId
  name: string
  description: string
  href: string
}
const STORAGE_KEY = 'flipit-current-view-v1'

function isViewId(value: string | null): value is ViewId {
  return VIEWS.some((view) => view.id === value)
}

export function PortalPreviewSwitch({
  mode,
  role,
}: {
  mode: 'ADMIN' | 'INVESTOR'
  role: AdminRole
}) {
  const pathname = usePathname()
  const router = useRouter()
  const rootRef = useRef<HTMLDivElement>(null)
  const [menuPath, setMenuPath] = useState<string | null>(null)
  const [minimized, setMinimized] = useState(false)
  const open = menuPath === pathname

  const routeView: ViewId =
    mode === 'INVESTOR'
      ? 'JOHN'
      : role === 'OPERATOR'
        ? 'DAVID'
        : 'MIKE'
  const [selectedView, setSelectedView] = useState<ViewId | null>(null)
  const currentView = selectedView ?? routeView
  const visibleViews = VIEWS.map((view) =>
    role === 'VIEWER' && view.id === 'JOHN'
      ? {
          ...view,
          name: 'Investor view',
          description: 'Safe John Doe rehearsal',
        }
      : view,
  )
  const current = visibleViews.find((view) => view.id === currentView) ?? visibleViews[0]

  useEffect(() => {
    const saved = window.localStorage.getItem(STORAGE_KEY)
    const initial = isViewId(saved) ? saved : routeView

    const frame = window.requestAnimationFrame(() => {
      setSelectedView(initial)

      if (initial === 'JOHN' && mode !== 'INVESTOR') {
        router.replace(JOHN_DOE_PREVIEW_PATH)
      } else if (initial === 'DAVID' && mode === 'INVESTOR') {
        router.replace('/admin/email-review')
      } else if (initial === 'MIKE' && mode === 'INVESTOR') {
        router.replace('/admin')
      }
    })

    return () => window.cancelAnimationFrame(frame)
  }, [mode, routeView, router])

  useEffect(() => {
    if (!open) return

    const closeOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setMenuPath(null)
    }
    const closeWithEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuPath(null)
    }

    window.addEventListener('pointerdown', closeOutside)
    window.addEventListener('keydown', closeWithEscape)
    return () => {
      window.removeEventListener('pointerdown', closeOutside)
      window.removeEventListener('keydown', closeWithEscape)
    }
  }, [open])

  const minimize = () => {
    setMenuPath(null)
    setMinimized(true)
  }

  const chooseView = (view: ViewOption) => {
    window.localStorage.setItem(STORAGE_KEY, view.id)
    setSelectedView(view.id)
    setMenuPath(null)

    if (view.id === 'JOHN') {
      if (mode !== 'INVESTOR') router.push(JOHN_DOE_PREVIEW_PATH)
      return
    }

    // Mike and David share the admin workspace. Keep the current admin page
    // when switching between them; only choose a start page when leaving the
    // customer experience, where the current route has no admin equivalent.
    if (mode === 'INVESTOR') router.push(view.href)
  }

  return (
    <div
      ref={rootRef}
      className="fixed bottom-4 left-4 z-[70]"
      data-testid="bottom-utility-panel"
    >
      {minimized ? (
        <button
          type="button"
          onClick={() => setMinimized(false)}
          className="min-h-11 rounded-t-md border hairline bg-bg2/96 px-4 py-2 text-[11px] font-bold uppercase tracking-[0.14em] text-orange shadow-2xl backdrop-blur-md hover:border-orange/60 focus-visible:ring-2 focus-visible:ring-orange"
          aria-label="Open view and text tools"
          data-testid="bottom-utility-tab"
        >
          View &amp; text
        </button>
      ) : (
        <aside
          className="relative w-[min(22rem,calc(100vw-2rem))] rounded-md border hairline bg-bg2/96 p-3 shadow-2xl backdrop-blur-md"
          aria-label="View and text tools"
        >
          {open ? (
            <div
              className="absolute bottom-[calc(100%+0.5rem)] left-0 w-full rounded-md border hairline bg-bg2/98 p-2 shadow-2xl backdrop-blur-md"
              role="menu"
              aria-label="Choose a portal view"
            >
              {visibleViews.map((view) => (
                <button
                  key={view.id}
                  type="button"
                  role="menuitem"
                  aria-current={currentView === view.id ? 'page' : undefined}
                  onClick={() => chooseView(view)}
                  className={`flex min-h-11 w-full items-center justify-between gap-4 rounded-sm px-3 py-2 text-left transition-colors hover:bg-orange/10 focus-visible:ring-2 focus-visible:ring-orange ${
                    currentView === view.id
                      ? 'bg-orange/10 text-orange'
                      : 'text-ftext'
                  }`}
                >
                  <span className="font-semibold">{view.name}</span>
                  <span className="text-right text-xs text-dim">
                    {view.description}
                  </span>
                </button>
              ))}
            </div>
          ) : null}

          <div className="mb-2 flex items-center justify-between border-b hairline pb-2">
            <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-dim">
              Page tools
            </span>
            <button
              type="button"
              onClick={minimize}
              className="inline-flex h-8 min-w-8 items-center justify-center rounded-sm border hairline px-2 text-sm text-silver2 hover:border-orange/60 hover:text-orange focus-visible:ring-2 focus-visible:ring-orange"
              aria-label="Minimize view and text tools"
              title="Minimize"
            >
              −
            </button>
          </div>

          <button
            type="button"
            onClick={() => setMenuPath(open ? null : pathname)}
            aria-expanded={open}
            aria-haspopup="menu"
            aria-label="Open the Mike, David, and John Doe view switcher"
            className="group flex min-h-12 w-full items-center justify-between gap-4 rounded-sm px-1 py-2 text-left transition-colors hover:bg-orange/10 focus-visible:ring-2 focus-visible:ring-orange"
          >
            <span className="flex items-center gap-3">
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
              <span className="leading-tight">
                <span className="block text-[10px] font-bold uppercase tracking-[0.16em] text-orange">
                  Current view
                </span>
                <span className="block text-xs text-ftext">{current.name}</span>
              </span>
            </span>
            <span className="text-sm text-dim" aria-hidden="true">
              {open ? '▾' : '▴'}
            </span>
          </button>

          <div className="mt-2 border-t hairline pt-3">
            <TextSizeButtons />
          </div>
        </aside>
      )}
    </div>
  )
}
