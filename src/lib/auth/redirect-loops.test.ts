import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  NO_ACCESS_PATH,
  PASSWORD_PATH,
  SECOND_FACTOR_PATH,
  SIGN_IN_PATH,
} from '@/lib/auth/guards'
import { canAct, type AdminRole } from '@/lib/roles'

/**
 * No page may be guarded by a check that sends it back to itself.
 *
 * This file exists because two such pages were live at once, and neither showed
 * up in a suite of 2,312 tests. Both were found by starting the server and
 * asking it for a URL.
 *
 *   - `/admin/password` rendered inside the admin shell, and the shell guards
 *     itself with `requireReader()`, which sends an account with no password to
 *     `/admin/password`. So **every** administrator redeeming their first setup
 *     link — the owner included — bounced between that path and itself and
 *     could never choose a password in a browser. It is the only route by which
 *     a password enters this system at all (§2.2, "First run").
 *   - `/admin/no-access` guarded itself with `requireAdmin()`, which refuses a
 *     viewer by redirecting to `/admin/no-access`. A read-only administrator
 *     touching any owner-only link bounced for ever, and `requireAdmin()` wrote
 *     an `access.refused` audit row on every hop — an unbounded write to the
 *     table that is meant to be the reliable account of what happened. Six
 *     requests produced fifteen rows while this was being measured.
 *
 * Neither was a subtle mistake inside a guard. Each guard is correct on its own
 * terms. The bug lives in the *pairing* of a page with a guard, and in the
 * pairing of a page with the shell above it — which is precisely the thing no
 * single file can see.
 *
 * ---
 *
 * **Why this is a state model and not a graph of "everywhere a guard can send
 * you".** That was the first attempt and it was wrong in an instructive way: it
 * reported `/signin → /admin → /signin` as a cycle. It is not one. `/signin`
 * sends you to `/admin` when you are signed in and `/admin` sends you to
 * `/signin` when you are not, and nobody is ever both. A redirect graph that
 * unions every state together proves nothing, because the states that make each
 * edge exist are mutually exclusive.
 *
 * So the property is per-state: **fix an account's state, and following
 * redirects from any route must reach a page that renders.** The state does not
 * change while a browser is chasing 307s, which is exactly why a cycle within
 * one state spins for ever and a "cycle" across two states does not.
 *
 * The model below mirrors `guards.ts`. A mirror can drift, so it is pinned:
 * every destination the model produces for a guard must appear in the set of
 * `redirect(...)` targets mechanically extracted from that guard's own source,
 * and vice versa. The model can therefore be wrong about *when*, but not about
 * *where* — and "where" is what makes a loop.
 */

const ROOT = process.cwd()

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

function read(relativePath: string): string {
  return stripComments(readFileSync(join(ROOT, relativePath), 'utf8'))
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(join(ROOT, dir))) {
    const rel = `${dir}/${entry}`
    if (statSync(join(ROOT, rel)).isDirectory()) walk(rel, out)
    else out.push(rel)
  }
  return out
}

// ---------------------------------------------------------------------------
// Where each guard can send you — extracted from guards.ts, never transcribed
// ---------------------------------------------------------------------------

const CONSTANTS: Record<string, string> = {
  SIGN_IN_PATH,
  NO_ACCESS_PATH,
  PASSWORD_PATH,
  SECOND_FACTOR_PATH,
}

const GUARDS_SOURCE = read('src/lib/auth/guards.ts')

/**
 * Every `async function` in guards.ts with its body — exported or not.
 *
 * The `not` matters. `requireOwner` and `requireOperator` are one line each and
 * delegate to `requireRole`, which is private. A first version of this file
 * looked only at exported functions, concluded `requireOwner` could redirect
 * nowhere, and cheerfully passed. That is the failure mode of every analysis
 * like this one: it is not wrong, it is silently blind.
 */
function functionBodies(source: string): Map<string, string> {
  const starts: Array<{ name: string; at: number }> = []
  const pattern = /(?:export )?async function (\w+)\(/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(source)) !== null) {
    starts.push({ name: match[1], at: match.index })
  }

  const bodies = new Map<string, string>()
  for (let i = 0; i < starts.length; i += 1) {
    const end = i + 1 < starts.length ? starts[i + 1].at : source.length
    bodies.set(starts[i].name, source.slice(starts[i].at, end))
  }
  return bodies
}

