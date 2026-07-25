import type { NextConfig } from 'next'

/**
 * basePath is read from the environment from the first commit.
 *
 * The application runs under "/SPV" on the testing deployment before it runs
 * at a domain root in production, so every internal link, asset path, cookie
 * path and OAuth callback has to respect it. Retrofitting this later is the
 * kind of change that breaks links quietly. BUILD_SPEC §18.1.
 */
const basePath = process.env.BASE_PATH ?? ''

if (basePath !== '' && (!basePath.startsWith('/') || basePath.endsWith('/'))) {
  throw new Error(
    `BASE_PATH must be empty or start with "/" and not end with "/". Received: ${basePath}`,
  )
}

const nextConfig: NextConfig = {
  basePath: basePath === '' ? undefined : basePath,
  reactStrictMode: true,
  poweredByHeader: false,
}

export default nextConfig
