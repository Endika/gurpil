/**
 * Traversal / anti-stuck tests (STABLE HYBRID model).
 *
 * Real player feedback: the car flipped / wedged and could not continue, or came
 * to a dead stop and refused to move. A car that gets permanently stuck = broken
 * game. In the stable-hybrid model the wheel collider is ALWAYS a ball, so it can
 * never flip over a corner and never wedges; every shape rolls on its motor.
 *
 * These tests use the REAL Rapier2d engine — no mocks — and prove:
 *   1. The uphill ramp is a GRIP GATE (mirroring the "eggs → line" gate): the
 *      GRIPPY shapes (square, triangle) summit the slippery ramp and drive the
 *      whole course to the finish, while the LOW-GRIP shapes (circle, line) slip,
 *      plateau before the ramp top and slide back to the flat base — a clear
 *      "wrong shape here" signal. This is an INTENDED design gate, not a stuck
 *      car: the slip is fully recoverable (see the swap-recovery test) and never
 *      wedges/flips (the collider stays a ball).
 *   2. The rocky section is cleared with net forward progress (never wedges).
 *   3. The self-right assist recovers the chassis from a near-upside-down tilt.
 *   4. NO DEAD-END: a car that slips on the ramp with the circle recovers the run
 *      by swapping to a triangle, which then summits and reaches the finish.
 *
 * The self-right assist lives in `vehicle.stabilize()`, called once per physics
 * step (same cadence as `applyDrive()`); the tests mirror that cadence.
 */

import { describe, it, expect, beforeAll } from 'vitest'
import RAPIER from '@dimforge/rapier2d-compat'
import { buildCourse } from '../../src/core/course'
import { createWorld } from '../../src/physics/world'
import { createVehicle, type Vehicle } from '../../src/physics/vehicle'
import type { ShapeId } from '../../src/core/shapes'

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

/** x at which the rocky zone ends / the uphill ramp BEGINS (mirrors course.ts X_ROCKY_END). */
const X_ROCKY_END = 50

/** x of the uphill ramp TOP / summit (mirrors course.ts X_UPHILL_END). */
const X_UPHILL_TOP = 90

/** x of the finish line (mirrors course.ts X_FINISH). */
const X_FINISH = 230

/** Shapes grippy enough to summit the slippery ramp (square, triangle). */
const GRIPPY_SHAPES: ShapeId[] = ['square', 'triangle']

/** Low-grip shapes that slip on the ramp and cannot summit (circle, line). */
const LOW_GRIP_SHAPES: ShapeId[] = ['circle', 'line']

/**
 * After slipping, a low-grip shape slides back to the flat base. Its final x must
 * settle within this margin of the ramp base — proving it left the ramp for
 * flatter ground (not wedged mid-ramp). Measured final x ≈ 50 (base = 50).
 */
const SLIDE_BACK_MARGIN = 6

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
  maxSteps: number = MAX_STEPS,
): Promise<{ maxX: number; finalX: number; finalY: number; finishStep: number }> {
  const course = buildCourse()
  const world = await createWorld(course)
  const vehicle = createVehicle(world, { x: startX, y: startY })
  for (let i = 0; i < REST_SETTLE_STEPS; i++) world.step()
  if (shape !== 'circle') vehicle.swapShape(shape)

  vehicle.setThrottle(1)
  let maxX = -Infinity
  let finishStep = -1
  for (let i = 0; i < maxSteps; i++) {
    driveStep(vehicle, world)
    maxX = Math.max(maxX, vehicle.position().x)
    if (maxX >= X_FINISH) {
      finishStep = i + 1
      break
    }
  }
  const p = vehicle.position()
  return { maxX, finalX: p.x, finalY: p.y, finishStep }
}

// ─── The uphill is a GRIP GATE (mirrors the "eggs → line" gate) ───────────────
//
// DESIGN NOTE — this is deliberately NOT "every shape reaches the finish". The
// player reported the old slope penalty was imperceptible; the ramp is now a hard
// pass/fail on grip, exactly like the eggs are on the line. The circle (and the
// line) MUST fail to summit here; that is the intended gate, not a weakened test.

