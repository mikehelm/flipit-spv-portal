import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { FOLD_STOPS, SIGNIN_CURL_PAINT } from './curl-logic'

function read(path: string): string {
  return readFileSync(path, 'utf8')
}

function code(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

const component = read('src/components/effects/CurlCorner.tsx')
const renderer = read('src/components/effects/curl-renderer.ts')
const logic = read('src/components/effects/curl-logic.ts')
const styles = read('src/components/effects/CurlCorner.module.css')
const combinedRuntime = code(`${component}\n${renderer}`)

describe('the premium access curl stays decorative', () => {
  it('cannot receive focus, pointer input or assistive-technology attention', () => {
    expect(component).toContain('aria-hidden="true"')
    expect(component).not.toMatch(/tabIndex|role=|onClick|onKey/)
    expect(styles).toMatch(/pointer-events:\s*none/)
  })

  it('does not inspect or transmit authentication or form information', () => {
    expect(combinedRuntime).not.toMatch(
      /\b(fetch|XMLHttpRequest|WebSocket|sendBeacon|localStorage|sessionStorage|cookie)\b/,
    )
    expect(combinedRuntime).not.toMatch(
      /\b(FormData|querySelector|input|password|credential)\b/i,
    )
  })

  it('has static reduced-motion, touch and forced-colour fallbacks', () => {
    expect(component).toContain('prefers-reduced-motion: reduce')
    expect(component).toContain('(hover: none), (pointer: coarse)')
    expect(styles).toContain('@media (prefers-reduced-motion: reduce)')
    expect(styles).toContain('@media (forced-colors: active)')
    expect(component).toContain('setRendererMode("fallback")')
  })

  it('does not widen CSP or load an external asset', () => {
    expect(combinedRuntime).not.toMatch(/https?:|data:|blob:|Worker\(/)
    expect(component).toContain('import("./curl-renderer")')
  })
})

/*
 * The component decides where the fold should be; the renderer decides what it
 * is allowed to be. They once disagreed — fixed pixel depths on one side,
 * box-relative ones on the other — and the result was a fold that ignored the
 * pointer entirely on a wide screen. These read the sources rather than the
 * behaviour, because the failure was a missing shared constant, not a wrong
 * number.
 */
describe('the fold is measured from its box, in one place', () => {
  it('takes every depth through curlMetrics on both sides', () => {
    expect(component).toContain('curlMetrics(')
    expect(renderer).toContain('curlMetrics(')
    expect(renderer).toContain('clampPeel(')
    expect(logic).toContain('export function clampPeel')
    expect(logic).toContain('export function curlMetrics')
  })

  it('leaves no hard-coded peel depth in the component or the renderer', () => {
    expect(code(component)).not.toMatch(/(?:rest|max)Peel:\s*\d/)
    expect(code(component)).not.toMatch(/setTarget\(\s*\d/)
    expect(code(renderer)).not.toMatch(/(?:rest|max)Peel\s*(?:=|\?\?)\s*\d/)
  })

  it('re-measures the box rather than trusting a stale rectangle', () => {
    expect(component).toContain('ResizeObserver')
    expect(component).toContain('getBoundingClientRect')
  })
})

/*
 * The same failure again, one level up. The two renderers agreed on how far the
 * fold could go and then disagreed about where it pointed: the drawn fold grew
 * its tip from the crease midpoint, and the shader rolled the mesh on a radius
 * fixed in advance that had no relationship to the fold it was bending. Both
 * are now solved from one reflection, and — as with the depths above — these
 * read the sources, because the fault was a second implementation rather than a
 * wrong number.
 */
describe('both renderers place the fold by the same reflection', () => {
  it('anchors the tip on the corner, in one shared piece of geometry', () => {
    expect(logic).toContain('export function foldCurl')
    expect(logic).toContain('export function foldProgress')
    expect(renderer).toContain('foldReflection(')
    expect(renderer).toContain('curlRollRadius(')
    expect(renderer).toContain('foldCurl(foldProgress(')
  })

  it('leaves no midpoint-anchored tip and no hand-placed fold origin', () => {
    // The exact shape of the original fault: a tip measured out from the middle
    // of the crease, and a renderer computing its own fold point beside it.
    expect(code(logic)).not.toMatch(/tip[XY]\s*[:=][^\n]*mid[XY]/)
    expect(code(renderer)).not.toMatch(/const fold[XY]\s*=/)
    // The roll is solved from the fold, never taken from the shadow's spread.
    expect(code(renderer)).not.toMatch(/depth\s*\/\s*uRadius/)
  })
})

describe('the curl only burns a frame when it has something to say', () => {
  it('stops asking for frames once the spring has settled', () => {
    expect(renderer).toContain('isSpringAtRest')
    expect(renderer).toContain('cancelAnimationFrame')
  })

  it('stands down when the tab or the corner is out of sight', () => {
    expect(component).toContain('visibilitychange')
    expect(component).toContain('IntersectionObserver')
    expect(renderer).toContain('pause()')
  })

  it('releases every GPU object it allocated', () => {
    expect(renderer).toContain('deleteBuffer')
    expect(renderer).toContain('deleteProgram')
    expect(renderer).toContain('webglcontextlost')
    expect(renderer).toContain('removeEventListener')
  })

  it('caps the device pixel ratio instead of rendering at native density', () => {
    expect(renderer).toContain('devicePixelRatio')
    expect(renderer).toContain('dprCap')
  })
})

/*
 * Two rejected attempts sit behind this block. The first painted a flat orange
 * triangle across the corner. The second built the fold from clip-path
 * polygons and gradient stops, which could only ever produce a narrow band
 * across the diagonal — it rendered as three thin metallic stripes with no
 * sheet in them at all.
 *
 * The fold is now drawn geometry: a curved silhouette with area, pinched to
 * nothing at both ends of the crease. Most of what follows checks that the
 * shape is still a shape, because a stripe passes every colour assertion a
 * page curl does.
 */
describe('the static fold reads as folded paper', () => {
  it('carries no flat accent fill and no band-shaped clip path', () => {
    expect(styles).not.toContain('.backing')
    expect(styles).not.toContain('var(--curl-orange)')
    // Comment-stripped: the stylesheet is allowed to say why clip-path was
    // abandoned, it just may not use it.
    expect(code(styles)).not.toContain('clip-path')
    expect(styles).not.toContain('repeating-linear-gradient')
  })

  it('draws the fold as inline SVG rather than approximating it', () => {
    expect(component).toContain('<svg')
    expect(component).toContain('viewBox={`0 0 ${FOLD_VIEWBOX} ${FOLD_VIEWBOX}`}')
    expect(component).toContain('styles.fallback')
  })

  it('ships the resting pose in the markup, from the one geometry source', () => {
    // Every attribute the server sends comes from FOLD_REST, so what arrives
    // is exactly the still pose — no first-frame jump, nothing to hydrate.
    expect(component).toContain('FOLD_REST.recessPath')
    expect(component).toContain('FOLD_REST.flapPath')
    expect(component).toContain('FOLD_REST.edgePath')
    expect(logic).toContain('export const FOLD_REST')
  })

  it('shows three separate surfaces', () => {
    expect(component).toContain('flipitFoldRecess')
    expect(component).toContain('flipitFoldFlap')
    expect(component).toContain('flipitFoldEdge')
  })

  it('ramps the flap from the page face through the roll to the underside', () => {
    const colours = FOLD_STOPS.map((stop) => stop.colour)
    expect(colours).toContain(SIGNIN_CURL_PAINT.faceHighlight)
    expect(colours).toContain(SIGNIN_CURL_PAINT.roll)
    expect(colours).toContain(SIGNIN_CURL_PAINT.underside)
    expect(colours).toContain(SIGNIN_CURL_PAINT.edge)
  })

  it('lights the fold with a bounce and a shadow the peel can move', () => {
    expect(component).toContain('flipitFoldBounce')
    expect(component).toContain('radialGradient')
    // The contact shadow is an SVG filter rather than a CSS drop-shadow, so
    // its offset, spread and depth are attributes the peel can rewrite
    // without touching inline styles.
    expect(component).toContain('flipitFoldShadow')
    expect(component).toContain('feGaussianBlur')
    expect(component).toContain('feOffset')
    expect(component).toContain('feFlood')
    expect(code(styles)).not.toContain('drop-shadow')
  })

  it('hides only a restrained detail beneath the fold', () => {
    expect(component).toContain('flipitFoldGrid')
    expect(component).not.toContain('<text')
    expect(component).not.toContain('<image')
  })

  it('keeps the decorative SVG inert and free of anything loadable', () => {
    expect(component).toContain('focusable="false"')
    expect(component).not.toContain('<script')
    expect(component).not.toContain('<use')
    expect(component).not.toMatch(/\bhref=/)
    // React namespaces inline SVG itself; an xmlns would put an http URL in
    // the bundle, which the CSP check above reads as an external reference.
    expect(component).not.toContain('xmlns')
  })

  it('uses Mike’s approved 490px canvas with a viewport-safe phone limit', () => {
    expect(styles).toMatch(/--curl-size:\s*490px/)
    expect(styles).toMatch(/--curl-size:\s*min\(490px,\s*100vw\)/)
    expect(styles).toContain('inline-size: var(--curl-size)')
  })
})

/*
 * Mike opened the preview, moved the mouse, and nothing happened: the element
 * said data-renderer="fallback" and the SVG behaved like an image. Two things
 * caused it — the coarse-pointer media query was believed outright, and the
 * drawn fold had no runtime of its own. Both are covered here.
 */
describe('the drawn fold is a renderer, not a picture', () => {
  it('reports which of the three paths actually drew the fold', () => {
    expect(component).toContain('"webgl" | "svg-animated" | "fallback"')
    expect(component).toContain('setRendererMode("svg-animated")')
    expect(component).toContain('setRendererMode("webgl")')
    expect(component).toContain('setRendererMode("fallback")')
    expect(component).toContain('data-renderer={rendererMode}')
  })

  it('animates the SVG on its own frame loop with spring easing', () => {
    expect(component).toContain('requestAnimationFrame')
    expect(component).toContain('cancelAnimationFrame')
    expect(component).toContain('stepSpring')
    expect(component).toContain('isSpringAtRest')
    expect(component).toContain('foldGeometry(')
  })

  it('drives the shape itself, not a transform on the whole sheet', () => {
    // A translate or rotate on the <svg> would be the sticker version of this.
    expect(code(component)).not.toMatch(/transform=|\.style\./)
    // The peel rewrites the geometry: paths, gradient axes, gradient stops,
    // and the four numbers that make up the contact shadow.
    expect(component).toContain('setAttribute("d"')
    expect(component).toContain('setAttribute("offset"')
    expect(component).toContain('setAttribute("stdDeviation"')
    expect(component).toContain('setAttribute("flood-opacity"')
  })

  it('treats a real mouse or pen as stronger evidence than the media query', () => {
    expect(component).toContain('precisePointerSeen')
    expect(component).toContain('event.pointerType === "touch"')
    // Reduced motion is the one thing pointer evidence cannot override.
    expect(component).toMatch(/pointerType === "touch" \|\| reducedMotion/)
  })

  it('keeps reduced motion and bare touch on the still fold', () => {
    expect(component).toMatch(
      /reducedMotion\.matches\)\s*\{\s*void activate\("fallback"\)/,
    )
    expect(component).toMatch(
      /coarsePointer\.matches && !precisePointerSeen\)\s*\{\s*void activate\("fallback"\)/,
    )
    expect(styles).toContain('@media (prefers-reduced-motion: reduce)')
  })

  it('stands down when hidden, offscreen, or unmounted', () => {
    expect(component).toContain('runtime?.pause()')
    expect(component).toContain('runtime?.resume()')
    expect(component).toContain('teardownRuntime()')
    expect(component).toContain('resizeObserver.disconnect()')
    expect(component).toContain('visibilityObserver?.disconnect()')
  })

  it('shows the drawn fold unless the canvas is genuinely running', () => {
    expect(styles).toMatch(/\.fallback\s*\{\s*display:\s*block/)
    expect(styles).toContain('.root[data-renderer="webgl"] .fallback')
    expect(styles).toContain('.root[data-renderer="webgl"] .canvas')
  })
})

describe('the effect is applied only to the intended surfaces', () => {
  it.each([
    'src/app/page.tsx',
    'src/app/signin/page.tsx',
    'src/app/access-request/page.tsx',
  ])('%s renders the access curl', (path) => {
    expect(read(path)).toContain('<CurlCorner')
  })

  it('keeps the existing static PageCurl unchanged', () => {
    const staticCurl = code(read('src/components/page-curl.tsx'))
    expect(staticCurl).not.toMatch(/animate|transition|keyframes|transform/)
  })

  it('scopes the interior treatment to the investor portal', () => {
    const portal = read('src/app/portal/page.tsx')
    expect(portal).toContain("from './premium-effects.module.css'")
    expect(portal).toContain('styles.surface')
    expect(portal).toContain('styles.timeline')
    expect(portal).toContain('styles.certificateSurface')
  })
})
