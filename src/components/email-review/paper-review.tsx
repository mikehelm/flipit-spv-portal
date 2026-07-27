'use client'

/**
 * Paper review: the two letters as pages on a desk.
 *
 * The spread is one CSS grid, and every cell carries a *column* only. Grid
 * auto-placement supplies the rows: with a definite column on each item the
 * placement cursor runs left, gutter, right and then drops a row, so a paired
 * change is one grid row — and one grid row is one height, which is why the two
 * sides stay level with each other with no synchronising JavaScript.
 *
 * The rows used to be placed with `style={{ gridRow }}`. They cannot be.
 * `style-src 'self'` refuses a style attribute parsed from markup, so on the
 * server-rendered page every one of those declarations was dropped, the grid
 * collapsed, and the pencil marks — which rely on their container being
 * positioned — escaped across the header. Nothing in this file may carry a
 * `style` attribute; `markup.test.ts` fails if one comes back.
 *
 * The sheets are a separate absolutely-positioned layer using the same
 * `--columns`, rather than grid items spanning every row: an item with a
 * definite row *and* column occupies those cells, and auto-placement would then
 * have had to route every paragraph around it.
 */

import { Fragment, useMemo, useState } from 'react'
import type { EmailReviewClause } from '@/lib/email-review/document'
import type { EmailDiffUnit } from '@/lib/email-review/segments'
import { AnnotationBalloon } from './annotation-balloon'
import {
  buildPassageAnnotation,
  handSeed,
  markPassage,
  passageText,
  type MarkToken,
  type PaperSide,
  type PassageAnnotation,
} from './markup'
import styles from './paper.module.css'
import { MarginMark, PencilLoop, TieStroke } from './pencil'

const BALLOON_ID = 'email-review-annotation'

interface ActiveBalloon {
  unitId: string
  side: PaperSide
  element: HTMLElement
  pinned: boolean
}

function Passage({
  unit,
  side,
  tokens,
  annotation,
  selected,
  described,
  markup,
  onSelect,
  onHover,
  onFocus,
  onClose,
  onToggle,
}: {
  unit: EmailDiffUnit
  side: PaperSide
  tokens: MarkToken[]
  annotation: PassageAnnotation
  selected: boolean
  described: boolean
  markup: boolean
  onSelect: () => void
  onHover: (element: HTMLElement) => void
  onFocus: (element: HTMLElement) => void
  onClose: () => void
  onToggle: (element: HTMLElement) => void
}) {
  const empty = unit[side].length === 0
  const seed = handSeed(`${unit.id}-${side}`)
  // Markup off is enforced here rather than by a rule the stylesheet might not
  // get to apply: with the pencil down, no mark is rendered at all.
  const marked = markup && unit.kind !== 'UNCHANGED' && !empty

  return (
    <button
      type="button"
      className={styles.passage}
      data-selected={selected ? 'true' : 'false'}
      data-diff-unit={unit.id}
      data-diff-side={side}
      aria-pressed={selected}
      aria-describedby={described ? BALLOON_ID : undefined}
      onClick={(event) => {
        onSelect()
        onToggle(event.currentTarget)
      }}
      onPointerEnter={(event) => onHover(event.currentTarget)}
      onPointerLeave={onClose}
      onFocus={(event) => onFocus(event.currentTarget)}
      onBlur={onClose}
    >
      <span className="sr-only">
        {annotation.status}: {annotation.title}.{' '}
        {annotation.unverified
          ? 'No reason recorded.'
          : 'Recorded reason available.'}
      </span>

      {marked ? <MarginMark kind={unit.kind} seed={seed} /> : null}
      {marked && unit.kind === 'CHANGED' ? <PencilLoop seed={seed} /> : null}

      {empty ? (
        <span className={`${styles.inkFaint} block py-1 text-xs italic leading-6`}>
          {unit.kind === 'ADDED'
            ? 'No equivalent in David’s original.'
            : 'Removed from the current invitation.'}
        </span>
      ) : (
        <span
          className={`${styles.serif} ${styles.body} block whitespace-pre-wrap text-sm`}
        >
          {tokens.map((token, index) => (
            <span
              key={`${unit.id}-${side}-${index}`}
              className={
                markup && token.state !== 'same' ? styles[token.state] : undefined
              }
            >
              {token.text}
            </span>
          ))}
        </span>
      )}
    </button>
  )
}

