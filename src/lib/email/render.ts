/**
 * Template parsing and rendering.
 *
 * BUILD_SPEC §11.4: "Rendering must fail loudly on any unresolved variable, in
 * both the email and the portal, after the fallback chain above has been
 * applied. A literal `{{recipient_name}}` reaching an investor's inbox is
 * unacceptable. Validate template rendering for every recipient at pre-flight,
 * not at send time."
 *
 * That paragraph is the whole design of this file.
 *
 *   - `renderEmail` throws `UnresolvedVariableError`, and the message names
 *     both the variable and the recipient, because "a variable is missing" is
 *     useless when the batch is forty people.
 *   - `validateBatch` renders every recipient and returns *all* the problems
 *     at once, so pre-flight catches them before the first send rather than
 *     halfway through it.
 *   - Nothing degrades. There is no "leave it blank" path and no default
 *     value anywhere in this file.
 *
 * **Syntax.** Deliberately tiny: `{{variable}}`, `{{#if flag}}…{{/if}}`,
 * `{{#unless flag}}…{{/unless}}`. No loops, no expressions, no helpers, no
 * partials, no arbitrary property access. A template language rich enough to
 * be interesting is rich enough to be a hazard in a document about someone's
 * money.
 *
 * **Escaping.** The HTML part escapes every substituted value. The text part
 * does not, because there is nothing to escape into. The subject line has any
 * CR or LF removed — an unescaped newline in a header is header injection.
 */

import {
  EMAIL_FLAG_NAMES,
  EMAIL_VARIABLE_NAMES,
  isEmailFlag,
  isEmailVariable,
  resolveEmailVariables,
  type EmailFlagName,
  type EmailVariableContext,
  type EmailVariableName,
  type RecipientVariableInput,
  type SenderDefaults,
} from './variables'
import { templateSource, type EmailTemplateKind, type EmailTemplateSource } from './templates'

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/** The template itself is wrong. A bug in the template, not in the data. */
export class TemplateSyntaxError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TemplateSyntaxError'
  }
}

export type EmailPart = 'subject' | 'html' | 'text'

export interface UnresolvedVariable {
  variable: EmailVariableName
  part: EmailPart
  /** Guidance from the resolution chain, when there is any. */
  note?: string
}

/**
 * Thrown by `renderEmail`. The message names the variable and the recipient,
 * which is what makes it actionable in a batch.
 */
export class UnresolvedVariableError extends Error {
  readonly recipientEmail: string
  readonly recipientName: string
  readonly unresolved: readonly UnresolvedVariable[]

  constructor(args: {
    recipientEmail: string
    recipientName: string
    unresolved: readonly UnresolvedVariable[]
  }) {
    const list = args.unresolved
      .map((item) => `{{${item.variable}}} (${item.part})`)
      .join(', ')
    const notes = args.unresolved
      .map((item) => item.note)
      .filter((note): note is string => typeof note === 'string')
    const unique = [...new Set(notes)]

    super(
      `Cannot render the email for ${args.recipientName} <${args.recipientEmail}>: ` +
        `unresolved ${args.unresolved.length === 1 ? 'variable' : 'variables'} ${list}.` +
        (unique.length > 0 ? ` ${unique.join(' ')}` : ''),
    )
    this.name = 'UnresolvedVariableError'
    this.recipientEmail = args.recipientEmail
    this.recipientName = args.recipientName
    this.unresolved = args.unresolved
  }
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

type Token =
  | { kind: 'text'; value: string }
  | { kind: 'var'; name: string }
  | { kind: 'open'; name: string; negate: boolean }
  | { kind: 'close'; negate: boolean }

export type TemplateNode =
  | { type: 'text'; value: string }
  | { type: 'var'; name: EmailVariableName }
  | { type: 'if'; name: string; negate: boolean; children: TemplateNode[] }

const TAG = /\{\{\s*([^{}]*?)\s*\}\}/g
const NAME = /^[a-z][a-z0-9_]*$/

function tokenize(source: string): Token[] {
  const tokens: Token[] = []
  let cursor = 0

  TAG.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = TAG.exec(source)) !== null) {
    if (match.index > cursor) {
      tokens.push({ kind: 'text', value: source.slice(cursor, match.index) })
    }
    cursor = match.index + match[0].length

    const body = match[1]
    if (body === '') {
      throw new TemplateSyntaxError('Empty tag `{{}}` in template.')
    }

    if (body.startsWith('#')) {
      const [keyword, ...rest] = body.slice(1).trim().split(/\s+/)
      if (keyword !== 'if' && keyword !== 'unless') {
        throw new TemplateSyntaxError(
          `Unknown block \`{{#${keyword}}}\`. Only \`#if\` and \`#unless\` exist.`,
        )
      }
      if (rest.length !== 1) {
        throw new TemplateSyntaxError(
          `\`{{#${keyword}}}\` takes exactly one name. Got \`{{${body}}}\`.`,
        )
      }
      tokens.push({ kind: 'open', name: rest[0], negate: keyword === 'unless' })
      continue
    }

    if (body.startsWith('/')) {
      const keyword = body.slice(1).trim()
      if (keyword !== 'if' && keyword !== 'unless') {
        throw new TemplateSyntaxError(`Unknown closing tag \`{{${body}}}\`.`)
      }
      tokens.push({ kind: 'close', negate: keyword === 'unless' })
      continue
    }

    tokens.push({ kind: 'var', name: body })
  }

  if (cursor < source.length) {
    tokens.push({ kind: 'text', value: source.slice(cursor) })
  }

  return tokens
}