const BODIES = functionBodies(GUARDS_SOURCE)

function directRedirects(body: string): string[] {
  const found: string[] = []
  const pattern = /redirect\(\s*(?:'([^']+)'|"([^"]+)"|(\w+))\s*\)/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(body)) !== null) {
    const literal = match[1] ?? match[2]
    if (literal) {
      found.push(literal)
      continue
    }
    const constant = match[3]
    if (constant in CONSTANTS) found.push(CONSTANTS[constant])
    else throw new Error(`redirect(${constant}) in guards.ts does not resolve to a path`)
  }
  return found
}

/** Guards a body delegates to, so their destinations are inherited. */
function delegatesTo(body: string): string[] {
  return [...BODIES.keys()].filter(
    (name) => new RegExp(`(?:await|return) ${name}\\(`).test(body),
  )
}

function redirectsOf(guard: string, seen = new Set<string>()): Set<string> {
  const out = new Set<string>()
  if (seen.has(guard)) return out
  seen.add(guard)

  const body = BODIES.get(guard)
  if (!body) return out

  for (const target of directRedirects(body)) out.add(target)
  for (const inner of delegatesTo(body)) {
    if (inner === guard) continue
    for (const target of redirectsOf(inner, seen)) out.add(target)
  }
  return out
}

// ---------------------------------------------------------------------------
// The state, and the model of each guard over it
// ---------------------------------------------------------------------------

interface AccessState {
  /** A live session cookie resolving to a user row. */
  signedIn: boolean
  /** Re-resolved from the allowlist on every request. Null means removed. */
  role: AdminRole | null
  passwordSet: boolean
  /** TOTP confirmed on the account, not yet satisfied on this session. */
  twoFactorPending: boolean
  /** Operator onboarding. Vacuous for the other roles. */
  onboarded: boolean
}

const ROLES: Array<AdminRole | null> = ['OWNER', 'OPERATOR', 'VIEWER', null]

const STATES: AccessState[] = ROLES.flatMap((role) =>
  [true, false].flatMap((signedIn) =>
    [true, false].flatMap((passwordSet) =>
      [true, false].flatMap((twoFactorPending) =>
        [true, false].map((onboarded) => ({
          signedIn,
          role,
          passwordSet,
          twoFactorPending,
          onboarded,
        })),
      ),
    ),
  ),
)

const ALLOW = null

/** Mirrors `currentIdentity()`. */
function identity(s: AccessState): boolean {
  return s.signedIn && s.role !== null && !s.twoFactorPending
}

/** Mirrors `pendingSecondFactorAdmin()`. */
function pending(s: AccessState): boolean {
  return s.signedIn && s.role !== null && s.twoFactorPending
}

/** Mirrors `currentAdmin()` — a viewer is nobody to it. */
function acting(s: AccessState): boolean {
  return identity(s) && canAct(s.role)
}

type Destination = string | typeof ALLOW

const MODEL: Record<string, (s: AccessState) => Destination> = {
  requireOwnAccount(s) {
    if (identity(s)) return ALLOW
    return pending(s) ? SECOND_FACTOR_PATH : SIGN_IN_PATH
  },

  requireReader(s) {
    if (identity(s)) return s.passwordSet ? ALLOW : PASSWORD_PATH
    return pending(s) ? SECOND_FACTOR_PATH : SIGN_IN_PATH
  },

  requireAdmin(s) {
    if (acting(s)) return ALLOW
    if (identity(s)) return NO_ACCESS_PATH // a viewer
    return pending(s) ? SECOND_FACTOR_PATH : SIGN_IN_PATH
  },

  requirePasswordSet(s) {
    const first = MODEL.requireAdmin(s)
    if (first !== ALLOW) return first
    return s.passwordSet ? ALLOW : PASSWORD_PATH
  },

  requireOwner(s) {
    const first = MODEL.requirePasswordSet(s)
    if (first !== ALLOW) return first
    return s.role === 'OWNER' ? ALLOW : NO_ACCESS_PATH
  },

  requireOperator(s) {
    const first = MODEL.requirePasswordSet(s)
    if (first !== ALLOW) return first
    return s.role === 'OPERATOR' ? ALLOW : NO_ACCESS_PATH
  },

  requireOnboardedAdmin(s) {
    const first = MODEL.requirePasswordSet(s)
    if (first !== ALLOW) return first
    if (s.role !== 'OPERATOR') return ALLOW
    return s.onboarded ? ALLOW : '/admin/onboarding'
  },
}

