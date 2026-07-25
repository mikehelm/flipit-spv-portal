import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { env } from '@/lib/env'
import * as schema from './schema'

/**
 * Database handle, created lazily.
 *
 * Lazy on purpose: importing this module must not open a connection or even
 * read the environment. Unit tests import modules that transitively reach the
 * database layer without ever touching it, and they should not need a running
 * Postgres to do so.
 *
 * Cached on globalThis so Next.js hot reloading does not open a new pool on
 * every edit.
 */
const globalForDb = globalThis as unknown as {
  __spvSql?: ReturnType<typeof postgres>
  __spvDb?: ReturnType<typeof drizzle<typeof schema>>
}

function connect() {
  if (!globalForDb.__spvSql) {
    globalForDb.__spvSql = postgres(env().DATABASE_URL, { max: 10 })
  }
  if (!globalForDb.__spvDb) {
    globalForDb.__spvDb = drizzle(globalForDb.__spvSql, { schema })
  }
  return globalForDb.__spvDb
}

export type Database = ReturnType<typeof connect>

/**
 * Proxy so `db.insert(...)` works exactly as before while the real connection
 * is deferred until the first query.
 */
export const db: Database = new Proxy({} as Database, {
  get(_target, property, receiver) {
    return Reflect.get(connect() as object, property, receiver)
  },
})

export { schema }
