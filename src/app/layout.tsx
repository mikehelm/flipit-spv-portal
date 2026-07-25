import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Flipit SPV — Investor Portal',
  description: 'Private investor portal for the Flipit Global SPV.',
  // Every route is noindex. The verification page (WP14) opts back in
  // deliberately and is the only exception. BUILD_SPEC §15, §15.1.
  robots: { index: false, follow: false, nocache: true },
}

/**
 * The root layout carries the palette, the language and the document shape.
 *
 * It deliberately does **not** carry the footer. The footer reads service
 * configuration to decide whether the maker's credit shows on this surface
 * (§13.2), and a database read in the root layout would make every static page
 * dynamic — including the anti-phishing page at `/verify`, which WP14 wants
 * reachable and cacheable when somebody is checking whether an email is real.
 * The admin shell and the investor portal render their own; see
 * `attribution.test.ts`.
 *
 * `viewport` is set here rather than per page. Without it a phone renders the
 * page at 980px and scales it down, which is the single commonest reason a
 * "mobile-first" build is nonetheless unreadable on a phone — §13.2.
 */
export const viewport = {
  width: 'device-width',
  initialScale: 1,
  // Not capped. Pinch-zoom on a page carrying somebody's investment figures is
  // not ours to disable — WCAG 1.4.4.
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="flex min-h-full flex-col bg-bg text-ftext">
        <a href="#main" className="skip-link">
          Skip to content
        </a>
        <div className="flex-1">{children}</div>
      </body>
    </html>
  )
}
