/**
 * The maths behind the top-right page fold, kept free of the DOM and of WebGL
 * so it can be reasoned about — and tested — on its own.
 *
 * Coordinate system: the effect box is a square whose top-left is the origin,
 * x growing right and y growing *down*, matching CSS. The page corner being
 * folded is therefore at (size, 0).
 */

import {
  SIGNIN_CURL_SETTINGS,
  creaseTilt,
  curlLabGeometry,
  curlLabPaint,
  curlLabTipFraction,
} from "./curl-lab-settings";

export { curlRollRadius, foldReflection } from "./curl-lab-settings";

/** The fold leans out of the corner at 45°: a symmetrical dog-ear. */
export const DEFAULT_CURL_ANGLE =
  (SIGNIN_CURL_SETTINGS.startAngle * Math.PI) / 180;

/**
 * How far the fold is allowed to swing away from 45° while following the
 * pointer. Deliberately small: past roughly a quarter radian the folded
 * triangle grows longer than the box that holds it, and the tip gets clipped.
 */
export const MAX_CURL_ANGLE_OFFSET = (24 * Math.PI) / 180;

/**
 * The fold is sized as a fraction of the effect box rather than in fixed
 * pixels, so the desktop and phone versions are the same shape.
 *
 * `REST_PEEL_RATIO` is the perpendicular distance from the crease to the
 * corner at rest. The visible fold along each page edge is that distance times
 * √2 — so on a 240px box the resting fold reads as roughly 119px of edge,
 * which is the "small and refined" size we want.
 */
export const REST_PEEL_RATIO =
  (SIGNIN_CURL_SETTINGS.startOpen / 100) * 0.7;
export const MAX_PEEL_RATIO =
  (SIGNIN_CURL_SETTINGS.endOpen / 100) * 0.7;

/**
 * How far the recess shadow spreads back under the lifted corner, as a
 * fraction of the box.
 *
 * This used to double as the paper's bend radius, which was the wrong job for
 * it: a radius fixed in advance has no relationship to the fold it is bending,
 * and at the approved settings it sent the roll through 224° — past the point
 * where the tip comes back round to the crease and stops moving. The bend
 * radius is now solved from the fold itself (see `curlRollRadius`), and this
 * constant keeps only the lighting job it was actually doing well.
 */
export const CURL_RADIUS_RATIO =
  0.06 + (SIGNIN_CURL_SETTINGS.roundness / 100) * 0.19;

/** Flattens the roll vertically. Paper does not curl into a circular tube. */
export const CURL_SQUASH =
  0.52 + (SIGNIN_CURL_SETTINGS.lift / 100) * 0.24;

export type CurlMode = "animated" | "static";

export interface CurlEnvironment {
  reducedMotion: boolean;
  coarsePointer: boolean;
  webglAvailable: boolean;
}

export interface CurlTargetSample {
  pointerX: number;
  pointerY: number;
  width: number;
  height: number;
  activationRadius: number;
  restPeel: number;
  maxPeel: number;
  maxAngleOffset?: number;
  /** Inside this distance the fold is fully peeled. Defaults to 18% of the zone. */
  innerRadius?: number;
}

export interface CurlTarget {
  angle: number;
  peel: number;
  proximity: number;
}

export interface CurlMetrics {
  restPeel: number;
  maxPeel: number;
  radius: number;
}

