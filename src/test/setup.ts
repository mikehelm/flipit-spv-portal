/**
 * Test environment.
 *
 * Set before any module reads it, so unit tests never depend on a developer's
 * local .env. Values are deliberately obvious fakes.
 */
// NODE_ENV is read-only in the Node types; assign through the index signature.
;(process.env as Record<string, string>).NODE_ENV = 'test'
process.env.DATABASE_URL ??= 'postgresql://postgres@127.0.0.1:5433/spv_test'
process.env.APP_URL ??= 'https://spv.flipit.com'
process.env.PRODUCTION_APP_URL ??= 'https://spv.flipit.com'
process.env.ENCRYPTION_KEY ??= Buffer.alloc(32, 5).toString('base64')
process.env.AUTH_SECRET ??= 'test-secret-not-used-anywhere-real'
process.env.OWNER_EMAILS ??= 'mike@flipthepage.com,mike@flipit.com'
process.env.OPERATOR_EMAILS ??= 'serenedavid@gmail.com'
