import type { Metadata } from 'next'
import { TextSizeControl } from '@/components/text-size-control'
import './globals.css'

const shareTitle = 'Flipit Global SPV — Private Review'
const shareDescription =
  'Invitation-only workspace for organized review and collaboration.'

export const metadata: Metadata = {
  metadataBase: new URL(process.env.APP_URL ?? 'https://spv.flipit.ltd'),
  title: {
    default: shareTitle,
    template: '%s | Flipit Global SPV',
  },
  description: shareDescription,
  icons: {
    icon: [
      { url: '/icon.png', type: 'image/png', sizes: '512x512' },
      { url: '/favicon.ico', type: 'image/x-icon' },
    ],
    apple: [{ url: '/icon.png', type: 'image/png', sizes: '512x512' }],
  },
  openGraph: {
    type: 'website',
    siteName: 'Flipit Global SPV',
    title: shareTitle,
    description: shareDescription,
    images: [
      {
        url: '/icon.png',
        width: 512,
        height: 512,
        alt: 'Private document review workspace',
      },
    ],
  },
  twitter: {
    card: 'summary',
    title: shareTitle,
    description: shareDescription,
    images: ['/icon.png'],
  },
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
/**
 * Every page is rendered per request, and this is a security property rather
 * than a performance one.
 *
 * `src/middleware.ts` puts a fresh nonce in the Content-Security-Policy of
 * every response, and Next stamps that nonce on the script tags it renders —
 * *while it renders them*. A statically prerendered page is rendered once, at
 * build time, when no request and therefore no nonce exists: its inline
 * bootstrap and flight-data scripts carry no nonce, the per-request policy
 * refuses them, and the page arrives looking correct and never hydrating. No
 * error status, no missing markup, nothing in the network tab to see.
 *
 * Four pages were in exactly that position — `/`, `/portal/email-confirmed`,
 * `/portal/link-not-valid` and the built-in `/_not-found`. Marking those four
 * would have fixed those four and left the next static page anybody adds to
 * fail the same silent way. Declaring it here means a page in this application
 * cannot accidentally be static, which is the property worth having.
 *
 * The cost is nil. This is a private portal: every other route already renders
 * per request because it reads a session and a database, nothing here is
 * cacheable by anyone, and the two files that are genuinely static —
 * `robots.ts` and `sitemap.ts` — are route handlers outside this layout, carry
 * no script, and are unaffected.
 */
export const dynamic = 'force-dynamic'

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
        <TextSizeControl />
      </body>
    </html>
  )
}
