import type { Metadata } from 'next'
import './globals.css'
import { SiteFooter } from '@/components/site-footer'

export const metadata: Metadata = {
  title: 'Flipit SPV — Investor Portal',
  description: 'Private investor portal for the Flipit Global SPV.',
  // Every route is noindex. The verification page (WP14) opts back in
  // deliberately and is the only exception. BUILD_SPEC §15, §15.1.
  robots: { index: false, follow: false, nocache: true },
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">
        <div className="flex-1">{children}</div>
        <SiteFooter />
      </body>
    </html>
  )
}
