import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { hashToken, issueToken } from '@/lib/crypto'
import { resetEnvCache } from '@/lib/env'
import {
  absoluteUrl,
  buildPortalLink,
  buildVerificationLink,
  PORTAL_CLAIM_PATH,
  PREVIEW_CLAIM_TOKEN,
  VERIFICATION_PATH,
} from '@/lib/email/variables'

/**
 * What an investor link is allowed to contain. BUILD_SPEC §15, AC5, AC9.
 *
 * AC5 — *"Investor links reveal no personal data in the URL"* — is a claim
 * about a string, and until now it was only ever tested sideways: through the
 * email that carries the link, or the route that redeems it. This file tests
 * the string.
 *
 * A URL is the least private thing in an email. It is in the browser's history,
 * the referrer header, the proxy log, the screen share and the forwarded reply.
 * A claim link that carried `?email=alex@example.com` would leak the recipient
 * list of a private securities round into all of them at once, and the round's
 * recipient list is the thing §15 exists to protect.
 *
 * So the rule is stronger than "no name in the URL": the link is a fixed path
 * and one opaque token, the token is random rather than derived, and what the
 * database holds is the token's SHA-256 hash (`src/lib/crypto.ts`), so even a
 * reader of the row cannot reconstruct what was in the email.
 */

// ---------------------------------------------------------------------------
// One investor, made of strings that could not appear in a URL by accident
// ---------------------------------------------------------------------------

const investor = {
  name: 'Ptolemaia Quenneville-Ashbourne',
  email: 'ptolemaia.quenneville@ashbourne-holdings.example',
  accountId: 'acct_zanzibar_9f2c4b',
  offerId: 'offer_kilimanjaro_41d8e7',
  proposedAmountUsd: '2500000.00',
  spvPercentage: '16.666667',
  jurisdiction: 'GB',
}

/**
 * Every form the value could take on its way into a URL: as written, cased
 * either way, percent-encoded, base64, base64url and hex. A leak that had been
 * "helpfully" encoded first would still be a leak.
 */
function encodings(value: string): string[] {
  return [
    value,
    value.toLowerCase(),
    value.toUpperCase(),
    encodeURIComponent(value),
    encodeURIComponent(value).toLowerCase(),
    Buffer.from(value, 'utf8').toString('base64'),
    Buffer.from(value, 'utf8').toString('base64url'),
    Buffer.from(value, 'utf8').toString('hex'),
  ]
}

function leaks(haystack: string, needle: string): boolean {
  return (
    haystack.includes(needle) || haystack.toLowerCase().includes(needle.toLowerCase())
  )
}

/**
 * Scan a whole URL, token and all, for every encoding of every value.
 *
 * Only for values of four characters or more. A shorter needle encodes to a
 * two- or three-character form, a random 43-character token contains any given
 * pair about one run in a hundred, and a test that fails one run in a hundred
 * teaches people to re-run it. Short values are checked against `composed`
 * below instead, which is the part of the URL this application actually writes.
 */
function expectAbsent(url: string, values: readonly string[]): void {
  for (const value of values) {
    const tooShort = `${value} is too short to scan a random token for`
    expect(value.length, tooShort).toBeGreaterThanOrEqual(4)
    for (const form of encodings(value)) {
      expect(leaks(url, form), `${value} appears in ${url} as "${form}"`).toBe(false)
    }
  }
}

/** A claim link with the token cut out: everything the application composed. */
function composed(token: string): string {
  return buildPortalLink(token).replace(token, '')
}

const APP_URL = 'https://spv.flipit.com'
const ORIGINAL_ENV = { ...process.env }

function deployedAt(appUrl: string, basePath = ''): void {
  process.env.APP_URL = appUrl
  process.env.BASE_PATH = basePath
  resetEnvCache()
}

afterEach(() => {
  process.env = { ...ORIGINAL_ENV }
  resetEnvCache()
})

// ---------------------------------------------------------------------------
// Source reading, for the checks a value cannot make
// ---------------------------------------------------------------------------

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8')

function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

const PORTAL_ROUTES = 'src/app/portal'

interface PortalFile {
  path: string
  source: string
}

function walk(dir: string): string[] {
  const found: string[] = []
  for (const entry of readdirSync(join(process.cwd(), dir), { withFileTypes: true })) {
    const next = join(dir, entry.name)
    if (entry.isDirectory()) found.push(...walk(next))
    else found.push(next)
  }
  return found
}

function portalFiles(): PortalFile[] {
  return walk(PORTAL_ROUTES)
    .filter((path) => path.endsWith('.ts') || path.endsWith('.tsx'))
    .map((path) => ({ path, source: withoutComments(read(path)) }))
}