/**
 * Remove the line a block tag sits alone on.
 *
 * Without this, `{{#if contact_phone}}` on its own line leaves a stray blank
 * line in the plain-text part whether the block renders or not, and the text
 * alternative has to read as well as the HTML one (§11.5).
 */
function trimStandaloneBlockLines(tokens: Token[]): Token[] {
  const out = tokens.map((token) => ({ ...token }))

  for (let i = 0; i < out.length; i += 1) {
    const token = out[i]
    if (token.kind !== 'open' && token.kind !== 'close') continue

    const before = i > 0 ? out[i - 1] : undefined
    const after = i + 1 < out.length ? out[i + 1] : undefined

    // Nothing but whitespace between the tag and the start of its line.
    let beforeOk = false
    let beforeTrimmed = ''
    if (before === undefined) {
      beforeOk = true
    } else if (before.kind === 'text') {
      const newline = before.value.lastIndexOf('\n')
      const tail = before.value.slice(newline + 1)
      if (/^[ \t]*$/.test(tail) && (newline >= 0 || i === 1)) {
        beforeOk = true
        beforeTrimmed = before.value.slice(0, newline + 1)
      }
    }

    // Nothing but whitespace between the tag and the end of its line.
    let afterOk = false
    let afterTrimmed = ''
    if (after === undefined) {
      afterOk = true
    } else if (after.kind === 'text') {
      const newline = after.value.indexOf('\n')
      const head = newline === -1 ? after.value : after.value.slice(0, newline)
      if (/^[ \t]*$/.test(head)) {
        afterOk = true
        afterTrimmed = newline === -1 ? '' : after.value.slice(newline + 1)
      }
    }

    if (!beforeOk || !afterOk) continue

    if (before !== undefined && before.kind === 'text') before.value = beforeTrimmed
    if (after !== undefined && after.kind === 'text') after.value = afterTrimmed
  }

  return out.filter((token) => token.kind !== 'text' || token.value !== '')
}

/**
 * Parse a template part into a tree.
 *
 * Throws on: an unknown variable, an unknown condition, an unbalanced block,
 * or a `{{/if}}` closing a `{{#unless}}`. All of those are template bugs and
 * none of them should ever be discovered by an investor.
 */
export function parseTemplate(source: string): TemplateNode[] {
  const tokens = trimStandaloneBlockLines(tokenize(source))

  const root: TemplateNode[] = []
  const stack: Array<{ node: Extract<TemplateNode, { type: 'if' }>; siblings: TemplateNode[] }> =
    []
  let current = root

  for (const token of tokens) {
    switch (token.kind) {
      case 'text':
        current.push({ type: 'text', value: token.value })
        break

      case 'var': {
        if (!isEmailVariable(token.name)) {
          if (isEmailFlag(token.name)) {
            throw new TemplateSyntaxError(
              `\`{{${token.name}}}\` is a condition, not a value. Use it as \`{{#if ${token.name}}}\`.`,
            )
          }
          throw new TemplateSyntaxError(
            `\`{{${token.name}}}\` is not a declared email variable. Declared: ${EMAIL_VARIABLE_NAMES.join(', ')}.`,
          )
        }
        current.push({ type: 'var', name: token.name })
        break
      }

      case 'open': {
        if (!NAME.test(token.name)) {
          throw new TemplateSyntaxError(`\`${token.name}\` is not a valid condition name.`)
        }
        if (!isEmailFlag(token.name) && !isEmailVariable(token.name)) {
          throw new TemplateSyntaxError(
            `\`{{#if ${token.name}}}\` names nothing that exists. Conditions: ${EMAIL_FLAG_NAMES.join(', ')}, or any declared variable.`,
          )
        }
        const node: Extract<TemplateNode, { type: 'if' }> = {
          type: 'if',
          name: token.name,
          negate: token.negate,
          children: [],
        }
        current.push(node)
        stack.push({ node, siblings: current })
        current = node.children
        break
      }

      case 'close': {
        const frame = stack.pop()
        if (!frame) {
          throw new TemplateSyntaxError(
            `\`{{/${token.negate ? 'unless' : 'if'}}}\` closes a block that was never opened.`,
          )
        }
        if (frame.node.negate !== token.negate) {
          throw new TemplateSyntaxError(
            `\`{{#${frame.node.negate ? 'unless' : 'if'} ${frame.node.name}}}\` was closed with \`{{/${token.negate ? 'unless' : 'if'}}}\`.`,
          )
        }
        current = frame.siblings
        break
      }
    }
  }

  if (stack.length > 0) {
    const open = stack[stack.length - 1].node
    throw new TemplateSyntaxError(
      `\`{{#${open.negate ? 'unless' : 'if'} ${open.name}}}\` is never closed.`,
    )
  }

  return root
}