export function PaperReview({
  diffUnits,
  clauses,
  selectedId,
  markup,
  onSelect,
}: {
  diffUnits: readonly EmailDiffUnit[]
  clauses: readonly EmailReviewClause[]
  selectedId: string | null
  markup: boolean
  onSelect: (unit: EmailDiffUnit) => void
}) {
  const [active, setActive] = useState<ActiveBalloon | null>(null)

  const passages = useMemo(
    () =>
      diffUnits.map((unit) => ({
        unit,
        annotation: buildPassageAnnotation(unit, clauses),
        tokens: markPassage(
          passageText(unit.original),
          passageText(unit.current),
        ),
      })),
    [diffUnits, clauses],
  )

  /**
   * Three ways in, and they do not fight each other. Hovering is a glance, so
   * it never disturbs a note somebody has pinned. Moving the keyboard focus is
   * a deliberate move, so it always takes the balloon with it. Clicking pins
   * and unpins.
   */
  function hover(unitId: string, side: PaperSide, element: HTMLElement) {
    setActive((previous) =>
      previous?.pinned ? previous : { unitId, side, element, pinned: false },
    )
  }

  function focus(unitId: string, side: PaperSide, element: HTMLElement) {
    setActive({ unitId, side, element, pinned: false })
  }

  function close() {
    setActive((previous) => (previous?.pinned ? previous : null))
  }

  function toggle(unitId: string, side: PaperSide, element: HTMLElement) {
    setActive((previous) => ({
      unitId,
      side,
      element,
      pinned: !(
        previous?.pinned &&
        previous.unitId === unitId &&
        previous.side === side
      ),
    }))
  }

  const activeAnnotation = passages.find(
    (entry) => entry.unit.id === active?.unitId,
  )?.annotation

  return (
    <section
      className={`${styles.root} rounded-sm border hairline`}
      aria-label="Paper review"
      data-markup={markup ? 'on' : 'off'}
    >
      <div className={styles.desk}>
        <div className={styles.stage}>
          <div className={styles.paperLayer} aria-hidden="true">
            <div className={`${styles.sheet} ${styles.sheetLeft}`} />
            <div className={`${styles.sheet} ${styles.sheetRight}`} />
          </div>

          <div className={styles.spread}>
            <header
              className={`${styles.colLeft} ${styles.cell} ${styles.letterhead}`}
            >
              <h2
                className={`${styles.ink} text-[11px] font-bold uppercase tracking-[0.18em]`}
              >
                David’s original
              </h2>
              <p className={`${styles.inkFaint} mt-1 text-[11px] leading-5`}>
                Preserved from Gmail · 25 July 2026
              </p>
            </header>
            <div className={styles.colTie} />
            <header
              className={`${styles.colRight} ${styles.cell} ${styles.letterhead}`}
            >
              <h2
                className={`${styles.ink} text-[11px] font-bold uppercase tracking-[0.18em]`}
              >
                Current invitation
              </h2>
              <p className={`${styles.inkFaint} mt-1 text-[11px] leading-5`}>
                The email source that would actually be sent
              </p>
            </header>

            {passages.map(({ unit, annotation, tokens }, index) => {
              const selected = selectedId === unit.id
              const rule = index > 0 ? styles.rule : ''
              return (
                <Fragment key={unit.id}>
                  <div
                    id={unit.id}
                    className={`${styles.colLeft} ${styles.cell} ${rule}`}
                  >
                    <Passage
                      unit={unit}
                      side="original"
                      tokens={tokens.original}
                      annotation={annotation}
                      selected={selected}
                      markup={markup}
                      described={
                        active?.unitId === unit.id && active?.side === 'original'
                      }
                      onSelect={() => onSelect(unit)}
                      onHover={(element) => hover(unit.id, 'original', element)}
                      onFocus={(element) => focus(unit.id, 'original', element)}
                      onClose={close}
                      onToggle={(element) => toggle(unit.id, 'original', element)}
                    />
                  </div>

                  <div className={styles.colTie}>
                    {unit.kind !== 'UNCHANGED' ? (
                      <TieStroke seed={handSeed(unit.id)} on={selected} />
                    ) : null}
                  </div>

                  <div className={`${styles.colRight} ${styles.cell} ${rule}`}>
                    <Passage
                      unit={unit}
                      side="current"
                      tokens={tokens.current}
                      annotation={annotation}
                      selected={selected}
                      markup={markup}
                      described={
                        active?.unitId === unit.id && active?.side === 'current'
                      }
                      onSelect={() => onSelect(unit)}
                      onHover={(element) => hover(unit.id, 'current', element)}
                      onFocus={(element) => focus(unit.id, 'current', element)}
                      onClose={close}
                      onToggle={(element) => toggle(unit.id, 'current', element)}
                    />
                  </div>
                </Fragment>
              )
            })}

            <div className={`${styles.colLeft} ${styles.foot}`} />
            <div className={styles.colTie} />
            <div className={`${styles.colRight} ${styles.foot}`} />
          </div>
        </div>
      </div>

      <footer className={`${styles.legend} border-t hairline bg-paper`}>
        <p className="text-[11px] leading-5 text-muted">
          {markup
            ? 'Pencil marks: an underline is wording that arrived, a strike is wording that left, a loop is a rewritten passage, and the margin rule marks the paragraph. Hover, focus or click a passage for the recorded reason.'
            : 'Markup is off, so both letters read as clean pages. Selecting a passage still focuses its pair and its tools.'}
        </p>
        <p className="mt-1 text-[11px] leading-5 text-warn">
          Unknown means unknown. Where no reason for a change was recorded, this
          page shows none and says so.
        </p>
      </footer>

      {active && activeAnnotation ? (
        <AnnotationBalloon
          id={BALLOON_ID}
          annotation={activeAnnotation}
          anchor={active.element}
          pinned={active.pinned}
          onDismiss={() => setActive(null)}
        />
      ) : null}
    </section>
  )
}
