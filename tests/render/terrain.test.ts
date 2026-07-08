/**
 * Terrain builder — pure function tests.
 *
 * No WebGL, no Three.js constructors (the import is only for type shapes).
 * Tests cover the only non-trivial pure logic: zone color mapping and
 * strip geometry sizing invariants.
 */

import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import {
  terrainColorAt,
  terrainColorForKind,
  buildTerrainStrip,
  groundBackdropExtent,
  sampleGroundY,
  findRampPeak,
  bridgePlankPositions,
  TERRAIN_FRONT_Z,
  APRON_RUN,
  APRON_DROP,
} from '../../src/render/terrain'
import { THEMES } from '../../src/core/theme'
import type { TerrainKind } from '../../src/core/course'

// The grassland theme reproduces the pre-theme hardcoded palette, so these
// zone-color assertions carry over unchanged.
const theme = THEMES.grassland

describe('terrainColorAt', () => {
  it('returns distinct colors for each zone', () => {
    const flat = terrainColorAt(10, theme)
    const rocky = terrainColorAt(35, theme)
    const uphill = terrainColorAt(70, theme)
    const mud = terrainColorAt(110, theme)
    const ice = terrainColorAt(150, theme)
    const eggs = terrainColorAt(195, theme)
    const runOut = terrainColorAt(220, theme)

    // All should be non-zero hex colors
    for (const c of [flat, rocky, uphill, mud, ice, eggs, runOut]) {
      expect(c).toBeGreaterThan(0)
    }

    // Each zone should have a distinct color
    const unique = new Set([flat, rocky, uphill, mud, ice, eggs, runOut])
    expect(unique.size).toBe(7)
  })

  it('flat zone (x < 20) is green-ish', () => {
    // 0x5cb85c has G channel dominant
    const c = terrainColorAt(0, theme)
    const g = (c >> 8) & 0xff
    const r = (c >> 16) & 0xff
    expect(g).toBeGreaterThan(r)
  })

  it('ice zone (120 < x < 170) is blue-ish', () => {
    // 0x87ceeb: B > R
    const c = terrainColorAt(140, theme)
    const b = c & 0xff
    const r = (c >> 16) & 0xff
    expect(b).toBeGreaterThan(r)
  })
})

describe('terrainColorForKind (zone-accurate, incl. Stage-3 features)', () => {
  it('gives every terrain kind a distinct themed color', () => {
    const kinds: TerrainKind[] = [
      'flat',
      'rocky',
      'uphill',
      'mud',
      'ice',
      'eggs',
      'ramp',
      'water',
      'bridge',
    ]
    const colors = kinds.map((k) => terrainColorForKind(k, theme))
    for (const c of colors) expect(c).toBeGreaterThan(0)
    expect(new Set(colors).size).toBe(kinds.length)
  })

  it('water reads blue (B channel dominant) in every non-lava theme', () => {
    for (const id of ['grassland', 'desert', 'snow', 'night'] as const) {
      const c = terrainColorForKind('water', THEMES[id])
      const b = c & 0xff
      const r = (c >> 16) & 0xff
      expect(b, `${id} water should be blue`).toBeGreaterThan(r)
    }
  })
})

describe('buildTerrainStrip — zone-kind coloring path', () => {
  it('colors points by their ACTUAL zone kind when a lookup is supplied', () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
    ]
    // Pretend the whole span is a water zone: the front-edge color must equal the
    // themed water color, not the x-based flat color.
    const { colors } = buildTerrainStrip(pts, theme, () => 'water')
    const water = new THREE.Color(terrainColorForKind('water', theme))
    expect(colors[0]).toBeCloseTo(water.r, 5)
    expect(colors[1]).toBeCloseTo(water.g, 5)
    expect(colors[2]).toBeCloseTo(water.b, 5)
  })

  it('falls back to the x-based color when no lookup is supplied', () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
    ]
    const { colors } = buildTerrainStrip(pts, theme)
    const flat = new THREE.Color(terrainColorAt(0, theme))
    expect(colors[0]).toBeCloseTo(flat.r, 5)
    expect(colors[1]).toBeCloseTo(flat.g, 5)
    expect(colors[2]).toBeCloseTo(flat.b, 5)
  })
})

