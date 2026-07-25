import { z } from 'zod'

/**
 * Environment configuration, validated at boot.
 *
 * The application refuses to start if a required variable is missing or
 * malformed. This is deliberate: a portal that silently starts with a missing
 * encryption key or a wrong base URL is worse than one that will not start.
 */

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  /** Postgres connection string. */
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

  /**
   * Path prefix the app is served under, e.g. "/SPV". Empty string when served
   * at a domain root. Must start with "/" and must not end with one.
   */
  BASE_PATH: z
    .string()
    .default('')
    .refine((v) => v === '' || (v.startsWith('/') && !v.endsWith('/')), {
      message: 'BASE_PATH must be empty or start with "/" and not end with "/"',
    }),

  /**
   * Absolute public URL of this deployment, including any base path.
   * Portal links embed this. See BUILD_SPEC §18.1.
   */
  APP_URL: z.string().url('APP_URL must be an absolute URL'),

  /**
   * The APP_URL this application is permitted to send real invitations from.
   * When APP_URL does not match, sending is refused (BUILD_SPEC §18.1, AC44).
   * Portal links embed the domain and every link issued from a testing
   * deployment would die on migration to production.
   */
  PRODUCTION_APP_URL: z.string().url('PRODUCTION_APP_URL must be an absolute URL'),

  /** 32-byte key, base64 encoded, for encrypting secrets at rest. */
  ENCRYPTION_KEY: z
    .string()
    .min(1, 'ENCRYPTION_KEY is required')
    .refine((v) => Buffer.from(v, 'base64').length === 32, {
      message: 'ENCRYPTION_KEY must be 32 bytes, base64 encoded',
    }),

  /** Auth.js session secret. */
  AUTH_SECRET: z.string().min(16, 'AUTH_SECRET must be at least 16 characters'),

  /** Google OAuth, used only for owner and operator sign-in. */
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),

  /** Comma-separated allowlists. Role is assigned by address (BUILD_SPEC §2). */
  OWNER_EMAILS: z.string().default(''),
  OPERATOR_EMAILS: z.string().default(''),
})

type Env = z.infer<typeof schema> & {
  ownerEmails: string[]
  operatorEmails: string[]
  isProductionDeployment: boolean
}

function normaliseUrl(value: string): string {
  return value.replace(/\/+$/, '').toLowerCase()
}

function splitList(value: string): string[] {
  return value
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean)
}

function load(): Env {
  const parsed = schema.safeParse(process.env)

  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((issue) => `  ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n')
    throw new Error(
      `Environment configuration is invalid. The application will not start.\n${detail}\n\n` +
        'See .env.example for every variable and what it is for.',
    )
  }

  const value = parsed.data

  return {
    ...value,
    ownerEmails: splitList(value.OWNER_EMAILS),
    operatorEmails: splitList(value.OPERATOR_EMAILS),
    isProductionDeployment:
      normaliseUrl(value.APP_URL) === normaliseUrl(value.PRODUCTION_APP_URL),
  }
}

let cached: Env | undefined

export function env(): Env {
  if (!cached) cached = load()
  return cached
}

/** Test-only. Clears the memoised environment so a test can vary it. */
export function resetEnvCache(): void {
  cached = undefined
}
