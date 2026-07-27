import { describe, expect, it } from "vitest";

import {
  SIGNIN_CURL_SETTINGS,
  curlLabGeometry,
  curlLabTipFraction,
} from "./curl-lab-settings";
import {
  CURL_RADIUS_RATIO,
  DEFAULT_CURL_ANGLE,
  FOLD_MAX_DEPTH,
  FOLD_MAX_LEAN,
  FOLD_REST,
  FOLD_REST_DEPTH,
  FOLD_STOPS,
  FOLD_VIEWBOX,
  MAX_CURL_ANGLE_OFFSET,
  MAX_PEEL_RATIO,
  REST_PEEL_RATIO,
  clamp,
  clampPeel,
  computeCurlTarget,
  curlMetrics,
  curlRollRadius,
  entryPeelOffset,
  foldCurl,
  foldGeometry,
  foldProgress,
  foldSpan,
  isSettled,
  isSpringAtRest,
  normalizeAngle,
  resolveCurlMode,
  smoothstep,
  stepSpring,
} from "./curl-logic";

/** The range the effect box actually takes across the clamp in the stylesheet. */
const BOX_SIZES = [120, 136, 160, 200, 232, 264];

describe("curl environment", () => {
  it("animates only when motion, pointer, and WebGL allow it", () => {
    expect(
      resolveCurlMode({
        reducedMotion: false,
        coarsePointer: false,
        webglAvailable: true,
      }),
    ).toBe("animated");

    expect(
      resolveCurlMode({
        reducedMotion: true,
        coarsePointer: false,
        webglAvailable: true,
      }),
    ).toBe("static");

    expect(
      resolveCurlMode({
        reducedMotion: false,
        coarsePointer: true,
        webglAvailable: true,
      }),
    ).toBe("static");

    expect(
      resolveCurlMode({
        reducedMotion: false,
        coarsePointer: false,
        webglAvailable: false,
      }),
    ).toBe("static");
  });
});

describe("curl arithmetic", () => {
  it("clamps and smooths values deterministically", () => {
    expect(clamp(8, 0, 5)).toBe(5);
    expect(smoothstep(0, 10, -1)).toBe(0);
    expect(smoothstep(0, 10, 5)).toBeCloseTo(0.5);
    expect(smoothstep(0, 10, 11)).toBe(1);
  });

  it("takes the short way round when comparing angles", () => {
    expect(normalizeAngle(Math.PI * 2)).toBeCloseTo(0);
    expect(normalizeAngle(Math.PI * 1.5)).toBeCloseTo(-Math.PI / 2);
    expect(normalizeAngle(-Math.PI * 1.5)).toBeCloseTo(Math.PI / 2);
  });
});

/*
 * The bug this block exists for: the component held fixed pixel depths (13 and
 * 58) while the renderer had moved to depths measured from the box. On a wide
 * screen every depth the pointer asked for landed below the renderer's floor,
 * so it clamped them all to rest and hover did nothing at all. Both sides now
 * go through curlMetrics and clampPeel, and these tests fail if either drifts
 * back to a literal.
 */
