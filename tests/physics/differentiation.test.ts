/**
 * Shape differentiation tests (Task 8) — proof that the 4 wheel shapes really
 * behave differently, not just "the vehicle moved".
 *
 * Uses the REAL Rapier2d engine — no mocks. Fully deterministic (fixed
 * timestep, no random state). Each test asserts a real inequality BETWEEN
 * shapes on a focused scenario.
 *
 * Scenarios (see task-8-report.md for measured numbers and rationale):
 *   - FLAT   (real course start zone): a rolling `circle` covers much more x
 *            than a tumbling `square`.
 *   - SLOPE  (purpose-built ramp): an unpowered `triangle` grips and holds the
 *            slope, where an unpowered `circle` rolls back down. (A motorized
 *            polygon tumbles inefficiently, so the honest, robust polygon
 *            advantage is anti-roll-back holding, not powered climbing.)
 *   - EGGS   (real course egg stretch): the `line` (ski) glides past the eggs
 *            where the `circle` stalls against the first egg.
 */

import { describe, it, expect, beforeAll } from 'vitest'
import RAPIER from '@dimforge/rapier2d-compat'
import { buildCourse } from '../../src/core/course'
import { createWorld, PHYSICS_TIMESTEP } from '../../src/physics/world'
import { createVehicle, type Vehicle } from '../../src/physics/vehicle'
import type { ShapeId } from '../../src/core/shapes'

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
 * Place an UNPOWERED vehicle on a ramp and measure how far it rolls back down
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
    world.step()
  }
  return vehicle.position().x - startX // negative = rolled back down the slope
}

// ─── FLAT: circle rolls further than square ─────────────────────────────────

describe('FLAT differentiation', () => {
  it('circle covers more x than square over 300 steps on the flat start zone', async () => {
    const start = { x: 5, y: 3 }
    const circle = await runOnCourse('circle', start, 1, 300)
    const square = await runOnCourse('square', start, 1, 300)

    // A rolling circle travels far; a tumbling square barely advances.
    expect(circle.dx).toBeGreaterThan(square.dx + 5)
    // Sanity: the circle genuinely moved a meaningful distance.
    expect(circle.dx).toBeGreaterThan(5)
  })
})

// ─── SLOPE: triangle holds where circle slips back ───────────────────────────

describe('SLOPE differentiation', () => {
  it('unpowered triangle holds the slope while circle rolls back down', async () => {
    const SLOPE_DEG = 16
    const GROUND_FRICTION = 1.0
    const STEPS = 400

    const circleBack = await rollbackOnRamp('circle', SLOPE_DEG, GROUND_FRICTION, STEPS)
    const triangleBack = await rollbackOnRamp('triangle', SLOPE_DEG, GROUND_FRICTION, STEPS)

    // Circle rolls back down the slope (clearly negative).
    expect(circleBack).toBeLessThan(-1.0)
    // Triangle grips: it barely moves compared to the circle.
    expect(Math.abs(triangleBack)).toBeLessThan(Math.abs(circleBack) - 1.0)
  })
})

// ─── EGGS: line glides past where circle stalls ──────────────────────────────

describe('EGGS differentiation', () => {
  it('line advances past the eggs where circle plateaus at the first egg', async () => {
    // Start just before the first egg (eggs at x = 185,190,195,200,205).
    const start = { x: 182, y: 15 }
    const circle = await runOnCourse('circle', start, 1, 600)
    const line = await runOnCourse('line', start, 1, 600)

    // Circle stalls against the first egg (well short of x=190).
    expect(circle.maxX).toBeLessThan(186)
    // Line glides on past several eggs — far beyond where the circle stopped.
    expect(line.maxX).toBeGreaterThan(circle.maxX + 10)
    expect(line.maxX).toBeGreaterThan(195)
  })
})