/** Every variable the template can reference, in any branch. Used by tests. */
export function referencedVariables(source: string): Set<EmailVariableName> {
  const found = new Set<EmailVariableName>()
  const walk = (nodes: TemplateNode[]) => {
    for (const node of nodes) {
      if (node.type === 'var') found.add(node.name)
      else if (node.type === 'if') {
        if (isEmailVariable(node.name)) found.add(node.name)
        walk(node.children)
      }
    }
  }
  walk(parseTemplate(source))
  return found
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

const HTML_ESCAPES: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => HTML_ESCAPES[character])
}

function conditionHolds(name: string, context: EmailVariableContext): boolean {
  if (isEmailFlag(name)) return context.flags[name as EmailFlagName]
  if (isEmailVariable(name)) {
    const value = context.variables[name as EmailVariableName]
    return typeof value === 'string' && value.trim() !== ''
  }
  // parseTemplate rejects anything else, so this is unreachable in practice.
  throw new TemplateSyntaxError(`Unknown condition \`${name}\`.`)
}

interface RenderPartResult {
  output: string
  unresolved: UnresolvedVariable[]
}

/**
 * Render one part. Collects every unresolved variable rather than stopping at
 * the first, so a preflight report is complete in one pass.
 *
 * A variable that is absent but sits inside a conditional block that did not
 * render is not unresolved — it was never asked for. That is exactly the
 * mechanism that lets `EMAIL_ONLY` drop the phone line instead of blocking the
 * send (§2.1 step 2), while a genuinely missing `sender_phone` under `PHONE`
 * still blocks it (§11.2, AC21).
 */
export function renderPart(
  source: string,
  context: EmailVariableContext,
  options: { escape: 'html' | 'none'; part: EmailPart },
): RenderPartResult {
  const nodes = parseTemplate(source)
  const unresolved: UnresolvedVariable[] = []
  const chunks: string[] = []

  const walk = (list: TemplateNode[]) => {
    for (const node of list) {
      if (node.type === 'text') {
        chunks.push(node.value)
        continue
      }

      if (node.type === 'if') {
        const holds = conditionHolds(node.name, context)
        if (holds !== node.negate) walk(node.children)
        continue
      }

      const value = context.variables[node.name]
      if (value === null || value.trim() === '') {
        unresolved.push({
          variable: node.name,
          part: options.part,
          note: context.notes[node.name],
        })
        // Nothing is substituted. A partially rendered body must never be
        // usable by accident, and `renderEmail` throws before it can be.
        continue
      }
      chunks.push(options.escape === 'html' ? escapeHtml(value) : value)
    }
  }

  walk(nodes)
  return { output: chunks.join(''), unresolved }
}

export interface RenderedEmail {
  kind: EmailTemplateKind
  subject: string
  html: string
  text: string
  /** SHA-256 of the template SOURCE this was rendered from (§8.2). */
  templateHash: string
}

/** A subject line is a header. A newline in one is an injection. */
function flattenSubject(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').replace(/\s{2,}/g, ' ').trim()
}

/**
 * Render one email for one recipient, or throw.
 *
 * There is no lenient mode and no partial result. §11.4 is unambiguous about
 * what a half-rendered invitation is worth.
 */
export function renderEmail(
  template: EmailTemplateSource,
  input: RecipientVariableInput,
  defaults: SenderDefaults,
): RenderedEmail {
  const context = resolveEmailVariables(input, defaults)

  const subject = renderPart(template.subject, context, {
    escape: 'none',
    part: 'subject',
  })
  const html = renderPart(template.htmlSource, context, { escape: 'html', part: 'html' })
  const text = renderPart(template.textSource, context, { escape: 'none', part: 'text' })

  const unresolved = [...subject.unresolved, ...html.unresolved, ...text.unresolved]
  if (unresolved.length > 0) {
    throw new UnresolvedVariableError({
      recipientEmail: input.recipientEmail,
      recipientName: input.recipientName,
      unresolved,
    })
  }

  return {
    kind: template.kind,
    subject: flattenSubject(subject.output),
    html: html.output,
    text: text.output,
    templateHash: template.hash,
  }
}