describe("the pointer and the renderer agree on how far the fold may go", () => {
  it.each(BOX_SIZES)("derives both depths from a %ipx box", (size) => {
    const metrics = curlMetrics(size);

    expect(metrics.restPeel).toBeCloseTo(size * REST_PEEL_RATIO);
    expect(metrics.maxPeel).toBeCloseTo(size * MAX_PEEL_RATIO);
    expect(metrics.radius).toBeCloseTo(size * CURL_RADIUS_RATIO);
    expect(metrics.maxPeel).toBeGreaterThan(metrics.restPeel);
  });

  it.each(BOX_SIZES)(
    "hands the renderer a full peel it accepts unchanged on a %ipx box",
    (size) => {
      const metrics = curlMetrics(size);
      const target = computeCurlTarget({
        pointerX: size,
        pointerY: 0,
        width: size,
        height: size,
        activationRadius: 320,
        restPeel: metrics.restPeel,
        maxPeel: metrics.maxPeel,
      });

      expect(target.proximity).toBe(1);
      expect(target.peel).toBeCloseTo(metrics.maxPeel);
      expect(clampPeel(target.peel, metrics)).toBeCloseTo(metrics.maxPeel);
    },
  );

  it.each(BOX_SIZES)(
    "still has room to expand after clamping on a %ipx box",
    (size) => {
      const metrics = curlMetrics(size);
      const resting = clampPeel(metrics.restPeel, metrics);
      const peeled = clampPeel(metrics.maxPeel, metrics);

      expect(peeled / resting).toBeGreaterThanOrEqual(1.4);
    },
  );

  it("clamps both ends without flattening the configured motion range", () => {
    const metrics = curlMetrics(264);

    expect(clampPeel(metrics.restPeel - 1, metrics)).toBe(metrics.restPeel);
    expect(clampPeel(metrics.maxPeel + 1, metrics)).toBe(metrics.maxPeel);
    expect(clampPeel(metrics.maxPeel, metrics)).toBeGreaterThan(
      clampPeel(metrics.restPeel, metrics),
    );
  });

  it("keeps the folded triangle inside its box at the extremes of the lean", () => {
    const metrics = curlMetrics(1);

    for (const lean of [-MAX_CURL_ANGLE_OFFSET, 0, MAX_CURL_ANGLE_OFFSET]) {
      const angle = DEFAULT_CURL_ANGLE + lean;
      const alongTop = metrics.maxPeel / Math.cos(angle);
      const alongRight = metrics.maxPeel / -Math.sin(angle);

      expect(Math.max(alongTop, alongRight)).toBeLessThan(1);
    }
  });
});

describe("curl geometry", () => {
  it("reaches maximum peel at the top-right corner", () => {
    const metrics = curlMetrics(200);
    const target = computeCurlTarget({
      pointerX: 200,
      pointerY: 0,
      width: 200,
      height: 200,
      activationRadius: 320,
      restPeel: metrics.restPeel,
      maxPeel: metrics.maxPeel,
    });

    expect(target.proximity).toBe(1);
    expect(target.peel).toBeCloseTo(metrics.maxPeel);
    expect(target.angle).toBe(DEFAULT_CURL_ANGLE);
  });

  it("holds a full peel across the plateau nearest the corner", () => {
    const metrics = curlMetrics(200);
    const shared = {
      width: 200,
      height: 200,
      activationRadius: 300,
      restPeel: metrics.restPeel,
      maxPeel: metrics.maxPeel,
    };

    const nudged = computeCurlTarget({
      ...shared,
      pointerX: 200 - 20,
      pointerY: 20,
    });

    expect(nudged.proximity).toBe(1);
    expect(nudged.peel).toBeCloseTo(metrics.maxPeel);
  });

  it("returns to rest and to 45 degrees outside the activation zone", () => {
    const metrics = curlMetrics(200);
    const target = computeCurlTarget({
      pointerX: -400,
      pointerY: 500,
      width: 200,
      height: 200,
      activationRadius: 320,
      restPeel: metrics.restPeel,
      maxPeel: metrics.maxPeel,
    });

    expect(target.proximity).toBe(0);
    expect(target.peel).toBe(metrics.restPeel);
    expect(target.angle).toBe(DEFAULT_CURL_ANGLE);
  });

  it("leans towards the pointer, and only as far as the limit allows", () => {
    const metrics = curlMetrics(200);
    const shared = {
      width: 200,
      height: 200,
      activationRadius: 400,
      restPeel: metrics.restPeel,
      maxPeel: metrics.maxPeel,
    };

    // Directly below the corner: the crease swings towards the horizontal.
    const below = computeCurlTarget({ ...shared, pointerX: 200, pointerY: 60 });
    expect(below.angle).toBeLessThan(DEFAULT_CURL_ANGLE);

    // Directly left of it: the crease swings towards the vertical.
    const left = computeCurlTarget({ ...shared, pointerX: 140, pointerY: 0 });
    expect(left.angle).toBeGreaterThan(DEFAULT_CURL_ANGLE);

    for (const target of [below, left]) {
      expect(Math.abs(target.angle - DEFAULT_CURL_ANGLE)).toBeLessThanOrEqual(
        MAX_CURL_ANGLE_OFFSET + 1e-9,
      );
    }
  });

  it("measures the folded triangle exactly at the crease", () => {
    const square = foldSpan(DEFAULT_CURL_ANGLE);
    expect(square.min).toBeCloseTo(-1);
    expect(square.max).toBeCloseTo(1);

    // Leaning the fold makes the triangle lopsided, never degenerate: the two
    // multipliers stay reciprocal and on opposite sides of the crease.
    for (const lean of [-MAX_CURL_ANGLE_OFFSET, 0.1, MAX_CURL_ANGLE_OFFSET]) {
      const span = foldSpan(DEFAULT_CURL_ANGLE + lean);
      expect(span.min).toBeLessThan(0);
      expect(span.max).toBeGreaterThan(0);
      expect(span.min * span.max).toBeCloseTo(-1);
    }
  });
});

