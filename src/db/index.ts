import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { env } from '@/lib/env'
import * as schema from './schema'

/**
 * Database handle.
 *
 * Cached on globalThis so Next.js hot reloading does not open a new pool on
 * every edit.
 */
const globalForDb = globalThis as unknown as {
  __spvSql?: ReturnType<typeof postgres>
}

const sql = globalForDb.__spvSql ?? postgres(env().DATABASE_URL, { max: 10 })

if (env().NODE_ENV !== 'production') globalForDb.__spvSql = sql

export const db = drizzle(sql, { schema })
export { schema, sql }
