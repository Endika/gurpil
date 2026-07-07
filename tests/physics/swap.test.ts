/**
 * Anti-pop tests for live wheel shape-swap (Task 8).
 *
 * Uses the REAL Rapier2d engine — no mocks. The core risk of the game is that
 * swapping a wheel collider mid-run changes mass/inertia and produces a
 * position/velocity "pop". These tests drive the vehicle to a steady state,
 * swap the shape, step ONCE, and assert the chassis neither teleports nor
 * suddenly changes velocity in that same step.
 */

import { describe, it, expect, beforeAll } from 'vitest'
import RAPIER from '@dimforge/rapier2d-compat'
import { buildCourse } from '../../src/core/course'
import { createWorld } from '../../src/physics/world'
import { createVehicle } from '../../src/physics/vehicle'
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
 * Max allowed single-step change in chassis position on swap (metres).
 * One normal 1/60 s step at a few m/s moves << this; a teleport would be huge.
 */
const MAX_POS_POP = 0.1

/**
 * Max allowed single-step change in chassis velocity on swap (m/s).
 * Normal per-step acceleration is small; a mass/inertia pop would spike this.
 */
const MAX_VEL_POP = 1.0

async function drivenVehicle() {
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

/** Assert that a single swap+step produces no position or velocity pop. */
function assertNoPop(
  world: { step(): void },
  vehicle: ReturnType<typeof createVehicle>,
  to: ShapeId,
) {
  const posBefore = vehicle.position()
  const velBefore = { ...vehicle.chassis.linvel() }

  vehicle.swapShape(to)
  vehicle.applyDrive()
  world.step()

  const posAfter = vehicle.position()
  const velAfter = vehicle.chassis.linvel()

  const dPos = Math.hypot(posAfter.x - posBefore.x, posAfter.y - posBefore.y)
  const dVel = Math.hypot(velAfter.x - velBefore.x, velAfter.y - velBefore.y)

  expect(dPos).toBeLessThan(MAX_POS_POP)
  expect(dVel).toBeLessThan(MAX_VEL_POP)
  return { dPos, dVel }
}

describe('swapShape anti-pop', () => {
  it('circle → square causes no position or velocity pop in one step', async () => {
    const { world, vehicle } = await drivenVehicle()
    assertNoPop(world, vehicle, 'square')
  })

  it('circle → triangle causes no position or velocity pop in one step', async () => {
    const { world, vehicle } = await drivenVehicle()
    assertNoPop(world, vehicle, 'triangle')
  })

  it('circle → line (slide mode) causes no position or velocity pop in one step', async () => {
    const { world, vehicle } = await drivenVehicle()
    assertNoPop(world, vehicle, 'line')
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
