/**
 * wheelMesh — pure geometry tests.
 *
 * BufferGeometry is pure JS in Three.js (no WebGL required).
 * CylinderGeometry / BoxGeometry use only typed arrays and math,
 * so these tests run headlessly in Node via Vitest.
 *
 * Tests cover:
 *   1. wheelGeometry() returns a non-empty BufferGeometry with a
 *      position attribute for every ShapeId.
 *   2. Bounding-box dimensions differ between shapes as expected
 *      (line is wider and thinner than circle; square is squarish).
 *   3. All SHAPE_IDS produce a valid geometry.
 *   4. wheelTriangleData() returns geometrically consistent arrays.
 *   5. wheelGeometryBounds() returns expected proportions.
 */

import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import {
  wheelGeometry,
  wheelTriangleData,
  wheelGeometryBounds,
  WHEEL_VISUAL_RADIUS,
} from '../../src/render/wheelMesh'
import { SHAPE_IDS } from '../../src/core/shapes'
import type { ShapeId } from '../../src/core/shapes'

// ─── wheelGeometry ────────────────────────────────────────────────────────────

describe('wheelGeometry', () => {
  it('returns a BufferGeometry for every ShapeId', () => {
    for (const id of SHAPE_IDS) {
      const geo = wheelGeometry(id as ShapeId)
      expect(geo).toBeInstanceOf(THREE.BufferGeometry)
      geo.dispose()
    }
  })

  it('position attribute is non-empty for every ShapeId', () => {
    for (const id of SHAPE_IDS) {
      const geo = wheelGeometry(id as ShapeId)
      const pos = geo.getAttribute('position')
      expect(pos).toBeDefined()
      expect(pos.count).toBeGreaterThan(0)
      geo.dispose()
    }
  })

  it('circle geometry has a position attribute with ≥ 32 vertices (cylinder disc)', () => {
    const geo = wheelGeometry('circle')
    const pos = geo.getAttribute('position')
    // CylinderGeometry with 16 segments has top cap + bottom cap + side quads
    expect(pos.count).toBeGreaterThanOrEqual(32)
    geo.dispose()
  })

  it('square geometry has exactly 24 vertices (BoxGeometry 6 faces × 4 verts)', () => {
    const geo = wheelGeometry('square')
    const pos = geo.getAttribute('position')
    expect(pos.count).toBe(24)
    geo.dispose()
  })

  it('triangle geometry has 6 vertices (3 front + 3 back)', () => {
    const geo = wheelGeometry('triangle')
    const pos = geo.getAttribute('position')
    expect(pos.count).toBe(6)
    geo.dispose()
  })

  it('line geometry has vertices for a rounded capsule roller (many more than a flat bar)', () => {
    const geo = wheelGeometry('line')
    const pos = geo.getAttribute('position')
    // CapsuleGeometry with cap/radial subdivisions produces far more vertices
    // than the old 24-vertex flat BoxGeometry bar — that density is exactly
    // what gives it rounded, non-flat-faceted ends at any spin angle.
    expect(pos.count).toBeGreaterThan(24)
    geo.dispose()
  })

  it('circle and square differ in bounding box from line (line is wider and thinner)', () => {
    const circleGeo = wheelGeometry('circle')
    circleGeo.computeBoundingBox()
    const lineGeo = wheelGeometry('line')
    lineGeo.computeBoundingBox()

    const circleBox = circleGeo.boundingBox!
    const lineBox = lineGeo.boundingBox!

    const circleWidth = circleBox.max.x - circleBox.min.x
    const circleHeight = circleBox.max.y - circleBox.min.y
    const lineWidth = lineGeo.boundingBox ? lineBox.max.x - lineBox.min.x : 0
    const lineHeight = lineGeo.boundingBox ? lineBox.max.y - lineBox.min.y : 0

    // Line bar is wider than circle disc
    expect(lineWidth).toBeGreaterThan(circleWidth)
    // Line bar is shorter (thinner) than circle disc
    expect(lineHeight).toBeLessThan(circleHeight)

    circleGeo.dispose()
    lineGeo.dispose()
  })

  it('square bounding box is approximately square (width ≈ height)', () => {
    const geo = wheelGeometry('square')
    geo.computeBoundingBox()
    const box = geo.boundingBox!
    const width = box.max.x - box.min.x
    const height = box.max.y - box.min.y
    // Should be within 1% of each other
    expect(Math.abs(width - height) / width).toBeLessThan(0.01)
    geo.dispose()
  })

  it('each shape returns a fresh geometry instance (not shared)', () => {
    const a = wheelGeometry('circle')
    const b = wheelGeometry('circle')
    expect(a).not.toBe(b)
    a.dispose()
    b.dispose()
  })
})

