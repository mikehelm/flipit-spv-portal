'use client'

/**
 * What a reader gets when something went wrong on the server. §15, §15.1.
 *
 * Same reason as `not-found.tsx`: Next's built-in error page is laid out with
 * inline `style` attributes, which `style-src 'self'` refuses, so it arrived
 * unstyled. And the same argument applies more strongly here — the moment a
 * page fails is the moment somebody looks hardest at what they are looking at,
 * and an unbranded black-on-white failure on a securities portal is the worst
 * possible time to be unrecognisable.
 *
 * **It shows no detail, deliberately.** Not the message, not the stack, not the
 * digest. Next already withholds the message from the client in a production
 * build; this withholds the digest too, because it is an identifier that means
 * something to whoever can read the server log and nothing to the reader, and a
 * page carrying an opaque code invites somebody to send it to a stranger.
 *
 * **"Shows" is exact, and the distinction was found by measuring rather than by
 * reading.** This component does not render the digest. The *response* carries
 * it anyway, twice, in the flight payload, because the framework puts it there
 * for the client boundary and nothing here can take it out. Everything else is
 * genuinely absent, and that is what `verify:viewport` now asserts — against the
 * whole response rather than against the rendered text, which is the distinction
 * `everythingSent` exists for: no message, no stack frame, no table name, no
 * connection string, no path on the server, no address.
 *
 * **And nothing is drawn until hydration.** An error boundary must be a client
 * component, so the 500 arrives with an empty body and this page appears when
 * the script runs. A reader with JavaScript disabled gets a blank page under a
 * 500 rather than the sentence below. That is the framework's shape rather than
 * a choice made here, and it is measured so that it is at least known.
 *
 * A retry, and nothing else. There is no automatic redirect to sign-in: an
 * investor whose portal failed to render should not be bounced to a form asking
 * for their address.
 */
export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  return (
    <main id="main" className="mx-auto w-full max-w-md px-5 py-16 sm:py-24">
      <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-orange">
        Flipit Global SPV
      </p>
      <h1 className="mt-4 text-2xl font-bold tracking-tight text-white sm:text-3xl">
        Something went wrong at our end
      </h1>
      <div className="mt-5 h-[3px] w-12 bg-orange" />

      <p className="mt-6 text-sm leading-relaxed text-dim">
        Nothing you were doing has been lost, and nothing has been sent anywhere. Try again;
        if it keeps happening, tell us rather than working around it.
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
  )
}
