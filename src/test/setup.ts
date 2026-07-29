/**
 * Test environment.
 *
 * Set before any module reads it, so unit tests never depend on a developer's
 * local `.env`. Values are deliberately obvious fakes.
 *
 * ## Why these are assignments and not `??=`
 *
 * They were `??=` — *fill it in if nobody else has* — which reads as a courtesy
 * and is the opposite of what the sentence above promises. `??=` means the
 * suite uses whatever is already in the environment, so the answer it gives
 * depends on who launched it and from where.
 *
 * That was not hypothetical. `verify:determinism` runs the unit suite in a
 * shuffled order, and it does `import 'dotenv/config'` for its own database
 * connection — so the suite inherited `APP_URL=http://localhost:3000` from
 * `.env` and **six tests failed** that pass from a bare shell. The same six
 * would fail for anybody who exports `APP_URL` in their profile, with no hint
 * as to why, and the seed printed to "reproduce" it reproduced nothing.
 *
 * `DATABASE_URL` is the one that matters most. Under `??=`, a developer with
 * their real connection string exported ran the unit suite **against their real
 * database**. Nothing here should reach a database at all; the fake names one
 * that does not exist, so anything that tries fails loudly, which is the point.
 *
 * A test that needs a different value sets it itself, after this has run, and
 * puts it back — several do. That is a deliberate act inside a test, which is a
 * different thing from an ambient value nobody chose.
 */
// NODE_ENV is read-only in the Node types; assign through the index signature.
;(process.env as Record<string, string>).NODE_ENV = 'test'
process.env.DATABASE_URL = 'postgresql://postgres@127.0.0.1:5433/spv_test'
process.env.APP_URL = 'https://spv.flipit.com'
process.env.PRODUCTION_APP_URL = 'https://spv.flipit.com'
process.env.ENCRYPTION_KEY = Buffer.alloc(32, 5).toString('base64')
process.env.AUTH_SECRET = 'test-secret-not-used-anywhere-real'
process.env.OWNER_EMAILS = 'mike@flipthepage.com,mike@flipit.com'
process.env.OPERATOR_EMAILS = 'serenedavid@gmail.com'
