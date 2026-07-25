import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { audit } from '@/lib/audit'

/**
 * The invariants WP15 must not break, checked against the source itself.
 *
 * These are not tests of behaviour — they are tests that a *shape* is still
 * true. Every one of them exists because the corresponding rule is easier to
 * break by adding a file than by changing one, and a behavioural test only
 * covers the paths somebody remembered to write.
 */

const ROOT = process.cwd()

function read(relative: string): string {
  return readFileSync(path.join(ROOT, relative), 'utf8')
}

/**
 * The code, with the prose taken out.
 *
 * Several of these assertions are of the form "this string does not appear",
 * and this package's files explain at length *why* they do not do the thing —
 * "not a 403", "`requireOperator`, not `requireAdmin`". A source test that
 * cannot tell an explanation from an instruction fails on its own
 * documentation, and the fix somebody reaches for is to delete the sentence.
 */
function code(relative: string): string {
  return read(relative)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
}

function walk(relative: string): string[] {
  const directory = path.join(ROOT, relative)
  const out: string[] = []

  for (const entry of readdirSync(directory)) {
    const full = path.join(directory, entry)
    if (statSync(full).isDirectory()) {
      out.push(...walk(path.join(relative, entry)))
    } else if (/\.(ts|tsx)$/.test(entry)) {
      out.push(path.join(relative, entry))
    }
  }

  return out
}

const MEDIA_MODULES = walk('src/lib/media').filter((file) => !file.endsWith('.test.ts'))

describe('nothing in the media library knows an investor exists — checklist 5', () => {
  it('no media module imports an investor table, session or portal record', () => {
    // `video.ts` reasons about whether the *portal* is readable, but it does so
    // from a boolean the caller passes; it never looks an account up.
    const offenders = MEDIA_MODULES.filter((file) => {
      const source = read(file)
      return (
        /investorAccounts|investorSessions|readInvestorAccount|loadPortalView/.test(source) &&
        !file.endsWith('boundary.test.ts')
      )
    })

    expect(offenders).toEqual([])
  })

  it('an asset row has no column that could name an investor', () => {
    const schema = read('src/db/schema.ts')
    const assets = schema.slice(
      schema.indexOf("mediaAssets = pgTable('media_assets'"),
      schema.indexOf("operatorVideos = pgTable('operator_videos'"),
    )

    expect(assets.length).toBeGreaterThan(100)
    expect(assets).not.toMatch(/account|investor|offer|recipient/i)
  })

  it('a video row has no column that could name an investor either', () => {
    const schema = read('src/db/schema.ts')
    const videos = schema.slice(
      schema.indexOf("operatorVideos = pgTable('operator_videos'"),
      schema.indexOf("roadmapTiles = pgTable('roadmap_tiles'"),
    )

    expect(videos.length).toBeGreaterThan(100)
    expect(videos).not.toMatch(/account|investor|offer|recipient/i)
    // ownerId is the operator's user id — the person who recorded it.
    expect(videos).toContain('ownerId')
  })

  it('the public image route reads no session and no investor record', () => {
    const source = read('src/app/media/[storageKey]/route.ts')

    expect(source).not.toContain('readInvestorAccount')
    expect(source).not.toContain('investorAccounts')
    expect(source).not.toContain('currentAdmin')
    // It reads exactly one table.
    expect(source.match(/db\.query\.\w+/g)).toEqual(['db.query.mediaAssets'])
  })
})

