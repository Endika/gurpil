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
  buildTerrainStrip,
  groundBackdropExtent,
  TERRAIN_FRONT_Z,
  APRON_RUN,
  APRON_DROP,
} from '../../src/render/terrain'

describe('terrainColorAt', () => {
  it('returns distinct colors for each zone', () => {
    const flat = terrainColorAt(10)
    const rocky = terrainColorAt(35)
    const uphill = terrainColorAt(70)
    const mud = terrainColorAt(110)
    const ice = terrainColorAt(150)
    const eggs = terrainColorAt(195)
    const runOut = terrainColorAt(220)

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
    const c = terrainColorAt(0)
    const g = (c >> 8) & 0xff
    const r = (c >> 16) & 0xff
    expect(g).toBeGreaterThan(r)
  })

  it('ice zone (120 < x < 170) is blue-ish', () => {
    // 0x87ceeb: B > R
    const c = terrainColorAt(140)
    const b = c & 0xff
    const r = (c >> 16) & 0xff
    expect(b).toBeGreaterThan(r)
  })
})

describe('buildTerrainStrip', () => {
  it('returns empty arrays for fewer than 2 points', () => {
    const result = buildTerrainStrip([])
    expect(result.positions.length).toBe(0)
    expect(result.indices.length).toBe(0)

    const single = buildTerrainStrip([{ x: 0, y: 0 }])
    expect(single.positions.length).toBe(0)
  })

  it('produces correct vertex count for n points', () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 1 },
    ]
    const { positions, colors } = buildTerrainStrip(pts)
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
    const { indices } = buildTerrainStrip(pts)
    // (n-1) segments × 18 indices each (3 quads: top + wall + apron, 6 each)
    expect(indices.length).toBe((pts.length - 1) * 18)
  })

  it('first top-front vertex maps x,y directly from ground point', () => {
    const pts = [
      { x: 5, y: 3 },
      { x: 10, y: 7 },
    ]
    const { positions } = buildTerrainStrip(pts)
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
    const { positions } = buildTerrainStrip(pts)
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
    const { colors } = buildTerrainStrip(pts)
    const zoneColor = new THREE.Color(terrainColorAt(110))

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
    const { colors } = buildTerrainStrip(pts)
    const zoneColor = new THREE.Color(terrainColorAt(110))
    const apronR = colors[4 * 3]
    // Darkened but proportional to the true front zone color, not the
    // backdrop-blended back-edge color.
    expect(apronR).toBeLessThan(zoneColor.r)
    expect(apronR).toBeGreaterThan(0)
  })

  it('all index values are within vertex range', () => {
    const pts = Array.from({ length: 10 }, (_, i) => ({ x: i, y: 0 }))
    const { positions, indices } = buildTerrainStrip(pts)
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
