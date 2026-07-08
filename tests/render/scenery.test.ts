/**
 * Landscape scenery — pure placement helper tests.
 *
 * No WebGL, no Three.js constructors (only the pure hash/placement helpers
 * are exercised). Covers the determinism guarantee (same seed → same
 * output), range coverage, and the instance-count budget.
 */

import { describe, it, expect } from 'vitest'
import { sceneryHash, sampleGroundY, scatterAlongCourse, spacingForBudget } from '../../src/render/scenery'

describe('sceneryHash', () => {
  it('is deterministic: same seed yields the same value', () => {
    expect(sceneryHash(42)).toBe(sceneryHash(42))
    expect(sceneryHash(1234.5)).toBe(sceneryHash(1234.5))
  })

  it('always returns a value in [0, 1)', () => {
    for (const seed of [0, 1, -5, 100.25, 9999, -0.001]) {
      const h = sceneryHash(seed)
      expect(h).toBeGreaterThanOrEqual(0)
      expect(h).toBeLessThan(1)
    }
  })

  it('different seeds generally yield different values', () => {
    const values = new Set([1, 2, 3, 4, 5].map((s) => sceneryHash(s)))
    expect(values.size).toBe(5)
  })
})

describe('sampleGroundY', () => {
  const ground = [
    { x: 0, y: 0 },
    { x: 10, y: 10 },
    { x: 20, y: 0 },
  ]

  it('returns exact y at known points', () => {
    expect(sampleGroundY(ground, 0)).toBe(0)
    expect(sampleGroundY(ground, 10)).toBe(10)
    expect(sampleGroundY(ground, 20)).toBe(0)
  })

  it('linearly interpolates between two bracketing points', () => {
    expect(sampleGroundY(ground, 5)).toBeCloseTo(5)
    expect(sampleGroundY(ground, 15)).toBeCloseTo(5)
  })

  it('clamps to the first/last point beyond the polyline range', () => {
    expect(sampleGroundY(ground, -100)).toBe(0)
    expect(sampleGroundY(ground, 1000)).toBe(0)
  })

  it('returns 0 for an empty ground array', () => {
    expect(sampleGroundY([], 5)).toBe(0)
  })
})

describe('scatterAlongCourse', () => {
  it('is deterministic: same inputs yield identical points', () => {
    const a = scatterAlongCourse(0, 100, 9, 23)
    const b = scatterAlongCourse(0, 100, 9, 23)
    expect(a).toEqual(b)
  })

  it('spans the requested range (first/last points near the ends)', () => {
    const points = scatterAlongCourse(0, 100, 10, 7)
    expect(points.length).toBeGreaterThan(0)
    const xs = points.map((p) => p.x)
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(-10) // allowing for jitter below 0
    expect(Math.max(...xs)).toBeLessThanOrEqual(110) // allowing for jitter above 100
    // The first and last grid slots should be close to the range's ends.
    expect(xs[0]).toBeLessThan(10)
    expect(xs[xs.length - 1]).toBeGreaterThan(90)
  })

  it('every point carries a hash in [0, 1)', () => {
    const points = scatterAlongCourse(0, 50, 5, 3)
    for (const p of points) {
      expect(p.hash).toBeGreaterThanOrEqual(0)
      expect(p.hash).toBeLessThan(1)
    }
  })

  it('different seeds produce different jitter for the same grid', () => {
    const a = scatterAlongCourse(0, 50, 5, 1)
    const b = scatterAlongCourse(0, 50, 5, 2)
    expect(a).not.toEqual(b)
  })

  it('returns an empty array for a degenerate or zero-length range', () => {
    expect(scatterAlongCourse(10, 10, 5, 1)).toEqual([])
    expect(scatterAlongCourse(10, 5, 5, 1)).toEqual([])
    expect(scatterAlongCourse(0, 100, 0, 1)).toEqual([])
  })
})

describe('spacingForBudget', () => {
  it('keeps the base spacing when the naive count is within budget', () => {
    expect(spacingForBudget(100, 10, 50)).toBe(10)
  })

  it('widens spacing so the count never exceeds the budget', () => {
    const rangeLen = 1000
    const baseSpacing = 5
    const maxCount = 20
    const spacing = spacingForBudget(rangeLen, baseSpacing, maxCount)
    expect(spacing).toBeGreaterThan(baseSpacing)
    expect(rangeLen / spacing).toBeLessThanOrEqual(maxCount)
  })

  it('falls back to base spacing for a non-positive range or budget', () => {
    expect(spacingForBudget(0, 10, 50)).toBe(10)
    expect(spacingForBudget(100, 10, 0)).toBe(10)
  })
})