describe('the model is pinned to the source it mirrors', () => {
  it('reads every guard out of guards.ts, private ones included', () => {
    for (const name of [
      'currentIdentity',
      'currentAdmin',
      'pendingSecondFactorAdmin',
      'requireAdmin',
      'requireReader',
      'requireOwnAccount',
      'requirePasswordSet',
      'requireRole',
      'requireOwner',
      'requireOperator',
      'requireOnboardedAdmin',
    ]) {
      expect(BODIES.has(name), name).toBe(true)
    }
  })

  it.each(Object.keys(MODEL))(
    '%s: the model reaches exactly the paths its source can redirect to',
    (guard) => {
      const fromSource = redirectsOf(guard)
      const fromModel = new Set(
        STATES.map((s) => MODEL[guard](s)).filter((d): d is string => d !== ALLOW),
      )
      expect([...fromModel].sort(), 'model invents a destination').toEqual(
        [...fromModel].filter((d) => fromSource.has(d)).sort(),
      )
      expect([...fromSource].sort(), 'model misses a destination the code has').toEqual(
        [...fromSource].filter((d) => fromModel.has(d)).sort(),
      )
    },
  )

  it('requireOwnAccount can reach neither the password page nor the refusal page', () => {
    // The one assertion both fixed loops rest on. If this fails,
    // `/admin/password` and `/admin/no-access` are once again guarded by
    // something that sends them to themselves.
    const targets = redirectsOf('requireOwnAccount')
    expect(targets.has(PASSWORD_PATH)).toBe(false)
    expect(targets.has(NO_ACCESS_PATH)).toBe(false)
    expect([...targets].sort()).toEqual([SIGN_IN_PATH, SECOND_FACTOR_PATH].sort())
  })

  it('requireReader still sends a password-less account to the password page', () => {
    // The behaviour that made the loop is kept, because it is right everywhere
    // except on the password page — and that page has left the shell.
    expect(redirectsOf('requireReader').has(PASSWORD_PATH)).toBe(true)
  })

  it('requireAdmin still refuses a viewer to the refusal page', () => {
    expect(redirectsOf('requireAdmin').has(NO_ACCESS_PATH)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// What guards each page — read out of the pages
// ---------------------------------------------------------------------------

/** `src/app/(admin)/admin/no-access/page.tsx` → `/admin/no-access` */
function routeOf(file: string): string {
  const path = file
    .replace(/^src\/app/, '')
    .replace(/\/(page|route|layout)\.tsx?$/, '')
    .replace(/\/\([^)]+\)/g, '')
  return path === '' ? '/' : path
}

const GROUPS = ['src/app/(admin)', 'src/app/(account)'] as const

function guardsIn(source: string): string[] {
  return Object.keys(MODEL).filter((name) => new RegExp(`\\b${name}\\(`).test(source))
}

interface Page {
  file: string
  route: string
  guards: string[]
  shell: string
}

const LAYOUTS = GROUPS.map((group) => ({
  group,
  guards: guardsIn(read(`${group}/layout.tsx`)),
}))

const PAGES: Page[] = GROUPS.flatMap((group) =>
  walk(group)
    .filter((f) => /\/page\.tsx$/.test(f) && !/\.test\./.test(f))
    .map((file) => ({
      file,
      route: routeOf(file),
      guards: guardsIn(read(file)),
      shell: group,
    })),
)

describe('every admin page is guarded by something this analysis can see', () => {
  it.each(PAGES.map((p) => [p.route, p.file] as const))('%s', (_route, file) => {
    const page = PAGES.find((p) => p.file === file)!
    const seen = page.guards.length > 0 || /requireImportActor/.test(read(file))
    expect(seen, `${file} calls no guard this analysis understands`).toBe(true)
  })

  it('the account shell uses the one guard that cannot send it where it renders', () => {
    const account = LAYOUTS.find((l) => l.group.includes('(account)'))!
    expect(account.guards).toEqual(['requireOwnAccount'])
  })

  it('the admin shell still asks for a reader, so a viewer sees the application', () => {
    const admin = LAYOUTS.find((l) => l.group.includes('(admin)'))!
    expect(admin.guards).toEqual(['requireReader'])
  })
})

// ---------------------------------------------------------------------------
// Following the redirects, one state at a time
// ---------------------------------------------------------------------------

/**
 * Where a request for `route` actually goes in state `s`.
 *
 * The shell is consulted first because it renders above the page — which is the
 * whole shape of the `/admin/password` bug. That page's own guard was blameless
 * and the layout above it did the sending, so a check that looked only at pages
 * would have declared it fine.
 */
function destination(route: string, s: AccessState): Destination {
  if (route === SIGN_IN_PATH) return acting(s) ? '/admin' : ALLOW
  if (route === SECOND_FACTOR_PATH) {
    if (acting(s)) return '/admin'
    return pending(s) ? ALLOW : SIGN_IN_PATH
  }

  const page = PAGES.find((p) => p.route === route)
  if (!page) return ALLOW // outside the admin surface; nothing here redirects into it

  const shell = LAYOUTS.find((l) => l.group === page.shell)!
  for (const guard of [...shell.guards, ...page.guards]) {
    const where = MODEL[guard](s)
    if (where !== ALLOW) return where
  }
  return ALLOW
}

describe('every route settles, from every state', () => {
  const routes = [...PAGES.map((p) => p.route), SIGN_IN_PATH, SECOND_FACTOR_PATH]

  it.each(routes.map((r) => [r] as const))('%s', (route) => {
    for (const state of STATES) {
      const trail: string[] = [route]
      let here = route

      for (let hop = 0; hop < routes.length + 2; hop += 1) {
        const next = destination(here, state)
        if (next === ALLOW) break

        if (trail.includes(next)) {
          const who = state.role ?? 'no role'
          throw new Error(
            `infinite redirect for {${who}, ${state.signedIn ? 'signed in' : 'signed out'}, ` +
              `${state.passwordSet ? 'password set' : 'no password'}, ` +
              `${state.twoFactorPending ? '2FA pending' : '2FA settled'}, ` +
              `${state.onboarded ? 'onboarded' : 'not onboarded'}}: ` +
              `${[...trail, next].join(' → ')}`,
          )
        }

        trail.push(next)
        here = next
      }
    }
  })

  it('the two pages that used to spin now render for the accounts sent to them', () => {
    // Named explicitly, because a general property passing is not the same as
    // the specific journey working, and these two are the journeys that broke.
    const firstRun: AccessState = {
      signedIn: true,
      role: 'OWNER',
      passwordSet: false,
      twoFactorPending: false,
      onboarded: false,
    }
    expect(destination(PASSWORD_PATH, firstRun)).toBe(ALLOW)

    const viewerRefused: AccessState = {
      signedIn: true,
      role: 'VIEWER',
      passwordSet: true,
      twoFactorPending: false,
      onboarded: false,
    }
    expect(destination(NO_ACCESS_PATH, viewerRefused)).toBe(ALLOW)

    // And the viewer's own account surfaces, which were closed to them.
    expect(destination('/admin/security', viewerRefused)).toBe(ALLOW)
    expect(destination(PASSWORD_PATH, viewerRefused)).toBe(ALLOW)

    // While the records stay shut.
    expect(destination('/compliance', viewerRefused)).toBe(NO_ACCESS_PATH)
    expect(destination('/audit', viewerRefused)).toBe(NO_ACCESS_PATH)
    expect(destination('/admin/settings', viewerRefused)).toBe(NO_ACCESS_PATH)
  })
})
