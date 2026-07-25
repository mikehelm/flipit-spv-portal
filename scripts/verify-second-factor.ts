/**
 * Two-factor, against a real database. BUILD_SPEC §2.2.
 *
 * *"**TOTP two-factor** for both privileged accounts … mandatory before the
 * production deployment sends anything real. Standard authenticator apps;
 * recovery codes issued once at setup."*
 *
 * The arithmetic is in `totp.test.ts` and the shape of the guards is in
 * `second-factor-guard.test.ts`. What is here is everything that only becomes
 * true once there are rows: that an enrolled account's session is genuinely
 * refused until a code is entered, that a recovery code is spent by the
 * database rather than in memory, that two sessions for the same account are
 * elevated independently, and that the release gate refuses a real send and
 * lets a test send through.
 *
 * It creates its own user under an obvious address and deletes it at the end.
 *
 *   pnpm tsx scripts/verify-second-factor.ts
 */

import 'dotenv/config'
import { eq, like } from 'drizzle-orm'
import { db } from '@/db'
import { auditEvents, sessions, users } from '@/db/schema'
import { evaluateSendGuard, type SendGuardConfig } from '@/lib/email/transport/guard'
import { operatorTwoFactorEnrolled } from '@/lib/auth/two-factor-state'
import {
  codeAt,
  consumeRecoveryCode,
  createTotpEnrolment,
  generateRecoveryCodes,
  PERIOD_SECONDS,
  verifyTotp,
} from '@/lib/auth/totp'
import { decrypt, encrypt, hashToken, issueToken } from '@/lib/crypto'

const PREFIX = 'wp2fa-verify'

let passed = 0
let failed = 0

