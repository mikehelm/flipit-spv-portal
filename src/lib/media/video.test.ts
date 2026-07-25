import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { mayViewVideo, shouldShowVideoSection, videoTextAlternative } from './video'

/**
 * BUILD_SPEC §13.3, and §22's access criteria applied to it.
 *
 * "Nothing is visible to investors until he explicitly publishes it."
 * "Served only to authenticated investors, and never indexed."
 * "If he never records one, the portal shows no gap where it would have been."
 */

const PUBLISHED = new Date('2026-07-20T10:00:00Z')

describe('mayViewVideo', () => {
  it('never shows an unpublished video to an investor', () => {
    expect(
      mayViewVideo({ audience: 'INVESTOR', publishedAt: null, portalReadable: true }),
    ).toBe(false)
  })

  it('shows a published video to a signed-in investor', () => {
    expect(
      mayViewVideo({ audience: 'INVESTOR', publishedAt: PUBLISHED, portalReadable: true }),
    ).toBe(true)
  })

  it('shows nothing at all to somebody who is not signed in — published or not', () => {
    expect(
      mayViewVideo({ audience: 'ANONYMOUS', publishedAt: PUBLISHED, portalReadable: true }),
    ).toBe(false)
    expect(
      mayViewVideo({ audience: 'ANONYMOUS', publishedAt: null, portalReadable: true }),
    ).toBe(false)
  })

  it('follows the portal shut: a suspended account or a disabled service takes the video with it', () => {
    expect(
      mayViewVideo({ audience: 'INVESTOR', publishedAt: PUBLISHED, portalReadable: false }),
    ).toBe(false)
  })

  it('lets the admin preview see it before anyone else, which is the whole point', () => {
    expect(mayViewVideo({ audience: 'ADMIN', publishedAt: null, portalReadable: false })).toBe(
      true,
    )
  })

  it('has no fourth audience and no override', () => {
    const source = readFileSync(path.join(process.cwd(), 'src/lib/media/video.ts'), 'utf8')

    expect(source).not.toMatch(/force|override|bypass|skipPublish|allowUnpublished/i)
    // Exactly three audiences. A fourth would be a way in that nothing tests.
    const audiences = source.match(/'(INVESTOR|ADMIN|ANONYMOUS)'/g) ?? []
    expect(new Set(audiences).size).toBe(3)
  })
})

describe('shouldShowVideoSection', () => {
  it('renders nothing when there is no video — no gap, no placeholder', () => {
    expect(shouldShowVideoSection(null)).toBe(false)
  })

  it('renders nothing when a video exists but has not been published', () => {
    expect(shouldShowVideoSection({ publishedAt: null })).toBe(false)
  })

  it('renders once it is published', () => {
    expect(shouldShowVideoSection({ publishedAt: PUBLISHED })).toBe(true)
  })
})

describe('videoTextAlternative', () => {
  it('reports the caption and transcript for a reader who cannot play sound', () => {
    const result = videoTextAlternative({
      caption: 'A short note from David',
      transcript: 'Hello — thank you for taking a look.',
    })

    expect(result.hasText).toBe(true)
    expect(result.caption).toBe('A short note from David')
    expect(result.transcript).toBe('Hello — thank you for taking a look.')
  })

  it('treats whitespace as absent rather than as an empty caption', () => {
    expect(videoTextAlternative({ caption: '   ', transcript: null })).toEqual({
      caption: null,
      transcript: null,
      hasText: false,
    })
  })
})
