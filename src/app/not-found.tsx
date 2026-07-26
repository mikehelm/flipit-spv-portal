import type { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = {
  title: 'Not found — Flipit',
  robots: { index: false, follow: false, nocache: true },
}

/**
 * The page for an address that is not one. BUILD_SPEC §15, §15.1.
 *
 * **It exists because of a Content-Security-Policy, and it should have existed
 * anyway.** Next's built-in 404 is a black-on-white line reading
 * `404 | This page could not be found`, laid out entirely with inline `style`
 * attributes and a bare `<style>` element. Once `style-src` became `'self'` the
 * browser refused every one of them, so that page rendered as unstyled text —
 * found by making a route throw and reading the markup that came back.
 *
 * Widening the policy to rescue a page nobody had written was the wrong way
 * round. §15.1 is built on an investor being able to tell a genuine page from a
 * copy, and the framework's default 404 — no wordmark, no colour, no link to
 * the verification page — is the least recognisable thing this application
 * could show somebody who mistyped a link they were sent about their own money.
 *
 * **It says nothing about what is there.** No path is echoed back, nothing
 * distinguishes a route that does not exist from one the reader may not have,
 * and there is no sign-in prompt: an unauthenticated 404 that invites a
 * password is a phishing pattern, and this page is reached by people who
 * arrived from an email.
 */
export default function NotFound() {
  return (
    <main id="main" className="mx-auto w-full max-w-md px-5 py-16 sm:py-24">
      <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-orange">
        Flipit Global SPV
      </p>
      <h1 className="mt-4 text-2xl font-bold tracking-tight text-white sm:text-3xl">
        There is nothing at this address
      </h1>
      <div className="mt-5 h-[3px] w-12 bg-orange" />

      <p className="mt-6 text-sm leading-relaxed text-dim">
        The link may have been typed slightly differently from the one you were sent, or it
        may have been broken across two lines by whatever you copied it from.
      </p>

      <p className="mt-8 text-xs leading-relaxed text-dim">
        To check that a message claiming to be from us is genuine, see our{' '}
        <Link href="/verify" className="text-orange">
          verification page
        </Link>
        . You can reach it by typing the address, which is the point of it.
      </p>
    </main>
  )
}
