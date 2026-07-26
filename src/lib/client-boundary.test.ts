import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * What a client component drags into the browser with it.
 *
 * This rule has now been learned twice from two very different symptoms, which
 * is why it is written down as a test rather than as a third comment.
 *
 * The loud one: `lib/updates/copy.ts` exists because a client component
 * imported one string from a module that imports the database, and the whole
 * postgres driver went into the browser bundle. That one broke the production
 * build, so it was found immediately.
 *
 * The quiet one, found only when a real browser was pointed at `/updates` with
 * the console being listened to: the same component imported another string
 * from `lib/updates/audience.ts`, which holds a `zod` schema. Zod arrived in
 * the browser, probed for `new Function` to decide whether it may compile its
 * validators, and the strict Content-Security-Policy refused it. Zod catches
 * that throw and carries on interpreted, so **nothing broke** — the page
 * rendered, every test passed, and every visit reported a `script-src eval`
 * violation into a console nobody was reading. Standing noise like that is
 * worse than a failure, because it is what a real violation would hide behind.
 *
 * Neither is visible to `pnpm typecheck`, `pnpm lint` or `pnpm test`: none of
 * them draws the server/client boundary. So this draws it.
 *
 * The check follows real imports only — `import type` is erased by the compiler
 * and reaches no bundle — from every `'use client'` file through every local
 * module it touches, and fails if any of them reaches a package that has no
 * business in a browser.
 */

const ROOT = process.cwd()

/**
 * Packages a client component must never pull in, and why.
 *
 * Deliberately short and deliberately justified. A long list becomes a thing
 * people add to without reading; each entry here is a package whose presence in
 * a browser bundle is evidence of a mistake rather than a choice.
 */
const FORBIDDEN: Array<{ module: string; because: string }> = [
  {
    module: 'postgres',
    because: 'the database driver in a browser bundle breaks the production build',
  },
  {
    module: 'drizzle-orm',
    because: 'query building belongs on the server, and it carries the driver with it',
  },
  {
    module: '@/db',
    because: 'the schema and the connection are server-only',
  },
  {
    module: 'zod',
    because:
      'zod probes for `new Function` to decide whether it may compile validators, ' +
      'and the Content-Security-Policy refuses it — a swallowed throw that reports a ' +
      'script-src violation on every page view',
  },
  {
    module: 'nodemailer',
    because: 'the mail transport must never be reachable from a browser',
  },
]

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(join(ROOT, dir))) {
    const rel = `${dir}/${entry}`
    if (statSync(join(ROOT, rel)).isDirectory()) walk(rel, out)
    else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(rel)
  }
  return out
}

/**
 * Every module specifier a file imports **at runtime**.
 *
 * `import type { X } from '…'` is dropped by the compiler and reaches no
 * bundle, so it is skipped. An `import { type X, y }` is not skipped, because
 * `y` is real and the module is loaded.
 */
function runtimeImports(source: string): string[] {
  const specifiers: string[] = []
  const pattern = /^\s*import\s+(type\s+)?([^'"]*?)from\s*['"]([^'"]+)['"]/gm
  let match: RegExpExecArray | null
  while ((match = pattern.exec(source)) !== null) {
    if (match[1]) continue // `import type … from …`
    specifiers.push(match[3])
  }
  // Side-effect imports: `import '@/lib/whatever'`
  const bare = /^\s*import\s*['"]([^'"]+)['"]/gm
  while ((match = bare.exec(source)) !== null) specifiers.push(match[1])
  return specifiers
}

/** Resolve a local specifier to a file under src, or null if it is a package. */
function resolveLocal(fromFile: string, specifier: string): string | null {
  let base: string
  if (specifier.startsWith('@/')) base = join('src', specifier.slice(2))
  else if (specifier.startsWith('.')) base = resolve(dirname(fromFile), specifier).replace(`${ROOT}/`, '')
  else return null

  for (const candidate of [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}/index.ts`,
    `${base}/index.tsx`,
  ]) {
    if (existsSync(join(ROOT, candidate)) && statSync(join(ROOT, candidate)).isFile()) {
      return candidate
    }
  }
  return null
}

const ALL = walk('src')
const CLIENT = ALL.filter((f) => /^\s*['"]use client['"]/.test(readFileSync(join(ROOT, f), 'utf8')))

function isServerAction(file: string): boolean {
  return /^\s*['"]use server['"]/.test(readFileSync(join(ROOT, file), 'utf8'))
}

/**
 * Every package reachable from `entry`, with the path that got there.
 *
 * The walk **stops at a `'use server'` module**, and that distinction is the
 * whole difference between a useful check and a wall of false alarms. A client
 * component importing a server action does not bundle the action: Next replaces
 * the import with a remote call, so the action's own imports — the database, the
 * audit log, the mail transport — stay on the server. Descending into one would
 * flag every interactive screen in the application, which is what the first
 * version of this file did.
 */
function reachablePackages(entry: string): Map<string, string[]> {
  const found = new Map<string, string[]>()
  const seen = new Set<string>()

  const visit = (file: string, trail: string[]): void => {
    if (seen.has(file)) return
    seen.add(file)
    if (file !== entry && isServerAction(file)) return

    const source = readFileSync(join(ROOT, file), 'utf8')
    for (const specifier of runtimeImports(source)) {
      const local = resolveLocal(file, specifier)
      if (local) {
        visit(local, [...trail, local])
        continue
      }
      // A package. Record the shallowest route to it.
      const key = specifier.startsWith('@/') ? specifier : specifier.split('/')[0]
      if (!found.has(key)) found.set(key, [...trail, specifier])
    }
  }

  visit(entry, [entry])
  return found
}

describe('the server/client boundary', () => {
  it('finds the client components at all', () => {
    // A resolution bug that found nothing would make every assertion below
    // vacuously true, which is the usual way a check like this stops working.
    expect(CLIENT.length).toBeGreaterThan(5)
  })

  it.each(CLIENT.map((f) => [f] as const))(
    '%s pulls nothing server-only into the browser',
    (file) => {
      const packages = reachablePackages(file)
      for (const { module, because } of FORBIDDEN) {
        const route = packages.get(module)
        expect(
          route,
          route
            ? `${file} reaches ${module} — ${because}\n    via ${route.join('\n     → ')}`
            : '',
        ).toBeUndefined()
      }
    },
  )
})
