import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

function pngSize(path: string): { width: number; height: number } {
  const png = readFileSync(path)
  expect(png.subarray(1, 4).toString()).toBe('PNG')
  return {
    width: png.readUInt32BE(16),
    height: png.readUInt32BE(20),
  }
}

describe('private-link sharing metadata', () => {
  it('uses a privacy-safe title and description without identifying a recipient', () => {
    const layout = readFileSync('src/app/layout.tsx', 'utf8')

    expect(layout).toContain('Flipit Global SPV — Private Review')
    expect(layout).toContain(
      'Invitation-only workspace for organized review and collaboration.',
    )
    expect(layout).not.toMatch(/grahambrain|serenedavid|@gmail\.com/i)
  })

  it('ships correctly sized icon and social-preview artwork', () => {
    expect(pngSize('src/app/icon.png')).toEqual({ width: 512, height: 512 })
    expect(pngSize('src/app/opengraph-image.png')).toEqual({
      width: 1200,
      height: 630,
    })
  })

  it('publishes the exact square icon for link previews and preserves noindex', () => {
    const layout = readFileSync('src/app/layout.tsx', 'utf8')

    expect(layout).toContain("card: 'summary'")
    expect(layout).toContain("url: '/icon.png'")
    expect(layout).toContain("images: ['/icon.png']")
    expect(layout).toContain('robots: { index: false, follow: false, nocache: true }')
  })
})