/** Convenience: render the current built-in template for a kind. */
export function renderTemplateKind(
  kind: EmailTemplateKind,
  input: RecipientVariableInput,
  defaults: SenderDefaults,
): RenderedEmail {
  return renderEmail(templateSource(kind), input, defaults)
}

// ---------------------------------------------------------------------------
// Pre-flight — BUILD_SPEC §19, AC21
// ---------------------------------------------------------------------------

export interface BatchProblem {
  offerId: string
  recipientName: string
  recipientEmail: string
  kind: EmailTemplateKind
  variable: EmailVariableName
  part: EmailPart
  note?: string
}

export interface BatchValidationResult {
  ok: boolean
  checked: number
  /** Every unresolved variable across every recipient and every template. */
  problems: BatchProblem[]
  /** Recipients with at least one problem, in the order they were supplied. */
  affectedOfferIds: string[]
  /**
   * A template that will not parse at all. Not a per-recipient failure —
   * nothing in the batch can send until it is fixed.
   */
  templateErrors: Array<{ kind: EmailTemplateKind; message: string }>
  /**
   * Something in the service configuration is unfinished, so no recipient in
   * the batch can be rendered honestly. Kept apart from `templateErrors`
   * because the fix is in settings rather than in a template, and apart from
   * `problems` because it is not attributable to any one recipient.
   */
  configurationErrors: string[]
}

/**
 * Render every recipient in the batch against every template that will be sent
 * to them, and report every problem at once.
 *
 * §11.4: "Validate template rendering for every recipient at pre-flight, not
 * at send time — an unresolved variable should be caught before the batch
 * starts, not halfway through it." AC21 names the specific case this exists
 * for: a row with no `sender_phone` and no configured default.
 *
 * This function sends nothing, writes nothing, and mutates nothing.
 */
export function validateBatch(
  recipients: readonly RecipientVariableInput[],
  defaults: SenderDefaults,
  options: { kinds?: readonly EmailTemplateKind[]; templates?: readonly EmailTemplateSource[] } = {},
): BatchValidationResult {
  const templates =
    options.templates ??
    (options.kinds ?? (['INVITATION', 'REMINDER'] as const)).map((kind) =>
      templateSource(kind),
    )

  const problems: BatchProblem[] = []
  const templateErrors: BatchValidationResult['templateErrors'] = []
  const configurationErrors: string[] = []
  const affected = new Set<string>()

  // §2.1 step 2 unanswered. Both contact flags are false, so every contact
  // block is skipped and every recipient renders perfectly — which is exactly
  // why this has to be checked here rather than inferred from the render. An
  // invitation to a securities offer that names no way to reach a human is not
  // a thing this application sends.
  if (defaults.contactMethod === null) {
    configurationErrors.push(
      'The operator has not chosen a contact method (BUILD_SPEC §2.1 step 2). ' +
        'Finish operator onboarding before sending — otherwise the invitation ' +
        'carries no way to make contact.',
    )
  }

  const parsed: EmailTemplateSource[] = []
  for (const template of templates) {
    try {
      parseTemplate(template.subject)
      parseTemplate(template.htmlSource)
      parseTemplate(template.textSource)
      parsed.push(template)
    } catch (error) {
      templateErrors.push({
        kind: template.kind,
        message: error instanceof Error ? error.message : String(error),
      })
    }
  }

  for (const recipient of recipients) {
    for (const template of parsed) {
      try {
        renderEmail(template, recipient, defaults)
      } catch (error) {
        if (error instanceof UnresolvedVariableError) {
          affected.add(recipient.offerId)
          for (const item of error.unresolved) {
            problems.push({
              offerId: recipient.offerId,
              recipientName: recipient.recipientName,
              recipientEmail: recipient.recipientEmail,
              kind: template.kind,
              variable: item.variable,
              part: item.part,
              note: item.note,
            })
          }
          continue
        }
        // A malformed deadline, or anything else the resolver refuses. It is
        // still a per-recipient failure and it still belongs in the report.
        affected.add(recipient.offerId)
        templateErrors.push({
          kind: template.kind,
          message: `${recipient.recipientName} <${recipient.recipientEmail}>: ${
            error instanceof Error ? error.message : String(error)
          }`,
        })
      }
    }
  }

  return {
    ok:
      problems.length === 0 &&
      templateErrors.length === 0 &&
      configurationErrors.length === 0,
    checked: recipients.length,
    problems,
    affectedOfferIds: [...affected],
    templateErrors,
    configurationErrors,
  }
}