export interface Spring {
  value: number;
  velocity: number;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function smoothstep(min: number, max: number, value: number): number {
  if (max <= min) {
    return value >= max ? 1 : 0;
  }

  const normalized = clamp((value - min) / (max - min), 0, 1);
  return normalized * normalized * (3 - 2 * normalized);
}

/** Folds an angle back into (-π, π] so a difference never takes the long way round. */
export function normalizeAngle(angle: number): number {
  const turn = Math.PI * 2;
  let wrapped = (angle + Math.PI) % turn;
  if (wrapped < 0) {
    wrapped += turn;
  }
  return wrapped - Math.PI;
}

export function resolveCurlMode(environment: CurlEnvironment): CurlMode {
  return environment.reducedMotion ||
    environment.coarsePointer ||
    !environment.webglAvailable
    ? "static"
    : "animated";
}

/** The fold depths and bend radius for a box of the given side length. */
export function curlMetrics(size: number): CurlMetrics {
  const side = Math.max(size, 1);
  return {
    restPeel: side * REST_PEEL_RATIO,
    maxPeel: side * MAX_PEEL_RATIO,
    radius: side * CURL_RADIUS_RATIO,
  };
}

/**
 * The single clamp both halves of the effect must agree on.
 *
 * The component decides where the fold *wants* to be from the pointer; the
 * renderer decides what it is allowed to be. If those two ever disagree about
 * the range — as they did when the component held fixed pixel depths and the
 * renderer had moved to box-relative ones — the fold silently stops responding
 * to the pointer on whichever screen size falls outside the overlap.
 */
export function clampPeel(peel: number, metrics: CurlMetrics): number {
  return clamp(peel, metrics.restPeel, metrics.maxPeel);
}

/**
 * Where a depth sits in the peel, on the same 0–1 scale the drawn fold uses.
 * The renderer works in pixels and the drawn fold in viewBox units, but both
 * measure the same fraction of the same box, so this is the one number that
 * lets them ask the settings the same question.
 */
export function foldProgress(peel: number, metrics: CurlMetrics): number {
  const span = metrics.maxPeel - metrics.restPeel;
  return span <= 0 ? 0 : clamp((peel - metrics.restPeel) / span, 0, 1);
}

/**
 * How far past the crease the tip reaches at that progress, as a fraction of
 * the fold's depth — the sign-in fold's own curl, read from the approved
 * settings so the rendered fold and the drawn one cannot drift apart.
 */
export function foldCurl(progress: number): number {
  const openness =
    (SIGNIN_CURL_SETTINGS.startOpen +
      (SIGNIN_CURL_SETTINGS.endOpen - SIGNIN_CURL_SETTINGS.startOpen) *
        clamp(progress, 0, 1)) /
    100;

  return curlLabTipFraction(SIGNIN_CURL_SETTINGS.roundness, openness);
}

/**
 * How wide the folded triangle is along the crease, as a multiple of the
 * distance still remaining to the corner.
 *
 * The folded region is the corner of the page cut off by the crease, so its
 * width is set by where the crease meets the top and right edges. At 45° that
 * is a symmetrical ±1; as the fold leans the triangle becomes lopsided, and
 * getting this exactly right is what lets the mesh cover the fold with no
 * wasted vertices and no gap at the edges.
 */
export function foldSpan(angle: number): { min: number; max: number } {
  // The same tilt clamp the drawn fold uses, so the mesh's corner triangle and
  // the reflection that places its tip are measured off one identical crease.
  const tilt = creaseTilt(angle);
  const sine = Math.sin(tilt);
  const cosine = Math.cos(tilt);
  return { min: sine / cosine, max: cosine / -sine };
}

export function computeCurlTarget(sample: CurlTargetSample): CurlTarget {
  const {
    pointerX,
    pointerY,
    width,
    activationRadius,
    restPeel,
    maxPeel,
    maxAngleOffset = MAX_CURL_ANGLE_OFFSET,
  } = sample;

  const outerRadius = Math.max(activationRadius, 1);
  const innerRadius = clamp(
    sample.innerRadius ?? outerRadius * 0.18,
    0,
    outerRadius - 1,
  );

  const dx = width - pointerX;
  const dy = -pointerY;
  const distance = Math.hypot(dx, dy);
  const proximity = 1 - smoothstep(innerRadius, outerRadius, distance);

  // The fold leans towards the pointer, and only as far as the pointer is
  // close. Far away it sits at exactly 45°, so an idle page is always
  // symmetrical rather than frozen mid-lean.
  const bearing = distance < 1 ? DEFAULT_CURL_ANGLE : Math.atan2(dy, dx);
  const lean = clamp(
    normalizeAngle(bearing - DEFAULT_CURL_ANGLE),
    -maxAngleOffset,
    maxAngleOffset,
  );

  return {
    angle: DEFAULT_CURL_ANGLE + lean * proximity,
    peel: restPeel + (maxPeel - restPeel) * proximity,
    proximity,
  };
}

/**
 * A damped spring, integrated in fixed sub-steps so a dropped frame cannot
 * blow it up. The default ratio is a shade under critical: it arrives with a
 * single, barely perceptible settle rather than a bounce.
 */
export function stepSpring(
  spring: Spring,
  target: number,
  deltaSeconds: number,
  stiffness = SIGNIN_CURL_SETTINGS.stiffness,
  damping = SIGNIN_CURL_SETTINGS.damping,
): Spring {
  const substep = 1 / 240;
  let remaining = clamp(deltaSeconds, 0, 1 / 15);
  let value = spring.value;
  let velocity = spring.velocity;

  while (remaining > 0) {
    const dt = Math.min(substep, remaining);
    remaining -= dt;
    const acceleration = (target - value) * stiffness - velocity * damping;
    velocity += acceleration * dt;
    value += velocity * dt;
  }

  return { value, velocity };
}

export function isSpringAtRest(
  spring: Spring,
  target: number,
  epsilon = 0.05,
  velocityEpsilon = 0.75,
): boolean {
  return (
    Math.abs(spring.value - target) <= epsilon &&
    Math.abs(spring.velocity) <= velocityEpsilon
  );
}

/**
 * A single-load flourish. It rises quickly, then settles without bouncing.
 * The returned value is added to the resting peel depth.
 */
export function entryPeelOffset(
  elapsedMs: number,
  durationMs = 1050,
  peak = 24,
): number {
  const progress = clamp(elapsedMs / durationMs, 0, 1);

  if (progress <= 0.42) {
    return peak * smoothstep(0, 0.42, progress);
  }

  return peak * (1 - smoothstep(0.42, 1, progress));
}

export function isSettled(
  current: number,
  target: number,
  epsilon = 0.05,
): boolean {
  return Math.abs(current - target) <= epsilon;
}

/* ------------------------------------------------------------------------ *
 * The drawn fold.
 *
 * Everything below produces the SVG fallback's geometry. It exists because
 * that fallback is not a placeholder: on a machine where WebGL will not
 * initialise — or a browser that reports a coarse pointer and turns out to
 * have a mouse — it is the whole effect, and it has to peel like one.
 *
 * The units are the SVG viewBox, a 100×100 square whose folded corner is at
 * (100, 0). `depth` is the perpendicular distance from that corner back to the
 * crease; `angle` is the fold normal, pointing from the crease at the corner,
 * and sits at -45° when nothing is near.
 * ------------------------------------------------------------------------ */

export const FOLD_VIEWBOX = 100;

/** Perpendicular depth matching the selected Curl Lab starting fold. */
export const FOLD_REST_DEPTH = REST_PEEL_RATIO * FOLD_VIEWBOX;

/**
 * Fully peeled. Capped so the crease cannot run off the box: at the widest
 * lean the far intercept is depth / sin(angle), which must stay under 100.
 */
export const FOLD_MAX_DEPTH = MAX_PEEL_RATIO * FOLD_VIEWBOX;

/** How far the fold may swing towards the pointer. */
export const FOLD_MAX_LEAN = MAX_CURL_ANGLE_OFFSET;

export interface FoldStop {
  /** Position along the flap's gradient at rest, and fully peeled. */
  rest: number;
  peeled: number;
  colour: string;
}

/**
 * The flap's three surfaces, read outwards from the crease: the page face
 * still catching light, the dark line where it rolls over, then the muted
 * warm underside. Peeling slides the boundaries inwards, so more of the
 * underside comes into view rather than the same picture merely getting
 * bigger.
 */
const SIGNIN_CURL_REST_GEOMETRY = curlLabGeometry(
  SIGNIN_CURL_SETTINGS,
  0,
);
const SIGNIN_CURL_END_GEOMETRY = curlLabGeometry(SIGNIN_CURL_SETTINGS, 1);
export const SIGNIN_CURL_PAINT = curlLabPaint(SIGNIN_CURL_SETTINGS);

export const FOLD_STOPS: readonly FoldStop[] =
  SIGNIN_CURL_PAINT.flapColours.map((colour, index) => ({
    rest: SIGNIN_CURL_REST_GEOMETRY.flapStops[index],
    peeled: SIGNIN_CURL_END_GEOMETRY.flapStops[index],
    colour,
  }));

export interface FoldGeometry {
  /** 0 at rest, 1 fully peeled. */
  progress: number;
  /** The crease, from the top page edge to the right one. */
  ax: number;
  ay: number;
  bx: number;
  by: number;
  /** Midpoint of the crease; every gradient starts here. */
  midX: number;
  midY: number;
  /**
   * The perpendicular dropped from the corner onto the crease, and the corner's
   * mirror image beyond it. The tip may only ever lie between the two.
   */
  footX: number;
  footY: number;
  mirrorX: number;
  mirrorY: number;
  /** How much of the way from the foot to the mirror the tip got. */
  curl: number;
  /** The folded corner's tip, lying back across the page. */
  tipX: number;
  tipY: number;
  bounceRadius: number;
  recessPath: string;
  flapPath: string;
  edgePath: string;
  stops: number[];
  shadowX: number;
  shadowY: number;
  shadowBlur: number;
  shadowOpacity: number;
  edgeWidth: number;
}

export function foldGeometry(depth: number, angle: number): FoldGeometry {
  const reach = clamp(depth, 0, FOLD_MAX_DEPTH);
  const progress = clamp(
    (reach - FOLD_REST_DEPTH) / (FOLD_MAX_DEPTH - FOLD_REST_DEPTH),
    0,
    1,
  );
  const baseAngleDegrees =
    SIGNIN_CURL_SETTINGS.startAngle +
    (SIGNIN_CURL_SETTINGS.endAngle - SIGNIN_CURL_SETTINGS.startAngle) *
      progress;
  const baseAngle = (baseAngleDegrees * Math.PI) / 180;
  const pointerLean = clamp(
    (angle - baseAngle) / MAX_CURL_ANGLE_OFFSET,
    -1,
    1,
  );
  const lab = curlLabGeometry(SIGNIN_CURL_SETTINGS, progress, pointerLean);

  return {
    progress,
    ax: lab.creaseAX,
    ay: lab.creaseAY,
    bx: lab.creaseBX,
    by: lab.creaseBY,
    midX: lab.midX,
    midY: lab.midY,
    footX: lab.footX,
    footY: lab.footY,
    mirrorX: lab.mirrorX,
    mirrorY: lab.mirrorY,
    curl: lab.curl,
    tipX: lab.tipX,
    tipY: lab.tipY,
    bounceRadius: lab.bounceRadius,
    recessPath: lab.recessPath,
    flapPath: lab.flapPath,
    edgePath: lab.edgePath,
    stops: lab.flapStops,
    shadowX: lab.shadowX,
    shadowY: lab.shadowY,
    shadowBlur: lab.shadowBlur,
    shadowOpacity: lab.shadowOpacity,
    edgeWidth: lab.edgeWidth,
  };
}

/** The pose the markup ships with, and the one it returns to. */
export const FOLD_REST: FoldGeometry = foldGeometry(
  FOLD_REST_DEPTH,
  DEFAULT_CURL_ANGLE,
);
