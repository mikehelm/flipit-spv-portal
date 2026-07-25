/**
 * A line diff, for showing what changed in a template after it drifted away
 * from its compliance approval. BUILD_SPEC §8.2 item 2: "Show a diff so it is
 * obvious what changed."
 *
 * Small and self-contained on purpose. The alternative is a dependency, and
 * this runs on exactly three strings — a subject line and two bodies — where a
 * plain longest-common-subsequence is both fast enough and easy to read.
 *
 * Nothing in here may ever reach the audit log or a log line: these are email
 * bodies (§15). Counts and hashes are what gets recorded; the text is for the
 * owner's screen only.
 */

export type DiffLineKind = 'CONTEXT' | 'ADDED' | 'REMOVED'

export interface DiffLine {
  kind: DiffLineKind
  /** 1-based line number in the approved source, when the line exists there. */
  approvedLineNo: number | null
  /** 1-based line number in the live source, when the line exists there. */
  liveLineNo: number | null
  text: string
}

export type TemplatePart = 'SUBJECT' | 'HTML' | 'TEXT'

export interface PartDiff {
  part: TemplatePart
  changed: boolean
  added: number
  removed: number
  /** Changed lines with a little surrounding context. Empty when unchanged. */
  lines: DiffLine[]
  /** True when context was elided between hunks. */
  truncated: boolean
}

export interface TemplateDiff {
  parts: PartDiff[]
  changedParts: TemplatePart[]
  totalAdded: number
  totalRemoved: number
  /** One line, safe to show anywhere a body is not. */
  summary: string
}

export interface TemplateSourceParts {
  subject: string
  htmlSource: string
  textSource: string
}

/** Lines of context kept either side of a change. */
const CONTEXT_LINES = 2

function split(value: string): string[] {
  // A trailing newline should not read as a phantom empty last line, but a
  // deliberate blank line in the middle must survive.
  const normalised = value.replace(/\r\n/g, '\n')
  const lines = normalised.split('\n')
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop()
  return lines
}

/**
 * Longest common subsequence table, then a walk back through it.
 *
 * O(n·m). Templates are hundreds of lines, not hundreds of thousands, and the
 * clarity is worth more here than the constant factor.
 */
function diffLines(approved: string[], live: string[]): DiffLine[] {
  const n = approved.length
  const m = live.length

  const table: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      table[i][j] =
        approved[i] === live[j]
          ? table[i + 1][j + 1] + 1
          : Math.max(table[i + 1][j], table[i][j + 1])
    }
  }

  const out: DiffLine[] = []
  let i = 0
  let j = 0

  while (i < n && j < m) {
    if (approved[i] === live[j]) {
      out.push({ kind: 'CONTEXT', approvedLineNo: i + 1, liveLineNo: j + 1, text: approved[i] })
      i += 1
      j += 1
    } else if (table[i + 1][j] >= table[i][j + 1]) {
      out.push({ kind: 'REMOVED', approvedLineNo: i + 1, liveLineNo: null, text: approved[i] })
      i += 1
    } else {
      out.push({ kind: 'ADDED', approvedLineNo: null, liveLineNo: j + 1, text: live[j] })
      j += 1
    }
  }
  while (i < n) {
    out.push({ kind: 'REMOVED', approvedLineNo: i + 1, liveLineNo: null, text: approved[i] })
    i += 1
  }
  while (j < m) {
    out.push({ kind: 'ADDED', approvedLineNo: null, liveLineNo: j + 1, text: live[j] })
    j += 1
  }

  return out
}

/** Keep changed lines and a little context; drop long unchanged stretches. */
function condense(lines: DiffLine[]): { lines: DiffLine[]; truncated: boolean } {
  const keep = new Set<number>()
  lines.forEach((line, index) => {
    if (line.kind === 'CONTEXT') return
    for (
      let at = Math.max(0, index - CONTEXT_LINES);
      at <= Math.min(lines.length - 1, index + CONTEXT_LINES);
      at += 1
    ) {
      keep.add(at)
    }
  })

  if (keep.size === lines.length) return { lines, truncated: false }

  const kept = lines.filter((_line, index) => keep.has(index))
  return { lines: kept, truncated: true }
}

function diffPart(part: TemplatePart, approved: string, live: string): PartDiff {
  if (approved === live) {
    return { part, changed: false, added: 0, removed: 0, lines: [], truncated: false }
  }

  const all = diffLines(split(approved), split(live))
  const added = all.filter((line) => line.kind === 'ADDED').length
  const removed = all.filter((line) => line.kind === 'REMOVED').length

  // The strings differ but every line survived — a trailing newline, or a
  // CRLF/LF difference. Nothing a reader could be shown, so nothing to show.
  // The hashes still differ and sending is still disabled: this only decides
  // what the diff view renders, never whether the template is approved.
  if (added === 0 && removed === 0) {
    return { part, changed: false, added: 0, removed: 0, lines: [], truncated: false }
  }

  const { lines, truncated } = condense(all)

  return { part, changed: true, added, removed, lines, truncated }
}

const PART_LABEL: Readonly<Record<TemplatePart, string>> = {
  SUBJECT: 'subject line',
  HTML: 'HTML body',
  TEXT: 'plain-text body',
}

export function partLabel(part: TemplatePart): string {
  return PART_LABEL[part]
}

/**
 * Diff an approved template source against the live one.
 *
 * Both are SOURCES, including their conditional blocks (§2.1) — the same thing
 * that was hashed. Diffing rendered output would show the operator's contact
 * method changing and call it a template change, which is exactly the mistake
 * §2.1 exists to prevent.
 */
export function diffTemplateSource(
  approved: TemplateSourceParts,
  live: TemplateSourceParts,
): TemplateDiff {
  const parts = [
    diffPart('SUBJECT', approved.subject, live.subject),
    diffPart('HTML', approved.htmlSource, live.htmlSource),
    diffPart('TEXT', approved.textSource, live.textSource),
  ]

  const changedParts = parts.filter((part) => part.changed).map((part) => part.part)
  const totalAdded = parts.reduce((sum, part) => sum + part.added, 0)
  const totalRemoved = parts.reduce((sum, part) => sum + part.removed, 0)

  const summary =
    changedParts.length === 0
      ? 'No line differs from the approved version. If the hashes still disagree the ' +
        'difference is invisible — a trailing newline or a line ending — and sending stays ' +
        'disabled until it is re-approved regardless.'
      : `${changedParts.map((part) => PART_LABEL[part]).join(', ')} changed: ` +
        `${totalAdded} line${totalAdded === 1 ? '' : 's'} added, ` +
        `${totalRemoved} removed.`

  return { parts, changedParts, totalAdded, totalRemoved, summary }
}