describe('uphill grip gate (from a dead stop)', () => {
  // Steps for a GRIPPY shape to drive the whole course to the finish. Generous.
  const GRIPPY_MAX_STEPS = MAX_STEPS
  // Steps to let a LOW-GRIP shape reach the ramp, plateau and slide back. It
  // never finishes, so a shorter cap is enough to observe the settled slip.
  const LOW_GRIP_STEPS = 3000

  for (const shape of GRIPPY_SHAPES) {
    it(`grippy ${shape} grips the slippery ramp and reaches the finish`, async () => {
      const { maxX, finishStep } = await driveFromRest(shape, 5, 2, GRIPPY_MAX_STEPS)
      console.log(`[traversal] grippy ${shape} finished at step ${finishStep} (maxX=${maxX.toFixed(1)})`)
      expect(finishStep, `${shape} never reached the finish`).toBeGreaterThan(0)
      expect(maxX).toBeGreaterThanOrEqual(X_FINISH)
    }, 30000)
  }

  for (const shape of LOW_GRIP_SHAPES) {
    it(`low-grip ${shape} reaches the ramp base but slips, cannot summit, and slides back`, async () => {
      const { maxX, finalX, finishStep } = await driveFromRest(shape, 5, 2, LOW_GRIP_STEPS)
      console.log(
        `[traversal] low-grip ${shape}: maxX=${maxX.toFixed(1)} finalX=${finalX.toFixed(1)} finish=${finishStep}`,
      )
      // It DID drive the flat + rocky and reach the base of the ramp (not stuck early).
      expect(maxX, `${shape} should reach the ramp base`).toBeGreaterThanOrEqual(X_ROCKY_END)
      // But it slips on the slippery slope and never summits (plateaus below the top).
      expect(maxX, `${shape} must NOT summit the ramp`).toBeLessThan(X_UPHILL_TOP)
      expect(finishStep, `${shape} must not reach the finish`).toBe(-1)
      // And it slides back off the ramp to the flat base (recoverable, not wedged).
      expect(finalX, `${shape} should slide back to the flat base`).toBeLessThan(
        X_ROCKY_END + SLIDE_BACK_MARGIN,
      )
    }, 30000)
  }

  it('gate summary: the triangle summits well past where the circle plateaus', async () => {
    const circle = await driveFromRest('circle', 5, 2, 3000)
    const triangle = await driveFromRest('triangle', 5, 2)
    // The triangle clears the summit; the circle never gets close to it.
    expect(triangle.maxX).toBeGreaterThan(X_UPHILL_TOP)
    expect(circle.maxX).toBeLessThan(X_UPHILL_TOP)
    // The gap is unmistakable (measured triangle maxX ≈ 230 vs circle ≈ 53).
    expect(triangle.maxX).toBeGreaterThan(circle.maxX + 100)
  }, 30000)
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
//
// The circle can't summit the slippery ramp — but it must never be *frozen* (the
// "se queda bloqueado" bug) nor *wedged* on the slope. It drives off any dead
// stop (anti-sleep) and, on the ramp, it slides back to flat ground rather than
// jamming — a recoverable slip, not a stuck car.

describe('circle drives off from a dead stop anywhere (anti-sleep, never wedged)', () => {
  it('drives off a dead stop settled on a rocky bump and reaches the ramp base', async () => {
    // Anti-sleep intent: a fully-rested circle on a rocky bump (x=35) must still
    // drive off and make real forward progress up to the ramp base (x≈50+).
    const { maxX } = await driveFromRest('circle', 35, 3, 3000)
    expect(maxX, 'circle should not be frozen on the bump').toBeGreaterThan(X_ROCKY_END)
  }, 30000)

  it('a circle settled mid-ramp slips back to the flat base (recoverable, not wedged)', async () => {
    // x=70 sits mid-way up the ramp; y=14 spawns just above the ramp surface
    // there so the car settles onto it. On the slippery slope the circle cannot
    // hold — but instead of wedging it slides back DOWN to flat ground. Proves
    // the slip is a clean recoverable state, never a stuck/reload situation.
    const { finalX, finalY } = await driveFromRest('circle', 70, 14, 3000)
    expect(finalX, 'circle should slide back to the flat base').toBeLessThan(
      X_ROCKY_END + SLIDE_BACK_MARGIN,
    )
    expect(finalY, 'circle should end on flat ground, not wedged on the ramp').toBeLessThan(3)
  }, 30000)

  it('a grippy triangle settled mid-ramp climbs out and reaches the finish', async () => {
    // Same mid-ramp dead stop, but on the triangle: it grips, climbs out of the
    // slope and finishes — the grip gate is escapable with the right shape.
    const { maxX, finishStep } = await driveFromRest('triangle', 70, 14)
    expect(finishStep, 'triangle should climb out and finish').toBeGreaterThan(0)
    expect(maxX).toBeGreaterThanOrEqual(X_FINISH)
  }, 30000)
})

// ─── NO DEAD-END: slip on the circle, swap to triangle, recover to the finish ──

describe('no dead-end: swapping to a grippy shape recovers a ramp slip', () => {
  it('reaches the ramp on the circle, swaps to a triangle, then summits to the finish', async () => {
    const course = buildCourse()
    const world = await createWorld(course)
    const vehicle = createVehicle(world, { x: 5, y: 2 })
    for (let i = 0; i < REST_SETTLE_STEPS; i++) world.step()

    vehicle.setThrottle(1)
    let reachedRamp = false
    let swapped = false
    let stepsSinceReach = 0
    let maxX = -Infinity
    let finishStep = -1
    for (let i = 0; i < MAX_STEPS; i++) {
      driveStep(vehicle, world)
      const x = vehicle.position().x
      maxX = Math.max(maxX, x)
      // Touched the ramp while still on the circle.
      if (!reachedRamp && x > X_ROCKY_END + 2) reachedRamp = true
      // Let it slip a moment on the circle, then swap to a triangle mid-run.
      if (reachedRamp && !swapped) {
        stepsSinceReach++
        if (stepsSinceReach > 200) {
          vehicle.swapShape('triangle')
          swapped = true
        }
      }
      if (maxX >= X_FINISH) {
        finishStep = i + 1
        break
      }
    }

    expect(reachedRamp, 'the circle should at least reach the ramp').toBe(true)
    expect(swapped, 'the run should swap to a triangle at the ramp').toBe(true)
    expect(finishStep, 'after swapping to a triangle the run should reach the finish').toBeGreaterThan(
      0,
    )
    expect(maxX).toBeGreaterThanOrEqual(X_FINISH)
  }, 30000)
})
