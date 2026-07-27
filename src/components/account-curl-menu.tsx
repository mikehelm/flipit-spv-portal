import type { ReactNode } from 'react'
import { CurlCorner } from '@/components/effects/CurlCorner'
import { TextSizeControl } from '@/components/text-size-control'

/**
 * The account controls live physically beneath the signature page curl.
 *
 * The large fold remains decorative; the concealed Account label and the
 * native details/summary control make the interaction discoverable with a
 * mouse, keyboard or screen reader.
 */
export function AccountCurlMenu({
  name,
  email,
  roleLabel,
  children,
}: {
  name: string
  email: string
  roleLabel: string
  children: ReactNode
}) {
  return (
    <details className="group pointer-events-none fixed right-0 top-0 z-50 h-96 w-[min(23rem,100vw)]">
      <summary
        data-testid="account-curl-toggle"
        className="pointer-events-auto absolute right-0 top-0 z-50 h-28 w-32 cursor-pointer list-none rounded-bl-3xl focus-visible:ring-2 focus-visible:ring-orange [&::-webkit-details-marker]:hidden"
        aria-label="Account details"
      >
        <CurlCorner
          intro={false}
          activationRadius={380}
          className="![--curl-size:290px] sm:![--curl-size:330px] !z-20"
        />
        <span className="absolute right-40 top-20 z-10 -translate-y-1 translate-x-1 rounded-full border border-orange/35 bg-bg2/80 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.16em] text-orange opacity-0 shadow-lg backdrop-blur-md transition-all duration-300 group-hover:translate-x-0 group-hover:translate-y-0 group-hover:bg-bg2 group-hover:opacity-100 group-focus-within:translate-x-0 group-focus-within:translate-y-0 group-focus-within:opacity-100 group-open:translate-x-0 group-open:translate-y-0 group-open:bg-orange group-open:text-ink group-open:opacity-100 sm:right-32">
          <span className="group-open:hidden">Account</span>
          <span className="hidden group-open:inline">Close</span>
        </span>
      </summary>

      <section
        data-testid="account-curl-panel"
        className="pointer-events-auto absolute right-4 top-24 z-10 hidden w-[min(19rem,calc(100vw-2rem))] rounded-sm border border-orange/25 bg-bg2/96 p-4 pt-6 shadow-2xl backdrop-blur-md group-hover:block group-focus-within:block group-open:block"
        aria-label="Account details"
      >
        <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-orange">
          Your account
        </p>
        <p className="mt-2 break-words text-base font-semibold text-ftext">{name}</p>
        <p className="mt-1 break-words text-xs text-dim">{email}</p>
        <p className="mt-1 text-xs text-silver2">{roleLabel}</p>
        <div className="mt-4 border-t hairline pt-4">{children}</div>
        <TextSizeControl />
      </section>
    </details>
  )
}
