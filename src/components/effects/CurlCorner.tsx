"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { curlPalette } from "@/lib/brand";
import styles from "./CurlCorner.module.css";
import {
  DEFAULT_CURL_ANGLE,
  FOLD_MAX_DEPTH,
  FOLD_MAX_LEAN,
  FOLD_REST,
  FOLD_REST_DEPTH,
  FOLD_STOPS,
  FOLD_VIEWBOX,
  SIGNIN_CURL_PAINT,
  computeCurlTarget,
  curlMetrics,
  foldGeometry,
  isSpringAtRest,
  stepSpring,
  type FoldGeometry,
  type Spring,
} from "./curl-logic";
import { SIGNIN_CURL_SETTINGS } from "./curl-lab-settings";
import type { CurlRenderer } from "./curl-renderer";

/**
 * Which path actually drew what is on screen. Reported on the element as
 * `data-renderer` so visual QA can tell an animated fold from a still one
 * without guessing — the previous version reported only "fallback" for both,
 * which is how a static picture went unnoticed.
 */
export type CurlRendererMode = "webgl" | "svg-animated" | "fallback";

export interface CurlCornerProps {
  className?: string;
  /**
   * Plays the one-shot entrance flourish. Set to false on secondary public
   * surfaces so navigation does not replay it.
   */
  intro?: boolean;
  /**
   * Pointer activation distance in CSS pixels. Neither the canvas nor the
   * drawn fold ever intercepts input.
   */
  activationRadius?: number;
}

/*
 * The mounted elements the drawn fold writes to each frame.
 *
 * Plain nodes, never ref objects. CurlCorner owns one piece of state per
 * element and hands the state *setter* down as the ref callback, so React
 * supplies each node on mount and null on unmount, the markup never reads a
 * ref during render, and nothing in this file assigns to a ref or a prop.
 */
interface FoldNodes {
  recess: SVGPathElement | null;
  flap: SVGPathElement | null;
  edge: SVGPathElement | null;
  recessGradient: SVGLinearGradientElement | null;
  flapGradient: SVGLinearGradientElement | null;
  edgeGradient: SVGLinearGradientElement | null;
  bounce: SVGRadialGradientElement | null;
  shadowOffset: SVGFEOffsetElement | null;
  shadowBlur: SVGFEGaussianBlurElement | null;
  shadowFlood: SVGFEFloodElement | null;
}

/** What StaticFold binds as its ref callbacks. Each is a state setter. */
interface FoldNodeSetters {
  setRecessElement: (node: SVGPathElement | null) => void;
  setFlapElement: (node: SVGPathElement | null) => void;
  setEdgeElement: (node: SVGPathElement | null) => void;
  setRecessGradientElement: (node: SVGLinearGradientElement | null) => void;
  setFlapGradientElement: (node: SVGLinearGradientElement | null) => void;
  setEdgeGradientElement: (node: SVGLinearGradientElement | null) => void;
  setBounceElement: (node: SVGRadialGradientElement | null) => void;
  setShadowOffsetElement: (node: SVGFEOffsetElement | null) => void;
  setShadowBlurElement: (node: SVGFEGaussianBlurElement | null) => void;
  setShadowFloodElement: (node: SVGFEFloodElement | null) => void;
}

/**
 * One fold, however it is being drawn. The pointer handler talks to this and
 * does not care whether a GPU or a path element is on the other side.
 */
interface FoldRuntime {
  measure(width: number, height: number): void;
  point(x: number, y: number, width: number, height: number): void;
  rest(): void;
  pause(): void;
  resume(): void;
  dispose(): void;
}

function setAxis(
  gradient: SVGLinearGradientElement | null,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
) {
  if (!gradient) {
    return;
  }
  gradient.setAttribute("x1", String(x1));
  gradient.setAttribute("y1", String(y1));
  gradient.setAttribute("x2", String(x2));
  gradient.setAttribute("y2", String(y2));
}

