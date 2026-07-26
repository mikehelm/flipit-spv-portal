import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  EMAIL_CHANGE_CONFIRMED_MESSAGE,
  EMAIL_CHANGE_FAILED_MESSAGE,
  EMAIL_CHANGE_READ_ONLY_MESSAGE,
  EMAIL_CHANGE_REQUESTED_MESSAGE,
  EMAIL_CHANGE_SAME_ADDRESS_MESSAGE,
  EMAIL_CHANGE_TOKEN_TTL_MINUTES,
  EMAIL_CHANGE_UNREADABLE_MESSAGE,
  isSendableAddress,
  normaliseEmail,
} from './email-change'

/**
 * Changing the contact address. BUILD_SPEC §13, §15.
 *
 * The database-backed proof — that a link actually moves an address, that a
 * second investor's address cannot be taken, that sessions die — lives in
 * `scripts/verify-email-change.ts` against real Postgres, as it does for the
 * rest of the mutation layer. What is tested here is everything that can be
 * decided without a connection: the two pure functions, the copy, and a set of
 * source-level invariants for the rules that would otherwise be enforced only
 * by good intentions.
 */

function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

function moduleSource(relativePath: string): string {
  return withoutComments(readFileSync(join(process.cwd(), relativePath), 'utf8'))
}

const SERVICE = 'src/lib/portal/email-change.ts'
const DELIVERY = 'src/lib/portal/send-email-change-link.ts'
const ROUTE = 'src/app/portal/email-change/[token]/route.ts'
const ACTION = 'src/actions/portal.ts'

// ---------------------------------------------------------------------------
// Normalising
// ---------------------------------------------------------------------------

describe('normaliseEmail', () => {
  it('trims and lower-cases, because every lookup in this application does', () => {
    expect(normaliseEmail('  Alex.Doe@Example.COM ')).toBe('alex.doe@example.com')
  })

  it('leaves an already-normal address alone', () => {
    expect(normaliseEmail('alex@example.com')).toBe('alex@example.com')
  })

  it('is idempotent, so storing a normalised value twice cannot drift', () => {
    const once = normaliseEmail(' MiXeD@Case.Example.com ')
    expect(normaliseEmail(once)).toBe(once)
  })

  it('handles a value that is nothing but whitespace', () => {
    expect(normaliseEmail('   ')).toBe('')
  })
})

// ---------------------------------------------------------------------------
// What we are willing to send to
// ---------------------------------------------------------------------------

