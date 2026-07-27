import { brand, curlPalette } from '@/lib/brand'

export const CURL_LAB_SETTINGS_VERSION = 1
export const CURL_LAB_STORAGE_KEY = 'flipit-curl-lab-settings-v1'

export type CurlLabInteraction = 'off' | 'proximity' | 'drag'

export interface CurlLabSettings {
  size: number
  anchorX: number
  anchorY: number
  startOpen: number
  endOpen: number
  startAngle: number
  endAngle: number
  roundness: number
  lift: number
  thickness: number
  brightness: number
  sheen: number
  shadow: number
  shadowBlur: number
  grid: number
  glow: number
  activationRadius: number
  stiffness: number
  damping: number
  interaction: CurlLabInteraction
  holdAfterDrag: boolean
  showHandle: boolean
  autoDemo: boolean
  faceColor: string
  faceHighlightColor: string
  rollColor: string
  undersideColor: string
  undersideHighlightColor: string
  edgeColor: string
  recessColor: string
  glowColor: string
}

export interface CurlLabPreset {
  id: string
  label: string
  description: string
  settings: CurlLabSettings
}

export interface CurlLabGeometry {
  progress: number
  openness: number
  angle: number
  recessPath: string
  flapPath: string
  edgePath: string
  tipX: number
  tipY: number
  midX: number
  midY: number
  /** The foot of the perpendicular dropped from the corner onto the crease. */
  footX: number
  footY: number
  /** The corner mirrored in the crease: where the tip lands in a flat fold. */
  mirrorX: number
  mirrorY: number
  /** How much of the way from the foot to the mirror the tip actually got. */
  curl: number
  creaseAX: number
  creaseAY: number
  creaseBX: number
  creaseBY: number
  bounceRadius: number
  shadowX: number
  shadowY: number
  shadowBlur: number
  shadowOpacity: number
  edgeWidth: number
  flapStops: number[]
}

export interface CurlLabPaint {
  face: string
  faceHighlight: string
  roll: string
  underside: string
  undersideHighlight: string
  edge: string
  recessDeep: string
  recessMid: string
  flapColours: string[]
}

const HEX = /^#[0-9a-f]{6}$/i

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function colour(value: unknown, fallback: string): string {
  return typeof value === 'string' && HEX.test(value) ? value.toLowerCase() : fallback
}

function rounded(value: number): number {
  return Math.round(value * 100) / 100
}

function lerp(from: number, to: number, amount: number): number {
  return from + (to - from) * amount
}

/* ------------------------------------------------------------------------ *
 * The fold, solved by reflection.
 *
 * A folded page corner is not a shape that happens to sit near the crease: it
 * is the corner *mirrored in* the crease. Drop a perpendicular from the corner
 * onto the crease line and you land on the foot; carry on the same distance
 * again and you reach the corner's mirror image, which is exactly where the tip
 * comes to rest when the sheet is folded flat. Every tip the paper can reach
 * lies on that one segment, and the segment's direction is the crease normal —
 * which is to say, the direction the pointer is pulling in.
 *
 * The crease midpoint used to stand in for the foot. The two coincide only in
 * the symmetrical 45° pose; lean the fold and the midpoint slides away down the
 * longer arm and drags the tip with it. At the widest lean the sign-in fold put
 * its tip 33 units from the corner's own mirror axis, which is why a leaning
 * fold read as a shape sliding down the page edge rather than as a corner being
 * turned over.
 * ------------------------------------------------------------------------ */

/**
 * How far the crease may tilt before the box can no longer hold it.
 *
 * Both limits are the same distance from an axis, so `Math.cos` and `Math.sin`
 * of the clamped tilt are never smaller than about 0.12 and always describe a
 * genuine unit normal. The previous version clamped the two components
 * separately, which produced a "normal" slightly longer than one and a crease
 * the reflection was no longer quite square to.
 */
const MAX_CREASE_TILT = 83
const MIN_CREASE_TILT = 7

/** The crease normal's angle, held inside the range the box can draw. */
export function creaseTilt(angle: number): number {
  const degrees = (angle * 180) / Math.PI
  return (clamp(degrees, -MAX_CREASE_TILT, -MIN_CREASE_TILT) * Math.PI) / 180
}