describe("curl motion", () => {
  it("settles on its target with barely any overshoot", () => {
    let spring = { value: 0, velocity: 0 };
    let peak = 0;

    for (let step = 0; step < 600; step += 1) {
      spring = stepSpring(spring, 100, 1 / 60);
      peak = Math.max(peak, spring.value);
    }

    expect(spring.value).toBeCloseTo(100, 1);
    expect(peak).toBeLessThan(103);
    expect(isSpringAtRest(spring, 100)).toBe(true);
  });

  it("is not at rest while it is still travelling", () => {
    const moving = stepSpring({ value: 0, velocity: 0 }, 100, 1 / 60);

    expect(moving.value).toBeGreaterThan(0);
    expect(isSpringAtRest(moving, 100)).toBe(false);
  });

  it("survives a dropped frame instead of exploding", () => {
    const spring = stepSpring({ value: 0, velocity: 0 }, 100, 5);

    expect(Number.isFinite(spring.value)).toBe(true);
    expect(Number.isFinite(spring.velocity)).toBe(true);
    expect(spring.value).toBeGreaterThan(0);
    expect(spring.value).toBeLessThanOrEqual(103);
  });

  it("uses a one-shot rise and settle with no residual motion", () => {
    expect(entryPeelOffset(0)).toBe(0);
    expect(entryPeelOffset(441)).toBeCloseTo(24);
    expect(entryPeelOffset(1050)).toBe(0);
    expect(entryPeelOffset(5000)).toBe(0);
    expect(entryPeelOffset(500, 1000, 10)).toBeLessThanOrEqual(10);
  });

  it("recognizes settled values", () => {
    expect(isSettled(10, 10.04)).toBe(true);
    expect(isSettled(10, 10.2)).toBe(false);
  });
});

/*
 * The drawn fold. This is the whole effect on a machine where WebGL will not
 * start, so it is held to the same standard as the rendered one: the resting
 * pose has to be exactly the design that was signed off, and peeling has to
 * change the shape rather than move it about.
 */