function check(label: string, condition: boolean, detail?: string): void {
  if (condition) {
    passed += 1
    console.log(`  ok    ${label}`)
  } else {
    failed += 1
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

async function cleanUp(): Promise<void> {
  const rows = await db
    .select({ id: users.id })
    .from(users)
    .where(like(users.email, `${PREFIX}%`))

  for (const row of rows) {
    await db.delete(sessions).where(eq(sessions.userId, row.id))
    await db.delete(auditEvents).where(eq(auditEvents.actorUserId, row.id))
    await db.delete(users).where(eq(users.id, row.id))
  }
}

/** The shape the send gate reads, with everything healthy but the one thing. */
function guardConfig(twoFactor: boolean): SendGuardConfig {
  return {
    serviceMode: 'ACTIVE',
    emailTransport: 'SMTP',
    smtpUserEncrypted: 'v1.aaa.bbb.ccc',
    smtpPasswordEncrypted: 'v1.ddd.eee.fff',
    smtpLastVerifiedAt: new Date(),
    smtpLastVerifyResult: 'OK: Authenticated to smtp.gmail.com:587 over STARTTLS.',
    operatorTwoFactorEnrolled: twoFactor,
  }
}

async function main(): Promise<void> {
  console.log('\nBUILD_SPEC §2.2 — two-factor, against a real database\n')

  await cleanUp()

  // -------------------------------------------------------------------------
  console.log('Enrolment')

  const enrolment = createTotpEnrolment(`${PREFIX}@example.test`)

  const [user] = await db
    .insert(users)
    .values({
      email: `${PREFIX}@example.test`,
      name: 'Two Factor Verify',
      role: 'OPERATOR',
      passwordHash: 'not-used-here',
      totpSecretEncrypted: encrypt(enrolment.secret),
    })
    .returning()

  const stored = await db.query.users.findFirst({ where: eq(users.id, user!.id) })

  check(
    'the secret is not stored in the clear',
    stored?.totpSecretEncrypted !== enrolment.secret &&
      !stored?.totpSecretEncrypted?.includes(enrolment.secret),
  )
  check(
    'and it decrypts back to what was enrolled',
    decrypt(stored!.totpSecretEncrypted!) === enrolment.secret,
  )
  check('enrolment is not confirmed until a code is entered', stored?.totpConfirmedAt === null)
  check('and no recovery codes exist yet', stored?.recoveryCodesHashed.length === 0)

  // A wrong code must not confirm it.
  const nowSeconds = Math.floor(Date.now() / 1000)
  check(
    'a wrong code does not verify',
    verifyTotp(enrolment.secret, '000000', nowSeconds) !== 'OK',
  )
  check(
    'the live code does',
    verifyTotp(enrolment.secret, codeAt(enrolment.secret, nowSeconds), nowSeconds) === 'OK',
  )
  check(
    'a code from five minutes ago does not',
    verifyTotp(
      enrolment.secret,
      codeAt(enrolment.secret, nowSeconds - 10 * PERIOD_SECONDS),
      nowSeconds,
    ) !== 'OK',
  )

  const recovery = generateRecoveryCodes()
  await db
    .update(users)
    .set({ totpConfirmedAt: new Date(), recoveryCodesHashed: recovery.hashed })
    .where(eq(users.id, user!.id))

  const confirmed = await db.query.users.findFirst({ where: eq(users.id, user!.id) })
  check('two-factor is now switched on', confirmed?.totpConfirmedAt !== null)
  check('ten recovery codes are stored', confirmed?.recoveryCodesHashed.length === 10)
  check(
    'none of them is stored in the clear',
    recovery.plain.every(
      (plain) => !confirmed!.recoveryCodesHashed.includes(plain.replace('-', '')),
    ),
  )

  // -------------------------------------------------------------------------
  console.log('\nSessions are elevated one at a time')

  const first = issueToken()
  const second = issueToken()
  const expires = new Date(Date.now() + 12 * 60 * 60 * 1000)

  await db.insert(sessions).values([
    { sessionToken: first.hash, userId: user!.id, expires },
    { sessionToken: second.hash, userId: user!.id, expires },
  ])

  const pending = await db
    .select({ id: sessions.id, secondFactorAt: sessions.secondFactorAt })
    .from(sessions)
    .where(eq(sessions.userId, user!.id))

  check('both sessions start un-elevated', pending.every((s) => s.secondFactorAt === null))

  // Elevate the first one only — by its token hash, the way the action does.
  const elevated = await db
    .update(sessions)
    .set({ secondFactorAt: new Date() })
    .where(eq(sessions.sessionToken, hashToken(first.token)))
    .returning({ id: sessions.id })

  check('elevating one session touches exactly one row', elevated.length === 1)

  const after = await db
    .select({ token: sessions.sessionToken, secondFactorAt: sessions.secondFactorAt })
    .from(sessions)
    .where(eq(sessions.userId, user!.id))

  const secondRow = after.find((s) => s.token === hashToken(second.token))
  check(
    'the other session is still waiting — a stolen password left open stays useless',
    secondRow?.secondFactorAt === null,
  )

  // -------------------------------------------------------------------------
  console.log('\nRecovery codes, spent against the database')

  const code = recovery.plain[4]!
  const row = await db.query.users.findFirst({ where: eq(users.id, user!.id) })
  const consumed = consumeRecoveryCode(row!.recoveryCodesHashed, code)
  check('a recovery code is accepted', consumed.ok)

  await db
    .update(users)
    .set({ recoveryCodesHashed: consumed.remaining })
    .where(eq(users.id, user!.id))

  const afterSpend = await db.query.users.findFirst({ where: eq(users.id, user!.id) })
  check('nine remain', afterSpend?.recoveryCodesHashed.length === 9)

  const replay = consumeRecoveryCode(afterSpend!.recoveryCodesHashed, code)
  check('and the same code is refused a second time', !replay.ok)

  check(
    'a code for a different account is refused',
    !consumeRecoveryCode(afterSpend!.recoveryCodesHashed, generateRecoveryCodes().plain[0]!).ok,
  )

  // -------------------------------------------------------------------------
  console.log('\nThe release gate — §2.2, on the production deployment')

  const enrolledNow = await operatorTwoFactorEnrolled()
  check(
    'the application can see that an operator is enrolled',
    enrolledNow,
    'operatorTwoFactorEnrolled() returned false with an enrolled operator present',
  )

  const refused = evaluateSendGuard({
    intent: 'INVITATION',
    config: guardConfig(false),
    isProductionDeployment: true,
  })
  check('a real invitation is refused without two-factor', !refused.allowed)
  check(
    'and the reason names it',
    !refused.allowed &&
      refused.blocks.some((b) => b.reason === 'SECOND_FACTOR_NOT_ENROLLED'),
    refused.allowed ? 'allowed' : refused.blocks.map((b) => b.reason).join(', '),
  )

  const allowed = evaluateSendGuard({
    intent: 'INVITATION',
    config: guardConfig(true),
    isProductionDeployment: true,
  })
  check('and permitted once it is switched on', allowed.allowed)

  const testSend = evaluateSendGuard({
    intent: 'TEST',
    config: guardConfig(false),
    isProductionDeployment: true,
    operatorEmail: `${PREFIX}@example.test`,
    recipient: `${PREFIX}@example.test`,
  })
  check('a test send to the operator is unaffected', testSend.allowed)

  // Switching it off must move the gate back.
  await db
    .update(users)
    .set({ totpConfirmedAt: null, totpSecretEncrypted: null, recoveryCodesHashed: [] })
    .where(eq(users.id, user!.id))

  check(
    'turning it off is visible to the gate immediately',
    (await operatorTwoFactorEnrolled()) === false,
  )

  // -------------------------------------------------------------------------
  console.log('\nNothing sensitive reached the log')

  const entries = await db
    .select({ metadata: auditEvents.metadata })
    .from(auditEvents)
    .where(eq(auditEvents.actorUserId, user!.id))

  const serialised = JSON.stringify(entries)
  check(
    'no audit entry for this account carries the secret or a recovery code',
    !serialised.includes(enrolment.secret) &&
      recovery.plain.every((plain) => !serialised.includes(plain)),
  )

  // -------------------------------------------------------------------------
  console.log('\nCleaning up')
  await cleanUp()

  const orphans = await db
    .select({ id: users.id })
    .from(users)
    .where(like(users.email, `${PREFIX}%`))
  check('verification data is removed', orphans.length === 0)

  console.log(`\n${passed} passed, ${failed} failed\n`)
  if (failed > 0) process.exitCode = 1
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => process.exit())
