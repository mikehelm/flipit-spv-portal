'use client'

import { useEffect, useState } from 'react'

const STORAGE_KEY = 'flipit-text-scale-v2'
const TEXT_SCALES = [1, 1.25, 1.5, 1.75, 2] as const
const DEFAULT_TEXT_SCALE = 1.5

function applyTextScale(scale: number) {
  document.documentElement.style.setProperty('--user-text-scale', String(scale))
}

export function TextSizeControl() {
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
    <aside
      className="group pointer-events-auto fixed bottom-5 right-5 z-[70] rounded-full border border-orange/35 bg-bg2/82 p-1.5 shadow-2xl backdrop-blur-md transition-all duration-200 hover:bg-bg2 focus-within:bg-bg2 focus:bg-bg2"
      aria-label="Text size"
      role="group"
      tabIndex={0}
      title="Hover or focus to adjust text size"
      data-testid="text-size-control"
    >
      <div className="flex items-center gap-1.5">
        <div className="invisible flex max-w-0 items-center gap-1 overflow-hidden opacity-0 transition-all duration-200 group-hover:visible group-hover:max-w-28 group-hover:opacity-100 group-focus-within:visible group-focus-within:max-w-28 group-focus-within:opacity-100">
          <button
            type="button"
            onClick={() => choose(TEXT_SCALES[Math.max(0, currentIndex - 1)])}
            disabled={currentIndex <= 0}
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full border hairline text-[13px] font-semibold text-ftext transition-colors hover:border-orange disabled:cursor-not-allowed disabled:opacity-35"
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
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full border hairline text-[16px] font-semibold text-ftext transition-colors hover:border-orange disabled:cursor-not-allowed disabled:opacity-35"
            aria-label="Make text larger"
          >
            A+
          </button>
        </div>
        <span className="whitespace-nowrap px-2 text-[12px] font-bold uppercase tracking-[0.12em] text-orange">
          Text{' '}
          <output className="tabular-nums" aria-live="polite">
            {Math.round(scale * 100)}%
          </output>
        </span>
      </div>
    </aside>
  )
}
