import type { MetadataRoute } from 'next'
import { buildVerificationSitemap } from '@/lib/verify/robots'

export default function sitemap(): MetadataRoute.Sitemap {
  return buildVerificationSitemap()
}
