import type { MetadataRoute } from 'next'
import { buildVerificationRobotsPolicy } from '@/lib/verify/robots'

export default function robots(): MetadataRoute.Robots {
  return buildVerificationRobotsPolicy()
}
