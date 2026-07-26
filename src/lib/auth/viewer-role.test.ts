import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { canAct, isAdminRole, isPrivileged, isViewer, ROLE_LABELS, VIEWER_BANNER } from '@/lib/roles'

/**
 * The read-only administrator. BUILD_SPEC §2, §20.
 *
 * A third role was added to an application whose entire admin surface already
 * assumed two, and where one of the two can send securities solicitations. The
 * danger was never writing the role — it was that around forty existing guards
 * already asked "is somebody signed in", and a role added carelessly would have
 * answered yes to all forty at once.
 *
 * So these tests are almost all negative. They assert what a viewer *cannot*
 * reach, and they are written to fail if a later change widens the role by
 * accident rather than on purpose.
 */

function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

function read(relativePath: string): string {
  return withoutComments(readFileSync(join(process.cwd(), relativePath), 'utf8'))
}

/** Every .ts/.tsx file under a directory. */
function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(join(process.cwd(), dir))) {
    const rel = `${dir}/${entry}`
    if (statSync(join(process.cwd(), rel)).isDirectory()) walk(rel, out)
    else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(rel)
  }
  return out
}

// ---------------------------------------------------------------------------
// The type is the control
// ---------------------------------------------------------------------------

describe('PrivilegedRole', () => {
  it('has exactly two members, and VIEWER is not one of them', () => {
    // The single most important assertion in this file. Every mutation guard
    // in the application takes a `PrivilegedRole`; adding a third member here
    // would open all of them at once, silently.
    const source = read('src/lib/roles.ts')
    const match = /export type PrivilegedRole = ([^\n]+)/.exec(source)
    expect(match).not.toBeNull()
    expect(match![1].trim()).toBe("'OWNER' | 'OPERATOR'")
  })

  it('AdminRole is the wider one, and it is what sign-in resolves to', () => {
    const source = read('src/lib/roles.ts')
    expect(source).toContain("export type AdminRole = PrivilegedRole | 'VIEWER'")
    expect(source).toContain('export function resolveRole(email: string | null | undefined): AdminRole | null')
  })
})

describe('canAct', () => {
  it('admits the two roles that may write', () => {
    expect(canAct('OWNER')).toBe(true)
    expect(canAct('OPERATOR')).toBe(true)
  })

  it('refuses a viewer', () => {
    expect(canAct('VIEWER')).toBe(false)
  })

  it('refuses anything it has never heard of', () => {
    // An allowlist, not `!isViewer(role)`. A fourth role added later gets no
    // capability by accident — it fails closed.
    for (const role of [null, undefined, '', 'ADMIN', 'INVESTOR', 'owner', 'Owner', 'SUPERUSER']) {
      expect(canAct(role), String(role)).toBe(false)
    }
  })

  it('is what isPrivileged now means, so the older name did not drift', () => {
    for (const role of ['OWNER', 'OPERATOR', 'VIEWER', 'nonsense', null]) {
      expect(isPrivileged(role), String(role)).toBe(canAct(role))
    }
  })
})