describe('the video is served only to authenticated investors — §13.3', () => {
  const portalRoute = read('src/app/portal/video/[videoId]/route.ts')
  const previewRoute = read('src/app/(admin)/admin/video/[videoId]/preview/route.ts')

  it('the portal route requires an investor session before anything else', () => {
    expect(portalRoute).toContain('readInvestorAccount')
    const sessionAt = portalRoute.indexOf('readInvestorAccount()')
    const storeAt = portalRoute.indexOf('mediaStore()')
    expect(sessionAt).toBeGreaterThan(0)
    expect(sessionAt).toBeLessThan(storeAt)
  })

  it('both routes ask the same function, so neither can drift from the other', () => {
    expect(portalRoute).toContain('mayViewVideo(')
    expect(previewRoute).toContain('mayViewVideo(')
  })

  it('the portal route passes INVESTOR and never ADMIN', () => {
    expect(portalRoute).toContain("audience: 'INVESTOR'")
    expect(portalRoute).not.toContain("audience: 'ADMIN'")
  })

  it('every refusal is the same 404 — never a 403, and never a different 404', () => {
    for (const source of [
      code('src/app/portal/video/[videoId]/route.ts'),
      code('src/app/(admin)/admin/video/[videoId]/preview/route.ts'),
    ]) {
      expect(source).not.toContain('403')
      expect(source).not.toContain('401')
      // One constructed refusal, reused. Several would be several chances to
      // make one distinguishable from another.
      expect(source.match(/status: 404/g)?.length).toBe(1)
    }
  })

  /**
   * Both video routes now answer range requests, and the arithmetic that makes
   * a 206 correct lives in one module. Two copies of it is the risk the route's
   * old "no ranges here" comment was actually worried about.
   */
  it('neither route builds a range response itself', () => {
    for (const source of [portalRoute, previewRoute]) {
      expect(source).toContain('serveMedia(')
      expect(source).not.toContain('Content-Range')
      expect(source).not.toContain('206')
      expect(source).not.toContain('resolveRange')
    }
  })

  it('a partial response is as private and as unindexed as a whole one', () => {
    const serve = read('src/lib/media/serve.ts')

    // One header table, applied to the 200, the 206 and the 416 alike, so a
    // partial response cannot quietly lose the headers the whole one carries.
    expect(serve.match(/'Cache-Control': 'private, no-store'/g)?.length).toBe(1)
    expect(serve.match(/'X-Robots-Tag'/g)?.length).toBe(1)
    expect(serve).toContain('...BASE_HEADERS')
    expect(serve.match(/\.\.\.BASE_HEADERS/g)?.length).toBe(3)
  })

  it('the range is resolved against the recorded size, never against a read', () => {
    const serve = read('src/lib/media/serve.ts')
    expect(serve).toContain('resolveRange(input.request.headers.get(\'range\'), input.sizeBytes)')
    // The whole object is never fetched in order to answer a partial request.
    const partialBranch = serve.slice(serve.indexOf("outcome.kind === 'partial'"))
    expect(partialBranch.slice(0, partialBranch.indexOf('return new Response'))).not.toContain(
      'store.get(',
    )
  })

  it('never indexed', () => {
    for (const source of [portalRoute, previewRoute]) {
      expect(source).toContain('X-Robots-Tag')
      expect(source).toContain('noindex')
    }
    expect(read('src/app/media/[storageKey]/route.ts')).toContain('noindex')
  })

  it('only two files write to the video table at all, and only one of them publishes', () => {
    const writers = walk('src')
      .filter((file) => !file.endsWith('.test.ts'))
      .filter((file) => /\.(insert|update|delete)\(operatorVideos\)/.test(code(file)))

    expect(writers.sort()).toEqual([
      'src/actions/video.ts',
      'src/app/(admin)/admin/video/upload/route.ts',
      'src/lib/media/video-store.ts',
    ])

    // Publishing is a single statement in a single file, and it is the only
    // place `published_at` is ever set to something other than null.
    const publishers = writers.filter((file) => /publishedAt,\s*updatedAt/.test(code(file)))
    expect(publishers).toEqual(['src/actions/video.ts'])
    expect(code('src/actions/video.ts').match(/publishedAt = new Date\(\)/g)?.length).toBe(1)
  })

  it('the upload route stores a replacement unpublished', () => {
    const source = read('src/app/(admin)/admin/video/upload/route.ts')
    expect(source).toContain('publishedAt: null')
    expect(source).not.toMatch(/publishedAt:\s*new Date/)
  })
})

describe('roles — §13.2 names both, §13.3 names one', () => {
  it('every write in the video actions is operator-only', () => {
    const source = code('src/actions/video.ts')
    const exported = source.match(/export async function \w+/g) ?? []

    expect(exported.length).toBeGreaterThan(3)
    expect(source.match(/requireOperator\(\)/g)?.length).toBe(exported.length)
    expect(source).not.toContain('requireAdmin')
    expect(source).not.toContain('requireOwner')
  })

  it('the upload route applies the same rule and answers with a status instead of a redirect', () => {
    const source = read('src/app/(admin)/admin/video/upload/route.ts')
    expect(source).toContain("admin.role !== 'OPERATOR'")
    expect(source).toContain('access.refused')
  })

  it('the media library is open to both roles, as §13.2 says', () => {
    const source = read('src/actions/media.ts')
    expect(source).toContain('requireOnboardedAdmin')
    expect(source).not.toContain('requireOwner()')
  })
})