describe("the drawn fold at rest", () => {
  it("is Mike's approved Curl Lab starting pose", () => {
    const approved = curlLabGeometry(SIGNIN_CURL_SETTINGS, 0);

    expect(FOLD_REST.ax).toBe(approved.creaseAX);
    expect(FOLD_REST.by).toBe(approved.creaseBY);
    expect(FOLD_REST.midX).toBe(approved.midX);
    expect(FOLD_REST.midY).toBe(approved.midY);
    expect(FOLD_REST.tipX).toBe(approved.tipX);
    expect(FOLD_REST.tipY).toBe(approved.tipY);
    expect(FOLD_REST.bounceRadius).toBe(approved.bounceRadius);
    expect(FOLD_REST.progress).toBe(0);
  });

  it("draws the corner triangle and a curved, closed flap", () => {
    const approved = curlLabGeometry(SIGNIN_CURL_SETTINGS, 0);

    expect(FOLD_REST.recessPath).toBe(approved.recessPath);
    expect(FOLD_REST.edgePath).toBe(approved.edgePath);
    expect(FOLD_REST.flapPath).toBe(`${FOLD_REST.edgePath} Z`);
    expect(FOLD_REST.edgePath).not.toContain("Z");
  });

  it("starts every gradient on the crease it belongs to", () => {
    expect(FOLD_REST.stops).toEqual(FOLD_STOPS.map((stop) => stop.rest));
  });

  /*
   * The pose in Mike's screenshot, to the last unit the SVG will print.
   *
   * Re-anchoring the tip on the corner's reflection had to leave the 45° fold
   * exactly where it was, and it does — not approximately, identically. At 45°
   * the crease midpoint *is* the foot of the perpendicular, and the two arms of
   * the corner triangle are the same length, so every term the rewrite touched
   * collapses back to the number it had before. This test is what says so: if a
   * later change to the geometry moves the resting fold by a hundredth of a
   * unit, it fails here rather than in Mike's eye.
   */
  it("draws the approved pose to the exact unit, after the reflection fix", () => {
    expect(FOLD_REST.ax).toBe(95.05);
    expect(FOLD_REST.by).toBe(4.95);
    expect(FOLD_REST.midX).toBe(97.53);
    expect(FOLD_REST.midY).toBe(2.47);
    expect(FOLD_REST.tipX).toBe(95.96);
    expect(FOLD_REST.tipY).toBe(4.04);
    expect(FOLD_REST.edgePath).toBe(
      "M 95.05 0 Q 96.81 1.92 95.96 4.04 Q 98.08 3.19 100 4.95",
    );
  });

  it("still coincides with the crease midpoint in the symmetrical pose", () => {
    // Not a coincidence to be relied on, but the reason the approved fold
    // survived the fix untouched: at 45° the foot of the perpendicular and the
    // middle of the crease are the same point.
    expect(FOLD_REST.footX).toBeCloseTo(FOLD_REST.midX, 6);
    expect(FOLD_REST.footY).toBeCloseTo(FOLD_REST.midY, 6);
  });
});

describe("the drawn fold peels", () => {
  const rest = foldGeometry(FOLD_REST_DEPTH, DEFAULT_CURL_ANGLE);
  const peeled = foldGeometry(FOLD_MAX_DEPTH, DEFAULT_CURL_ANGLE);

  it("reports how far through the peel it is", () => {
    expect(rest.progress).toBe(0);
    expect(peeled.progress).toBe(1);
    expect(
      foldGeometry(
        (FOLD_REST_DEPTH + FOLD_MAX_DEPTH) / 2,
        DEFAULT_CURL_ANGLE,
      ).progress,
    ).toBeCloseTo(0.5, 5);
  });

  it("reaches its fully peeled 45 degree pose to the exact unit", () => {
    expect(peeled.edgePath).toBe(
      "M 59.41 0 Q 73.8 15.77 65.7 34.3 Q 84.23 26.2 100 40.59",
    );
  });

  it("opens the crease and the recess behind it", () => {
    // The crease slides away from the corner along both page edges.
    expect(peeled.ax).toBeLessThan(rest.ax - 8);
    expect(peeled.by).toBeGreaterThan(rest.by + 8);
  });

  it("changes the flap silhouette rather than sliding it", () => {
    const restDepth = Math.hypot(rest.tipX - rest.midX, rest.tipY - rest.midY);
    const peeledDepth = Math.hypot(
      peeled.tipX - peeled.midX,
      peeled.tipY - peeled.midY,
    );

    // The tip reaches further past the crease, and by more than the crease
    // itself moved — so the leaf genuinely deepens, it is not just a bigger
    // copy of the same picture.
    expect(peeledDepth).toBeGreaterThan(restDepth * 1.25);
    expect(peeled.flapPath).not.toBe(rest.flapPath);
    expect(peeled.recessPath).not.toBe(rest.recessPath);
  });

  it("brings more of the warm underside into view", () => {
    let changed = 0;
    for (let index = 1; index < FOLD_STOPS.length - 1; index += 1) {
      expect(peeled.stops[index]).toBeLessThanOrEqual(rest.stops[index]);
      if (peeled.stops[index] < rest.stops[index]) changed += 1;
    }
    expect(changed).toBeGreaterThanOrEqual(4);
    expect(peeled.stops[0]).toBe(rest.stops[0]);
    expect(peeled.stops[FOLD_STOPS.length - 1]).toBe(1);
  });

  it("honors the approved maximum lift and shadow treatment", () => {
    expect(rest.shadowX).toBeLessThanOrEqual(-3.5);
    expect(rest.shadowY).toBeGreaterThanOrEqual(6);
    expect(rest.shadowBlur).toBeGreaterThanOrEqual(5);
    expect(rest.shadowOpacity).toBeGreaterThanOrEqual(0.65);
    expect(peeled.shadowX).toBe(rest.shadowX);
    expect(peeled.shadowY).toBe(rest.shadowY);
  });

  it("leans towards the pointer without swinging the whole sheet", () => {
    const towardsTop = foldGeometry(
      FOLD_MAX_DEPTH,
      DEFAULT_CURL_ANGLE + FOLD_MAX_LEAN,
    );
    const towardsSide = foldGeometry(
      FOLD_MAX_DEPTH,
      DEFAULT_CURL_ANGLE - FOLD_MAX_LEAN,
    );

    // Leaning one way pulls the crease along the top edge and pushes it down
    // the right one; leaning the other way does the reverse.
    expect(towardsTop.ax).toBeGreaterThan(peeled.ax);
    expect(towardsTop.by).toBeGreaterThan(peeled.by);
    expect(towardsSide.ax).toBeLessThan(peeled.ax);
    expect(towardsSide.by).toBeLessThan(peeled.by);
  });
});