describe('isSendableAddress', () => {
  it('accepts ordinary addresses', () => {
    for (const address of [
      'alex@example.com',
      'alex.doe+spv@sub.example.co.uk',
      'obrien@example.ie',
      'a@b.co',
      'serenedavid@gmail.com',
    ]) {
      expect(isSendableAddress(address), address).toBe(true)
    }
  })

  it('refuses anything that could become two recipients in a header', () => {
    // This is the reason the check exists at all. Each of these is a way of
    // smuggling a second address into a `To:` line, and an application that
    // accepts one is an application that can be made to send mail to an
    // arbitrary third party.
    for (const address of [
      'alex@example.com, victim@example.com',
      'alex@example.com; victim@example.com',
      'alex@example.com victim@example.com',
      'Alex <alex@example.com>',
      '"alex"@example.com',
      'alex@example.com\nBcc: victim@example.com',
      'alex@example.com\r\nBcc: victim@example.com',
      'alex\\@example.com@example.com',
    ]) {
      expect(isSendableAddress(address), address).toBe(false)
    }
  })

  it('refuses the shapes that are not an address at all', () => {
    for (const address of [
      '',
      'alex',
      'alex@',
      '@example.com',
      'alex@example',
      'alex@@example.com',
      'alex@.example.com',
      'alex@example.com.',
      'alex@exa..mple.com',
    ]) {
      expect(isSendableAddress(address), address).toBe(false)
    }
  })

  it('accepts a local part right at the limit and refuses one past it', () => {
    expect(isSendableAddress(`${'a'.repeat(64)}@example.com`)).toBe(true)
    expect(isSendableAddress(`${'a'.repeat(65)}@example.com`)).toBe(false)
    expect(isSendableAddress(`${'a'.repeat(320)}@example.com`)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// The copy
// ---------------------------------------------------------------------------

describe('the sentences an investor is shown', () => {
  const investorFacing = [
    EMAIL_CHANGE_REQUESTED_MESSAGE,
    EMAIL_CHANGE_SAME_ADDRESS_MESSAGE,
    EMAIL_CHANGE_UNREADABLE_MESSAGE,
    EMAIL_CHANGE_READ_ONLY_MESSAGE,
    EMAIL_CHANGE_FAILED_MESSAGE,
    EMAIL_CHANGE_CONFIRMED_MESSAGE,
  ]

  it('never mention another investor, an account, or a database word', () => {
    // §15. None of these sentences may hint that the address typed belongs to
    // somebody, that other records exist, or that there is a row anywhere.
    for (const sentence of investorFacing) {
      expect(sentence).not.toMatch(
        /another|other investor|already (in use|taken|registered)|belongs to|someone else|somebody else/i,
      )
      expect(sentence).not.toMatch(/account_id|database|row|token|null|undefined/i)
    }
  })

  it('are complete sentences a person would read', () => {
    for (const sentence of investorFacing) {
      expect(sentence.length).toBeGreaterThan(40)
      expect(sentence.trim()).toMatch(/[.!?]$/)
      expect(sentence).not.toMatch(/\s{2,}/)
    }
  })

  it('promise nothing has changed wherever nothing has', () => {
    for (const sentence of [
      EMAIL_CHANGE_REQUESTED_MESSAGE,
      EMAIL_CHANGE_UNREADABLE_MESSAGE,
      EMAIL_CHANGE_READ_ONLY_MESSAGE,
      EMAIL_CHANGE_FAILED_MESSAGE,
    ]) {
      expect(sentence.toLowerCase()).toContain('changed')
    }
  })

  it('tell the investor the request expires, so a cold link reads as expected', () => {
    expect(EMAIL_CHANGE_REQUESTED_MESSAGE.toLowerCase()).toContain('expires')
  })

  it('are not identical to one another', () => {
    expect(new Set(investorFacing).size).toBe(investorFacing.length)
  })
})

describe('the refusal for an address already held by another record', () => {
  it('is the success sentence, verbatim', () => {
    // The heart of the feature's §15 posture, and the thing most likely to be
    // "improved" by somebody adding a helpful message later. `ADDRESS_TAKEN`
    // has no branch in the action, so the only sentence it can produce is the
    // one returned at the end.
    const action = moduleSource(ACTION)
    expect(action).toContain('EMAIL_CHANGE_REQUESTED_MESSAGE')
    expect(action).not.toMatch(/ADDRESS_TAKEN/)
  })
})

// ---------------------------------------------------------------------------
// Source-level invariants
// ---------------------------------------------------------------------------

describe('the token', () => {
  const source = moduleSource(SERVICE)

  it('is stored hashed and never in plaintext', () => {
    expect(source).toContain('issueToken()')
    expect(source).toContain('tokenHash: hash')
    expect(source).not.toMatch(/tokenHash:\s*token\b/)
  })

  it('is compared in constant time as well as looked up by hash', () => {
    expect(source).toContain('hashToken(token)')
    expect(source).toContain('tokensMatch(token, row.tokenHash)')
  })

  it('is spent by a conditional UPDATE, so two redemptions cannot both win', () => {
    expect(source).toMatch(/isNull\(emailChangeRequests\.confirmedAt\)/)
    expect(source).toContain('db.transaction')
  })

  it('expires', () => {
    expect(EMAIL_CHANGE_TOKEN_TTL_MINUTES).toBeGreaterThan(0)
    expect(EMAIL_CHANGE_TOKEN_TTL_MINUTES).toBeLessThanOrEqual(60)
    expect(source).toContain('expiresAt')
    expect(source).toMatch(/expiresAt\.getTime\(\) <= now\.getTime\(\)/)
  })

  it('never reaches the audit log', () => {
    // `assertNoSecrets` would throw on a key called `token`, but a token passed
    // under an innocent key would sail through. The rule is that no metadata
    // object in this module mentions the variable at all.
    const metadataBlocks = source.match(/metadata:\s*\{[^}]*\}/g) ?? []
    expect(metadataBlocks.length).toBeGreaterThan(0)
    for (const block of metadataBlocks) {
      expect(block).not.toMatch(/\btoken\b/)
      expect(block).not.toMatch(/\bhash\b/)
    }
  })

  it('never reaches the audit log as an address either', () => {
    // An audit log is exported (§20) and read by an operator. Recording which
    // address collided would name another investor; recording either address
    // would put a mailbox in a file whose whole point is being shareable.
    const metadataBlocks = source.match(/metadata:\s*\{[^}]*\}/g) ?? []
    for (const block of metadataBlocks) {
      expect(block).not.toMatch(/[eE]mail/)
    }
  })
})

describe('the confirmation link', () => {
  it('establishes no session', () => {
    // The one line that separates this from a second way into a portal. If a
    // future edit imports the session module here, this fails.
    const route = moduleSource(ROUTE)
    expect(route).not.toContain('createInvestorSession')
    expect(route).not.toContain('portal/session')
  })

  it('lands every failure on the one page with the one message', () => {
    const route = moduleSource(ROUTE)
    const redirects = [...route.matchAll(/NextResponse\.redirect\(`\$\{base\}([^`]*)`\)/g)].map(
      (match) => match[1],
    )
    expect(redirects).toEqual(['/portal/link-not-valid', '/portal/email-confirmed'])
  })

  it('is not reachable by a search engine', () => {
    const page = readFileSync(
      join(process.cwd(), 'src/app/portal/email-confirmed/page.tsx'),
      'utf8',
    )
    expect(page).toContain('robots: { index: false, follow: false, nocache: true }')
  })
})

describe('delivery', () => {
  const source = moduleSource(DELIVERY)

  it('offers no caller anywhere to put a recipient', () => {
    // The invariant that makes this feature safe to expose to an authenticated
    // stranger: every recipient is read off a row by id. A field carrying an
    // address into either exported function would be an open relay with extra
    // steps, so the check is on what those functions can be handed.
    //
    // `notifyPreviousAddress` takes a bare string, and the test asserts it is
    // the request id rather than an address.
    expect(source).toMatch(/notifyPreviousAddress\(requestId: string\)/)

    const inputs = [...source.matchAll(/export interface \w*Input \{([^}]*)\}/g)].map(
      (match) => match[1],
    )
    expect(inputs.length).toBeGreaterThanOrEqual(1)
    for (const fields of inputs) {
      expect(fields).not.toMatch(/^\s*(email|address|to|recipient|newEmail)\s*[?:]/im)
    }

    // The one function that does take an address is private, and is called only
    // with values read from a row two lines above the call.
    expect(source).toMatch(/^async function deliver\(/m)
    expect(source).not.toMatch(/export\s+async\s+function\s+deliver\(/)
  })

  it('reads both mailboxes off the request row', () => {
    expect(source).toContain('request.newEmail')
    expect(source).toContain('request.previousEmail')
  })

  it('goes through the one gated send function', () => {
    expect(source).toContain('sendOneEmail')
    expect(source).not.toMatch(/createTransport|nodemailer/)
  })

  it('logs no address and no body when a send fails', () => {
    const metadataBlocks = source.match(/metadata:\s*\{[^}]*\}/g) ?? []
    expect(metadataBlocks.length).toBeGreaterThan(0)
    for (const block of metadataBlocks) {
      expect(block).not.toMatch(/[eE]mail|body|html|text|subject/)
    }
  })
})

describe('the service', () => {
  const source = moduleSource(SERVICE)

  it('refuses to move an address on anything but a fully open portal', () => {
    // §7. Twice — once when the change is asked for and once when it is
    // confirmed — because the account can be suspended in between.
    const checks = source.match(/access\.capability !== 'FULL'/g) ?? []
    expect(checks.length).toBe(2)
  })

  it('kills every outstanding link and session once the address moves', () => {
    expect(source).toContain('revokeAllPortalAccess(account.id)')
  })

  it('supersedes an outstanding request rather than leaving two live', () => {
    expect(source).toMatch(/set\(\{ revokedAt: now \}\)/)
  })

  it('checks the record still carries the address the request was made against', () => {
    expect(source).toContain('row.previousEmail')
    expect(source).toContain("detail: 'ACCOUNT_MOVED'")
  })

  it('drops the error object on a constraint violation', () => {
    // A Postgres unique-violation message contains the colliding value, which
    // is another investor's address. `catch {` with no binding is the only
    // shape that cannot log it by accident.
    expect(source).toMatch(/\}\s*catch\s*\{/)
    expect(source).not.toMatch(/catch\s*\([^)]+\)\s*\{[\s\S]{0,200}console/)
  })

  it('writes nothing to the console at all', () => {
    expect(source).not.toContain('console.')
  })
})
