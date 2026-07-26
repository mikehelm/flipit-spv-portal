/**
 * How large an import file may be, and the sentence that says so. BUILD_SPEC §9.1.
 *
 * A module of its own for the same reason `tooLargeMessage` sits in
 * `media/formats.ts`: **the browser has to know the limit too.** The wizard is a
 * client component and it posts the chosen file to a server action, so it has
 * to be able to refuse an oversized one before it builds the body — a body over
 * the server action limit in `next.config.ts` never reaches the action, and an
 * action that never runs cannot explain itself.
 *
 * `table.ts` cannot be that module: it imports the whole spreadsheet reader, and
 * pulling that into the browser to learn one number would put a megabyte of
 * parser in the wizard's bundle.
 *
 * The number was written down in three places before this file existed — the
 * reader, the action's schema, and the wizard's own prose — with three
 * different sentences for the same refusal. `limits.test.ts` now asserts there
 * is one.
 */

/**
 * Five megabytes.
 *
 * A register of a few hundred investors is tens of kilobytes as a `.csv` and a
 * few hundred as an `.xlsx`. Five megabytes is a scanned-in spreadsheet with
 * images pasted into it, which is a file worth refusing on its own merits, and
 * it is well under `MAX_ROWS` in practice — a five-megabyte `.csv` has far more
 * than five thousand rows.
 */
export const MAX_FILE_BYTES = 5 * 1024 * 1024

/** One decimal place, so a 5.4 MB file is not reported as 5 MB. */
function megabytes(bytes: number): string {
  return `${Math.round((bytes / (1024 * 1024)) * 10) / 10} MB`
}

/**
 * The refusal, in one sentence, used by the reader, the action and the browser.
 *
 * It names both numbers for the same reason the media one does: a message that
 * names only the limit leaves the operator wondering which of the two files on
 * their desktop they actually chose.
 */
export function importTooLargeMessage(bytes: number): string {
  return (
    `That file is ${megabytes(bytes)} and the limit is ${megabytes(MAX_FILE_BYTES)}. ` +
    'Nothing was read. Check it is the right file.'
  )
}
