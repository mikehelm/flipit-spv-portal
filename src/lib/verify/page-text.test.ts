import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { everythingSent, flatten, onScreen, type TextReadablePage } from './page-text'

/**
 * The rule that `page-text.ts` exists to hold, and a check that no script goes
 * back to breaking it.
 *
 * This is the second half of a finding. `verify:recorder` had one check failing
 * on half its runs, and the entry that fixed it blamed the wait being on a
 * rendering rather than on a fact — which is true, and is not the mechanism. The
 * mechanism is that **`document.body.textContent` includes the text inside
 * `<script>` elements**, and a Next.js page carries its whole server render
 * again in the body as an inline flight payload. Measured on this application's
 * sign-in page: 8,646 characters of `textContent` against 294 of `innerText`.
 *
 * So the string the wait was looking for was already in the body before the
 * button was pressed, the wait returned immediately, and the request that
 * followed raced a database write it was supposed to be waiting for.
 *
 * Two consequences, and they point in opposite directions:
 *
 *   - a **visibility** check reading `textContent` can pass on text nobody can
 *     see, because the payload holds every branch the server rendered;
 *   - a **leak** check reading `innerText` can pass on a name that was sent and
 *     merely not drawn.
 *
 * Both were live here. Hence two functions rather than one, and hence this
 * source scan: the wrong one is a single word's difference from the right one,
 * and the failure is silent in both directions.
 */

const root = process.cwd()

function scripts(): string[] {
  return readdirSync(join(root, 'scripts'))
    .filter((name) => name.endsWith('.ts'))
    .map((name) => `scripts/${name}`)
}

function read(relative: string): string {
  return readFileSync(join(root, relative), 'utf8')
}

function withoutComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

describe('the two questions have two answers', () => {
  const page: TextReadablePage = {
    locator: () => ({ innerText: async () => '  Only   this\n is drawn  ' }),
    content: async () =>
      '<html><body>Only this is drawn' +
      '<script>self.__next_f.push([1,"a caption nobody sees"])</script>' +
      '<a href="/portal/video/secret-id">x</a></body></html>',
  }

  it('onScreen is what a person can read', async () => {
    expect(await onScreen(page)).toBe('Only this is drawn')
  })

  it('and it does not include the flight payload', async () => {
    expect(await onScreen(page)).not.toContain('a caption nobody sees')
  })

  it('everythingSent includes the payload, which is the point of it', async () => {
    expect(await everythingSent(page)).toContain('a caption nobody sees')
  })

  it('and the attributes too, which neither textContent nor innerText covers', async () => {
    // An id in an href has left the building as surely as one in a paragraph.
    expect(await everythingSent(page)).toContain('secret-id')
    expect(await onScreen(page)).not.toContain('secret-id')
  })

  it('both flatten whitespace, so a check does not depend on the layout', () => {
    expect(flatten('  a \n\n  b  ')).toBe('a b')
  })
})

describe('no verification script reads the body as textContent', () => {
  const offenders = scripts().filter((file) => {
    const code = withoutComments(read(file))
    return (
      /textContent\(['"]body['"]\)/.test(code) ||
      /document\.body\.textContent/.test(code) ||
      /body['"]\)\.textContent/.test(code)
    )
  })

  it('there are scripts to check', () => {
    expect(scripts().length).toBeGreaterThan(20)
  })

  it('and none of them asks the body for its textContent', () => {
    expect(
      offenders,
      'use onScreen() for "is this on the screen" and everythingSent() for "did this leak" — ' +
        'body.textContent is the flight payload and answers neither',
    ).toEqual([])
  })

  /**
   * The scripts that drive a browser must be reading page text through one of
   * the two functions, or through a scoped locator. A script that stops using
   * either has almost certainly gone back to `textContent`.
   */
  it('the browser-driven scripts use the named helpers', () => {
    const browserScripts = scripts().filter((file) => /from 'playwright'/.test(read(file)))
    expect(browserScripts.length).toBeGreaterThanOrEqual(3)

    for (const file of browserScripts) {
      const code = withoutComments(read(file))
      // Either it reads whole-page text through the helpers, or it only ever
      // asks about specific elements — both are fine, and nothing else is.
      const usesHelpers = /onScreen\(|everythingSent\(/.test(code)
      const readsWholePageAnotherWay = /locator\(['"]body['"]\)/.test(code)
      expect(
        usesHelpers || !readsWholePageAnotherWay,
        `${file} reads the whole body without going through page-text.ts`,
      ).toBe(true)
    }
  })
})
