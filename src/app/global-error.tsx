'use client'

import './globals.css'

/**
 * The last resort: an error thrown by the root layout itself.
 *
 * `error.tsx` renders *inside* the root layout, so it cannot help when the
 * layout is what failed. This one replaces the whole document, which is why it
 * carries its own `<html>` and `<body>` and imports the stylesheet directly —
 * without that import it would be the framework's unstyled default again, and
 * a page with no stylesheet is exactly what the two files beside this one exist
 * to avoid.
 *
 * The realistic way to reach it is a failure in `env()` — the boot-time
 * validation the root layout's children depend on — which means the most likely
 * reader is whoever deployed this rather than an investor. It still says
 * nothing about the fault, because "most likely" is not "only".
 */
export default function GlobalError({ reset }: { error: Error; reset: () => void }) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="flex min-h-full flex-col bg-bg text-ftext">
        <main id="main" className="mx-auto w-full max-w-md px-5 py-16 sm:py-24">
          <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-orange">
            Flipit Global SPV
          </p>
          <h1 className="mt-4 text-2xl font-bold tracking-tight text-white sm:text-3xl">
            This page could not be loaded
          </h1>
          <div className="mt-5 h-[3px] w-12 bg-orange" />

          <p className="mt-6 text-sm leading-relaxed text-dim">
            Nothing has been lost and nothing has been sent anywhere. Try again in a moment.
          </p>

          <p className="mt-8">
            <button
              type="button"
              onClick={reset}
              className="inline-flex min-h-11 items-center rounded-sm bg-orange px-4 text-sm font-semibold text-ink"
            >
              Try again
            </button>
          </p>
        </main>
      </body>
    </html>
  )
}
