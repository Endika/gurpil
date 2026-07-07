/**
 * Shape differentiation tests — proof that the 4 wheel shapes really behave
 * differently in the STABLE HYBRID model, not just "the vehicle moved".
 *
 * In the stable-hybrid model the collider is ALWAYS a ball; the drawn shape
 * drives per-shape tuning (radius / friction / speed) instead of the collider
 * geometry. The differentiation therefore comes from those params, verified here
 * against the REAL Rapier2d engine — no mocks, fully deterministic (fixed
 * timestep, no random state).
 *
 * Scenarios:
 *   - FLAT   : EVERY shape moves forward from a dead stop (none stuck); the
 *              `circle` (fastest speedMul) covers clearly more x than the grippy,
 *              slower `square`.
 *   - EGGS   : the `line` (largest effective radius) covers the egg stretch far
 *              better than the `circle`. The circle no longer permanently stalls
 *              — it just makes less progress in the same window.
 *   - SLOPE  : on a steep, slick ramp the grip difference is real — an unpowered
 *              low-grip `circle` slides back down, where the grippiest `triangle`
 *              holds.
 */

import { describe, it, expect, beforeAll } from 'vitest'
import RAPIER from '@dimforge/rapier2d-compat'
import { buildCourse } from '../../src/core/course'
import { createWorld, PHYSICS_TIMESTEP } from '../../src/physics/world'
import { createVehicle, type Vehicle } from '../../src/physics/vehicle'
import { SHAPE_IDS, type ShapeId } from '../../src/core/shapes'

beforeAll(async () => {
  await RAPIER.init()
})

// ─── Shared constants ───────────────────────────────────────────────────────

/** Steps to let the vehicle settle before applying throttle / measuring. */
const SETTLE_STEPS = 60

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Run a vehicle on the real course from a start pose and return net motion. */
async function runOnCourse(
  shape: ShapeId,
  start: { x: number; y: number },
  throttle: number,
  driveSteps: number,
): Promise<{ dx: number; maxX: number; finalX: number }> {
  const course = buildCourse()
  const world = await createWorld(course)
  const vehicle = createVehicle(world, start)
  for (let i = 0; i < SETTLE_STEPS; i++) world.step()
  if (shape !== 'circle') vehicle.swapShape(shape)

  const startX = vehicle.position().x
  vehicle.setThrottle(throttle)
  let maxX = -Infinity
  for (let i = 0; i < driveSteps; i++) {
    vehicle.applyDrive()
    vehicle.stabilize()
    world.step()
    maxX = Math.max(maxX, vehicle.position().x)
  }
  const finalX = vehicle.position().x
  return { dx: finalX - startX, maxX, finalX }
}

/** Build a bare world containing a single straight ramp (fixed friction). */
function makeRampWorld(slopeDeg: number, groundFriction: number) {
  const world = new RAPIER.World({ x: 0, y: -9.81 })
  world.timestep = PHYSICS_TIMESTEP
  const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed())
  const rad = (slopeDeg * Math.PI) / 180
  const a = { x: -10, y: -10 * Math.tan(rad) }
  const b = { x: 60, y: 60 * Math.tan(rad) }
  world.createCollider(
    RAPIER.ColliderDesc.segment(a, b).setFriction(groundFriction),
    body,
  )
  return { world: { raw: world, step: () => world.step() }, rad }
}

/**
 * Place an UNPOWERED vehicle on a ramp and measure how far it slides back down
 * (negative dx) over `steps`. Same ground friction for every shape — only the
 * wheel shape (and its own friction) differs.
 */
async function rollbackOnRamp(
  shape: ShapeId,
  slopeDeg: number,
  groundFriction: number,
  steps: number,
): Promise<number> {
  const { world, rad } = makeRampWorld(slopeDeg, groundFriction)
  const sx = 20
  const sy = sx * Math.tan(rad) + 1.2
  const vehicle: Vehicle = createVehicle(world, { x: sx, y: sy })
  for (let i = 0; i < SETTLE_STEPS; i++) world.step()
  if (shape !== 'circle') vehicle.swapShape(shape)

  const startX = vehicle.position().x
  vehicle.setThrottle(0)
  for (let i = 0; i < steps; i++) {
    vehicle.applyDrive()
    vehicle.stabilize()
    world.step()
  }
  return vehicle.position().x - startX // negative = slid back down the slope
}

// ─── FLAT: nobody is stuck; circle beats square ──────────────────────────────

describe('FLAT differentiation', () => {
  /** Every shape must make real forward progress from a dead stop. */
  const MIN_FLAT_PROGRESS = 5

  it('every shape drives forward from a dead stop on the flat start zone (none stuck)', async () => {
    const start = { x: 5, y: 3 }
    for (const shape of SHAPE_IDS) {
      const { dx } = await runOnCourse(shape, start, 1, 300)
      expect(dx, `${shape} should not be stuck on the flat`).toBeGreaterThan(
        MIN_FLAT_PROGRESS,
      )
    }
  })

  it('circle covers more x than square over 300 steps on the flat start zone', async () => {
    const start = { x: 5, y: 3 }
    const circle = await runOnCourse('circle', start, 1, 300)
    const square = await runOnCourse('square', start, 1, 300)

    // The fastest (circle) clearly out-runs the grippy, slower square.
    // Deterministic measured margin ≈ 1.8 m over 300 steps; assert a real,
    // comfortable fraction of it (not tautological, not ≈0).
    expect(circle.dx).toBeGreaterThan(square.dx + 1)
    // Both genuinely moved (neither is stuck).
    expect(circle.dx).toBeGreaterThan(MIN_FLAT_PROGRESS)
    expect(square.dx).toBeGreaterThan(MIN_FLAT_PROGRESS)
  })
})

// ─── SLOPE: triangle grips where circle slides back ──────────────────────────

describe('SLOPE differentiation', () => {
  it('unpowered circle slides back down a steep slick ramp while triangle holds', async () => {
    // Steep + slick enough that the low-grip circle can no longer hold static
    // friction, but the grippiest triangle still does.
    const SLOPE_DEG = 26
    const GROUND_FRICTION = 0.3
    const STEPS = 400

    const circleBack = await rollbackOnRamp('circle', SLOPE_DEG, GROUND_FRICTION, STEPS)
    const triangleBack = await rollbackOnRamp('triangle', SLOPE_DEG, GROUND_FRICTION, STEPS)

    // Circle slides clearly back down the slope.
    expect(circleBack).toBeLessThan(-3.0)
    // Triangle grips: it holds far better than the circle (real margin).
    expect(Math.abs(triangleBack)).toBeLessThan(Math.abs(circleBack) - 3.0)
  })
})

// ─── EGGS: line covers the egg stretch better than circle ────────────────────

describe('EGGS differentiation', () => {
  it('line covers the eggs stretch far better than circle in the same window', async () => {
    // Start just before the first egg (eggs at x = 185,190,195,200,205).
    const start = { x: 182, y: 8 }
    const circle = await runOnCourse('circle', start, 1, 600)
    const line = await runOnCourse('line', start, 1, 600)

    // Both make forward progress (the circle is NOT permanently stuck any more).
    expect(circle.maxX).toBeGreaterThan(start.x + 2)
    // The line's large effective radius carries it much further through / past
    // the eggs than the circle in the same number of steps (real margin).
    expect(line.maxX).toBeGreaterThan(circle.maxX + 10)
  })
})
