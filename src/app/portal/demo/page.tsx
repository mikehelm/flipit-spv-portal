import type { Metadata } from 'next'
import { renderPortalPage } from '../page'

export const metadata: Metadata = {
  title: 'John Doe demo — Flipit SPV',
  robots: { index: false, follow: false, nocache: true },
}

/**
 * This route is intentionally static and contains no identity in the URL.
 * `renderPortalPage(true)` applies the acting-admin guard before selecting the
 * synthetic record, so knowing the path grants nothing.
 */
export default async function JohnDoeDemoPage() {
  return renderPortalPage(true)
}