describe('no log line carries a body, a transcript or a credential — checklist 8', () => {
  it('the video actions record lengths and flags, never the text', () => {
    const source = read('src/actions/video.ts')
    expect(source).toContain('captionLength')
    expect(source).toContain('transcriptLength')
    expect(source).not.toMatch(/metadata:\s*\{[^}]*\btranscript:/)
    expect(source).not.toMatch(/metadata:\s*\{[^}]*\bcaption:/)
  })

  it('the audit helper refuses a transcript outright, so this cannot be got wrong later', async () => {
    await expect(
      audit({
        actor: { kind: 'system', label: 'test' },
        entityType: 'operator_video',
        action: 'video.published',
        metadata: { transcript: 'Hello, this is David.' },
      }),
    ).rejects.toThrow(/transcript/i)
  })

  it('a refused upload records the reason and not the filename', () => {
    for (const file of ['src/actions/media.ts', 'src/app/(admin)/admin/video/upload/route.ts']) {
      const source = read(file)
      expect(source).toContain('reason: result.reason')
      expect(source).not.toMatch(/metadata:\s*\{[^}]*file\.name/)
    }
  })

  it('no media module logs anything at all', () => {
    for (const file of MEDIA_MODULES) {
      expect(read(file)).not.toMatch(/console\.(log|info|warn|error)/)
    }
  })
})

describe('an image in an email is covered by the compliance approval — §8.2', () => {
  it('the templates screen offers an address to paste, never a variable to resolve', () => {
    const panel = code('src/app/(admin)/templates/media-panel.tsx')

    // A `{{header_image}}` variable would let somebody change what every
    // recipient sees without changing the template hash — the approval would
    // still read as current and would no longer cover the document that went
    // out. The address goes in the source, so the hash covers the image.
    expect(panel).not.toMatch(/\{\{\s*\w*image\w*\s*\}\}/i)
    expect(panel).toContain('absoluteMediaUrl(')

    // And nothing added an image variable to the resolver.
    const variables = code('src/lib/email/variables.ts')
    expect(variables).not.toMatch(/image|media|logo/i)
  })

  it('the screen says that adding one requires a fresh approval', () => {
    const panel = read('src/app/(admin)/templates/media-panel.tsx')
    expect(panel).toContain('changes the hash')
    expect(panel).toContain('approval')
  })

  it('the address offered to an email is absolute, because a mail client has no origin', () => {
    const urls = code('src/lib/media/urls.ts')
    expect(urls).toContain('APP_URL')
    expect(code('src/app/(admin)/templates/media-panel.tsx')).toContain('absoluteMediaUrl')
  })
})

describe('the gates this package must not weaken', () => {
  it('nothing in the media library touches money, a percentage or a send path', () => {
    for (const file of MEDIA_MODULES) {
      const source = read(file)
      expect(source).not.toMatch(/parseFloat|toNumber\(/)
      expect(source).not.toMatch(/sendOneEmail|SmtpTransport|assertCanSend/)
    }
  })

  it('there is one ingest, and every upload path goes through it', () => {
    const uploaders = [
      'src/actions/media.ts',
      'src/app/(admin)/admin/video/upload/route.ts',
    ]

    for (const file of uploaders) {
      const source = code(file)
      expect(source).toContain("from '@/lib/media/ingest'")
      // Nothing writes to a store directly; `ingest` is the only writer.
      expect(source).not.toMatch(/\.put\(/)
    }

    const putters = walk('src')
      .filter((file) => !file.endsWith('.test.ts'))
      .filter((file) => file !== 'src/lib/media/store.ts')
      .filter((file) => /\.put\(/.test(code(file)))

    expect(putters.sort()).toEqual(['src/lib/media/ingest.ts'])
  })

  it('the ingest has no parameter that skips a check', () => {
    const source = read('src/lib/media/ingest.ts')
    expect(source).not.toMatch(/skip|force|trustDeclared|allowAny|unsafe/i)
  })

  it('SVG is refused in the one place formats are listed, with nothing that re-admits it', () => {
    const formats = read('src/lib/media/formats.ts')
    expect(formats).toContain("'image/svg+xml'")
    expect(read('src/lib/media/formats.ts')).not.toMatch(
      /IMAGE_FORMATS\s*=\s*\[[^\]]*svg/i,
    )
  })
})
