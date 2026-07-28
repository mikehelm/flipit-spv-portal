'use client'

/**
 * The explanation balloon.
 *
 * It is rendered into `document.body` through a portal rather than inside the
 * passage. The paper spread scrolls sideways when the text is large enough to
 * need it, and an `overflow` box clips its own children — a balloon anchored
 * inside the sheet would be cut off by exactly the passages a reviewer is most
 * likely to be reading at that size. A portal plus measured coordinates is the
 * only arrangement that cannot be clipped.
 *
 * **The coordinates are written through the CSSOM, not through `style={{…}}`.**
 * `style-src 'self'` refuses a style attribute parsed from markup, and
 * `auditScreen` in `pnpm verify:viewport` fails any screen whose served HTML
 * carries one. A style set through `element.style` is a different route that CSP
 * does not govern and the audit does not read, which is what makes measured
 * placement possible at all here. Everything that can be a class is one, so a
 * balloon that has not been measured yet is invisible rather than parked in the
 * top-left corner.
 *
 * It says only what was recorded. Where nothing was recorded, it says so.
 */

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import { createPortal } from 'react-dom'
import type { PassageAnnotation } from './markup'
import styles from './paper.module.css'

const useIsomorphicLayoutEffect =
  typeof window === 'undefined' ? useEffect : useLayoutEffect

const GAP = 10
const EDGE = 12
const ARROW = 5

export function AnnotationBalloon({
  id,
  annotation,
  anchor,
  pinned,
  onDismiss,
}: {
  id: string
  annotation: PassageAnnotation
  anchor: HTMLElement
  pinned: boolean
  onDismiss: () => void
}) {
  const ref = useRef<HTMLDivElement | null>(null)
  const arrowRef = useRef<HTMLSpanElement | null>(null)
  const [placed, setPlaced] = useState(false)

  const reposition = useCallback(() => {
    const node = ref.current
    const arrow = arrowRef.current
    if (!node || !arrow) return

    const box = node.getBoundingClientRect()
    const target = anchor.getBoundingClientRect()

    const below = target.bottom + GAP
    const above = target.top - GAP - box.height
    const fitsBelow = below + box.height <= window.innerHeight - EDGE
    const top = fitsBelow ? below : above >= EDGE ? above : below

    const wanted = target.left + target.width / 2 - box.width / 2
    const limit = Math.max(EDGE, window.innerWidth - box.width - EDGE)
    const left = Math.min(Math.max(wanted, EDGE), limit)

    const centre = target.left + target.width / 2 - left
    const arrowLeft =
      Math.min(Math.max(centre, 18), Math.max(18, box.width - 18)) - ARROW

    node.style.top = `${Math.round(top)}px`
    node.style.left = `${Math.round(left)}px`
    arrow.style.left = `${Math.round(arrowLeft)}px`
    arrow.style.top = `${Math.round(
      fitsBelow || above < EDGE ? -ARROW : box.height - ARROW,
    )}px`
    setPlaced(true)
  }, [anchor])

  // `reposition` is rebuilt whenever the anchor changes, and the anchor is the
  // passage the balloon belongs to — so this covers a move to a new passage as
  // well as the first measurement.
  useIsomorphicLayoutEffect(() => {
    reposition()
  }, [reposition])

  useEffect(() => {
    const handle = () => reposition()
    window.addEventListener('scroll', handle, true)
    window.addEventListener('resize', handle)
    return () => {
      window.removeEventListener('scroll', handle, true)
      window.removeEventListener('resize', handle)
    }
  }, [reposition])

  useEffect(() => {
    if (!pinned) return
    const handle = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onDismiss()
    }
    window.addEventListener('keydown', handle)
    return () => window.removeEventListener('keydown', handle)
  }, [pinned, onDismiss])

  return createPortal(
    <div
      ref={ref}
      id={id}
      role="tooltip"
      className={styles.balloon}
      data-placed={placed ? 'true' : 'false'}
      data-pinned={pinned ? 'true' : 'false'}
    >
      <span ref={arrowRef} aria-hidden="true" className={styles.balloonArrow} />
      <div className={styles.balloonBody}>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <h3 className={`${styles.balloonInk} min-w-0 text-xs font-bold`}>
            {annotation.title}
          </h3>
          <span
            className={`${styles.chip} text-[10px] font-bold uppercase tracking-[0.12em]`}
            data-unverified={annotation.unverified ? 'true' : 'false'}
          >
            {annotation.status}
          </span>
        </div>

        {annotation.entries.length === 0 ? (
          <p className={`${styles.balloonSoft} mt-3 text-xs leading-6`}>
            This passage is part of the complete mechanical comparison. No
            separate rationale was recorded against it.
          </p>
        ) : null}

        {annotation.entries.map((entry) => (
          <section
            key={entry.clauseId}
            className={`${styles.balloonRule} mt-3 pt-3`}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h4 className={`${styles.balloonInk} text-[11px] font-bold`}>
                {entry.title}
              </h4>
              <span
                className={`${styles.chip} text-[10px] font-bold uppercase tracking-[0.12em]`}
                data-unverified={entry.reason === null ? 'true' : 'false'}
              >
                {entry.reason === null ? 'Unverified' : entry.evidenceKind}
              </span>
            </div>
            {entry.reason === null ? (
              <p className={`${styles.balloonSoft} mt-2 text-xs leading-6`}>
                Unknown means unknown. No reason for this change is recorded
                anywhere, so none is shown. A qualified person still has to
                confirm it.
              </p>
            ) : (
              <>
                <p className={`${styles.balloonSoft} mt-2 text-xs leading-6`}>
                  {entry.reason}
                </p>
                {entry.evidence ? (
                  <p
                    className={`${styles.balloonFaint} mt-2 text-[11px] leading-5`}
                  >
                    {entry.evidence}
                  </p>
                ) : null}
              </>
            )}
          </section>
        ))}

        <p className={`${styles.balloonFaint} mt-3 text-[10px] leading-5`}>
          {pinned
            ? 'Pinned. Press Escape or click the passage again to close.'
            : 'Click the passage to pin this note.'}
        </p>
      </div>
    </div>,
    window.document.body,
  )
}