describe("the drawn fold stays inside its box", () => {
  it("never puts the crease or the tip outside the viewBox", () => {
    for (let step = 0; step <= 20; step += 1) {
      const depth =
        FOLD_REST_DEPTH + ((FOLD_MAX_DEPTH - FOLD_REST_DEPTH) * step) / 20;

      for (const lean of [-FOLD_MAX_LEAN, -0.05, 0, 0.05, FOLD_MAX_LEAN]) {
        const fold = foldGeometry(depth, DEFAULT_CURL_ANGLE + lean);

        for (const value of [
          fold.ax,
          fold.by,
          fold.tipX,
          fold.tipY,
          fold.midX,
          fold.midY,
        ]) {
          expect(value).toBeGreaterThanOrEqual(0);
          expect(value).toBeLessThanOrEqual(FOLD_VIEWBOX);
        }
      }
    }
  });

  it("survives an angle or depth no pointer should ever produce", () => {
    for (const fold of [
      foldGeometry(-40, 0),
      foldGeometry(4000, DEFAULT_CURL_ANGLE),
      foldGeometry(FOLD_MAX_DEPTH, -Math.PI / 2),
      foldGeometry(FOLD_MAX_DEPTH, 0),
    ]) {
      expect(Number.isFinite(fold.ax)).toBe(true);
      expect(Number.isFinite(fold.by)).toBe(true);
      expect(fold.ax).toBeGreaterThanOrEqual(0);
      expect(fold.by).toBeLessThanOrEqual(FOLD_VIEWBOX);
      expect(fold.flapPath).not.toContain("NaN");
      expect(fold.recessPath).not.toContain("NaN");
    }
  });
});

describe("the pointer drives the drawn fold over its own range", () => {
  const box = 208;

  it("peels to the maximum at the corner and rests far away", () => {
    const shared = {
      width: box,
      height: box,
      activationRadius: 320,
      restPeel: FOLD_REST_DEPTH,
      maxPeel: FOLD_MAX_DEPTH,
      maxAngleOffset: FOLD_MAX_LEAN,
    };

    const near = computeCurlTarget({ ...shared, pointerX: box, pointerY: 0 });
    expect(near.peel).toBeCloseTo(FOLD_MAX_DEPTH);

    const far = computeCurlTarget({
      ...shared,
      pointerX: -600,
      pointerY: 700,
    });
    expect(far.peel).toBe(FOLD_REST_DEPTH);
    expect(far.angle).toBe(DEFAULT_CURL_ANGLE);
  });

  it("never asks for a lean the geometry has to clamp away", () => {
    const target = computeCurlTarget({
      pointerX: box,
      pointerY: 40,
      width: box,
      height: box,
      activationRadius: 400,
      restPeel: FOLD_REST_DEPTH,
      maxPeel: FOLD_MAX_DEPTH,
      maxAngleOffset: FOLD_MAX_LEAN,
    });

    const fold = foldGeometry(target.peel, target.angle);
    expect(fold.ax).toBeGreaterThan(2);
    expect(fold.by).toBeLessThan(FOLD_VIEWBOX - 2);
  });
});