describe('buildTerrainStrip', () => {
  it('returns empty arrays for fewer than 2 points', () => {
    const result = buildTerrainStrip([], theme)
    expect(result.positions.length).toBe(0)
    expect(result.indices.length).toBe(0)

    const single = buildTerrainStrip([{ x: 0, y: 0 }], theme)
    expect(single.positions.length).toBe(0)
  })

  it('produces correct vertex count for n points', () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 1 },
    ]
    const { positions, colors } = buildTerrainStrip(pts, theme)
    // 5 verts per point (top-front/back, bot-front/back, apron-near) × 3 floats
    expect(positions.length).toBe(pts.length * 5 * 3)
    expect(colors.length).toBe(pts.length * 5 * 3)
  })

  it('produces correct index count for n points', () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 1 },
      { x: 3, y: 2 },
    ]
    const { indices } = buildTerrainStrip(pts, theme)
    // (n-1) segments × 18 indices each (3 quads: top + wall + apron, 6 each)
    expect(indices.length).toBe((pts.length - 1) * 18)
  })

  it('first top-front vertex maps x,y directly from ground point', () => {
    const pts = [
      { x: 5, y: 3 },
      { x: 10, y: 7 },
    ]
    const { positions } = buildTerrainStrip(pts, theme)
    // Vertex 0 = top-front of first point: (x=5, y=3, z=zFront)
    expect(positions[0]).toBe(5)
    expect(positions[1]).toBe(3)
    // z should be a positive value (front of the strip)
    expect(positions[2]).toBeGreaterThan(0)
  })

  it('apron-near vertex slopes down and toward the camera from the front edge', () => {
    const pts = [
      { x: 5, y: 3 },
      { x: 10, y: 7 },
    ]
    const { positions } = buildTerrainStrip(pts, theme)
    // Vertex 4 of the first point = apron-near: same x, dropped in y, pushed +z.
    const base = 4 * 3
    expect(positions[base + 0]).toBe(5) // same x as the front edge
    expect(positions[base + 1]).toBe(3 - APRON_DROP) // dropped below the surface
    expect(positions[base + 2]).toBeCloseTo(TERRAIN_FRONT_Z + APRON_RUN) // toward camera
    // The apron never rises above the road surface (occlusion safety).
    expect(positions[base + 1]).toBeLessThan(3)
  })

  it('back-edge color blends toward the green ground backdrop; front-edge stays the true zone color', () => {
    // Mud zone (x=110): a dark brown, distinctly non-green — the exact case
    // the dirt/grass seam fix targets (see BACK_EDGE_BACKDROP_BLEND doc
    // comment in terrain.ts).
    const pts = [
      { x: 110, y: 0 },
      { x: 111, y: 0 },
    ]
    const { colors } = buildTerrainStrip(pts, theme)
    const zoneColor = new THREE.Color(terrainColorAt(110, theme))

    // vIdx 5*0+0 = top-front, vIdx 5*0+1 = top-back (see the vertex layout
    // comment above buildTerrainStrip).
    const [frontR, frontG, frontB] = [colors[0], colors[1], colors[2]]
    const [backR, backG, backB] = [colors[3], colors[4], colors[5]]

    // Front edge keeps the exact, true zone color.
    expect(frontR).toBeCloseTo(zoneColor.r, 5)
    expect(frontG).toBeCloseTo(zoneColor.g, 5)
    expect(frontB).toBeCloseTo(zoneColor.b, 5)

    // Back edge — where the strip meets the green backdrop — shifts toward
    // green relative to the front, instead of repeating the same flat brown
    // right up to the seam.
    expect(backG).toBeGreaterThan(frontG)
    expect(backR).not.toBeCloseTo(frontR, 3)
    expect(backB).not.toBeCloseTo(frontB, 3)

    // The bottom edge (wall) mirrors the same front/back split.
    const [botFrontR] = [colors[2 * 3]]
    const [botBackR] = [colors[3 * 3]]
    expect(botFrontR).toBeCloseTo(frontR, 5)
    expect(botBackR).toBeCloseTo(backR, 5)
  })

  it('apron-near color darkens off the FRONT zone color, unaffected by the back-edge blend', () => {
    const pts = [
      { x: 110, y: 0 },
      { x: 111, y: 0 },
    ]
    const { colors } = buildTerrainStrip(pts, theme)
    const zoneColor = new THREE.Color(terrainColorAt(110, theme))
    const apronR = colors[4 * 3]
    // Darkened but proportional to the true front zone color, not the
    // backdrop-blended back-edge color.
    expect(apronR).toBeLessThan(zoneColor.r)
    expect(apronR).toBeGreaterThan(0)
  })

  it('all index values are within vertex range', () => {
    const pts = Array.from({ length: 10 }, (_, i) => ({ x: i, y: 0 }))
    const { positions, indices } = buildTerrainStrip(pts, theme)
    const maxVert = positions.length / 3 - 1
    for (const idx of indices) {
      expect(idx).toBeGreaterThanOrEqual(0)
      expect(idx).toBeLessThanOrEqual(maxVert)
    }
  })
})

