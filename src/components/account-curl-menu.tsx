'use client'

import { usePathname } from 'next/navigation'
import { type FocusEvent, type ReactNode, useEffect, useRef, useState } from 'react'
import { CurlCorner } from '@/components/effects/CurlCorner'

/**
 * The account controls live physically beneath the signature page curl.
 *
 * Hover and focus reveal the panel without making it sticky. A click pins it
 * open when somebody wants to move the pointer away, and route changes, Escape
 * or a click outside close it again.
 */
export function AccountCurlMenu({
  name,
  email,
  roleLabel,
  children,
}: {
  name: string
  email: string
  roleLabel: string
  children: ReactNode
}) {
  const pathname = usePathname()
  const rootRef = useRef<HTMLDivElement>(null)
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const [open, setOpen] = useState(false)
  const visible = hovered || focused || open

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

  const leaveFocus = (event: FocusEvent<HTMLDivElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
      setFocused(false)
    }
  }

  return (
    <div
      ref={rootRef}
      className="group pointer-events-none fixed right-0 top-0 z-50 h-96 w-[min(23rem,100vw)]"
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      onFocusCapture={() => setFocused(true)}
      onBlurCapture={leaveFocus}
    >
      <button
        type="button"
        data-testid="account-curl-toggle"
        className="pointer-events-auto absolute right-0 top-0 z-50 h-28 w-32 cursor-pointer rounded-bl-3xl focus-visible:ring-2 focus-visible:ring-orange"
        aria-label={open ? 'Close account details' : 'Open account details'}
        aria-expanded={visible}
        aria-controls="account-curl-panel"
        onClick={() => setOpen((value) => !value)}
      >
        <CurlCorner
          intro={false}
          activationRadius={380}
          className="![--curl-size:290px] sm:![--curl-size:330px] !z-20"
        />
        <span
          className={`absolute right-40 top-20 z-10 -translate-y-1 translate-x-1 rounded-full border border-orange/35 bg-bg2/80 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.16em] text-orange shadow-lg backdrop-blur-md transition-all duration-300 sm:right-32 ${
            visible
              ? 'translate-x-0 translate-y-0 bg-bg2 opacity-100'
              : 'opacity-0'
          } ${open ? 'bg-orange text-ink' : ''}`}
        >
          {open ? 'Close' : 'Account'}
        </span>
      </button>

      <section
        id="account-curl-panel"
        data-testid="account-curl-panel"
        hidden={!visible}
        className="pointer-events-auto absolute right-4 top-24 z-10 w-[min(19rem,calc(100vw-2rem))] rounded-sm border border-orange/25 bg-bg2/96 p-4 pt-6 shadow-2xl backdrop-blur-md"
        aria-label="Account details"
      >
        <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-orange">
          Your account
        </p>
        <p className="mt-2 break-words text-base font-semibold text-ftext">{name}</p>
        <p className="mt-1 break-words text-xs text-dim">{email}</p>
        <p className="mt-1 text-xs text-silver2">{roleLabel}</p>
        <div className="mt-4 border-t hairline pt-4">{children}</div>
      </section>
    </div>
  )
}
