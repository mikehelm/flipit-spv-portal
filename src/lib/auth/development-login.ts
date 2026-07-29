import { and, eq, gt } from 'drizzle-orm'
import { db } from '@/db'
import { sessions, users } from '@/db/schema'
import { audit } from '@/lib/audit'
import { hashToken, issueToken } from '@/lib/crypto'
import { env } from '@/lib/env'
import { evaluateAllowlist } from './sign-in-policy'
import { createAdminSession } from './session'

export const DEVELOPMENT_LOGIN_TTL_MINUTES = 10
const DEVELOPMENT_LOGIN_PREFIX = 'dev_'

export function developmentLoginExpiresAt(now = new Date()): Date {
  return new Date(now.getTime() + DEVELOPMENT_LOGIN_TTL_MINUTES * 60 * 1000)
}

export function isDevelopmentLoginToken(candidate: string): boolean {
  return candidate.startsWith(DEVELOPMENT_LOGIN_PREFIX)
}

function assertDevelopmentOnly(): void {
  const config = env()
  if (process.env.NODE_ENV === 'production' || config.isProductionDeployment) {
    throw new Error('Development login links are disabled outside local development.')
  }
}

export async function issueDevelopmentOperatorLoginLink(options: {
  baseUrl?: string
  now?: Date
} = {}): Promise<{ url: string; email: string; expiresAt: Date }> {
  assertDevelopmentOnly()
  const config = env()
  const ownerEmail = config.ownerEmails[0]
  const operatorEmail = config.operatorEmails[0]
  if (!ownerEmail || !operatorEmail) {
    throw new Error('An owner and an operator must be configured.')
  }

  const ownerDecision = evaluateAllowlist(ownerEmail)
  const operatorDecision = evaluateAllowlist(operatorEmail)
  if (
    !ownerDecision.allowed ||
    ownerDecision.role !== 'OWNER' ||
    !operatorDecision.allowed ||
    operatorDecision.role !== 'OPERATOR'
  ) {
    throw new Error('The configured owner or operator role is invalid.')
  }

  const [owner, operator] = await Promise.all([
    db.query.users.findFirst({ where: eq(users.email, ownerDecision.email) }),
    db.query.users.findFirst({ where: eq(users.email, operatorDecision.email) }),
  ])
  if (!owner || !operator) {
    throw new Error('The configured owner or operator account does not exist.')
  }

  const issued = issueToken()
  const raw = `${DEVELOPMENT_LOGIN_PREFIX}${issued.token}`
  const expiresAt = developmentLoginExpiresAt(options.now)
  const [temporary] = await db
    .insert(sessions)
    .values({
      sessionToken: hashToken(raw),
      userId: operator.id,
      expires: expiresAt,
      secondFactorAt: null,
    })
    .returning({ id: sessions.id })

  await audit({
    actor: { kind: 'user', id: owner.id, label: owner.email },
    entityType: 'session',
    entityId: temporary.id,
    action: 'development_login_link.issued',
    metadata: {
      targetEmail: operator.email,
      expiresAt: expiresAt.toISOString(),
      testing: true,
    },
  })

  const base = (options.baseUrl ?? config.APP_URL).replace(/\/+$/, '')
  const url = new URL('/api/auth/development-login', `${base}/`)
  url.searchParams.set('token', raw)
  return { url: url.toString(), email: operator.email, expiresAt }
}

export async function redeemDevelopmentOperatorLoginLink(
  candidate: string,
  now = new Date(),
): Promise<boolean> {
  try {
    assertDevelopmentOnly()
  } catch {
    return false
  }
  if (!isDevelopmentLoginToken(candidate)) return false

  const consumed = await db
    .delete(sessions)
    .where(
      and(
        eq(sessions.sessionToken, hashToken(candidate)),
        gt(sessions.expires, now),
      ),
    )
    .returning({ id: sessions.id, userId: sessions.userId })
  if (consumed.length !== 1) return false

  const operator = await db.query.users.findFirst({
    where: eq(users.id, consumed[0].userId),
  })
  if (!operator) return false

  const decision = evaluateAllowlist(operator.email)
  if (!decision.allowed || decision.role !== 'OPERATOR') return false

  await createAdminSession(operator.id, { secondFactorSatisfied: true })
  await audit({
    actor: { kind: 'user', id: operator.id, label: operator.email },
    entityType: 'session',
    entityId: consumed[0].id,
    action: 'access.sign_in',
    metadata: {
      method: 'development_one_time_link',
      role: 'OPERATOR',
      testing: true,
    },
  })
  return true
}