describe('groundBackdropExtent', () => {
  it('centers on the course and extends well beyond it in x', () => {
    const { width, centerX } = groundBackdropExtent(0, 230)
    expect(centerX).toBe(115)
    // Spans the whole course plus a generous margin each side.
    expect(width).toBeGreaterThan(230)
    // Half-width reaches far past both ends.
    expect(centerX - width / 2).toBeLessThan(0)
    expect(centerX + width / 2).toBeGreaterThan(230)
  })

  it('produces a positive depth reaching back from the road edge into the distance', () => {
    const { depth, centerZ } = groundBackdropExtent(0, 100)
    expect(depth).toBeGreaterThan(0)
    // Center sits behind the road (negative z) — the plane recedes into -z.
    expect(centerZ).toBeLessThan(0)
  })

  it('is deterministic for the same course bounds', () => {
    expect(groundBackdropExtent(10, 500)).toEqual(groundBackdropExtent(10, 500))
  })
})

describe('sampleGroundY (Stage-4 feature geometry helper)', () => {
  it('returns the exact y at an existing ground point', () => {
    const ground = [
      { x: 0, y: 0 },
      { x: 10, y: 5 },
      { x: 20, y: 0 },
    ]
    expect(sampleGroundY(ground, 10)).toBe(5)
  })

  it('linearly interpolates between two ground points', () => {
    const ground = [
      { x: 0, y: 0 },
      { x: 10, y: 10 },
    ]
    expect(sampleGroundY(ground, 5)).toBeCloseTo(5, 5)
    expect(sampleGroundY(ground, 2.5)).toBeCloseTo(2.5, 5)
  })

  it('clamps to the first/last point outside the polyline range', () => {
    const ground = [
      { x: 10, y: 3 },
      { x: 20, y: 7 },
    ]
    expect(sampleGroundY(ground, 0)).toBe(3)
    expect(sampleGroundY(ground, 100)).toBe(7)
  })

  it('returns 0 for an empty polyline', () => {
    expect(sampleGroundY([], 5)).toBe(0)
  })
})

describe('findRampPeak (Stage-4 feature geometry helper)', () => {
  it('finds the highest point within the given x range', () => {
    const ground = [
      { x: 0, y: 0 },
      { x: 5, y: 3 },
      { x: 10, y: 8 },
      { x: 15, y: 2 },
      { x: 20, y: 0 },
    ]
    const peak = findRampPeak(ground, 0, 20)
    expect(peak).toEqual({ x: 10, y: 8 })
  })

  it('only considers points within [xStart, xEnd]', () => {
    const ground = [
      { x: 0, y: 100 }, // outside range — must be ignored
      { x: 10, y: 3 },
      { x: 15, y: 8 },
      { x: 20, y: 1 },
    ]
    const peak = findRampPeak(ground, 10, 20)
    expect(peak).toEqual({ x: 15, y: 8 })
  })

  it('returns undefined when no points fall in range', () => {
    const ground = [{ x: 0, y: 0 }]
    expect(findRampPeak(ground, 10, 20)).toBeUndefined()
  })
})

describe('bridgePlankPositions (Stage-4 feature geometry helper)', () => {
  it('spaces elements evenly across the span with no leftover gap', () => {
    const positions = bridgePlankPositions(0, 16, 4)
    expect(positions.length).toBe(4)
    // Evenly spaced at 4 apart, centered within each quarter of the span.
    expect(positions).toEqual([2, 6, 10, 14])
  })

  it('always places at least one element for a positive span', () => {
    const positions = bridgePlankPositions(0, 1, 4)
    expect(positions.length).toBe(1)
    expect(positions[0]).toBeCloseTo(0.5, 5)
  })

  it('every position stays strictly within [xStart, xEnd]', () => {
    const positions = bridgePlankPositions(10, 33, 1.6)
    for (const x of positions) {
      expect(x).toBeGreaterThan(10)
      expect(x).toBeLessThan(33)
    }
  })

  it('returns an empty array for a non-positive span or spacing', () => {
    expect(bridgePlankPositions(10, 10, 1.6)).toEqual([])
    expect(bridgePlankPositions(10, 20, 0)).toEqual([])
  })

  it('is deterministic', () => {
    expect(bridgePlankPositions(5, 27.4, 1.6)).toEqual(bridgePlankPositions(5, 27.4, 1.6))
  })
})