/**
 * Below this the settings ramp is taken at face value; above it the last of the
 * range is eased into the flat-fold limit instead of being clipped there.
 */
const CURL_KNEE = 0.75

/**
 * How far past the crease the tip reaches, as a fraction of the fold's depth.
 *
 * Zero leaves the tip lying on the crease; one is a flat fold, where the tip
 * lands precisely on the corner's mirror image and an inextensible sheet has
 * nowhere further to go. The raw settings ramp can ask for more than one, so
 * the top of the range saturates smoothly rather than being clipped — and it is
 * the identity below the knee, which leaves the approved sign-in fold (0.632 at
 * rest, 0.690 fully peeled) untouched to the last decimal.
 */
export function curlLabTipFraction(
  roundness: number,
  openness: number,
): number {
  const raw =
    0.56 + (clamp(roundness, 0, 100) / 100) * 0.92 + clamp(openness, 0, 1) * 0.16

  if (raw <= CURL_KNEE) {
    return raw
  }

  const headroom = 1 - CURL_KNEE
  return CURL_KNEE + headroom * (1 - Math.exp(-(raw - CURL_KNEE) / headroom))
}

/**
 * The radius of the rolled lip at the crease.
 *
 * The sheet spends its curvature turning through a half circle and then has
 * none left, so it runs straight on from there. Its depth is therefore the half
 * circle's arc length plus the flat tail: `depth = π·radius + depth·curl`. That
 * one identity is what makes the rolled surface land its tip on exactly the
 * point the reflection above predicts, so the WebGL fold and the drawn one
 * agree on the silhouette instead of merely resembling each other.
 */
export function curlRollRadius(depth: number, curl: number): number {
  return Math.max((Math.max(depth, 0) * (1 - clamp(curl, 0, 1))) / Math.PI, 1e-4)
}

export interface FoldReflection {
  /** Unit normal, pointing from the crease out towards the folded corner. */
  normalX: number
  normalY: number
  /** Perpendicular foot on the crease, and the corner's mirror image. */
  footX: number
  footY: number
  mirrorX: number
  mirrorY: number
  /** The tip: the corner carried `curl` of the way from the foot to the mirror. */
  tipX: number
  tipY: number
}

/**
 * Where the folded corner and its tip actually are.
 *
 * `depth` is the perpendicular distance from the crease back to the corner and
 * `angle` is the crease normal. The travel to the tip is clamped, rather than
 * its coordinates, so a fold too big for its box comes up short along its own
 * perpendicular instead of being bent sideways off it.
 *
 * Only `boxHeight` bounds that travel: leaving the top-right corner the fold
 * runs left and down, so it can reach the left wall and the floor but never the
 * right wall it started against.
 */
export function foldReflection(
  cornerX: number,
  cornerY: number,
  depth: number,
  angle: number,
  curl: number,
  boxHeight: number,
): FoldReflection {
  const tilt = creaseTilt(angle)
  const normalX = Math.cos(tilt)
  const normalY = Math.sin(tilt)
  const reach = Math.max(depth, 0)

  const footX = cornerX - normalX * reach
  const footY = cornerY - normalY * reach
  const mirrorX = cornerX - normalX * reach * 2
  const mirrorY = cornerY - normalY * reach * 2

  // Past the crease the fold runs left and down, so those are the only two
  // walls it can reach. Both are expressed as a distance along the perpendicular.
  const room = Math.min(footX / normalX, (boxHeight - footY) / -normalY)
  const travel = clamp(reach * clamp(curl, 0, 1), 0, Math.max(room, 0))

  return {
    normalX,
    normalY,
    footX,
    footY,
    mirrorX,
    mirrorY,
    tipX: footX - normalX * travel,
    tipY: footY - normalY * travel,
  }
}

function hexToRgb(hex: string): [number, number, number] {
  const value = Number.parseInt(hex.slice(1), 16)
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255]
}

function rgbToHex(red: number, green: number, blue: number): string {
  return `#${[red, green, blue]
    .map((channel) =>
      clamp(Math.round(channel), 0, 255).toString(16).padStart(2, '0'),
    )
    .join('')}`
}

export function brightenCurlColour(hex: string, percent: number): string {
  const [red, green, blue] = hexToRgb(hex)
  const factor = percent / 100
  return rgbToHex(red * factor, green * factor, blue * factor)
}

