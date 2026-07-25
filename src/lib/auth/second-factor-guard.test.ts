import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * The structural rules that make the second factor hard to get around.
 * BUILD_SPEC §2.2.
 *
 * The behaviour — a wrong code refused, a recovery code spent once, a session
 * elevated — is in `totp.test.ts` and in `scripts/verify-second-factor.ts`,
 * which runs it against a real database. What is here is the shape of the
 * thing, because the way a second factor usually fails is not that the maths is
 * wrong: it is that some route forgot to ask.
 */

function walk(dir: string, exts: string[]): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry)
    if (statSync(p).isDirectory()) out.push(...walk(p, exts))
    else if (exts.some((e) => p.endsWith(e))) out.push(p)
  }
  return out
}

function code(file: string): string {
  return readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

describe('a pending session is not an administrator', () => {
  it('the check lives in currentAdmin, which every guard already goes through', () => {
    const guards = code('src/lib/auth/guards.ts')

    // The resolution is in one function and `currentAdmin` calls it. A guard
    // that forgets to think about two-factor therefore gets null and redirects
    // — the failure is closed rather than open.
    expect(guards).toContain('function secondFactorPending')
    expect(guards).toMatch(/currentAdmin[\s\S]*?secondFactorPending\(user, session\)/)
  })

  it('every other guard is built on currentAdmin rather than on the session', () => {
    const guards = code('src/lib/auth/guards.ts')

    // requireAdmin → currentAdmin; requirePasswordSet → requireAdmin;
    // requireRole → requirePasswordSet; requireOwner/Operator → requireRole.
    // One path, one check.
    expect(guards).toMatch(/requireAdmin[\s\S]*?await currentAdmin\(\)/)
    expect(guards).toMatch(/requirePasswordSet[\s\S]*?await requireAdmin\(\)/)
    expect(guards).toMatch(/requireRole[\s\S]*?await requirePasswordSet\(\)/)
    expect(guards).toMatch(/requireOwner[\s\S]*?requireRole\('OWNER'\)/)
    expect(guards).toMatch(/requireOperator[\s\S]*?requireRole\('OPERATOR'\)/)
  })

  it('only the second-factor page reads a session currentAdmin refused', () => {
    const users = walk('src/app', ['.tsx', '.ts'])
      .concat(walk('src/actions', ['.ts']))
      .filter((f) => code(f).includes('pendingSecondFactorAdmin'))
      .sort()

    // The page that renders the form, and the action that receives it. A third
    // caller would be a second surface reachable half-authenticated.
    expect(users).toEqual([
      'src/actions/second-factor.ts',
      'src/app/signin/second-factor/page.tsx',
    ])
  })

  it('no page or action reads the session table directly to work around it', () => {
    const offenders = walk('src/app', ['.tsx', '.ts'])
      .concat(walk('src/actions', ['.ts']))
      .filter((f) => /db\.query\.sessions|from\(sessions\)/.test(code(f)))

    expect(offenders).toEqual([])
  })
})

describe('a session starts un-elevated', () => {
  it('createAdminSession defaults to NOT satisfied', () => {
    const session = code('src/lib/auth/session.ts')

    // A caller that forgets the option produces a session that reaches the
    // second-factor form, not one that reaches the investor records.
    expect(session).toMatch(/secondFactorAt: options\.secondFactorSatisfied \? new Date\(\) : null/)
  })

  it('neither sign-in path claims the second factor for itself', () => {
    // Password sign-in and the one-time setup link both create a plain
    // session. Only `markSecondFactorSatisfied`, called after a verified code,
    // elevates one.
    for (const file of ['src/actions/auth.ts', 'src/lib/auth/bootstrap.ts']) {
      expect(code(file)).not.toMatch(/secondFactorSatisfied:\s*true/)
    }
  })

  it('elevation is by session token, never by user id', () => {
    const session = code('src/lib/auth/session.ts')
    const fn = session.slice(session.indexOf('markSecondFactorSatisfied'))

    // Elevating every session a user holds would elevate one an attacker had
    // opened with a stolen password and left waiting.
    expect(fn).toContain('sessions.sessionToken')
    expect(fn.slice(0, fn.indexOf('return'))).not.toContain('sessions.userId')

    // And only a session that has not already been elevated, so a replayed
    // form submission cannot re-stamp one.
    expect(fn).toContain('isNull(sessions.secondFactorAt)')
  })
})

describe('the secret and the codes', () => {
  it('the secret is encrypted before it is stored, everywhere it is stored', () => {
    const actions = code('src/actions/second-factor.ts')
    expect(actions).toMatch(/totpSecretEncrypted:\s*encrypt\(/)
    // Never assigned a bare value.
    expect(actions).not.toMatch(/totpSecretEncrypted:\s*secret\b/)
  })

  it('nothing logs a secret, a code, or a recovery code', () => {
    const actions = code('src/actions/second-factor.ts')

    // Checklist point 8. The audit entries here record a method and a count.
    expect(actions).not.toMatch(/metadata:\s*\{[^}]*\b(code|secret|token)\b\s*[,}]/)
    expect(actions).not.toMatch(/console\.(log|info|warn|error)/)
  })

  it('recovery codes are stored hashed and never in the clear', () => {
    const totp = code('src/lib/auth/totp.ts')
    expect(totp).toMatch(/hashed:\s*plain\.map\(\(code\) => hashToken\(/)

    const actions = code('src/actions/second-factor.ts')
    // Only `recovery.hashed` is written; `recovery.plain` goes to the one-time
    // reveal channel and nowhere else.
    expect(actions).toMatch(/recoveryCodesHashed:\s*recovery\.hashed/)
    expect(actions).not.toMatch(/recoveryCodesHashed:\s*recovery\.plain/)
  })

  it('the second step is throttled on the same counters as the first', () => {
    const actions = code('src/actions/second-factor.ts')

    // A six-digit code is a million possibilities. An unthrottled form walks
    // it in an afternoon, and a form throttled on its own counters lets an
    // attacker spend the password budget and the code budget separately.
    expect(actions).toContain('signInKeys(pending.email, ip)')
    expect(actions).toContain('checkRateLimit')
    expect(actions).toContain('recordFailure')
  })

  it('turning it off asks for the password, not merely a session', () => {
    const actions = code('src/actions/second-factor.ts')
    const disable = actions.slice(actions.indexOf('disableTotpAction'))
    expect(disable).toContain('verifyPassword')
  })

  it('switching it on ends every other session for that account', () => {
    const actions = code('src/actions/second-factor.ts')
    const confirm = actions.slice(
      actions.indexOf('confirmTotpEnrolmentAction'),
      actions.indexOf('disableTotpAction'),
    )
    // Sessions opened under one-factor rules must not survive switching it on,
    // or the change would have altered nothing for the sessions that existed.
    expect(confirm).toContain('revokeAllSessionsForUser')
  })
})

describe('the release gate', () => {
  it('is read inside the one gated send, not supplied by callers', () => {
    const transport = code('src/lib/email/transport/index.ts')

    // A gate whose evidence the caller provides is a gate the caller can get
    // wrong. Every send in the application comes through `sendOneEmail`.
    expect(transport).toContain('operatorTwoFactorEnrolled()')
    expect(transport).toMatch(/sendOneEmail[\s\S]*?operatorTwoFactorEnrolled\(\)/)
  })

  it('is required on the guard config, so a new call site has to state it', () => {
    const guard = code('src/lib/email/transport/guard.ts')
    expect(guard).toMatch(/operatorTwoFactorEnrolled:\s*boolean\s*$/m)
    // Not optional — an optional field with a default is a field somebody
    // forgets, and the default would be the wrong one in exactly one case.
    expect(guard).not.toMatch(/operatorTwoFactorEnrolled\?:/)
  })
})