/** Every `[segment]` directory name under the portal tree. */
function dynamicSegments(): string[] {
  const segments = new Set<string>()
  for (const file of portalFiles()) {
    for (const part of relative(PORTAL_ROUTES, file.path).split(/[\\/]/)) {
      if (part.startsWith('[')) segments.add(part)
    }
  }
  return [...segments].sort()
}

// ---------------------------------------------------------------------------
// AC5 — the claim link
// ---------------------------------------------------------------------------

describe('a claim link carries a token and nothing about the person it went to', () => {
  it('takes a token, and has no parameter for anything else', () => {
    // A second parameter — for the name, the offer, the amount, the account —
    // is how this rule gets broken. There is none, and this is what fails if
    // one is added.
    expect(buildPortalLink.length).toBe(1)
  })

  it('reveals no part of the recipient’s name or address, in any encoding', () => {
    const token = issueToken().token
    const url = buildPortalLink(token)

    expectAbsent(url, [
      investor.name,
      'Ptolemaia',
      'Quenneville',
      'Ashbourne',
      investor.email,
      // Half an address identifies a person as well as the whole of it does.
      'ptolemaia.quenneville',
      'ashbourne-holdings.example',
      'ashbourne-holdings',
    ])

    // An address needs an `@`, and the part of the URL this application writes
    // has none — nor a percent-encoded one.
    expect(composed(token)).not.toContain('@')
    expect(composed(token).toLowerCase()).not.toContain('%40')
  })

  it('reveals no offer id, account id, amount or percentage', () => {
    const token = issueToken().token
    const url = buildPortalLink(token)

    expectAbsent(url, [
      investor.offerId,
      'kilimanjaro',
      investor.accountId,
      'zanzibar',
      investor.proposedAmountUsd,
      '2500000',
      '2,500,000',
      investor.spvPercentage,
      '16.666667',
    ])

    // No figure of any kind: no percent sign, no currency, no run of digits
    // outside the token.
    expect(composed(token)).not.toMatch(/[%$£€\d]/)
  })

  it('reveals no jurisdiction', () => {
    // A jurisdiction code is two characters, and a random 43-character token
    // will occasionally contain any given pair. The token is asserted to be
    // opaque below; here it is cut out first, so this is a statement about the
    // part of the URL the application composes.
    const url = composed(issueToken().token)

    for (const code of [investor.jurisdiction, 'US', 'SG', 'TH', 'CH']) {
      expect(leaks(url, code), `${code} appears in ${url}`).toBe(false)
    }
    expect(leaks(url, 'jurisdiction')).toBe(false)
  })

  it('is the claim path and the token, with nothing appended', () => {
    const token = issueToken().token
    const url = buildPortalLink(token)

    expect(url).toBe(`${APP_URL}${PORTAL_CLAIM_PATH}/${token}`)

    const parsed = new URL(url)
    // No query string and no fragment at all — not an empty one, none. Those
    // are where a "just this once" extra field would go.
    expect(parsed.search).toBe('')
    expect(parsed.hash).toBe('')
    expect(parsed.username).toBe('')
    expect(parsed.password).toBe('')
    expect(parsed.pathname.split('/').filter(Boolean)).toEqual([
      'portal',
      'claim',
      token,
    ])
  })

  it('differs between two invitations only in the token', () => {
    const one = issueToken().token
    const two = issueToken().token
    const prefix = `${APP_URL}${PORTAL_CLAIM_PATH}/`

    expect(buildPortalLink(one)).toBe(`${prefix}${one}`)
    expect(buildPortalLink(two)).toBe(`${prefix}${two}`)
    expect(buildPortalLink(one)).not.toBe(buildPortalLink(two))
  })

  it('is the same fixed string for every admin preview, and mints nothing', () => {
    // A preview is a read, and reads do not issue credentials.
    const url = buildPortalLink(PREVIEW_CLAIM_TOKEN)
    expect(url).toBe(`${APP_URL}${PORTAL_CLAIM_PATH}/${PREVIEW_CLAIM_TOKEN}`)
    expect(Buffer.from(PREVIEW_CLAIM_TOKEN, 'base64url').length).not.toBe(32)
    expectAbsent(url, [investor.name, investor.email, investor.offerId])
  })
})

// ---------------------------------------------------------------------------
// The token itself
// ---------------------------------------------------------------------------

