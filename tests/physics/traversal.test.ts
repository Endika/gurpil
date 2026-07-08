/**
 * Traversal / anti-stuck tests (STABLE HYBRID model).
 *
 * Real player feedback: the car flipped / wedged and could not continue, or came
 * to a dead stop and refused to move. A car that gets permanently stuck = broken
 * game. In the stable-hybrid model the wheel collider is ALWAYS a ball, so it can
 * never flip over a corner and never wedges; every shape rolls on its motor.
 *
 * These tests use the REAL Rapier2d engine — no mocks — and prove:
 *   1. EACH of the 4 shapes, from a settled dead stop, drives the whole course
 *      to the finish within a generous step cap — none gets stuck anywhere.
 *   2. The rocky section is cleared with net forward progress (never wedges).
 *   3. The self-right assist recovers the chassis from a near-upside-down tilt.
 *
 * The self-right assist lives in `vehicle.stabilize()`, called once per physics
 * step (same cadence as `applyDrive()`); the tests mirror that cadence.
 */

import { describe, it, expect, beforeAll } from 'vitest'
import RAPIER from '@dimforge/rapier2d-compat'
import { buildCourse } from '../../src/core/course'
import { createWorld } from '../../src/physics/world'
import { createVehicle, type Vehicle } from '../../src/physics/vehicle'
import { SHAPE_IDS, type ShapeId } from '../../src/core/shapes'

beforeAll(async () => {
  await RAPIER.init()
})

// ─── Shared constants ───────────────────────────────────────────────────────

/** Steps to let the vehicle settle on the terrain before driving. */
const SETTLE_STEPS = 60

/**
 * Steps to let the vehicle settle to a DEAD STOP before driving.
 *
 * Rapier auto-sleeps a resting body after ~2 s (~120 steps at 1/60 s). This is
 * comfortably past that threshold, so these tests reproduce the real
 * "se queda bloqueado" playtest bug: a car that has fully come to rest must still
 * be able to drive off from a standstill (guaranteed by `setCanSleep(false)`).
 */
const REST_SETTLE_STEPS = 300

/** Generous per-step cap for a full-course drive. */
const MAX_STEPS = 8000

/** x at which the rocky zone ends (mirrors course.ts X_ROCKY_END). */
const X_ROCKY_END = 50

/** x of the finish line (mirrors course.ts X_FINISH). */
const X_FINISH = 230

/** Run the per-step drive cadence used by the real game loop. */
function driveStep(vehicle: Vehicle, world: { step(): void }): void {
  vehicle.applyDrive()
  vehicle.stabilize()
  world.step()
}

/**
 * Spawn a vehicle at `(startX, startY)`, equip `shape`, let it settle to a DEAD
 * STOP (past Rapier's sleep threshold), then apply full throttle from that
 * standstill and drive until the finish or `MAX_STEPS`. Returns the furthest x
 * reached and the step at which it finished (-1 if it never did).
 */
async function driveFromRest(
  shape: ShapeId,
  startX: number,
  startY: number,
): Promise<{ maxX: number; finishStep: number }> {
  const course = buildCourse()
  const world = await createWorld(course)
  const vehicle = createVehicle(world, { x: startX, y: startY })
  for (let i = 0; i < REST_SETTLE_STEPS; i++) world.step()
  if (shape !== 'circle') vehicle.swapShape(shape)

  vehicle.setThrottle(1)
  let maxX = -Infinity
  let finishStep = -1
  for (let i = 0; i < MAX_STEPS; i++) {
    driveStep(vehicle, world)
    maxX = Math.max(maxX, vehicle.position().x)
    if (maxX >= X_FINISH) {
      finishStep = i + 1
      break
    }
  }
  return { maxX, finishStep }
}

// ─── Every shape reaches the finish from a dead stop ─────────────────────────

describe('every shape reaches the finish from a dead stop (none stuck)', () => {
  for (const shape of SHAPE_IDS) {
    it(`${shape} drives the whole course from rest and reaches the finish`, async () => {
      const { maxX, finishStep } = await driveFromRest(shape, 5, 2)
      // Report the per-shape finish step count.
      console.log(`[traversal] ${shape} reached finish at step ${finishStep} (maxX=${maxX.toFixed(1)})`)
      expect(finishStep, `${shape} never reached the finish`).toBeGreaterThan(0)
      expect(maxX).toBeGreaterThanOrEqual(X_FINISH)
    }, 30000)
  }
})

// ─── Rocky traversal: the car must not wedge in the rocks ────────────────────

describe('rocky traversal (anti-stuck)', () => {
  it('circle wheels drive PAST the rocky section without getting stuck', async () => {
    const course = buildCourse()
    const world = await createWorld(course)
    const vehicle = createVehicle(world, { x: course.startX + 5, y: 2 })
    for (let i = 0; i < SETTLE_STEPS; i++) world.step()

    vehicle.setThrottle(1)

    let earlyX = Number.NaN
    let lateX = Number.NaN
    let clearedRocky = false
    for (let i = 0; i < MAX_STEPS; i++) {
      driveStep(vehicle, world)
      const x = vehicle.position().x
      if (Number.isNaN(earlyX) && x > 25) earlyX = x
      if (Number.isNaN(lateX) && x > 40) lateX = x
      if (x > X_ROCKY_END) {
        clearedRocky = true
        break
      }
    }

    expect(clearedRocky).toBe(true)
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

    const NEAR_FLIP = 2.9 // rad (~166°)
    vehicle.chassis.setRotation(NEAR_FLIP, true)
    vehicle.chassis.setLinvel({ x: 0, y: 0 }, true)
    vehicle.chassis.setAngvel(0, true)

    vehicle.setThrottle(0)
    for (let i = 0; i < 400; i++) {
      driveStep(vehicle, world)
    }

    const angle = vehicle.chassis.rotation()
    const wrapped = Math.atan2(Math.sin(angle), Math.cos(angle))
    expect(Math.abs(wrapped)).toBeLessThan(0.6)
  })
})

// ─── From a DEAD STOP anywhere: the car must never be permanently stuck ───────

describe('circle drives off from a dead stop anywhere (anti-sleep)', () => {
  it('drives off from a dead stop settled on a rocky bump and reaches the finish', async () => {
    const { maxX } = await driveFromRest('circle', 35, 3)
    expect(maxX).toBeGreaterThanOrEqual(X_FINISH)
  }, 30000)

  it('drives off from a dead stop settled on the uphill ramp and reaches the finish', async () => {
    // x=70 sits mid-way up the steepened ramp; y=14 spawns just above the ramp
    // surface there (ramp y≈10 at x=70) so the car settles onto it. Even from a
    // dead stop on the slope the low-grip circle is penalised (crawls) but is
    // NEVER stuck — it still climbs out and reaches the finish.
    const { maxX } = await driveFromRest('circle', 70, 14)
    expect(maxX).toBeGreaterThanOrEqual(X_FINISH)
  }, 30000)
})
