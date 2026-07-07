/**
 * Anti-pop tests for live wheel shape-swap (STABLE HYBRID model).
 *
 * Uses the REAL Rapier2d engine — no mocks. The core risk of the game is that
 * swapping the wheel collider mid-run changes geometry/inertia and produces a
 * position/velocity "pop". In the stable-hybrid model the collider is always a
 * ball; swapping only changes its RADIUS (+ friction/mass), and `swapShape`
 * lifts the vehicle by the radius delta so the ball's contact point is preserved,
 * keeping the swap contact-neutral.
 *
 * To measure the SWAP-INDUCED pop (and not the vehicle's normal per-step forward
 * motion, which is non-trivial at full speed), each test runs TWO identical
 * vehicles to the same steady state: a CONTROL that steps once WITHOUT swapping,
 * and a SUBJECT that swaps then steps once. Rapier is deterministic, so the
 * difference between the two after that one step is purely the swap's effect.
 */

import { describe, it, expect, beforeAll } from 'vitest'
import RAPIER from '@dimforge/rapier2d-compat'
import { buildCourse } from '../../src/core/course'
import { createWorld, type PhysicsWorld } from '../../src/physics/world'
import { createVehicle, type Vehicle } from '../../src/physics/vehicle'
import type { ShapeId } from '../../src/core/shapes'

beforeAll(async () => {
  await RAPIER.init()
})

// Flat start zone (x in [0,20], y=0), spawned above ground to settle.
const START_X = 10
const START_Y = 3
const SETTLE_STEPS = 60
const DRIVE_STEPS = 90

/**
 * Max allowed SWAP-INDUCED single-step position deviation from the control
 * (metres). This is the pop ONLY — normal forward motion is subtracted out by
 * the control. A contact-neutral swap barely deviates; a geometry pop would be
 * large.
 */
const MAX_POS_POP = 0.1

/**
 * Max allowed SWAP-INDUCED single-step velocity deviation from the control
 * (m/s). A mass/inertia/penetration pop would spike this well past 1.
 */
const MAX_VEL_POP = 1.0

/** Drive a fresh vehicle to a steady state on the flat start zone. */
async function drivenVehicle(): Promise<{ world: PhysicsWorld; vehicle: Vehicle }> {
  const course = buildCourse()
  const world = await createWorld(course)
  const vehicle = createVehicle(world, { x: START_X, y: START_Y })
  for (let i = 0; i < SETTLE_STEPS; i++) world.step()
  vehicle.setThrottle(1)
  for (let i = 0; i < DRIVE_STEPS; i++) {
    vehicle.applyDrive()
    world.step()
  }
  return { world, vehicle }
}

/**
 * Assert a swap to `to` produces no pop beyond a normal step. Compares a control
 * (no-swap) step against a subject (swap then step) from identical steady states.
 */
async function assertNoPop(to: ShapeId): Promise<{ dPos: number; dVel: number }> {
  // Control: identical vehicle, one plain step (no swap).
  const control = await drivenVehicle()
  control.vehicle.applyDrive()
  control.world.step()
  const controlPos = control.vehicle.position()
  const controlVel = control.vehicle.chassis.linvel()

  // Subject: identical vehicle, swap then one step.
  const subject = await drivenVehicle()
  subject.vehicle.swapShape(to)
  subject.vehicle.applyDrive()
  subject.world.step()
  const subjectPos = subject.vehicle.position()
  const subjectVel = subject.vehicle.chassis.linvel()

  const dPos = Math.hypot(subjectPos.x - controlPos.x, subjectPos.y - controlPos.y)
  const dVel = Math.hypot(subjectVel.x - controlVel.x, subjectVel.y - controlVel.y)

  expect(dPos).toBeLessThan(MAX_POS_POP)
  expect(dVel).toBeLessThan(MAX_VEL_POP)
  return { dPos, dVel }
}

describe('swapShape anti-pop', () => {
  it('circle → square causes no position or velocity pop beyond a normal step', async () => {
    await assertNoPop('square')
  })

  it('circle → triangle causes no position or velocity pop beyond a normal step', async () => {
    await assertNoPop('triangle')
  })

  it('circle → line (largest radius) causes no position or velocity pop beyond a normal step', async () => {
    await assertNoPop('line')
  })

  it('currentShape() reflects the last swap', async () => {
    const { vehicle } = await drivenVehicle()
    expect(vehicle.currentShape()).toBe('circle')
    vehicle.swapShape('triangle')
    expect(vehicle.currentShape()).toBe('triangle')
    vehicle.swapShape('line')
    expect(vehicle.currentShape()).toBe('line')
  })
})
