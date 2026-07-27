/**
 * A quiet maker credit for the two public front doors.
 *
 * The global text-size control already occupies the literal bottom-right
 * corner, so the credit sits beside it on desktop and just above it on narrow
 * screens. It is deliberately plain text: no logo, colour, link or animation
 * competing with the private-access form.
 */
export function PublicMakerCredit() {
  return (
    <p className="pointer-events-none fixed bottom-20 right-5 z-20 text-[10px] font-medium uppercase tracking-[0.16em] text-muted sm:bottom-7 sm:right-40">
      Made with Mike
    </p>
  )
}