/**
 * Writes a pose onto the markup. Attributes only — no inline styles, no
 * injected CSS, nothing the Content-Security-Policy has to make room for.
 */
function applyFold(nodes: FoldNodes, fold: FoldGeometry) {
  nodes.recess?.setAttribute("d", fold.recessPath);
  nodes.flap?.setAttribute("d", fold.flapPath);
  nodes.edge?.setAttribute("d", fold.edgePath);
  nodes.edge?.setAttribute("stroke-width", String(fold.edgeWidth));

  setAxis(nodes.recessGradient, fold.midX, fold.midY, FOLD_VIEWBOX, 0);
  setAxis(nodes.flapGradient, fold.midX, fold.midY, fold.tipX, fold.tipY);
  setAxis(nodes.edgeGradient, fold.ax, fold.ay, fold.bx, fold.by);

  const bounce = nodes.bounce;
  if (bounce) {
    bounce.setAttribute("cx", String(fold.midX));
    bounce.setAttribute("cy", String(fold.midY));
    bounce.setAttribute("r", String(fold.bounceRadius));
  }

  // The stops are the gradient's own children, in the order FOLD_STOPS
  // declares them, so they need no handles of their own.
  const flapGradient = nodes.flapGradient;
  if (flapGradient) {
    const stops = flapGradient.children;
    const count = Math.min(stops.length, fold.stops.length);
    for (let index = 0; index < count; index += 1) {
      stops[index].setAttribute("offset", String(fold.stops[index]));
    }
  }

  const shadowOffset = nodes.shadowOffset;
  const shadowBlur = nodes.shadowBlur;
  const shadowFlood = nodes.shadowFlood;
  shadowOffset?.setAttribute("dx", String(fold.shadowX));
  shadowOffset?.setAttribute("dy", String(fold.shadowY));
  shadowBlur?.setAttribute("stdDeviation", String(fold.shadowBlur));
  shadowFlood?.setAttribute("flood-opacity", String(fold.shadowOpacity));
}