describe('isViewer and isAdminRole', () => {
  it('identify the viewer without admitting them anywhere', () => {
    expect(isViewer('VIEWER')).toBe(true)
    expect(isViewer('OWNER')).toBe(false)
    expect(isAdminRole('VIEWER')).toBe(true)
    expect(isAdminRole('INVESTOR')).toBe(false)
    expect(isAdminRole(null)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// The guards
// ---------------------------------------------------------------------------

describe('currentAdmin', () => {
  const guards = read('src/lib/auth/guards.ts')

  it('cannot return a viewer', () => {
    // The line every one of the forty existing call sites depends on.
    const body = guards.slice(
      guards.indexOf('export async function currentAdmin('),
      guards.indexOf('export async function requireAdmin('),
    )
    expect(body).toContain('if (!canAct(identity.role)) return null')
  })

  it('is typed so the compiler enforces it too', () => {
    expect(guards).toContain('export async function currentAdmin(): Promise<ActingAdmin | null>')
    expect(guards).toContain('export type ActingAdmin = AdminIdentity & { role: PrivilegedRole }')
  })

  it('is what the acting guards are built from', () => {
    for (const fn of ['requireAdmin', 'requirePasswordSet', 'requireOwner', 'requireOperator', 'requireOnboardedAdmin']) {
      expect(guards, fn).toContain(`export async function ${fn}(): Promise<ActingAdmin>`)
    }
  })
})

describe('requireAdmin, meeting a viewer', () => {
  const guards = read('src/lib/auth/guards.ts')
  const body = guards.slice(
    guards.indexOf('export async function requireAdmin('),
    guards.indexOf('export async function requireReader('),
  )

  it('refuses rather than pretending they are signed out', () => {
    expect(body).toContain('isViewer(identity.role)')
    expect(body).toContain('redirect(NO_ACCESS_PATH)')
  })

  it('logs the refusal — §22 AC19', () => {
    expect(body).toContain("action: 'access.refused'")
  })

  it('logs no secret with it', () => {
    const metadata = body.match(/metadata:\s*\{[^}]*\}/g) ?? []
    expect(metadata.length).toBeGreaterThan(0)
    for (const block of metadata) {
      expect(block).not.toMatch(/password|token|hash|secret/i)
    }
  })
})

// ---------------------------------------------------------------------------
// What a viewer may reach — an allowlist, checked both ways
// ---------------------------------------------------------------------------

/**
 * §20 scope B: every investor by name, all four amounts, documents, the Q&A
 * thread and status history. Deliberately NOT the audit log, the export, the
 * compliance approval, settings, the import, or the register's computed order.
 */
const READABLE = [
  'src/app/(admin)/admin/page.tsx',
  'src/app/(admin)/recipients/page.tsx',
  'src/app/(admin)/recipients/[offerId]/page.tsx',
  'src/app/(admin)/investors/page.tsx',
  'src/app/(admin)/questions/page.tsx',
  'src/app/(admin)/questions/[entryId]/page.tsx',
  'src/app/(admin)/round/page.tsx',
  'src/app/(admin)/updates/page.tsx',
]

/**
 * The other reason a surface may be open to a viewer, and it is not §20 scope.
 *
 * A password and a second factor belong to the **account**, not to the role.
 * These files were closed to a viewer by `requireAdmin()`, and the effect was
 * not caution: the one account whose whole session is sight of every named
 * investor's financial position was the one account that could not put a second
 * factor in front of that sight, or even choose the first password it needs to
 * sign in at all.
 *
 * The widening is safe on one condition, so the condition is asserted below
 * rather than trusted: **each of these touches `users` at the acting account's
 * own id and no other table.** A file added to this list that writes anywhere
 * else fails the suite.
 */
const OWN_ACCOUNT = [
  'src/app/(admin)/admin/security/page.tsx',
  'src/app/(account)/admin/password/page.tsx',
  'src/actions/second-factor.ts',
  'src/actions/password.ts',
]

describe('the pages opened to a viewer', () => {
  it('each ask for a reader, and only these do', () => {
    const all = walk('src/app/(admin)')
      .concat(walk('src/app/(account)'))
      .concat(walk('src/actions'))
    const asking = all.filter((f) => /\brequireReader\b/.test(read(f)))

    // The layout is the ninth: the shell must render or a viewer cannot reach
    // anything. The document route is the tenth and uses currentIdentity. The
    // last two are the account's own surfaces, which are not §20 scope at all.
    const expected = new Set([
      ...READABLE,
      'src/app/(admin)/layout.tsx',
      'src/app/(admin)/admin/security/page.tsx',
      'src/actions/second-factor.ts',
    ])
    for (const file of asking) {
      expect(expected.has(file), `${file} opened itself to a viewer`).toBe(true)
    }
    for (const file of READABLE) {
      expect(asking.includes(file), `${file} is no longer open to a viewer`).toBe(true)
    }
  })
})

describe("the account's own surfaces, which a viewer may reach", () => {
  it('exist, so the list below is not silently empty', () => {
    for (const file of OWN_ACCOUNT) {
      expect(read(file).length, file).toBeGreaterThan(0)
    }
  })

  it('import no database table but `users`', () => {
    // The whole justification for admitting a viewer here. A file on this list
    // that reaches for `offers`, `recipients` or `investorAccounts` is handing
    // a read-only administrator a lever over records, whatever its guard says.
    for (const file of OWN_ACCOUNT) {
      const imported = /from '@\/db\/schema'/.test(read(file))
        ? (read(file).match(/import \{([^}]*)\} from '@\/db\/schema'/)?.[1] ?? '')
        : ''
      const tables = imported
        .split(',')
        .map((name) => name.trim())
        .filter(Boolean)
      expect(tables, `${file} imports a table other than users`).toEqual(
        tables.filter((t) => t === 'users'),
      )
    }
  })

  it('write only to the row of whoever is acting', () => {
    // Every `.where(eq(users.id, X))` must name the acting identity. `pending`
    // is the half-authenticated identity behind the second-factor form and is
    // the same person by another name.
    for (const file of OWN_ACCOUNT) {
      const targets = [...read(file).matchAll(/eq\(users\.id,\s*([\w.]+)\)/g)].map(
        (m) => m[1],
      )
      for (const target of targets) {
        expect(['admin.id', 'pending.id', 'identity.id'], `${file} → ${target}`).toContain(
          target,
        )
      }
    }
  })

  it('never reach for an acting guard, which would refuse the viewer again', () => {
    for (const file of OWN_ACCOUNT) {
      expect(read(file), `${file} still asks an acting question`).not.toMatch(
        /\brequireAdmin\b|\brequireOwner\b|\brequireOperator\b|\brequireOnboardedAdmin\b/,
      )
    }
  })
})

describe('the surfaces a viewer must never reach', () => {
  const CLOSED = [
    ['the audit log', 'src/app/(admin)/audit/page.tsx'],
    ['the recipient export', 'src/app/(admin)/export/recipients/route.ts'],
    ['the compliance approval', 'src/app/(admin)/compliance/page.tsx'],
    ['settings', 'src/app/(admin)/admin/settings/page.tsx'],
    ['the import', 'src/app/(admin)/import/page.tsx'],
    ['the register order', 'src/app/(admin)/register/page.tsx'],
    ['reminders', 'src/app/(admin)/reminders/page.tsx'],
    ['the acknowledgement wording', 'src/app/(admin)/admin/acknowledgements/page.tsx'],
  ] as const

  for (const [what, file] of CLOSED) {
    it(`${what} does not ask for a reader`, () => {
      expect(read(file)).not.toMatch(/\brequireReader\b/)
    })
  }
})

describe('every server action', () => {
  it('is behind a guard that a viewer cannot pass', () => {
    // Actions are where the damage would be. Each must reach an acting guard —
    // requireOwner, requireOperator, requireAdmin — or currentAdmin, all four
    // of which are now closed to a viewer. None may call requireReader or
    // currentIdentity.
    const actions = walk('src/actions')
      .filter((f) => read(f).includes("'use server'"))
      // The two exceptions, and they are exceptions by proof rather than by
      // assertion: `OWN_ACCOUNT` above establishes that both touch `users` at
      // the acting id and nothing else, so admitting a viewer gives them
      // authority over their own sign-in and over nothing in the application.
      .filter((f) => !OWN_ACCOUNT.includes(f))
    expect(actions.length).toBeGreaterThan(10)

    for (const file of actions) {
      const source = read(file)
      expect(source, `${file} uses a read-only guard`).not.toMatch(/\brequireReader\b/)
      expect(source, `${file} uses currentIdentity`).not.toMatch(/\bcurrentIdentity\b/)
      expect(source, `${file} uses the account guard`).not.toMatch(/\brequireOwnAccount\b/)
      expect(
        /\brequireOwner\b|\brequireOperator\b|\brequireAdmin\b|\brequireOnboardedAdmin\b|\brequirePasswordSet\b|\bcurrentAdmin\b|\brequireImportActor\b|\breadInvestorAccount\b/.test(source),
        `${file} reaches no guard at all`,
      ).toBe(true)
    }
  })

  it('and the one indirect guard is itself closed to a viewer', () => {
    // `import.ts` delegates to `requireImportActor`, so the allowance above is
    // only sound while that function asks the acting question. The import path
    // creates investor records; this is the one worth pinning.
    const authz = read('src/lib/import/authz.ts')
    expect(authz).toContain('currentAdmin')
    expect(authz).not.toMatch(/\bcurrentIdentity\b/)
    expect(authz).not.toMatch(/\brequireReader\b/)
  })
})

describe('currentIdentity — the one function that hands back a viewer', () => {
  it('is called in exactly the places that mean to', () => {
    const all = walk('src/app').concat(walk('src/actions'), walk('src/lib'), walk('src/components'))
    const callers = all.filter((f) => /\bcurrentIdentity\(/.test(read(f)))
    expect(callers.sort()).toEqual(
      [
        'src/app/(admin)/import/page.tsx',
        'src/app/(admin)/investors/[offerId]/document/[documentId]/route.ts',
        'src/lib/auth/guards.ts',
      ].sort(),
    )
  })

  it('decides nothing on the import page — it only picks a sentence', () => {
    // The import page is the third caller and the newest, and it is the one
    // that could go wrong quietly. `requireImportActor` refuses a viewer by
    // throwing; the identity is read afterwards, inside the catch, purely to
    // avoid telling somebody who is signed in to sign in. If the identity ever
    // reaches the render, it has become an authorization input on the page that
    // creates investor records.
    const source = read('src/app/(admin)/import/page.tsx')

    const refusalAt = source.indexOf('await requireImportActor()')
    const identityAt = source.indexOf('await currentIdentity()')
    expect(refusalAt, 'the import no longer calls its own guard').toBeGreaterThan(-1)
    expect(identityAt, 'the identity is read before the refusal').toBeGreaterThan(refusalAt)

    const markup = source.slice(source.lastIndexOf('return ('))
    expect(markup, 'the identity reaches the markup').not.toMatch(/\bidentity\b/)
    expect(markup, 'the wizard is no longer behind the refusal').toContain(
      'refusal ?',
    )
  })
})

// ---------------------------------------------------------------------------
// Being told
// ---------------------------------------------------------------------------

describe('the banner', () => {
  it('says what the access is, and that it is watched', () => {
    expect(VIEWER_BANNER.toLowerCase()).toContain('read-only')
    expect(VIEWER_BANNER.toLowerCase()).toContain('cannot change')
    expect(VIEWER_BANNER.toLowerCase()).toContain('recorded')
  })

  it('renders on every admin screen, from the shell', () => {
    const layout = read('src/app/(admin)/layout.tsx')
    expect(layout).toContain("admin.role === 'VIEWER'")
    expect(layout).toContain('VIEWER_BANNER')
  })

  it('names the role in the header rather than mislabelling it', () => {
    expect(ROLE_LABELS.VIEWER).toBe('Read-only')
    expect(new Set(Object.values(ROLE_LABELS)).size).toBe(3)
  })
})

describe('the allowlist', () => {
  it('has its own environment variable, empty by default', () => {
    const env = read('src/lib/env.ts')
    expect(env).toContain("VIEWER_EMAILS: z.string().default('')")
    expect(env).toContain('viewerEmails: splitList(value.VIEWER_EMAILS)')
  })

  it('resolves owner and operator ahead of viewer', () => {
    // An address on two lists is a misconfiguration. Resolving downward would
    // quietly demote somebody out of their own application.
    const source = read('src/lib/roles.ts')
    const owner = source.indexOf('ownerEmails.includes')
    const operator = source.indexOf('operatorEmails.includes')
    const viewer = source.indexOf('viewerEmails.includes')
    expect(owner).toBeLessThan(operator)
    expect(operator).toBeLessThan(viewer)
  })
})
