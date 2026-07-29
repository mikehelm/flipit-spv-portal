import { MakerCreditText } from '@/components/maker-credit-text'

/**
 * A quiet maker credit for the two public front doors.
 *
 * The global text-size control already occupies the literal bottom-right
 * corner, so the credit sits beside it on desktop and just above it on narrow
 * screens. It is deliberately plain text with no logo, container, link or
 * animation competing with the private-access form.
 */
export function PublicMakerCredit() {
  return (
    <p className="pointer-events-none fixed bottom-20 right-5 z-20 text-[10px] font-medium tracking-[0.04em] sm:bottom-7 sm:right-40">
      <MakerCreditText />
    </p>
  )
}
