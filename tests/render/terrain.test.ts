/**
 * Terrain builder — pure function tests.
 *
 * No WebGL, no Three.js constructors (the import is only for type shapes).
 * Tests cover the only non-trivial pure logic: zone color mapping and
 * strip geometry sizing invariants.
 */

import { describe, it, expect } from 'vitest'
import { terrainColorAt, buildTerrainStrip } from '../../src/render/terrain'

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
    // 4 verts per point × 3 floats each
    expect(positions.length).toBe(pts.length * 4 * 3)
    expect(colors.length).toBe(pts.length * 4 * 3)
  })

  it('produces correct index count for n points', () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 1 },
      { x: 3, y: 2 },
    ]
    const { indices } = buildTerrainStrip(pts)
    // (n-1) segments × 12 indices each (2 quads, 2 tris per quad, 3 verts per tri)
    expect(indices.length).toBe((pts.length - 1) * 12)
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
