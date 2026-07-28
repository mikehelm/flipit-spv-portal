'use client'

import { usePathname } from 'next/navigation'
import { useEffect, useRef } from 'react'

interface Counters {
  pagePath: string
  startedAt: number
  clickCount: number
  rapidClickCount: number
  browserErrorCount: number
  recentClicks: number[]
}

function fresh(pagePath: string): Counters {
  return {
    pagePath,
    startedAt: Date.now(),
    clickCount: 0,
    rapidClickCount: 0,
    browserErrorCount: 0,
    recentClicks: [],
  }
}

export function UsabilityTracker({ basePath = '' }: { basePath?: string }) {
  const pathname = usePathname()
  const counters = useRef<Counters>(fresh(pathname))

  useEffect(() => {
    const send = () => {
      const current = counters.current
      const durationMs = Math.min(
        5 * 60 * 1000,
        Math.max(0, Date.now() - current.startedAt),
      )
      if (
        durationMs < 1000 &&
        current.clickCount === 0 &&
        current.browserErrorCount === 0
      ) {
        return
      }

      const body = JSON.stringify({
        pagePath: current.pagePath,
        durationMs,
        clickCount: current.clickCount,
        rapidClickCount: current.rapidClickCount,
        browserErrorCount: current.browserErrorCount,
      })
      counters.current = fresh(current.pagePath)

      if (navigator.sendBeacon) {
        navigator.sendBeacon(
          `${basePath}/api/usability`,
          new Blob([body], { type: 'application/json' }),
        )
        return
      }
      void fetch(`${basePath}/api/usability`, {
        method: 'POST',
        body,
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        keepalive: true,
      })
    }

    const previous = counters.current
    if (previous.pagePath !== pathname) {
      send()
      counters.current = fresh(pathname)
    }

    const onClick = () => {
      const now = Date.now()
      const current = counters.current
      current.clickCount += 1
      current.recentClicks = current.recentClicks
        .filter((at) => now - at <= 1500)
        .concat(now)
      if (current.recentClicks.length === 3) current.rapidClickCount += 1
    }
    const onError = () => {
      counters.current.browserErrorCount += 1
    }
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') send()
    }

    document.addEventListener('click', onClick, { passive: true })
    window.addEventListener('error', onError)
    window.addEventListener('unhandledrejection', onError)
    document.addEventListener('visibilitychange', onVisibility)
    const interval = window.setInterval(send, 45_000)

    return () => {
      window.clearInterval(interval)
      document.removeEventListener('click', onClick)
      window.removeEventListener('error', onError)
      window.removeEventListener('unhandledrejection', onError)
      document.removeEventListener('visibilitychange', onVisibility)
      send()
    }
  }, [basePath, pathname])

  return null
}
