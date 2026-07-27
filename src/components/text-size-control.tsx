'use client'

import { useEffect, useState } from 'react'

const STORAGE_KEY = 'flipit-text-scale'
const TEXT_SCALES = [1, 1.5, 2, 2.5] as const
const DEFAULT_TEXT_SCALE = 2

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

    setScale(initial)
    applyTextScale(initial)
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
      className="mt-4 border-t hairline pt-4"
      aria-label="Text size"
      data-testid="text-size-control"
    >
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs font-semibold text-dim">Text size</span>
        <output className="text-xs font-bold tabular-nums text-orange" aria-live="polite">
          {scale}×
        </output>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => choose(TEXT_SCALES[Math.max(0, currentIndex - 1)])}
          disabled={currentIndex <= 0}
          className="inline-flex min-h-11 items-center justify-center rounded-sm border hairline text-sm font-semibold text-ftext transition-colors hover:border-orange disabled:cursor-not-allowed disabled:opacity-35"
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
          className="inline-flex min-h-11 items-center justify-center rounded-sm border hairline text-lg font-semibold text-ftext transition-colors hover:border-orange disabled:cursor-not-allowed disabled:opacity-35"
          aria-label="Make text larger"
        >
          A+
        </button>
      </div>
    </div>
  )
}