export function mixCurlColour(
  hex: string,
  target: string,
  amount: number,
): string {
  const first = hexToRgb(hex)
  const second = hexToRgb(target)
  return rgbToHex(
    first[0] + (second[0] - first[0]) * amount,
    first[1] + (second[1] - first[1]) * amount,
    first[2] + (second[2] - first[2]) * amount,
  )
}

export const CURL_LAB_DEFAULTS: CurlLabSettings = {
  size: 360,
  anchorX: 100,
  anchorY: 0,
  startOpen: 36,
  endOpen: 74,
  startAngle: -45,
  endAngle: -45,
  roundness: 58,
  lift: 55,
  thickness: 0.8,
  brightness: 100,
  sheen: 58,
  shadow: 66,
  shadowBlur: 48,
  grid: 13,
  glow: 26,
  activationRadius: 420,
  stiffness: 168,
  damping: 23,
  interaction: 'proximity',
  holdAfterDrag: true,
  showHandle: true,
  autoDemo: false,
  faceColor: curlPalette.face,
  faceHighlightColor: curlPalette.faceHighlight,
  rollColor: curlPalette.roll,
  undersideColor: curlPalette.underside,
  undersideHighlightColor: curlPalette.undersideHighlight,
  edgeColor: curlPalette.edgeBright,
  recessColor: curlPalette.recess,
  glowColor: brand.orange,
}

/** Mike's approved Curl Lab receipt, copied exactly on 2026-07-27. */
export const SIGNIN_CURL_SETTINGS: CurlLabSettings = {
  size: 490,
  anchorX: 100,
  anchorY: 0,
  startOpen: 5,
  endOpen: 41,
  startAngle: -45,
  endAngle: -45,
  roundness: 7,
  lift: 100,
  thickness: 0.2,
  brightness: 101,
  sheen: 26,
  shadow: 75,
  shadowBlur: 50,
  grid: 27,
  glow: 21,
  activationRadius: 1400,
  stiffness: 132,
  damping: 45,
  interaction: 'proximity',
  holdAfterDrag: false,
  showHandle: false,
  autoDemo: false,
  faceColor: curlPalette.selectedFace,
  faceHighlightColor: curlPalette.selectedFaceHighlight,
  rollColor: curlPalette.selectedRoll,
  undersideColor: curlPalette.softUnderside,
  undersideHighlightColor: curlPalette.undersideHighlight,
  edgeColor: curlPalette.edgeBright,
  recessColor: curlPalette.recess,
  glowColor: brand.orange,
}

export function curlLabPaint(rawSettings: CurlLabSettings): CurlLabPaint {
  const settings = normalizeCurlLabSettings(rawSettings)
  const brightness = settings.brightness
  const face = brightenCurlColour(settings.faceColor, brightness)
  const faceHighlight = brightenCurlColour(
    settings.faceHighlightColor,
    brightness,
  )
  const roll = brightenCurlColour(settings.rollColor, brightness)
  const underside = brightenCurlColour(settings.undersideColor, brightness)
  const undersideHighlight = brightenCurlColour(
    settings.undersideHighlightColor,
    brightness,
  )
  const edge = mixCurlColour(
    brightenCurlColour(settings.edgeColor, brightness),
    curlPalette.pureLight,
    settings.sheen / 180,
  )

  return {
    face,
    faceHighlight,
    roll,
    underside,
    undersideHighlight,
    edge,
    recessDeep: mixCurlColour(
      settings.recessColor,
      curlPalette.pureDark,
      0.7,
    ),
    recessMid: mixCurlColour(
      settings.recessColor,
      curlPalette.pureDark,
      0.35,
    ),
    flapColours: [
      face,
      faceHighlight,
      mixCurlColour(faceHighlight, roll, 0.35),
      roll,
      mixCurlColour(roll, underside, 0.5),
      underside,
      mixCurlColour(underside, undersideHighlight, 0.45),
      undersideHighlight,
      mixCurlColour(undersideHighlight, edge, 0.55),
      edge,
    ],
  }
}

