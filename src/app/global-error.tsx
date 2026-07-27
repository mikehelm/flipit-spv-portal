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
 * **Nothing has ever rendered this, and as the application stands nothing can.**
 * This file used to say the realistic way to reach it was a failure in `env()`.
 * That was wrong, and measuring found it: `env()` is called by the layout's
 * *children*, so a failure there renders `error.tsx` — which is now driven by
 * `verify:viewport` against a real database fault — and never reaches this. The
 * root layout imports nothing, awaits nothing and reads nothing. It is markup, a
 * language attribute, a skip link and a `viewport` object, and it cannot throw.
 *
 * So this is a net under a wire nobody walks. It is kept rather than deleted,
 * because it costs nothing, because the framework can call it for a failure that
 * is not this application's code at all, and because the day it *is* reached is
 * the day nothing else in the application is working. What keeps the statement
 * above true is `root-layout-purity.test.ts`: the moment the root layout grows a
 * data read, that test fails and whoever added it has to decide deliberately
 * that a screen nothing has ever rendered is now reachable.
 *
 * It says nothing about the fault, for the same reason `error.tsx` does not.
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
