import { describe, expect, it } from 'vitest'
import { brand, curlPalette } from '@/lib/brand'
import {
  CURL_LAB_DEFAULTS,
  CURL_LAB_PRESETS,
  SIGNIN_CURL_SETTINGS,
  creaseTilt,
  curlLabGeometry,
  curlLabTipFraction,
  curlRollRadius,
  exportCurlLabSettings,
  foldReflection,
  importCurlLabSettings,
  normalizeCurlLabSettings,
} from './curl-lab-settings'

describe('curl lab settings', () => {
  it('preserves Mike’s approved sign-in receipt exactly', () => {
    expect(SIGNIN_CURL_SETTINGS).toEqual({
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
    })
  })

  it('offers five distinct presets with valid settings', () => {
    expect(CURL_LAB_PRESETS).toHaveLength(5)
    expect(new Set(CURL_LAB_PRESETS.map((preset) => preset.id)).size).toBe(5)
    for (const preset of CURL_LAB_PRESETS) {
      expect(normalizeCurlLabSettings(preset.settings)).toEqual(preset.settings)
    }
  })

  it('supports a completely flat starting pose', () => {
    const settings = normalizeCurlLabSettings({
      ...CURL_LAB_DEFAULTS,
      startOpen: 0,
    })
    const geometry = curlLabGeometry(settings, 0)

    expect(geometry.openness).toBe(0)
    expect(geometry.flapPath).toBe('M 100 0 L 100 0 L 100 0 Z')
    expect(geometry.shadowOpacity).toBe(0)
  })

  it('supports a full page-turn ending pose', () => {
    const settings = normalizeCurlLabSettings({
      ...CURL_LAB_DEFAULTS,
      startOpen: 0,
      endOpen: 100,
    })
    const geometry = curlLabGeometry(settings, 1)

    expect(geometry.openness).toBe(1)
    expect(geometry.creaseAX).toBeLessThan(10)
    expect(geometry.creaseBY).toBeGreaterThan(90)
  })

  it('clamps unsafe imported values and preserves start/end order', () => {
    const settings = normalizeCurlLabSettings({
      ...CURL_LAB_DEFAULTS,
      size: 9999,
      startOpen: 80,
      endOpen: 20,
      brightness: -12,
      interaction: 'drag',
    })

    expect(settings.size).toBe(1200)
    expect(settings.startOpen).toBe(80)
    expect(settings.endOpen).toBe(80)
    expect(settings.brightness).toBe(45)
    expect(settings.interaction).toBe('drag')
  })

  it('reports the foot and the mirror the tip was built from', () => {
    // A leaning fold, where the crease midpoint and the perpendicular foot are
    // nowhere near each other and only one of them is the right anchor.
    const geometry = curlLabGeometry(SIGNIN_CURL_SETTINGS, 1, 1)

    expect(Math.hypot(geometry.midX - geometry.footX, geometry.midY - geometry.footY)).toBeGreaterThan(20)

    // The mirror is twice as far from the corner as the foot, along one line.
    expect(100 - geometry.mirrorX).toBeCloseTo((100 - geometry.footX) * 2, 1)
    expect(geometry.mirrorY).toBeCloseTo(geometry.footY * 2, 1)

    // And the tip sits between them, exactly `curl` of the way across.
    expect(geometry.tipX).toBeCloseTo(
      geometry.footX + (geometry.mirrorX - geometry.footX) * geometry.curl,
      1,
    )
    expect(geometry.tipY).toBeCloseTo(
      geometry.footY + (geometry.mirrorY - geometry.footY) * geometry.curl,
      1,
    )
  })

  it('exports and imports a versioned complete settings receipt', () => {
    const expected = normalizeCurlLabSettings({
      ...CURL_LAB_DEFAULTS,
      size: 777,
      endOpen: 100,
      glowColor: curlPalette.grid,
    })
    const exported = exportCurlLabSettings(expected)

    expect(importCurlLabSettings(exported)).toEqual(expected)
    expect(importCurlLabSettings('{"kind":"something-else"}')).toBeNull()
    expect(importCurlLabSettings('not-json')).toBeNull()
  })
})

