import type { Metadata } from 'next'
import { renderPortalPage } from '../../page'

export const metadata: Metadata = {
  title: 'David investor preview — Flipit SPV',
  robots: { index: false, follow: false, nocache: true },
}

export default async function DavidInvestorPreviewPage() {
  return renderPortalPage('DAVID')
}
