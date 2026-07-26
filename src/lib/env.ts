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

  /**
   * The shared secret an external uptime monitor presents to `/api/health`.
   *
   * Empty is the default and means the endpoint does not exist — every request
   * to it, with or without a header, gets the same 404 as any invented path.
   * That is the conservative state: a deployment that has not deliberately
   * turned this on is not quietly answering questions about itself.
   *
   * When set it must be long. A short shared secret on an unauthenticated
   * internet endpoint is a guessable one, and there is nothing rate-limiting a
   * health check — so the length is the whole defence. Generate one with
   * `openssl rand -base64 32`.
   *
   * Never logged, never rendered, never exported.
   */
  HEALTH_TOKEN: z
    .string()
    .default('')
    .refine((v) => v === '' || v.length >= 32, {
      message: 'HEALTH_TOKEN must be empty or at least 32 characters',
    }),

  // No OAuth configuration. Owner and operator sign in with an email and
  // password held in this application's own database (BUILD_SPEC §2.2).

  /** Comma-separated allowlists. Role is assigned by address (BUILD_SPEC §2). */
  OWNER_EMAILS: z.string().default(''),
  OPERATOR_EMAILS: z.string().default(''),

  /**
   * Where uploaded images and video are stored. BUILD_SPEC §13.2, §13.3.
   *
   * Empty means there is nowhere, and that is a supported state rather than a
   * misconfiguration: the portal, the emails and the certificate are all
   * complete with an empty media library, and the upload screens say exactly
   * what to set. See `lib/media/store.ts` for why this is a choice and not a
   * default — a filesystem store needs a directory that survives a restart,
   * and a serverless deployment does not have one.
   */
  MEDIA_STORE: z.enum(['', 'filesystem', 'object-store']).default(''),
  MEDIA_DIR: z.string().default('.media'),

  /**
   * The S3-compatible object store, for `MEDIA_STORE="object-store"`.
   *
   * Ignored entirely for any other value of MEDIA_STORE, and required for that
   * one — see the refinement below. The application refuses to start rather
   * than refusing at upload time, which is the difference between finding out
   * on deployment and finding out when somebody tries to put a document on an
   * investor's record.
   *
   * Region defaults to `auto` because Cloudflare R2 wants exactly that and the
   * others do not care what is in the signature scope as long as it matches
   * the bucket's. A deployment on AWS proper must set its real region.
   */
  MEDIA_S3_ENDPOINT: z.string().default(''),
  MEDIA_S3_REGION: z.string().default('auto'),
  MEDIA_S3_BUCKET: z.string().default(''),
  MEDIA_S3_ACCESS_KEY_ID: z.string().default(''),
  MEDIA_S3_SECRET_ACCESS_KEY: z.string().default(''),
})

/**
 * The object store is all-or-nothing.
 *
 * Selecting it with three of the five variables set is the failure this is
 * here to stop: it would start, look configured on the settings screen, and
 * refuse the first upload. The endpoint is additionally required to be an
 * absolute URL with no path, because the client appends `/bucket/key` to it
 * and a trailing path segment would silently address the wrong prefix.
 */
const withObjectStore = schema.superRefine((value, ctx) => {
  if (value.MEDIA_STORE !== 'object-store') return

  const required = [
    'MEDIA_S3_ENDPOINT',
    'MEDIA_S3_BUCKET',
    'MEDIA_S3_ACCESS_KEY_ID',
    'MEDIA_S3_SECRET_ACCESS_KEY',
  ] as const

  for (const name of required) {
    if (value[name] === '') {
      ctx.addIssue({
        code: 'custom',
        path: [name],
        message: `${name} is required when MEDIA_STORE is "object-store"`,
      })
    }
  }

  if (value.MEDIA_S3_ENDPOINT !== '') {
    let parsed: URL | null = null
    try {
      parsed = new URL(value.MEDIA_S3_ENDPOINT)
    } catch {
      parsed = null
    }

    if (!parsed || !/^https?:$/.test(parsed.protocol)) {
      ctx.addIssue({
        code: 'custom',
        path: ['MEDIA_S3_ENDPOINT'],
        message: 'MEDIA_S3_ENDPOINT must be an absolute http or https URL',
      })
    } else if (parsed.pathname !== '/' || parsed.search !== '') {
      ctx.addIssue({
        code: 'custom',
        path: ['MEDIA_S3_ENDPOINT'],
        message:
          'MEDIA_S3_ENDPOINT must be scheme and host only — the bucket and key are appended to it',
      })
    }
  }
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
  const parsed = withObjectStore.safeParse(process.env)

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