function preset(
  id: string,
  label: string,
  description: string,
  changes: Partial<CurlLabSettings>,
): CurlLabPreset {
  return {
    id,
    label,
    description,
    settings: { ...CURL_LAB_DEFAULTS, ...changes },
  }
}

export const CURL_LAB_PRESETS: readonly CurlLabPreset[] = [
  preset(
    'subtle-signature',
    'Subtle Signature',
    'Small, quiet and conservative.',
    {
      size: 230,
      startOpen: 24,
      endOpen: 48,
      roundness: 40,
      lift: 30,
      sheen: 36,
      shadow: 42,
      glow: 14,
      activationRadius: 300,
    },
  ),
  preset(
    'executive-fold',
    'Executive Fold',
    'Balanced depth, polish and restraint.',
    {},
  ),
  preset(
    'soft-paper',
    'Soft Paper',
    'Rounder material with a gentle spring.',
    {
      size: 430,
      startOpen: 30,
      endOpen: 70,
      roundness: 82,
      lift: 42,
      thickness: 0.55,
      stiffness: 112,
      damping: 20,
      faceHighlightColor: curlPalette.softFaceHighlight,
      undersideColor: curlPalette.softUnderside,
    },
  ),
  preset(
    'dramatic-reveal',
    'Dramatic Reveal',
    'A larger, brighter peel for presentation.',
    {
      size: 620,
      startOpen: 18,
      endOpen: 92,
      startAngle: -52,
      endAngle: -34,
      roundness: 72,
      lift: 82,
      brightness: 118,
      sheen: 86,
      shadow: 82,
      glow: 54,
      activationRadius: 640,
    },
  ),
  preset(
    'full-page-flip',
    'Full Flip',
    'Starts flat and turns across most of the page.',
    {
      size: 920,
      startOpen: 0,
      endOpen: 100,
      startAngle: -45,
      endAngle: -45,
      roundness: 88,
      lift: 100,
      brightness: 112,
      sheen: 92,
      shadow: 88,
      shadowBlur: 72,
      glow: 64,
      activationRadius: 900,
      stiffness: 126,
      damping: 18,
    },
  ),
] as const

export function normalizeCurlLabSettings(
  value: Partial<CurlLabSettings> | null | undefined,
): CurlLabSettings {
  const source = value ?? {}
  const interaction: CurlLabInteraction =
    source.interaction === 'off' ||
    source.interaction === 'drag' ||
    source.interaction === 'proximity'
      ? source.interaction
      : CURL_LAB_DEFAULTS.interaction

  const startOpen = clamp(
    finite(source.startOpen, CURL_LAB_DEFAULTS.startOpen),
    0,
    100,
  )
  const endOpen = clamp(
    finite(source.endOpen, CURL_LAB_DEFAULTS.endOpen),
    startOpen,
    100,
  )

  return {
    size: clamp(finite(source.size, CURL_LAB_DEFAULTS.size), 120, 1200),
    anchorX: clamp(finite(source.anchorX, CURL_LAB_DEFAULTS.anchorX), 10, 100),
    anchorY: clamp(finite(source.anchorY, CURL_LAB_DEFAULTS.anchorY), 0, 90),
    startOpen,
    endOpen,
    startAngle: clamp(
      finite(source.startAngle, CURL_LAB_DEFAULTS.startAngle),
      -82,
      -8,
    ),
    endAngle: clamp(
      finite(source.endAngle, CURL_LAB_DEFAULTS.endAngle),
      -82,
      -8,
    ),
    roundness: clamp(
      finite(source.roundness, CURL_LAB_DEFAULTS.roundness),
      0,
      100,
    ),
    lift: clamp(finite(source.lift, CURL_LAB_DEFAULTS.lift), 0, 100),
    thickness: clamp(
      finite(source.thickness, CURL_LAB_DEFAULTS.thickness),
      0.2,
      3,
    ),
    brightness: clamp(
      finite(source.brightness, CURL_LAB_DEFAULTS.brightness),
      45,
      180,
    ),
    sheen: clamp(finite(source.sheen, CURL_LAB_DEFAULTS.sheen), 0, 100),
    shadow: clamp(finite(source.shadow, CURL_LAB_DEFAULTS.shadow), 0, 100),
    shadowBlur: clamp(
      finite(source.shadowBlur, CURL_LAB_DEFAULTS.shadowBlur),
      0,
      100,
    ),
    grid: clamp(finite(source.grid, CURL_LAB_DEFAULTS.grid), 0, 60),
    glow: clamp(finite(source.glow, CURL_LAB_DEFAULTS.glow), 0, 100),
    activationRadius: clamp(
      finite(source.activationRadius, CURL_LAB_DEFAULTS.activationRadius),
      120,
      1400,
    ),
    stiffness: clamp(
      finite(source.stiffness, CURL_LAB_DEFAULTS.stiffness),
      40,
      320,
    ),
    damping: clamp(
      finite(source.damping, CURL_LAB_DEFAULTS.damping),
      8,
      45,
    ),
    interaction,
    holdAfterDrag:
      typeof source.holdAfterDrag === 'boolean'
        ? source.holdAfterDrag
        : CURL_LAB_DEFAULTS.holdAfterDrag,
    showHandle:
      typeof source.showHandle === 'boolean'
        ? source.showHandle
        : CURL_LAB_DEFAULTS.showHandle,
    autoDemo:
      typeof source.autoDemo === 'boolean'
        ? source.autoDemo
        : CURL_LAB_DEFAULTS.autoDemo,
    faceColor: colour(source.faceColor, CURL_LAB_DEFAULTS.faceColor),
    faceHighlightColor: colour(
      source.faceHighlightColor,
      CURL_LAB_DEFAULTS.faceHighlightColor,
    ),
    rollColor: colour(source.rollColor, CURL_LAB_DEFAULTS.rollColor),
    undersideColor: colour(
      source.undersideColor,
      CURL_LAB_DEFAULTS.undersideColor,
    ),
    undersideHighlightColor: colour(
      source.undersideHighlightColor,
      CURL_LAB_DEFAULTS.undersideHighlightColor,
    ),
    edgeColor: colour(source.edgeColor, CURL_LAB_DEFAULTS.edgeColor),
    recessColor: colour(source.recessColor, CURL_LAB_DEFAULTS.recessColor),
    glowColor: colour(source.glowColor, CURL_LAB_DEFAULTS.glowColor),
  }
}

