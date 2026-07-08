/**
 * Tests for the endless course generator — determinism, that it is very long,
 * that its difficulty RAMPS with distance, and (on the REAL Rapier engine) that a
 * vehicle can be driven a LONG way — well past several checkpoints — with a
 * sensible shape strategy, proving the ramp has no dead-ends.
 */

import { describe, it, expect, beforeAll } from 'vitest'
import RAPIER from '@dimforge/rapier2d-compat'
import { generateEndlessCourse, zoneAt, type Course, type TerrainKind } from '../../src/core/course'
import { CHECKPOINT_SPACING } from '../../src/core/endless'
import { createWorld } from '../../src/physics/world'
import { createVehicle } from '../../src/physics/vehicle'
import type { ShapeId } from '../../src/core/shapes'

// ─── Determinism ──────────────────────────────────────────────────────────────

describe('generateEndlessCourse — determinism', () => {
  it('same seed → byte-identical track', () => {
    const a = generateEndlessCourse({ seed: 12345 })
    const b = generateEndlessCourse({ seed: 12345 })
    expect(a.startX).toBe(b.startX)
    expect(a.finishX).toBe(b.finishX)
    expect(a.ground).toEqual(b.ground)
    expect(a.obstacles).toEqual(b.obstacles)
    expect(a.zones).toEqual(b.zones)
  })

  it('different seed → different track', () => {
    const a = generateEndlessCourse({ seed: 1 })
    const b = generateEndlessCourse({ seed: 2 })
    const differs =
      a.finishX !== b.finishX ||
      JSON.stringify(a.ground) !== JSON.stringify(b.ground) ||
      JSON.stringify(a.obstacles) !== JSON.stringify(b.obstacles)
    expect(differs).toBe(true)
  })
})

// ─── Structure ────────────────────────────────────────────────────────────────

describe('generateEndlessCourse — structure', () => {
  const course = generateEndlessCourse({ seed: 7 })

  it('is VERY long (far longer than a normal generated course)', () => {
    expect(course.finishX - course.startX).toBeGreaterThan(5000)
  })

  it('starts and ends flat (safe spawn + capped far end)', () => {
    expect(course.zones[0].kind).toBe('flat')
    expect(course.zones[course.zones.length - 1].kind).toBe('flat')
  })

  it('zones tile [startX, finishX] contiguously', () => {
    expect(course.zones[0].xStart).toBe(course.startX)
    expect(course.zones[course.zones.length - 1].xEnd).toBe(course.finishX)
    for (let i = 1; i < course.zones.length; i++) {
      expect(course.zones[i].xStart).toBe(course.zones[i - 1].xEnd)
    }
  })

  it('has many hazard zones (a long ramped sequence)', () => {
    expect(course.zones.length).toBeGreaterThan(30)
  })

  it('every obstacle is a finite egg inside an eggs zone', () => {
    for (const obs of course.obstacles) {
      expect(obs.kind).toBe('egg')
      expect(Number.isFinite(obs.x)).toBe(true)
      expect(zoneAt(course, obs.x)?.kind).toBe('eggs')
    }
  })
})

// ─── Difficulty ramps with distance ───────────────────────────────────────────
//
// Monotonic metric: the peak terrain height in a window. Hills grow from the
// beginner floor (grade ~0.2, short) to the expert ceiling (grade ~0.5, long) as x
// increases, so a late window's tallest terrain dwarfs an early window's. Averaged
// over several seeds to be robust to the random hazard placement.

function maxHeightInWindow(c: Course, xStart: number, xEnd: number): number {
  let max = 0
  for (const p of c.ground) {
    if (p.x >= xStart && p.x < xEnd) max = Math.max(max, Math.abs(p.y))
  }
  return max
}

describe('generateEndlessCourse — difficulty ramps with distance', () => {
  it('late sections have taller terrain than early sections (avg over seeds)', () => {
    const SEEDS = 8
    const WINDOW = 800
    let earlySum = 0
    let lateSum = 0
    for (let seed = 0; seed < SEEDS; seed++) {
      const c = generateEndlessCourse({ seed })
      const span = c.finishX - c.startX
      earlySum += maxHeightInWindow(c, c.startX, c.startX + WINDOW)
      lateSum += maxHeightInWindow(c, c.startX + span - WINDOW, c.startX + span)
    }
    expect(lateSum / SEEDS).toBeGreaterThan(earlySum / SEEDS)
  })

  it('the opening is gentle: no ice or ramp in the first stretch', () => {
    // Across many seeds the very first zones stay within the gentle palette.
    for (let seed = 0; seed < 20; seed++) {
      const c = generateEndlessCourse({ seed })
      const opening = c.zones.filter((z) => z.xStart - c.startX < 200)
      for (const z of opening) {
        expect(z.kind).not.toBe('ice')
      }
    }
  })
})

