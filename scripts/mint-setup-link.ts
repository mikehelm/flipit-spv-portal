/**
 * Mints a one-time administrator setup link from the console.
 *
 *   pnpm setup-link mike@flipit.com
 *
 * BUILD_SPEC §2.2: this is how a password gets into the system at all. There is
 * no route that issues one of these to an unauthenticated visitor, which would
 * be a permanent way in. The link is printed here and nowhere else — never
 * emailed, never written to a file, never put in an environment variable — and
 * only its hash is stored, so it cannot be recovered after this runs.
 *
 * Issuing a link revokes any outstanding one for the same address.
 */

import 'dotenv/config'
import { issueAdminSetupLink } from '@/lib/auth/bootstrap'

async function main() {
  const email = process.argv[2]
  if (!email) {
    console.error('Usage: pnpm setup-link <email>')
    process.exit(1)
  }

  const link = await issueAdminSetupLink(email)

  if (process.env.SETUP_LINK_TOKEN_ONLY === '1') {
    // Used by the end-to-end check, which needs the token rather than prose.
    process.stdout.write(new URL(link.url).searchParams.get('token') ?? '')
    process.exit(0)
  }

  console.log('')
  console.log(`  ${link.email}`)
  console.log(`  ${link.url}`)
  console.log(`  expires ${link.expiresAt.toISOString()}`)
  console.log('')
  console.log('  Works once. Not recoverable. Any previous link for this address is revoked.')
  console.log('')
  process.exit(0)
}

void main()