export function curlLabGeometry(
  rawSettings: CurlLabSettings,
  rawProgress: number,
  pointerLean = 0,
): CurlLabGeometry {
  const settings = normalizeCurlLabSettings(rawSettings)
  const progress = clamp(rawProgress, 0, 1)
  const openness = lerp(settings.startOpen, settings.endOpen, progress) / 100
  const angleDegrees =
    lerp(settings.startAngle, settings.endAngle, progress) +
    clamp(pointerLean, -1, 1) * 24
  const angle = creaseTilt((angleDegrees * Math.PI) / 180)

  if (openness <= 0.001) {
    return {
      progress,
      openness: 0,
      angle,
      recessPath: 'M 100 0 L 100 0 L 100 0 Z',
      flapPath: 'M 100 0 L 100 0 L 100 0 Z',
      edgePath: 'M 100 0 L 100 0',
      tipX: 100,
      tipY: 0,
      midX: 100,
      midY: 0,
      footX: 100,
      footY: 0,
      mirrorX: 100,
      mirrorY: 0,
      curl: 0,
      creaseAX: 100,
      creaseAY: 0,
      creaseBX: 100,
      creaseBY: 0,
      bounceRadius: 0,
      shadowX: 0,
      shadowY: 0,
      shadowBlur: 0,
      shadowOpacity: 0,
      edgeWidth: settings.thickness,
      flapStops: [0, 0.08, 0.17, 0.25, 0.36, 0.5, 0.66, 0.82, 0.94, 1],
    }
  }

  // The tilt is already held clear of both axes, so these are a true unit
  // normal and every distance below can be read straight off them.
  const cosine = Math.cos(angle)
  const sine = Math.sin(angle)
  const depth = openness * 70
  const topReach = clamp(depth / cosine, 0, 98)
  const rightReach = clamp(depth / -sine, 0, 98)
  const ax = 100 - topReach
  const ay = 0
  const bx = 100
  const by = rightReach
  const midX = (ax + bx) / 2
  const midY = by / 2
  const spanX = bx - ax
  const spanY = by
  const length = Math.max(0.001, Math.hypot(spanX, spanY))
  const alongX = spanX / length
  const alongY = spanY / length
  const intoX = -cosine
  const intoY = -sine
  const roundness = settings.roundness / 100
  const lift = settings.lift / 100

  const curl = curlLabTipFraction(settings.roundness, openness)
  const fold = foldReflection(100, 0, depth, angle, curl, 100)
  const { footX, footY, mirrorX, mirrorY, tipX, tipY } = fold

  const bulge = depth * (0.02 + roundness * 0.2)
  /*
   * Each arm is measured from its own end of the crease to the foot rather than
   * from a single shared half-length. The two ends are only equidistant in the
   * symmetrical pose — lean the fold and one arm of the corner triangle becomes
   * far longer than the other, and a shared arm sends the short side's control
   * point straight past the tip, hooking the silhouette. Because the two are
   * equal at 45°, both collapse back to exactly the value this used to be and
   * the approved fold is unchanged.
   */
  const armScale = 2 * (0.38 - roundness * 0.12)
  const armA = Math.hypot(ax - footX, ay - footY) * armScale
  const armB = Math.hypot(bx - footX, by - footY) * armScale
  const c1x = ax + alongX * armA + intoX * bulge
  const c1y = ay + alongY * armA + intoY * bulge
  const c2x = bx - alongX * armB + intoX * bulge
  const c2y = by - alongY * armB + intoY * bulge

  const edgePath =
    `M ${rounded(ax)} 0` +
    ` Q ${rounded(c1x)} ${rounded(c1y)} ${rounded(tipX)} ${rounded(tipY)}` +
    ` Q ${rounded(c2x)} ${rounded(c2y)} 100 ${rounded(by)}`

  const reveal = clamp((settings.sheen / 100) * 0.25 + openness * 0.5, 0, 0.75)
  const roll = 0.3 - reveal * 0.16
  const flapStops = [
    0,
    0.07,
    0.15,
    roll,
    roll + 0.1,
    roll + 0.24,
    roll + 0.42,
    roll + 0.58,
    roll + 0.7,
    1,
  ].map((offset, index, all) => {
    const lower = index === 0 ? 0 : all[index - 1] + 0.005
    return rounded(clamp(offset, lower, 1))
  })

  return {
    progress,
    openness,
    angle,
    recessPath: `M ${rounded(ax)} 0 L 100 0 L 100 ${rounded(by)} Z`,
    flapPath: `${edgePath} Z`,
    edgePath,
    tipX: rounded(tipX),
    tipY: rounded(tipY),
    midX: rounded(midX),
    midY: rounded(midY),
    footX: rounded(footX),
    footY: rounded(footY),
    mirrorX: rounded(mirrorX),
    mirrorY: rounded(mirrorY),
    curl,
    creaseAX: rounded(ax),
    creaseAY: ay,
    creaseBX: bx,
    creaseBY: rounded(by),
    bounceRadius: rounded(length * (0.26 + (settings.glow / 100) * 0.34)),
    shadowX: rounded(-(0.5 + lift * 3.2)),
    shadowY: rounded(1 + lift * 5.2),
    shadowBlur: rounded(
      0.4 + (settings.shadowBlur / 100) * 5.6 + lift * 1.8,
    ),
    shadowOpacity: rounded((settings.shadow / 100) * (0.45 + lift * 0.45)),
    edgeWidth: rounded(settings.thickness),
    flapStops,
  }
}

export function exportCurlLabSettings(settings: CurlLabSettings): string {
  return JSON.stringify(
    {
      kind: 'flipit-curl-lab-settings',
      version: CURL_LAB_SETTINGS_VERSION,
      settings: normalizeCurlLabSettings(settings),
    },
    null,
    2,
  )
}

export function importCurlLabSettings(value: string): CurlLabSettings | null {
  try {
    const parsed = JSON.parse(value) as {
      kind?: unknown
      version?: unknown
      settings?: Partial<CurlLabSettings>
    }
    if (
      parsed.kind !== 'flipit-curl-lab-settings' ||
      parsed.version !== CURL_LAB_SETTINGS_VERSION ||
      !parsed.settings
    ) {
      return null
    }
    return normalizeCurlLabSettings(parsed.settings)
  } catch {
    return null
  }
}