/*
 * The tip, and where a folded corner is actually allowed to put one.
 *
 * A folded page corner is the corner *mirrored in* the crease. Drop a
 * perpendicular from the corner onto the crease and you land on the foot; carry
 * on the same distance again and you reach the mirror image, which is where the
 * tip ends up when the sheet is folded flat. Every tip the paper can reach lies
 * on that one segment, and its direction is the crease normal — the direction
 * the pointer is pulling in.
 *
 * The fold used to grow its tip out of the crease *midpoint* instead. The two
 * points coincide at 45°, which is why every still screenshot looked right; the
 * moment the fold leaned, the midpoint slid away down the longer arm and took
 * the tip with it. At the widest lean the tip sat 33 units off the corner's own
 * mirror axis, so a leaning fold read as a shape sliding down the page edge
 * rather than as a corner being turned over.
 *
 * These sweep the whole range instead of checking two poses, because two poses
 * is exactly what the old geometry got right.
 */
describe("the tip is the corner, mirrored in the crease", () => {
  const CORNER_X = FOLD_VIEWBOX;
  const CORNER_Y = 0;

  /*
   * The geometry prints coordinates to two decimals, because that is what goes
   * into the path data — so every distance measured back off them carries a few
   * thousandths of rounding. This is the width of that noise, and it is three
   * orders of magnitude below the fault being tested: the old tip missed its
   * perpendicular by 33 units, not by 0.02.
   */
  const PRINTED = 0.02;

  /** Every depth and lean the pointer can ask the sign-in fold for. */
  const POSES: { depth: number; lean: number }[] = [];
  for (let d = 0; d <= 8; d += 1) {
    for (let l = -6; l <= 6; l += 1) {
      POSES.push({
        depth: FOLD_REST_DEPTH + ((FOLD_MAX_DEPTH - FOLD_REST_DEPTH) * d) / 8,
        lean: (FOLD_MAX_LEAN * l) / 6,
      });
    }
  }

  /*
   * The crease as drawn, read back out of the geometry rather than recomputed
   * from the inputs — so these measure the shape that ships, not a second
   * implementation of it that could be wrong in the same direction.
   */
  function crease(fold: ReturnType<typeof foldGeometry>) {
    const alongX = fold.bx - fold.ax;
    const alongY = fold.by - fold.ay;
    const length = Math.hypot(alongX, alongY);
    // The crease normal, turned to face the corner it cut off.
    const normalX = alongY / length;
    const normalY = -alongX / length;
    const depth =
      (CORNER_X - fold.ax) * normalX + (CORNER_Y - fold.ay) * normalY;

    return { normalX, normalY, length, depth };
  }

  it.each(POSES)("puts the tip on the corner's own perpendicular", (pose) => {
    const fold = foldGeometry(pose.depth, DEFAULT_CURL_ANGLE + pose.lean);
    const { normalX, normalY } = crease(fold);

    // Corner to tip, resolved across the crease rather than along it: a fold
    // that travels sideways off its perpendicular shows up here immediately.
    const toTipX = CORNER_X - fold.tipX;
    const toTipY = CORNER_Y - fold.tipY;
    const sideways = toTipX * -normalY + toTipY * normalX;

    expect(Math.abs(sideways)).toBeLessThan(PRINTED);
  });

  it.each(POSES)("carries the tip past the crease, never past the mirror", (pose) => {
    const fold = foldGeometry(pose.depth, DEFAULT_CURL_ANGLE + pose.lean);
    const { normalX, normalY, depth } = crease(fold);
    const travelled =
      (CORNER_X - fold.tipX) * normalX + (CORNER_Y - fold.tipY) * normalY;

    // Past the crease, because the flap lies back across the page…
    expect(travelled).toBeGreaterThan(depth);
    // …and never past the corner's mirror image, because an inextensible
    // sheet folded on that crease has nowhere further to go.
    expect(travelled).toBeLessThanOrEqual(depth * 2 + PRINTED);
    expect(Math.abs(travelled - depth * (1 + fold.curl))).toBeLessThan(PRINTED);
  });

  it.each(POSES)("mirrors the corner exactly in the crease", (pose) => {
    const fold = foldGeometry(pose.depth, DEFAULT_CURL_ANGLE + pose.lean);

    // The defining property of a reflection: both ends of the crease are the
    // same distance from the mirrored corner as from the real one, so the
    // folded triangle is congruent to the one it was cut from.
    expect(
      Math.abs(
        Math.hypot(fold.ax - fold.mirrorX, fold.ay - fold.mirrorY) -
          Math.hypot(fold.ax - CORNER_X, fold.ay - CORNER_Y),
      ),
    ).toBeLessThan(PRINTED);
    expect(
      Math.abs(
        Math.hypot(fold.bx - fold.mirrorX, fold.by - fold.mirrorY) -
          Math.hypot(fold.bx - CORNER_X, fold.by - CORNER_Y),
      ),
    ).toBeLessThan(PRINTED);
  });

  it.each(POSES)("never stretches the paper to reach the tip", (pose) => {
    const fold = foldGeometry(pose.depth, DEFAULT_CURL_ANGLE + pose.lean);

    // Each edge of the flap is a page edge that has been rolled over, so it
    // cannot come out longer than the edge it was made from.
    expect(
      Math.hypot(fold.ax - fold.tipX, fold.ay - fold.tipY),
    ).toBeLessThanOrEqual(
      Math.hypot(fold.ax - CORNER_X, fold.ay - CORNER_Y) + PRINTED,
    );
    expect(
      Math.hypot(fold.bx - fold.tipX, fold.by - fold.tipY),
    ).toBeLessThanOrEqual(
      Math.hypot(fold.bx - CORNER_X, fold.by - CORNER_Y) + PRINTED,
    );
  });

  it.each(POSES)("keeps the foot on the crease it belongs to", (pose) => {
    const fold = foldGeometry(pose.depth, DEFAULT_CURL_ANGLE + pose.lean);
    const { length } = crease(fold);
    const fromA = Math.hypot(fold.ax - fold.footX, fold.ay - fold.footY);
    const fromB = Math.hypot(fold.bx - fold.footX, fold.by - fold.footY);

    // Between the two ends, and on the segment rather than merely on the line.
    expect(Math.abs(fromA + fromB - length)).toBeLessThan(PRINTED);
  });

  /*
   * The regression itself. The old geometry passes everything above at 45° and
   * fails all of it the moment the fold leans, so this is the test that would
   * have caught it: the tip and the crease midpoint must part company.
   */
  it("stops taking the tip from the middle of the crease", () => {
    const square = foldGeometry(FOLD_MAX_DEPTH, DEFAULT_CURL_ANGLE);
    const leaned = foldGeometry(
      FOLD_MAX_DEPTH,
      DEFAULT_CURL_ANGLE + FOLD_MAX_LEAN,
    );

    // Symmetrical: the midpoint is the foot, so the old and new tips agree.
    expect(square.footX).toBeCloseTo(square.midX, 6);

    // Leaning: the midpoint has slid a long way down the crease, and the tip
    // has stayed with the corner instead of following it.
    expect(Math.hypot(leaned.midX - leaned.footX, leaned.midY - leaned.footY),
    ).toBeGreaterThan(20);
    expect(leaned.tipX).toBeCloseTo(54.72, 1);
    expect(leaned.tipY).toBeCloseTo(17.38, 1);

    // The pose the midpoint anchor used to produce, now firmly out of reach.
    expect(Math.hypot(leaned.tipX - 66.14, leaned.tipY - 47.14)).toBeGreaterThan(
      20,
    );
  });

  it("points the tip in exactly the direction the pointer asked for", () => {
    const angles = [-1, -0.5, 0, 0.5, 1].map(
      (fraction) => DEFAULT_CURL_ANGLE + FOLD_MAX_LEAN * fraction,
    );
    const bearings = angles.map((angle) => {
      const fold = foldGeometry(FOLD_MAX_DEPTH, angle);
      return Math.atan2(CORNER_Y - fold.tipY, CORNER_X - fold.tipX);
    });

    // The strongest form of the whole fix. The bearing from the corner to the
    // tip is not merely *related* to the fold angle, it is the fold angle: the
    // tip is what you get by walking away from the corner along the direction
    // the pointer set. Nothing here is fitted or tuned.
    angles.forEach((angle, index) => {
      expect(bearings[index]).toBeCloseTo(angle, 3);
    });

    // And so it swings with the pointer, monotonically, with no reversal.
    for (let index = 1; index < bearings.length; index += 1) {
      expect(bearings[index]).toBeGreaterThan(bearings[index - 1]);
    }
  });
});