describe('the token in the URL is opaque', () => {
  it('is 256 bits of randomness, well past the 128 §15 requires', () => {
    const { token } = issueToken()
    expect(Buffer.from(token, 'base64url').length).toBe(32)
    expect(Buffer.from(token, 'base64url').length * 8).toBeGreaterThanOrEqual(128)
  })

  it('is URL-safe throughout, so nothing about it needs escaping', () => {
    // If a token ever needed percent-encoding to survive a URL, it would mean
    // it had picked up structure — a separator, a prefix, a readable field.
    for (let i = 0; i < 50; i++) {
      const { token } = issueToken()
      expect(token).toMatch(/^[A-Za-z0-9_-]+$/)
      expect(encodeURIComponent(token)).toBe(token)
    }
  })

  it('is drawn fresh for every link, never derived from the account', () => {
    const seen = new Set<string>()
    for (let i = 0; i < 300; i++) seen.add(issueToken().token)
    expect(seen.size).toBe(300)
  })

  it('is stored as a hash, so the emailed URL cannot be rebuilt from the row', () => {
    // `src/lib/crypto.ts`: `issueToken` returns the token and its SHA-256, and
    // only the hash is written. A reader of `portal_tokens` — a leaked backup,
    // an export, the owner — holds the hash and cannot turn it back into the
    // link that was sent.
    const { token, hash } = issueToken()
    const url = buildPortalLink(token)

    expect(hash).not.toBe(token)
    expect(url).not.toContain(hash)
    expect(hash).not.toContain(token)
    expect(buildPortalLink(hash)).not.toBe(url)

    // And it is a real one-way function of the token, not a reversible encoding
    // of it: the token does not survive a base64url decode of the hash.
    expect(Buffer.from(hash, 'base64url').toString('utf8')).not.toContain(token)
    expect(hashToken(token)).toBe(hash)
  })

  it('is not a column anywhere — the table holds token_hash and nothing else', () => {
    const schema = withoutComments(read('src/db/schema.ts'))
    const table = /export const portalTokens = pgTable\(([\s\S]*?)\n\)/.exec(schema)?.[1]
    expect(table).toBeTruthy()
    expect(table).toContain("tokenHash: text('token_hash')")
    expect(table).not.toMatch(/text\('token'\)/)
    expect(table).not.toMatch(/\btoken:\s*text\(/)
  })

  it('is looked up by its hash, so the raw value never reaches a query', () => {
    const source = withoutComments(read('src/lib/portal/claim.ts'))
    expect(source).toContain('eq(portalTokens.tokenHash, hashToken(token))')
    expect(source).not.toMatch(/eq\(portalTokens\.token\b(?!Hash)/)
  })
})

// ---------------------------------------------------------------------------
// The deployment the link points at — §18.1
// ---------------------------------------------------------------------------

describe('a link always points at the configured deployment', () => {
  it('is built from APP_URL, base path included', () => {
    deployedAt('https://spv.flipit.com/SPV', '/SPV')
    expect(buildPortalLink('tok')).toBe('https://spv.flipit.com/SPV/portal/claim/tok')
    expect(buildVerificationLink()).toBe('https://spv.flipit.com/SPV/verify')
  })

  it('follows APP_URL to a different host without any edit here', () => {
    deployedAt('https://staging.flipit.example')
    expect(buildPortalLink('tok')).toBe('https://staging.flipit.example/portal/claim/tok')
  })

  it('trims a trailing slash rather than doubling it', () => {
    deployedAt('https://spv.flipit.com///')
    expect(buildPortalLink('tok')).toBe('https://spv.flipit.com/portal/claim/tok')
    expect(absoluteUrl('portal')).toBe('https://spv.flipit.com/portal')
    expect(absoluteUrl('/portal')).toBe('https://spv.flipit.com/portal')
  })

  it('names no host of its own, so a link cannot outlive a move', () => {
    const source = withoutComments(read('src/lib/email/variables.ts'))
    expect(source).not.toMatch(/https?:\/\//)
    expect(source).toContain('env().APP_URL')
  })

  it('cannot be pointed at a host a caller supplied', () => {
    // The token reaches `buildPortalLink` from a row, a queue or — one day —
    // somewhere less careful. Whatever it contains, the link stays on this
    // deployment: the token is percent-encoded into a single path segment, so
    // a slash, a scheme, a query or a fragment cannot escape it.
    const hostile = [
      'https://evil.example/steal',
      '//evil.example',
      '../../../etc/passwd',
      'tok?next=https://evil.example',
      'tok#evil',
      'tok/../../portal',
      'tok&email=ptolemaia@ashbourne-holdings.example',
    ]

    for (const token of hostile) {
      const parsed = new URL(buildPortalLink(token))
      expect(parsed.host, token).toBe('spv.flipit.com')
      expect(parsed.protocol, token).toBe('https:')
      expect(parsed.search, token).toBe('')
      expect(parsed.hash, token).toBe('')
      expect(parsed.pathname.startsWith(`${PORTAL_CLAIM_PATH}/`), token).toBe(true)
      // One segment after the claim path, whatever was handed in.
      expect(parsed.pathname.split('/').filter(Boolean), token).toHaveLength(3)
    }
  })
})

// ---------------------------------------------------------------------------
// The verification link — §15.1
// ---------------------------------------------------------------------------

describe('the verification link is the same shape and names nobody', () => {
  it('takes no arguments at all, so there is nothing per-recipient to pass', () => {
    expect(buildVerificationLink.length).toBe(0)
  })

  it('is byte-identical in every email sent to everyone', () => {
    expect(buildVerificationLink()).toBe(buildVerificationLink())
    expect(buildVerificationLink()).toBe(absoluteUrl(VERIFICATION_PATH))
    expect(buildVerificationLink()).toBe(`${APP_URL}${VERIFICATION_PATH}`)
  })

  it('carries no token, no query and no fragment', () => {
    const parsed = new URL(buildVerificationLink())
    expect(parsed.search).toBe('')
    expect(parsed.hash).toBe('')
    expect(parsed.pathname.split('/').filter(Boolean)).toEqual(['verify'])
    expectAbsent(buildVerificationLink(), [
      investor.name,
      investor.email,
      investor.accountId,
      investor.offerId,
    ])
  })
})

// ---------------------------------------------------------------------------
// AC9, the URL-shaped half — coming back later
// ---------------------------------------------------------------------------

describe('signing back in later uses a link of the same shape', () => {
  it('builds the sign-in link from the token alone, never from the account', () => {
    const source = withoutComments(read('src/lib/portal/send-sign-in-link.ts'))
    expect(source).toContain('buildPortalLink(input.token)')
    expect(source).not.toMatch(/buildPortalLink\(\s*account/)
    expect(source).not.toMatch(/buildPortalLink\([^)]*email/)
  })

  it('reaches the same route, which redeems a sign-in token as well as a claim', () => {
    // This is why a returning investor needs nothing of the original email:
    // the fresh link is the same path with a fresh token behind it.
    const source = withoutComments(read('src/lib/portal/claim.ts'))
    expect(source).toContain("row.purpose !== 'CLAIM' && row.purpose !== 'SIGN_IN'")
  })

  it('is indistinguishable from a claim link to anyone reading it', () => {
    const claim = buildPortalLink(issueToken().token)
    const signIn = buildPortalLink(issueToken().token)
    const shape = (url: string) => url.slice(0, url.lastIndexOf('/'))

    expect(shape(signIn)).toBe(shape(claim))
    expect(signIn).not.toBe(claim)
    expectAbsent(signIn, [investor.email, investor.name, investor.accountId])
  })
})

// ---------------------------------------------------------------------------
// The routes behind the links
// ---------------------------------------------------------------------------

describe('no portal route accepts anything but a token in its URL', () => {
  it('has exactly two dynamic segments, both opaque identifiers', () => {
    // If a route ever appears as `[email]`, `[accountId]` or `[offerId]`, the
    // personal datum is in the URL by construction and no amount of care in
    // the link builders can take it back out.
    expect(dynamicSegments()).toEqual(['[certificateId]', '[token]'])

    for (const segment of dynamicSegments()) {
      expect(segment, segment).toMatch(/^\[(token|certificateId)\]$/)
      // No catch-all: `[...path]` would accept whatever was appended to it.
      expect(segment.startsWith('[...') || segment.startsWith('[[...'), segment).toBe(
        false,
      )
      expect(segment, segment).not.toMatch(
        /email|address|account|offer|investor|name|amount|percent|jurisdiction/i,
      )
    }
  })

  it('types every route parameter as one opaque string', () => {
    const declared = new Set<string>()
    for (const file of portalFiles()) {
      for (const match of file.source.matchAll(/params:\s*Promise<\{([^}]*)\}>/g)) {
        for (const field of match[1].split(',')) {
          const name = field.split(':')[0].trim()
          if (name !== '') declared.add(name)
        }
      }
    }
    expect([...declared].sort()).toEqual(['certificateId', 'token'])
  })

  it('reads no search parameter anywhere in the portal', () => {
    // A query parameter is the easy way to smuggle an address into a URL, and
    // the portal reads none — the account comes from the session cookie.
    const files = portalFiles()
    // A walk that found nothing would pass every check below it.
    expect(files.length).toBeGreaterThanOrEqual(5)

    for (const file of files) {
      expect(file.source, file.path).not.toMatch(/searchParams/)
      expect(file.source, file.path).not.toMatch(/URLSearchParams/)
      expect(file.source, file.path).not.toMatch(/nextUrl\.search/)
      expect(file.source, file.path).not.toMatch(/\.get\(\s*['"](email|account|offer)/i)
    }
  })

  it('redirects only to fixed paths on this deployment', () => {
    const source = withoutComments(read('src/app/portal/claim/[token]/route.ts'))
    // A failed claim goes to one page with one message, and a successful one to
    // the portal root. Neither carries the token onward into a referrer header.
    expect(source).toContain('`${base}/portal/link-not-valid`')
    expect(source).toContain('`${base}/portal`')
    expect(source).not.toMatch(/redirect\([^)]*token/)
  })
})
