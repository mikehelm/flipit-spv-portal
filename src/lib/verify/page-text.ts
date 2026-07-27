/**
 * Two different questions about what a page contains, and the two different
 * answers a browser can give.
 *
 * Every browser-driven verification script in this repository asks both, and
 * until now two of them asked both the same way — `page.textContent('body')` —
 * which answers neither reliably.
 *
 * **`document.body.textContent` includes the text of `<script>` elements**, and
 * a Next.js page carries its entire server render again inside the body as an
 * inline React flight payload. Measured on this application's own sign-in page:
 *
 *     document.body.textContent   8,646 characters
 *     document.body.innerText       294 characters
 *
 * Every one of the other 8,352 characters is payload. So a check reading
 * `textContent` is reading a transcript of what the server sent on first load,
 * not what is on the screen — and the payload **never changes** when a server
 * action re-renders part of the page, because the re-render arrives over fetch.
 *
 * That is not a theoretical problem. It is what made `verify:recorder`'s
 * *"taking it down puts it back out of reach"* fail on half its runs: it waited
 * for `document.body.textContent` to contain "Publish to the portal" before
 * asking the video route, and that string was already in the first load's
 * payload, so the wait returned instantly and the request raced the write.
 *
 * The fix is not to replace one with the other everywhere. **The two questions
 * want different answers:**
 *
 *   - *"Is the operator told X?"* — a claim about what a person can read. The
 *     payload is irrelevant and misleading. Use `onScreen`.
 *   - *"Did anything about another investor reach this browser?"* — a claim about
 *     what was **sent**. Here the payload is the point: a name the server put in
 *     the flight data has left the building whether or not CSS drew it. Use
 *     `everythingSent`, which is stricter than either textContent or innerText
 *     because it covers attributes too.
 *
 * A leak check written against `onScreen` would pass on a page that shipped a
 * name and hid it. A visibility check written against the payload passes on
 * text nobody can see. Both mistakes were live in this repository.
 */

/** Anything with the two methods these need — `Page` from Playwright, or a stub. */
export interface TextReadablePage {
  locator(selector: string): { innerText(): Promise<string> }
  content(): Promise<string>
}

/** Collapse runs of whitespace so a check does not depend on how it was laid out. */
export function flatten(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

/**
 * What a person can actually read.
 *
 * `innerText` is layout-aware: it excludes `<script>` and `<style>`, and it
 * excludes anything not rendered — the contents of a closed `<details>`, an
 * element with `display: none`. That is the correct reading of "is this on the
 * screen", and it is the reason a check using it may need to open a `<details>`
 * first, which is honest: a person would have to as well.
 */
export async function onScreen(page: TextReadablePage): Promise<string> {
  return flatten(await page.locator('body').innerText())
}

/**
 * Everything the server sent this browser: markup, attributes and the inline
 * flight payload.
 *
 * For "did X leak" this is the only fair question. An id in an `href`, a name in
 * a `data-` attribute and a caption in the flight payload are all things that
 * reached the browser, and none of them appear in `innerText`.
 */
export async function everythingSent(page: TextReadablePage): Promise<string> {
  return flatten(await page.content())
}
