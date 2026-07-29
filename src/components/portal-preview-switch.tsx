'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { JOHN_DOE_PREVIEW_PATH } from '@/lib/portal/demo'

export function PortalPreviewSwitch({
  mode,
}: {
  mode: 'ADMIN' | 'INVESTOR'
}) {
  const investorMode = mode === 'INVESTOR'
  const href = investorMode ? '/admin' : JOHN_DOE_PREVIEW_PATH
  const [nearCorner, setNearCorner] = useState(false)
  const [focused, setFocused] = useState(false)

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

  return (
    <div
      className={`fixed bottom-4 left-14 z-40 transition-all duration-300 motion-reduce:transition-none ${
        nearCorner || focused
          ? 'translate-x-0 opacity-100'
          : '-translate-x-2 opacity-25'
      }`}
      onFocusCapture={() => setFocused(true)}
      onBlurCapture={() => setFocused(false)}
    >
      <Link
        href={href}
        aria-label={
          investorMode
            ? 'Return to the administrator view'
            : 'Preview the portal as demo investor John Doe'
        }
        className="group inline-flex min-h-11 items-center gap-3 rounded-full border hairline bg-bg2/90 px-3 py-2 shadow-lg backdrop-blur-md transition-colors hover:border-orange/50"
      >
        <span
          aria-hidden="true"
          className={`relative h-7 w-12 shrink-0 rounded-full border transition-colors ${
            investorMode ? 'border-orange/60 bg-orange/20' : 'border-edge bg-bg'
          }`}
        >
          <span
            className={`absolute top-1 h-5 w-5 rounded-full shadow-md transition-transform ${
              investorMode
                ? 'translate-x-6 bg-orange'
                : 'translate-x-1 bg-silver2 group-hover:bg-silver1'
            }`}
          />
        </span>
        <span className="text-left leading-tight">
          <span className="block text-[10px] font-bold uppercase tracking-[0.16em] text-orange">
            {investorMode ? 'Investor view' : 'Admin view'}
          </span>
          <span className="block text-xs text-ftext">
            {investorMode ? 'John Doe' : 'View as John Doe'}
          </span>
        </span>
      </Link>
    </div>
  )
}
