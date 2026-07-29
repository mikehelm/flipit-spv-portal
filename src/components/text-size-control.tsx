'use client'

import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'

const STORAGE_KEY = 'flipit-text-scale-v2'
const TEXT_SCALES = [1, 1.25, 1.5, 1.75, 2] as const
const DEFAULT_TEXT_SCALE = 1.5
const COMBINED_PANEL_PREFIXES = [
  '/access-requests',
  '/admin',
  '/audit',
  '/compliance',
  '/follow-up',
  '/health',
  '/import',
  '/investors',
  '/more',
  '/portal',
  '/questions',
  '/recipients',
  '/register',
  '/reminders',
  '/round',
  '/templates',
  '/updates',
] as const

function applyTextScale(scale: number) {
  document.documentElement.style.setProperty('--user-text-scale', String(scale))
}

export function TextSizeButtons() {
  const [scale, setScale] = useState(DEFAULT_TEXT_SCALE)

  useEffect(() => {
    const saved = Number(window.localStorage.getItem(STORAGE_KEY))
    const initial = TEXT_SCALES.includes(saved as (typeof TEXT_SCALES)[number])
      ? saved
      : DEFAULT_TEXT_SCALE

    const frame = window.requestAnimationFrame(() => {
      setScale(initial)
      applyTextScale(initial)
    })
    return () => window.cancelAnimationFrame(frame)
  }, [])

  const choose = (next: number) => {
    setScale(next)
    applyTextScale(next)
    window.localStorage.setItem(STORAGE_KEY, String(next))
  }

  const currentIndex = TEXT_SCALES.indexOf(
    scale as (typeof TEXT_SCALES)[number],
  )

  return (
    <div
      className="flex items-center justify-between gap-4"
      role="group"
      aria-label="Text size"
      data-testid="text-size-buttons"
    >
      <span className="leading-tight">
        <span className="block text-[10px] font-bold uppercase tracking-[0.16em] text-orange">
          Text size
        </span>
        <output
          className="block text-xs tabular-nums text-ftext"
          aria-live="polite"
        >
          {Math.round(scale * 100)}%
        </output>
      </span>

      <span className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => choose(TEXT_SCALES[Math.max(0, currentIndex - 1)])}
          disabled={currentIndex <= 0}
          className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full border hairline text-[13px] font-semibold text-ftext transition-colors hover:border-orange focus-visible:ring-2 focus-visible:ring-orange disabled:cursor-not-allowed disabled:opacity-35"
          aria-label="Make text smaller"
        >
          A−
        </button>
        <button
          type="button"
          onClick={() =>
            choose(TEXT_SCALES[Math.min(TEXT_SCALES.length - 1, currentIndex + 1)])
          }
          disabled={currentIndex >= TEXT_SCALES.length - 1}
          className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full border hairline text-[16px] font-semibold text-ftext transition-colors hover:border-orange focus-visible:ring-2 focus-visible:ring-orange disabled:cursor-not-allowed disabled:opacity-35"
          aria-label="Make text larger"
        >
          A+
        </button>
      </span>
    </div>
  )
}

/**
 * Pages without the role-aware view switcher still receive the same
 * bottom-left utility treatment for text sizing.
 */
export function TextSizeControl() {
  const pathname = usePathname()
  const [minimized, setMinimized] = useState(false)
  const usesCombinedPanel = COMBINED_PANEL_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  )

  if (usesCombinedPanel) return null

  return (
    <div
      className="fixed bottom-4 left-4 z-[70]"
      data-testid="text-size-control"
    >
      {minimized ? (
        <button
          type="button"
          onClick={() => setMinimized(false)}
          className="min-h-11 rounded-t-md border hairline bg-bg2/96 px-4 py-2 text-[11px] font-bold uppercase tracking-[0.14em] text-orange shadow-2xl backdrop-blur-md hover:border-orange/60 focus-visible:ring-2 focus-visible:ring-orange"
          aria-label="Open text tools"
        >
          Text tools
        </button>
      ) : (
        <aside
          className="w-[min(20rem,calc(100vw-2rem))] rounded-md border hairline bg-bg2/96 p-3 shadow-2xl backdrop-blur-md"
          aria-label="Text tools"
        >
          <div className="mb-3 flex items-center justify-between border-b hairline pb-2">
            <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-dim">
              Page tools
            </span>
            <button
              type="button"
              onClick={() => setMinimized(true)}
              className="inline-flex h-8 min-w-8 items-center justify-center rounded-sm border hairline px-2 text-sm text-silver2 hover:border-orange/60 hover:text-orange focus-visible:ring-2 focus-visible:ring-orange"
              aria-label="Minimize page tools"
              title="Minimize"
            >
              −
            </button>
          </div>
          <TextSizeButtons />
        </aside>
      )}
    </div>
  )
}
