import Link from 'next/link'
import { CurlCorner } from '@/components/effects/CurlCorner'
import { PublicMakerCredit } from '@/components/public-maker-credit'

/**
 * The public front door is deliberately non-identifying. It does not describe
 * the service, its users, its workflow, its deployment, or its configuration.
 */
export default function Home() {
  return (
    <>
      <CurlCorner />
      <PublicMakerCredit />
      <main
        id="main"
        className="mx-auto flex min-h-[100dvh] w-full max-w-md flex-col justify-center px-5 py-10"
      >
        <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-orange">
          Private access
        </p>

        <h1 className="mt-4 text-4xl font-bold leading-tight tracking-tight text-white">
          Sign in to continue
        </h1>

        <div className="mt-5 h-[3px] w-12 bg-orange" />

        <p className="mt-5 text-sm leading-relaxed text-dim">
          Access is available by invitation.
        </p>

        <div className="mt-8 flex flex-wrap items-center gap-4">
          <Link
            href="/signin"
            className="inline-flex min-h-11 items-center justify-center rounded-sm bg-orange px-5 text-sm font-semibold text-ink transition-colors hover:bg-orange-soft"
          >
            Sign in
          </Link>
          <Link
            href="/access-request"
            className="inline-flex min-h-11 items-center justify-center rounded-sm border hairline px-5 text-sm font-semibold text-ftext transition-colors hover:border-orange"
          >
            Request access
          </Link>
        </div>
      </main>
    </>
  )
}