/*
 * The reflection the whole fold is built on. A folded corner is the corner
 * mirrored in the crease, so the tip may only ever lie on the perpendicular
 * dropped from that corner — never on an offset from the crease midpoint, which
 * is where it used to come from and which is only the same point at 45°.
 */
describe('the fold reflection', () => {
  it('keeps the crease normal a genuine unit vector at every tilt', () => {
    // The old code clamped cosine and sine separately, which at the extremes
    // produced a pair a fifth of a percent longer than one — a "unit" normal
    // that quietly stretched every distance measured along it.
    for (const degrees of [-120, -84, -45, -20, -6, 0, 40]) {
      const tilt = creaseTilt((degrees * Math.PI) / 180)
      expect(Math.hypot(Math.cos(tilt), Math.sin(tilt))).toBeCloseTo(1, 12)
      // Held clear of both axes, so neither reach can divide by nothing.
      expect(Math.abs(Math.cos(tilt))).toBeGreaterThan(0.12)
      expect(Math.abs(Math.sin(tilt))).toBeGreaterThan(0.12)
    }

    // Inside the range it is the identity, so the approved fold is untouched.
    expect(creaseTilt(-Math.PI / 4)).toBeCloseTo(-Math.PI / 4, 12)
  })

  it('mirrors the corner and lands the tip on that one line', () => {
    for (const degrees of [-70, -45, -21]) {
      const angle = (degrees * Math.PI) / 180
      const fold = foldReflection(100, 0, 28.7, angle, 0.69, 100)

      // The foot is the corner pulled back along the normal; the mirror is the
      // same trip taken twice.
      expect(Math.hypot(100 - fold.footX, 0 - fold.footY)).toBeCloseTo(28.7, 9)
      expect(Math.hypot(100 - fold.mirrorX, 0 - fold.mirrorY)).toBeCloseTo(57.4, 9)

      // The tip is on the same line, and short of the mirror by the curl.
      const travelled = Math.hypot(100 - fold.tipX, 0 - fold.tipY)
      expect(travelled).toBeCloseTo(28.7 * 1.69, 9)
      expect(Math.atan2(0 - fold.tipY, 100 - fold.tipX)).toBeCloseTo(angle, 9)
    }
  })

  it('shortens a fold too big for its box instead of bending it off course', () => {
    // Clamping coordinates would slide the tip sideways off its perpendicular.
    // Clamping the travel keeps the direction and gives up only the distance.
    const angle = (-80 * Math.PI) / 180
    const fold = foldReflection(100, 0, 70, angle, 1, 100)

    expect(fold.tipY).toBeLessThanOrEqual(100)
    expect(fold.tipX).toBeGreaterThanOrEqual(0)
    expect(Math.atan2(0 - fold.tipY, 100 - fold.tipX)).toBeCloseTo(angle, 9)
  })

  it('solves a roll radius that spends the fold exactly', () => {
    // depth = π·radius + depth·curl: the half turn at the crease plus the flat
    // tail that carries the tip to the mirror.
    for (const [depth, curl] of [
      [140, 0.69],
      [17, 0.63],
      [55, 0.2],
    ] as const) {
      expect(Math.PI * curlRollRadius(depth, curl) + depth * curl).toBeCloseTo(
        depth,
        6,
      )
    }
  })

  it('never lets the settings ramp ask for more than a flat fold', () => {
    for (let roundness = 0; roundness <= 100; roundness += 5) {
      for (const openness of [0, 0.5, 1]) {
        const curl = curlLabTipFraction(roundness, openness)
        expect(curl).toBeGreaterThan(0)
        expect(curl).toBeLessThanOrEqual(1)
      }
    }

    // The lab's own defaults used to ask for 1.15 of a fold, which put the tip
    // past the corner's mirror image — somewhere an unstretched sheet cannot go.
    expect(curlLabTipFraction(CURL_LAB_DEFAULTS.roundness, 0.74)).toBeLessThan(1)
  })
})