/*
 * The two renderers, held to one silhouette.
 *
 * The drawn fold joins its crease to a tip with two curves. The rendered one
 * rolls a mesh through a half turn and then runs it out flat. Those are
 * different constructions and they used to disagree badly: the shader rolled on
 * a radius fixed in advance, which at the approved settings ran the arc to 224°
 * — the tip swept forward, came back round to the crease and stopped, so the
 * rendered fold never lay across the page at all. The roll radius is now solved
 * from the fold, and these check the two land on the same point.
 */
describe("the rendered fold and the drawn one agree on the tip", () => {
  /** The shader's profile, in one dimension: roll through a half turn, then run flat. */
  function rolledExtent(depth: number, roll: number): number {
    const arc = Math.min(depth / roll, Math.PI);
    const tail = Math.max(depth - Math.PI * roll, 0);
    return roll * Math.sin(arc) - tail;
  }

  const metrics = curlMetrics(490);

  it.each([0, 0.25, 0.5, 0.75, 1])(
    "lands the rolled mesh on the drawn tip at progress %s",
    (progress) => {
      const peel =
        metrics.restPeel + (metrics.maxPeel - metrics.restPeel) * progress;
      const curl = foldCurl(foldProgress(peel, metrics));
      const roll = curlRollRadius(peel, curl);

      // The mesh's own tip, measured across the crease, is the reflection's.
      expect(rolledExtent(peel, roll)).toBeCloseTo(-peel * curl, 6);
    },
  );

  it("reads the same curl from a depth as the drawn fold does", () => {
    for (const progress of [0, 0.5, 1]) {
      const peel =
        metrics.restPeel + (metrics.maxPeel - metrics.restPeel) * progress;
      const drawn = foldGeometry(
        FOLD_REST_DEPTH + (FOLD_MAX_DEPTH - FOLD_REST_DEPTH) * progress,
        DEFAULT_CURL_ANGLE,
      );

      expect(foldCurl(foldProgress(peel, metrics))).toBeCloseTo(drawn.curl, 6);
    }
  });

  it("keeps the roll a real radius even at a dead-flat fold", () => {
    // A flat fold spends no length on the lip at all. The radius still has to
    // be a number the shader can divide by.
    expect(curlRollRadius(140, 1)).toBeGreaterThan(0);
    expect(Number.isFinite(curlRollRadius(0, 0.69))).toBe(true);
    expect(rolledExtent(140, curlRollRadius(140, 1))).toBeCloseTo(-140, 2);
  });

  it("never asks the paper to reach past its own mirror image", () => {
    // The settings ramp can ask for more curl than a sheet has; the top of the
    // range eases into the flat fold rather than sailing through it.
    expect(curlLabTipFraction(100, 1)).toBeLessThanOrEqual(1);
    expect(curlLabTipFraction(100, 1)).toBeGreaterThan(0.9);
    // Below the knee it is left exactly alone, which is what keeps the approved
    // sign-in fold identical.
    expect(curlLabTipFraction(SIGNIN_CURL_SETTINGS.roundness, 0.05)).toBeCloseTo(
      0.6324,
      6,
    );
    expect(curlLabTipFraction(SIGNIN_CURL_SETTINGS.roundness, 0.41)).toBeCloseTo(
      0.69,
      6,
    );
  });
});
