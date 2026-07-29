import type { Metadata } from 'next'
import { renderPortalPage } from '../../page'

export const metadata: Metadata = {
  title: 'Tohu investor preview — Flipit SPV',
  robots: { index: false, follow: false, nocache: true },
}

export default async function TohuInvestorPreviewPage() {
  return renderPortalPage('TOHU')
}