export function CurlCorner({
  className,
  intro = true,
  activationRadius = SIGNIN_CURL_SETTINGS.activationRadius,
}: CurlCornerProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [rendererMode, setRendererMode] =
    useState<CurlRendererMode>("fallback");

  /*
   * One piece of state per animated element. The setters go down to the
   * markup as ref callbacks — React hands each one its node on mount and null
   * on unmount — so nothing here reads a ref object during render and no
   * callback writes to anything it was given.
   *
   * Setters are stable, so binding them costs nothing per render, and these
   * ten only ever change together, once, at mount.
   */
  const [recess, setRecessElement] = useState<SVGPathElement | null>(null);
  const [flap, setFlapElement] = useState<SVGPathElement | null>(null);
  const [edge, setEdgeElement] = useState<SVGPathElement | null>(null);
  const [recessGradient, setRecessGradientElement] =
    useState<SVGLinearGradientElement | null>(null);
  const [flapGradient, setFlapGradientElement] =
    useState<SVGLinearGradientElement | null>(null);
  const [edgeGradient, setEdgeGradientElement] =
    useState<SVGLinearGradientElement | null>(null);
  const [bounce, setBounceElement] =
    useState<SVGRadialGradientElement | null>(null);
  const [shadowOffset, setShadowOffsetElement] =
    useState<SVGFEOffsetElement | null>(null);
  const [shadowBlur, setShadowBlurElement] =
    useState<SVGFEGaussianBlurElement | null>(null);
  const [shadowFlood, setShadowFloodElement] =
    useState<SVGFEFloodElement | null>(null);

  const nodes = useMemo<FoldNodes>(
    () => ({
      recess,
      flap,
      edge,
      recessGradient,
      flapGradient,
      edgeGradient,
      bounce,
      shadowOffset,
      shadowBlur,
      shadowFlood,
    }),
    [
      recess,
      flap,
      edge,
      recessGradient,
      flapGradient,
      edgeGradient,
      bounce,
      shadowOffset,
      shadowBlur,
      shadowFlood,
    ],
  );

  /*
   * The animation reads the bundle here, inside frames, never during render.
   * Keeping it behind a ref is what stops the elements arriving at mount from
   * counting as a change to the runtime effect below — otherwise every mount
   * would build a WebGL context, throw it away, and build another.
   */
  const nodesRef = useRef<FoldNodes>(nodes);
  useEffect(() => {
    nodesRef.current = nodes;
  }, [nodes]);

  useEffect(() => {
    const root = rootRef.current;
    const canvas = canvasRef.current;
    if (!root || !canvas) {
      return;
    }

    const reducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    );
    const coarsePointer = window.matchMedia("(hover: none), (pointer: coarse)");

    let disposed = false;
    let generation = 0;
    let runtime: FoldRuntime | null = null;
    let bounds = root.getBoundingClientRect();
    let onScreen = true;
    /*
     * The media query is a hint, not proof. Mike's preview reported a coarse
     * pointer on a desktop with a mouse and got a still picture, so an actual
     * PointerEvent that is not a finger now outranks whatever the query says.
     * Reduced motion is the one thing this cannot override.
     */
    let precisePointerSeen = false;

    /* ---------------- the drawn fold ---------------- */

    const createSvgRuntime = (): FoldRuntime => {
      let depth: Spring = { value: FOLD_REST_DEPTH, velocity: 0 };
      let lean: Spring = { value: DEFAULT_CURL_ANGLE, velocity: 0 };
      let targetDepth = FOLD_REST_DEPTH;
      let targetLean = DEFAULT_CURL_ANGLE;
      let frameRequest: number | null = null;
      let lastTimestamp: number | null = null;
      let stopped = false;
      let asleep = false;

      const paint = () => {
        applyFold(nodesRef.current, foldGeometry(depth.value, lean.value));
      };

      const cancel = () => {
        if (frameRequest !== null) {
          window.cancelAnimationFrame(frameRequest);
          frameRequest = null;
        }
        lastTimestamp = null;
      };

      const request: () => void = () => {
        if (frameRequest !== null || stopped || asleep) {
          return;
        }
        frameRequest = window.requestAnimationFrame(tick);
      };

      function tick(timestamp: number) {
        frameRequest = null;
        if (stopped || asleep) {
          return;
        }

        const delta =
          lastTimestamp === null ? 1 / 60 : (timestamp - lastTimestamp) / 1000;
        lastTimestamp = timestamp;

        depth = stepSpring(depth, targetDepth, delta);
        lean = stepSpring(
          lean,
          targetLean,
          delta,
          SIGNIN_CURL_SETTINGS.stiffness,
          SIGNIN_CURL_SETTINGS.damping,
        );
        paint();

        if (
          !isSpringAtRest(depth, targetDepth, 0.02, 0.35) ||
          !isSpringAtRest(lean, targetLean, 0.0008, 0.006)
        ) {
          request();
          return;
        }

        // Settled. Land exactly on the target and stop asking for frames.
        depth = { value: targetDepth, velocity: 0 };
        lean = { value: targetLean, velocity: 0 };
        lastTimestamp = null;
        paint();
      }

      return {
        measure() {
          // The fold is drawn in viewBox units, so it scales on its own.
        },

        point(x, y, width, height) {
          const target = computeCurlTarget({
            pointerX: x,
            pointerY: y,
            width,
            height,
            activationRadius,
            restPeel: FOLD_REST_DEPTH,
            maxPeel: FOLD_MAX_DEPTH,
            maxAngleOffset: FOLD_MAX_LEAN,
          });

          // The listener is on the window, so this runs for every move
          // anywhere on the page. Outside the activation zone the target is
          // exactly the resting one, and asking for a frame to redraw a fold
          // that is already at rest is pure waste.
          if (
            target.peel === targetDepth &&
            target.angle === targetLean &&
            frameRequest === null &&
            isSpringAtRest(depth, targetDepth, 0.02, 0.35) &&
            isSpringAtRest(lean, targetLean, 0.0008, 0.006)
          ) {
            return;
          }

          targetDepth = target.peel;
          targetLean = target.angle;
          request();
        },

        rest() {
          targetDepth = FOLD_REST_DEPTH;
          targetLean = DEFAULT_CURL_ANGLE;
          request();
        },

        pause() {
          asleep = true;
          cancel();
        },

        resume() {
          if (stopped) {
            return;
          }
          asleep = false;
          request();
        },

        dispose() {
          stopped = true;
          cancel();
          // Leave the markup in the pose it ships with.
          applyFold(nodesRef.current, FOLD_REST);
        },
      };
    };

    /* ---------------- the rendered fold ---------------- */

    const createWebglRuntime = (renderer: CurlRenderer): FoldRuntime => {
      let metrics = curlMetrics(Math.min(bounds.width, bounds.height));

      return {
        measure(width, height) {
          metrics = curlMetrics(Math.min(width, height));
          renderer.resize(width, height);
        },

        point(x, y, width, height) {
          const target = computeCurlTarget({
            pointerX: x,
            pointerY: y,
            width,
            height,
            activationRadius,
            restPeel: metrics.restPeel,
            maxPeel: metrics.maxPeel,
          });
          renderer.setTarget(target.peel, target.angle);
        },

        rest() {
          renderer.setTarget(metrics.restPeel, DEFAULT_CURL_ANGLE);
        },

        pause() {
          renderer.pause();
        },

        resume() {
          renderer.resume();
        },

        dispose() {
          renderer.dispose();
        },
      };
    };

    /* ---------------- choosing between them ---------------- */

    const teardownRuntime = () => {
      runtime?.dispose();
      runtime = null;
    };

    const startSvg = () => {
      runtime = createSvgRuntime();
      setRendererMode("svg-animated");
      runtime.rest();
      if (document.hidden || !onScreen) {
        runtime.pause();
      }
    };

    // Annotated because it reaches for itself when the GPU context drops, and
    // TypeScript will not infer the type of a function used in its own body.
    const activate: (kind: CurlRendererMode) => Promise<void> = async (kind) => {
      const mark = ++generation;
      teardownRuntime();

      if (kind === "fallback") {
        setRendererMode("fallback");
        return;
      }

      if (kind === "webgl") {
        const { createCurlRenderer } = await import("./curl-renderer");
        if (disposed || mark !== generation) {
          return;
        }

        const created = createCurlRenderer(canvas, {
          onContextLost: () => {
            void activate("svg-animated");
          },
          onContextRestored: () => {
            void activate("webgl");
          },
        });

        if (created) {
          runtime = createWebglRuntime(created);
          setRendererMode("webgl");
          runtime.measure(bounds.width, bounds.height);
          runtime.rest();
          if (intro) {
            created.startEntry();
          }
          if (document.hidden || !onScreen) {
            runtime.pause();
          }
          return;
        }
        // WebGL would not start. The drawn fold takes over — and it still moves.
      }

      if (disposed || mark !== generation) {
        return;
      }
      startSvg();
    };

    const decide = () => {
      if (reducedMotion.matches) {
        void activate("fallback");
        return;
      }
      if (coarsePointer.matches && !precisePointerSeen) {
        void activate("fallback");
        return;
      }
      void activate("webgl");
    };

    /* ---------------- input and lifecycle ---------------- */

    const onPointerMove = (event: PointerEvent) => {
      // A finger is not evidence of a pointer, and must never start motion.
      if (event.pointerType === "touch" || reducedMotion.matches) {
        return;
      }

      if (!precisePointerSeen) {
        precisePointerSeen = true;
        if (!runtime) {
          void activate("webgl");
          return;
        }
      }

      if (!runtime || !onScreen) {
        return;
      }

      runtime.point(
        event.clientX - bounds.left,
        event.clientY - bounds.top,
        bounds.width,
        bounds.height,
      );
    };

    const onPointerLeave = () => {
      runtime?.rest();
    };

    const measure = () => {
      bounds = root.getBoundingClientRect();
      runtime?.measure(bounds.width, bounds.height);
    };

    // The box is pinned to the top-right of the document, so anything moving
    // the viewport moves it. Re-read here to keep the pointer handler free of
    // layout work on every single move.
    const onViewportChange = () => {
      bounds = root.getBoundingClientRect();
    };

    const onVisibilityChange = () => {
      if (document.hidden) {
        runtime?.pause();
      } else if (onScreen) {
        runtime?.resume();
      }
    };

    const resizeObserver = new ResizeObserver(measure);
    resizeObserver.observe(root);

    let visibilityObserver: IntersectionObserver | null = null;
    if (typeof IntersectionObserver === "function") {
      visibilityObserver = new IntersectionObserver((entries) => {
        onScreen = entries.some((entry) => entry.isIntersecting);
        if (!onScreen) {
          runtime?.pause();
        } else if (!document.hidden) {
          runtime?.resume();
        }
      });
      visibilityObserver.observe(root);
    }

    const onPreferenceChange = () => {
      decide();
    };

    window.addEventListener("pointermove", onPointerMove, { passive: true });
    window.addEventListener("scroll", onViewportChange, { passive: true });
    window.addEventListener("resize", onViewportChange, { passive: true });
    document.documentElement.addEventListener("pointerleave", onPointerLeave, {
      passive: true,
    });
    document.addEventListener("visibilitychange", onVisibilityChange);
    reducedMotion.addEventListener("change", onPreferenceChange);
    coarsePointer.addEventListener("change", onPreferenceChange);

    decide();

    return () => {
      disposed = true;
      generation += 1;
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("scroll", onViewportChange);
      window.removeEventListener("resize", onViewportChange);
      document.documentElement.removeEventListener(
        "pointerleave",
        onPointerLeave,
      );
      document.removeEventListener("visibilitychange", onVisibilityChange);
      reducedMotion.removeEventListener("change", onPreferenceChange);
      coarsePointer.removeEventListener("change", onPreferenceChange);
      resizeObserver.disconnect();
      visibilityObserver?.disconnect();
      teardownRuntime();
    };
  }, [activationRadius, intro]);

  const rootClassName = className
    ? `${styles.root} ${className}`
    : styles.root;

  return (
    <div
      ref={rootRef}
      className={rootClassName}
      data-renderer={rendererMode}
      aria-hidden="true"
    >
      <StaticFold
        setRecessElement={setRecessElement}
        setFlapElement={setFlapElement}
        setEdgeElement={setEdgeElement}
        setRecessGradientElement={setRecessGradientElement}
        setFlapGradientElement={setFlapGradientElement}
        setEdgeGradientElement={setEdgeGradientElement}
        setBounceElement={setBounceElement}
        setShadowOffsetElement={setShadowOffsetElement}
        setShadowBlurElement={setShadowBlurElement}
        setShadowFloodElement={setShadowFloodElement}
      />
      <canvas ref={canvasRef} className={styles.canvas} aria-hidden="true" />
    </div>
  );
}