// ─── Drivability past several checkpoints (real engine) ───────────────────────

const LOOKAHEAD = 8
const SETTLE_STEPS = 90
const MAX_DRIVE_STEPS = 40000
/** Steps of zero forward progress before the driver tries a different shape. */
const STALL_STEPS = 120
/** Minimum forward gain (units) that counts as "still making progress". */
const PROGRESS_EPS = 0.05
/** Distance (units) a recovery shape must carry the vehicle before the driver
 *  hands control back to the lookahead ideal-shape heuristic. Gives the recovery
 *  shape room to actually clear the obstacle instead of instantly reverting. */
const RECOVERY_CLEAR_DIST = 4

/** All shapes, tried in turn to break a stall — proves no dead-end exists. */
const ALL_SHAPES: readonly ShapeId[] = ['circle', 'triangle', 'square', 'line']

function idealShape(kind: TerrainKind): ShapeId {
  switch (kind) {
    case 'uphill':
      return 'triangle'
    case 'eggs':
      return 'line'
    case 'mud':
    case 'ice':
      return 'triangle'
    default:
      return 'circle'
  }
}

/**
 * Drive the course on the real engine, targeting a distance. Uses a lookahead
 * "ideal shape" heuristic, and — crucially — if forward progress stalls it cycles
 * through the OTHER shapes until it breaks free. Because the course is completable
 * everywhere (some shape always keeps you moving), a stall is only ever a wrong
 * shape choice, never a dead-end; the recovery cycle proves exactly that.
 */
async function driveDistance(course: Course, targetDistance: number): Promise<number> {
  const world = await createWorld(course)
  const vehicle = createVehicle(world, { x: course.startX + 2, y: 2 })
  for (let i = 0; i < SETTLE_STEPS; i++) world.step()

  vehicle.setThrottle(1)
  let maxX = vehicle.position().x
  let stallSince = 0
  let recoveryIndex = 0
  let recoveryStartX = maxX
  const targetX = course.startX + targetDistance

  for (let i = 0; i < MAX_DRIVE_STEPS; i++) {
    const x = vehicle.position().x

    if (i - stallSince >= STALL_STEPS) {
      // Stalled: cycle to the next shape to try to break free, and hold it.
      recoveryIndex = (recoveryIndex % ALL_SHAPES.length) + 1
      vehicle.swapShape(ALL_SHAPES[(recoveryIndex - 1) % ALL_SHAPES.length])
      stallSince = i
      recoveryStartX = maxX
    } else if (recoveryIndex === 0 || maxX - recoveryStartX > RECOVERY_CLEAR_DIST) {
      // Not recovering (or the recovery shape has already carried us clear): let
      // the lookahead ideal-shape heuristic drive again.
      recoveryIndex = 0
      const zone = zoneAt(course, x + LOOKAHEAD) ?? zoneAt(course, x)
      if (zone) {
        const want = idealShape(zone.kind)
        if (vehicle.currentShape() !== want) vehicle.swapShape(want)
      }
    }

    vehicle.applyDrive()
    vehicle.stabilize()
    world.step()

    const newX = vehicle.position().x
    if (newX > maxX + PROGRESS_EPS) stallSince = i
    maxX = Math.max(maxX, newX)
    if (maxX >= targetX) break
  }
  return maxX - course.startX
}

describe('generateEndlessCourse — drivable past several checkpoints (real engine)', () => {
  beforeAll(async () => {
    await RAPIER.init()
  })

  // 500 units = 10 checkpoints at the default spacing — proves the ramped opening
  // has no dead-ends and the vehicle keeps moving far into the harder terrain.
  const TARGET = CHECKPOINT_SPACING * 10

  for (const seed of [1, 2]) {
    it(`seed=${seed} drives at least ${TARGET} units (past several checkpoints)`, async () => {
      const course = generateEndlessCourse({ seed })
      const reached = await driveDistance(course, TARGET)
      expect(
        reached,
        `only reached ${reached.toFixed(1)} of ${TARGET} units`,
      ).toBeGreaterThanOrEqual(TARGET)
    }, 60000)
  }
})
