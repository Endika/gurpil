/**
 * Traversal / anti-stuck tests (playtest bug fix).
 *
 * Real player feedback: "the physics on the rocky section are too chaotic — the
 * car flips over / wedges between the spikes and CANNOT continue." A car that
 * gets permanently stuck = broken game.
 *
 * These tests use the REAL Rapier2d engine — no mocks — and prove:
 *   1. The car (plain circle wheels, full throttle) drives PAST the rocky zone
 *      and keeps making net forward progress there (it never wedges).
 *   2. The self-right assist recovers the chassis from a near-upside-down tilt
 *      back to upright, so the car can never be permanently flipped.
 *   3. Plain circle wheels can reach near the finish across the whole course
 *      within a generous step cap (documenting any zone that legitimately needs
 *      a shape change).
 *
 * The self-right assist lives in `vehicle.stabilize()`, which the game loop
 * calls once per physics step (same cadence as `applyDrive()`); the tests mirror
 * that cadence.
 */

import { describe, it, expect, beforeAll } from 'vitest'
import RAPIER from '@dimforge/rapier2d-compat'
import { buildCourse } from '../../src/core/course'
import { createWorld } from '../../src/physics/world'
import { createVehicle, type Vehicle } from '../../src/physics/vehicle'

beforeAll(async () => {
  await RAPIER.init()
})

// ─── Shared constants ───────────────────────────────────────────────────────

/** Steps to let the vehicle settle on the terrain before driving. */
const SETTLE_STEPS = 60

/** Generous per-step cap for a full-course drive. */
const MAX_STEPS = 6000

/** x at which the rocky zone ends (mirrors course.ts X_ROCKY_END). */
const X_ROCKY_END = 50

/** x of the finish line (mirrors course.ts X_FINISH). */
const X_FINISH = 230

/**
 * x just in front of the first egg (eggs at 185..205). The eggs are the ONE
 * zone a plain circle legitimately can't clear — the line/ski is designed to
 * beat them (see differentiation EGGS test). So full-course reachability asserts
 * the circle reaches the eggs approach (proving no earlier zone is a dead end),
 * not that it clears the eggs.
 */
const X_EGGS_APPROACH = 182

/** Run the per-step drive cadence used by the real game loop. */
function driveStep(vehicle: Vehicle, world: { step(): void }): void {
  vehicle.applyDrive()
  vehicle.stabilize()
  world.step()
}

// ─── Rocky traversal: the car must not wedge in the rocks ────────────────────

describe('rocky traversal (anti-stuck)', () => {
  it('circle wheels drive PAST the rocky section without getting stuck', async () => {
    const course = buildCourse()
    const world = await createWorld(course)
    // Spawn on the flat start zone, above ground so it settles.
    const vehicle = createVehicle(world, { x: course.startX + 5, y: 2 })
    for (let i = 0; i < SETTLE_STEPS; i++) world.step()

    vehicle.setThrottle(1)

    // Sample x roughly mid-rocky (early) vs late to prove net forward progress.
    let earlyX = Number.NaN
    let lateX = Number.NaN
    let clearedRocky = false
    for (let i = 0; i < MAX_STEPS; i++) {
      driveStep(vehicle, world)
      const x = vehicle.position().x
      if (Number.isNaN(earlyX) && x > 25) earlyX = x // entered the rocky zone
      if (Number.isNaN(lateX) && x > 40) lateX = x // near the far end of rocky
      if (x > X_ROCKY_END) {
        clearedRocky = true
        break
      }
    }

    // It must actually clear the rocky section — not wedge inside it.
    expect(clearedRocky).toBe(true)
    // And it must have made net forward progress THROUGH the rocky zone.
    expect(lateX).toBeGreaterThan(earlyX)
  })
})

// ─── Self-right recovery: the car can never stay flipped ─────────────────────

describe('self-right recovery', () => {
  it('recovers from a near-upside-down tilt back to upright', async () => {
    const course = buildCourse()
    const world = await createWorld(course)
    const vehicle = createVehicle(world, { x: course.startX + 5, y: 2 })
    for (let i = 0; i < SETTLE_STEPS; i++) world.step()

    // Forcibly flip the chassis near fully upside-down and kill its velocity.
    // At this tilt the wheels/joints CANNOT lever the chassis back on their own
    // (verified: without stabilize() it stays pinned at ~2.9 rad indefinitely),
    // so a return to upright genuinely proves the self-right assist works — it
    // is not something normal physics would do anyway.
    const NEAR_FLIP = 2.9 // rad (~166°)
    vehicle.chassis.setRotation(NEAR_FLIP, true)
    vehicle.chassis.setLinvel({ x: 0, y: 0 }, true)
    vehicle.chassis.setAngvel(0, true)

    vehicle.setThrottle(0)
    for (let i = 0; i < 400; i++) {
      driveStep(vehicle, world)
    }

    // Angle wraps to [-π, π]; upright means |angle| small.
    const angle = vehicle.chassis.rotation()
    const wrapped = Math.atan2(Math.sin(angle), Math.cos(angle))
    // Comfortably upright — well short of the ~50° assist threshold.
    expect(Math.abs(wrapped)).toBeLessThan(0.6)
  })
})

// ─── Full-course reachability on plain circle wheels ─────────────────────────

describe('full-course reachability (circle)', () => {
  it('circle wheels reach at least the eggs zone from the start', async () => {
    const course = buildCourse()
    const world = await createWorld(course)
    const vehicle = createVehicle(world, { x: course.startX + 5, y: 2 })
    for (let i = 0; i < SETTLE_STEPS; i++) world.step()

    vehicle.setThrottle(1)
    let maxX = -Infinity
    for (let i = 0; i < MAX_STEPS; i++) {
      driveStep(vehicle, world)
      maxX = Math.max(maxX, vehicle.position().x)
      if (maxX >= X_FINISH) break
    }

    // The circle clears every zone up to the eggs (flat, rocky, uphill, mud,
    // ice) and reaches the eggs approach. It stalls AT the eggs by design — the
    // line/ski is the shape meant to clear them (see differentiation EGGS test),
    // so this is intended difficulty, NOT a stuck/dead-end bug. Reaching the eggs
    // approach proves no zone before them is a dead end.
    expect(maxX).toBeGreaterThanOrEqual(X_EGGS_APPROACH)
  })
})