/*
 * The drawn fold. Everyone who is not getting the rendered one sees this:
 * touch, reduced motion, no WebGL, and the moment before the renderer loads.
 * It is real geometry rather than an approximation, because the shape only
 * reads as paper if the silhouette curves and the surfaces taper to nothing
 * where the crease meets the page edges.
 *
 * The markup ships in the resting pose and every attribute below comes from
 * FOLD_REST, so what the server sends is exactly what a still fold looks like.
 * When it is animating, the effect above rewrites those same attributes each
 * frame — React never re-renders for motion, and never overwrites the live
 * values, because it only touches attributes whose JSX has changed.
 *
 * Geometry, on a 100×100 square whose folded corner is at (100, 0):
 *
 *   crease   from (38, 0) on the top edge to (100, 62) on the right one, so
 *            the resting fold shows 62% of the box along each page edge
 *   recess   the corner triangle the sheet has lifted off
 *   flap     a leaf lying back across the page, pinched to a point at both
 *            ends of the crease and reaching its tip past the middle
 *
 * There is deliberately no namespace attribute on the element: React handles
 * that for inline SVG on its own, and writing it out would put a w3.org URL in
 * the bundle, which the CSP checks read as an external reference. Nothing here
 * loads, scripts, or can be interacted with.
 */
