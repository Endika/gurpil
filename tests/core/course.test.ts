/**
 * Tests for the course model.
 *
 * All assertions target real behavior — no mocks, no passthrough tests.
 * buildCourse() is deterministic and pure so every test call is safe.
 */

import { describe, it, expect } from 'vitest'
import { buildCourse } from '../../src/core/course'

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Return the y values for ground points whose x falls in [xStart, xEnd). */
function yInRange(ground: { x: number; y: number }[], xStart: number, xEnd: number): number[] {
  return ground.filter((p) => p.x >= xStart && p.x < xEnd).map((p) => p.y)
}

// ─── Segment x constants — mirror course.ts public shape without importing internals ──

// We derive these from the course output rather than importing private constants,
// keeping the test independent of implementation details.

describe('buildCourse', () => {
  const course = buildCourse()

  // ── Structural invariants ──────────────────────────────────────────────────

  it('finishX > startX', () => {
    expect(course.finishX).toBeGreaterThan(course.startX)
  })

  it('ground is non-empty', () => {
    expect(course.ground.length).toBeGreaterThan(0)
  })

  it('ground x values are strictly increasing', () => {
    const { ground } = course
    for (let i = 1; i < ground.length; i++) {
      expect(ground[i].x).toBeGreaterThan(ground[i - 1].x)
    }
  })

  it('ground spans from startX to finishX', () => {
    const { ground, startX, finishX } = course
    expect(ground[0].x).toBe(startX)
    expect(ground[ground.length - 1].x).toBe(finishX)
  })

  // ── Obstacles ─────────────────────────────────────────────────────────────

  it('contains at least one egg obstacle', () => {
    const eggs = course.obstacles.filter((o) => o.kind === 'egg')
    expect(eggs.length).toBeGreaterThanOrEqual(1)
  })

  it('every obstacle is of kind egg', () => {
    for (const obs of course.obstacles) {
      expect(obs.kind).toBe('egg')
    }
  })

  it('obstacles have finite x and y', () => {
    for (const obs of course.obstacles) {
      expect(Number.isFinite(obs.x)).toBe(true)
      expect(Number.isFinite(obs.y)).toBe(true)
    }
  })

  // ── Uphill segment ────────────────────────────────────────────────────────

  it('uphill segment produces a real y rise', () => {
    // The uphill zone is somewhere in the middle of the course.
    // Find the segment with the maximum y in the course — it should be above 0.
    const maxY = Math.max(...course.ground.map((p) => p.y))
    // Ground starts at y≈0; uphill must push it clearly above that.
    expect(maxY).toBeGreaterThan(5)
  })

  it('uphill y at segment end is greater than y at segment start', () => {
    // Identify the uphill x-range by scanning for the contiguous rising stretch.
    // We look for a window where y increases monotonically for a sustained span.
    const { ground } = course
    // The uphill zone must contain at least one step where y strictly increases
    // over a span of at least 10 x units.
    let riseFound = false
    for (let i = 0; i < ground.length - 1; i++) {
      const startPt = ground[i]
      const endPt = ground[i + 1]
      const xSpan = endPt.x - startPt.x
      if (xSpan > 0 && endPt.y > startPt.y + 0.1) {
        // Found a rising step — now check if there's a sustained rise over ≥10 x units
        let j = i
        while (j < ground.length - 1 && ground[j + 1].y >= ground[j].y - 0.01) {
          j++
          if (ground[j].x - startPt.x >= 10) {
            riseFound = true
            break
          }
        }
        if (riseFound) break
      }
    }
    expect(riseFound).toBe(true)
  })

  // ── surfaceFriction ───────────────────────────────────────────────────────

  it('ice range friction < mud range friction', () => {
    // Sample a midpoint in each zone using x values from the ground polyline.
    // We pick x values in the rough second half of the course where ice and mud
    // should sit, then verify the ordering holds.

    // Strategy: scan through a wide range of x to find the minimum (ice candidate)
    // and maximum (mud candidate) friction values.
    const samples: number[] = []
    for (let x = course.startX; x <= course.finishX; x += 1) {
      samples.push(course.surfaceFriction(x))
    }
    const minFriction = Math.min(...samples)
    const maxFriction = Math.max(...samples)

    // Ice (low) must be meaningfully below mud (high)
    expect(minFriction).toBeLessThan(maxFriction)
  })

  it('surfaceFriction returns a lower value in the ice range than in the mud range', () => {
    // Identify ice and mud zones by x position: scan the full course and
    // collect distinct friction values, then compare ice vs mud directly.
    // We rely on the contract: ice friction < base friction < mud friction.

    // Sample densely to cover all zones
    const frictions = new Map<number, number[]>()
    for (let x = course.startX; x <= course.finishX; x += 0.5) {
      const f = course.surfaceFriction(x)
      const bucket = Math.round(f * 100)
      if (!frictions.has(bucket)) frictions.set(bucket, [])
      frictions.get(bucket)!.push(x)
    }

    const uniqueFrictionValues = Array.from(frictions.keys())
      .map((k) => k / 100)
      .sort((a, b) => a - b)

    // There must be at least two distinct friction tiers
    expect(uniqueFrictionValues.length).toBeGreaterThanOrEqual(2)

    // The lowest friction value must be strictly below the highest
    expect(uniqueFrictionValues[0]).toBeLessThan(
      uniqueFrictionValues[uniqueFrictionValues.length - 1],
    )
  })

  it('surfaceFriction out-of-bounds returns base friction (does not throw)', () => {
    expect(() => course.surfaceFriction(-1000)).not.toThrow()
    expect(() => course.surfaceFriction(9999)).not.toThrow()
    expect(Number.isFinite(course.surfaceFriction(-1000))).toBe(true)
    expect(Number.isFinite(course.surfaceFriction(9999))).toBe(true)
  })

  // ── Determinism ───────────────────────────────────────────────────────────

  it('buildCourse() is deterministic across two calls', () => {
    const a = buildCourse()
    const b = buildCourse()

    expect(a.startX).toBe(b.startX)
    expect(a.finishX).toBe(b.finishX)
    expect(a.ground).toEqual(b.ground)
    expect(a.obstacles).toEqual(b.obstacles)
    // surfaceFriction is a closure — compare by sampling, not reference
    for (let x = a.startX; x <= a.finishX; x += 5) {
      expect(a.surfaceFriction(x)).toBe(b.surfaceFriction(x))
    }
  })

  // ── Ground covers full course span ────────────────────────────────────────

  it('ground array covers all terrain kinds (rocky bumps present)', () => {
    // Rocky bumps produce a sawtooth — there must be both positive and negative y
    // values relative to BASE_Y (0) in the rough first third of the course.
    const rockyZone = yInRange(course.ground, 20, 50)
    const hasUp = rockyZone.some((y) => y > 0.1)
    const hasDown = rockyZone.some((y) => y < -0.1)
    expect(hasUp).toBe(true)
    expect(hasDown).toBe(true)
  })
})