// ─── wheelTriangleData ────────────────────────────────────────────────────────

describe('wheelTriangleData', () => {
  const r = WHEEL_VISUAL_RADIUS
  const depth = 1.0

  it('returns 6 vertices (3 front + 3 back)', () => {
    const { positions } = wheelTriangleData(r, depth)
    expect(positions.length).toBe(6 * 3) // 6 verts × 3 floats
  })

  it('front face z values are positive (= +depth/2)', () => {
    const { positions } = wheelTriangleData(r, depth)
    // Verts 0,1,2 are front face at z = +depth/2
    expect(positions[2]).toBeCloseTo(depth / 2, 5) // v0 z
    expect(positions[5]).toBeCloseTo(depth / 2, 5) // v1 z
    expect(positions[8]).toBeCloseTo(depth / 2, 5) // v2 z
  })

  it('back face z values are negative (= -depth/2)', () => {
    const { positions } = wheelTriangleData(r, depth)
    // Verts 3,4,5 are back face at z = -depth/2
    expect(positions[11]).toBeCloseTo(-depth / 2, 5) // v3 z
    expect(positions[14]).toBeCloseTo(-depth / 2, 5) // v4 z
    expect(positions[17]).toBeCloseTo(-depth / 2, 5) // v5 z
  })

  it('bottom-left vertex is at (-r, -r)', () => {
    const { positions } = wheelTriangleData(r, depth)
    expect(positions[0]).toBeCloseTo(-r, 5) // v0 x
    expect(positions[1]).toBeCloseTo(-r, 5) // v0 y
  })

  it('apex vertex is at (0, +r)', () => {
    const { positions } = wheelTriangleData(r, depth)
    expect(positions[6]).toBeCloseTo(0, 5)  // v2 x
    expect(positions[7]).toBeCloseTo(r, 5)  // v2 y
  })

  it('index array covers all face triangles (8 triangles × 3 indices = 24)', () => {
    const { indices } = wheelTriangleData(r, depth)
    expect(indices.length).toBe(8 * 3)
  })

  it('all index values are within [0, 5]', () => {
    const { indices } = wheelTriangleData(r, depth)
    for (const idx of indices) {
      expect(idx).toBeGreaterThanOrEqual(0)
      expect(idx).toBeLessThanOrEqual(5)
    }
  })
})

// ─── wheelGeometryBounds ─────────────────────────────────────────────────────

describe('wheelGeometryBounds', () => {
  const r = WHEEL_VISUAL_RADIUS

  it('circle bounds: width = height = 2r', () => {
    const { width, height } = wheelGeometryBounds('circle', r)
    expect(width).toBeCloseTo(r * 2, 5)
    expect(height).toBeCloseTo(r * 2, 5)
  })

  it('square bounds: width = height = 2r', () => {
    const { width, height } = wheelGeometryBounds('square', r)
    expect(width).toBeCloseTo(r * 2, 5)
    expect(height).toBeCloseTo(r * 2, 5)
  })

  it('line bounds: width > height (elongated rounded roller)', () => {
    const { width, height } = wheelGeometryBounds('line', r)
    expect(width).toBeGreaterThan(height)
    // Width (overall end-to-end length) should be 6× r, same reach as the
    // old flat bar.
    expect(width).toBeCloseTo(r * 6, 5)
    // Height (cross-section diameter) is a full wheel radius — clearly
    // thicker than the old flat bar (which was 0.4× r tall) so it reads as
    // a solid roller — while still narrower than the circle/square's own
    // diameter (2r), keeping the "line" shape visually distinct.
    expect(height).toBeCloseTo(r, 5)
    expect(height).toBeGreaterThan(r * 0.4)
    expect(height).toBeLessThan(r * 2)
  })

  it('triangle bounds: width = height = 2r', () => {
    const { width, height } = wheelGeometryBounds('triangle', r)
    expect(width).toBeCloseTo(r * 2, 5)
    expect(height).toBeCloseTo(r * 2, 5)
  })

  it('all shapes return the same depth', () => {
    const depths = SHAPE_IDS.map((id) => wheelGeometryBounds(id as ShapeId, r).depth)
    const first = depths[0]
    for (const d of depths) {
      expect(d).toBeCloseTo(first, 5)
    }
  })
})