function StaticFold({
  setRecessElement,
  setFlapElement,
  setEdgeElement,
  setRecessGradientElement,
  setFlapGradientElement,
  setEdgeGradientElement,
  setBounceElement,
  setShadowOffsetElement,
  setShadowBlurElement,
  setShadowFloodElement,
}: FoldNodeSetters) {
  return (
    <svg
      className={styles.fallback}
      viewBox={`0 0 ${FOLD_VIEWBOX} ${FOLD_VIEWBOX}`}
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        {/* Under the sheet: darkest in the crease, opening out to the corner. */}
        <linearGradient
          id="flipitFoldRecess"
          ref={setRecessGradientElement}
          gradientUnits="userSpaceOnUse"
          x1={FOLD_REST.midX}
          y1={FOLD_REST.midY}
          x2={FOLD_VIEWBOX}
          y2="0"
        >
          <stop offset="0" stopColor={SIGNIN_CURL_PAINT.recessDeep} />
          <stop offset="0.4" stopColor={SIGNIN_CURL_PAINT.recessMid} />
          <stop
            offset="1"
            stopColor={SIGNIN_CURL_SETTINGS.recessColor}
          />
        </linearGradient>

        {/* Warm light bouncing off the underside back into the recess. */}
        <radialGradient
          id="flipitFoldBounce"
          ref={setBounceElement}
          gradientUnits="userSpaceOnUse"
          cx={FOLD_REST.midX}
          cy={FOLD_REST.midY}
          r={FOLD_REST.bounceRadius}
        >
          <stop
            offset="0"
            stopColor={SIGNIN_CURL_SETTINGS.glowColor}
            stopOpacity={SIGNIN_CURL_SETTINGS.glow / 100}
          />
          <stop
            offset="0.55"
            stopColor={SIGNIN_CURL_SETTINGS.glowColor}
            stopOpacity={(SIGNIN_CURL_SETTINGS.glow / 100) * 0.25}
          />
          <stop
            offset="1"
            stopColor={SIGNIN_CURL_SETTINGS.glowColor}
            stopOpacity="0"
          />
        </radialGradient>

        {/* The three surfaces, read outwards from the crease. */}
        <linearGradient
          id="flipitFoldFlap"
          ref={setFlapGradientElement}
          gradientUnits="userSpaceOnUse"
          x1={FOLD_REST.midX}
          y1={FOLD_REST.midY}
          x2={FOLD_REST.tipX}
          y2={FOLD_REST.tipY}
        >
          {FOLD_STOPS.map((stop, index) => (
            <stop
              key={stop.colour}
              offset={FOLD_REST.stops[index]}
              stopColor={stop.colour}
            />
          ))}
        </linearGradient>

        {/* The cut edge of the paper, brightest where it is most side-on. */}
        <linearGradient
          id="flipitFoldEdge"
          ref={setEdgeGradientElement}
          gradientUnits="userSpaceOnUse"
          x1={FOLD_REST.ax}
          y1={FOLD_REST.ay}
          x2={FOLD_REST.bx}
          y2={FOLD_REST.by}
        >
          <stop
            offset="0"
            stopColor={SIGNIN_CURL_PAINT.edge}
            stopOpacity="0.12"
          />
          <stop
            offset="0.5"
            stopColor={SIGNIN_CURL_PAINT.edge}
            stopOpacity="1"
          />
          <stop
            offset="1"
            stopColor={SIGNIN_CURL_PAINT.edge}
            stopOpacity="0.12"
          />
        </linearGradient>

        {/* The restrained detail underneath: a ruled grid, nothing to read. */}
        <pattern
          id="flipitFoldGrid"
          patternUnits="userSpaceOnUse"
          width="6.5"
          height="6.5"
        >
          <path
            d="M 6.5 0 L 0 0 L 0 6.5"
            fill="none"
            stroke={curlPalette.grid}
            strokeOpacity={SIGNIN_CURL_SETTINGS.grid / 100}
            strokeWidth="0.4"
          />
        </pattern>

        {/*
         * The contact shadow, built by hand rather than with feDropShadow so
         * its offset, spread and depth are four ordinary attributes the peel
         * can move. A near shadow for the contact, a far one for the lift.
         */}
        <filter
          id="flipitFoldShadow"
          x="-45%"
          y="-45%"
          width="200%"
          height="200%"
          colorInterpolationFilters="sRGB"
        >
          <feOffset in="SourceAlpha" dx="-0.4" dy="0.9" result="nearOffset" />
          <feGaussianBlur in="nearOffset" stdDeviation="0.7" result="nearBlur" />
          <feFlood
            floodColor={curlPalette.shadow}
            floodOpacity={FOLD_REST.shadowOpacity}
            result="nearTint"
          />
          <feComposite
            in="nearTint"
            in2="nearBlur"
            operator="in"
            result="near"
          />

          <feOffset
            ref={setShadowOffsetElement}
            in="SourceAlpha"
            dx={FOLD_REST.shadowX}
            dy={FOLD_REST.shadowY}
            result="farOffset"
          />
          <feGaussianBlur
            ref={setShadowBlurElement}
            in="farOffset"
            stdDeviation={FOLD_REST.shadowBlur}
            result="farBlur"
          />
          <feFlood
            ref={setShadowFloodElement}
            floodColor={curlPalette.shadow}
            floodOpacity={FOLD_REST.shadowOpacity}
            result="farTint"
          />
          <feComposite in="farTint" in2="farBlur" operator="in" result="far" />

          <feMerge>
            <feMergeNode in="far" />
            <feMergeNode in="near" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>

        {/*
         * One shape for the recess, so peeling rewrites a single `d` and the
         * fill, the grid and the bounce all follow it.
         */}
        <clipPath id="flipitFoldRecessShape">
          <path ref={setRecessElement} d={FOLD_REST.recessPath} />
        </clipPath>
      </defs>

      <g clipPath="url(#flipitFoldRecessShape)">
        <rect
          x="0"
          y="0"
          width={FOLD_VIEWBOX}
          height={FOLD_VIEWBOX}
          fill="url(#flipitFoldRecess)"
        />
        <rect
          x="0"
          y="0"
          width={FOLD_VIEWBOX}
          height={FOLD_VIEWBOX}
          fill="url(#flipitFoldGrid)"
        />
        <rect
          x="0"
          y="0"
          width={FOLD_VIEWBOX}
          height={FOLD_VIEWBOX}
          fill="url(#flipitFoldBounce)"
        />
      </g>

      <g filter="url(#flipitFoldShadow)">
        <path
          ref={setFlapElement}
          d={FOLD_REST.flapPath}
          fill="url(#flipitFoldFlap)"
        />
          <path
            ref={setEdgeElement}
            d={FOLD_REST.edgePath}
            fill="none"
            stroke="url(#flipitFoldEdge)"
            strokeWidth={FOLD_REST.edgeWidth}
          strokeLinecap="round"
        />
      </g>
    </svg>
  );
}
