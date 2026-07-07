/**
 * Tests for the motorized vehicle (Task 7).
 *
 * Uses the REAL Rapier2d engine — no mocks.  Fixed timestep ensures full
 * determinism across runs.  The vehicle is placed on the flat start zone
 * (x in [0, 20], ground y = 0) slightly above the ground so it settles
 * before throttle is applied.
 */

import { describe, it, expect, beforeAll } from 'vitest'
import RAPIER from '@dimforge/rapier2d-compat'
import { buildCourse } from '../../src/core/course'
import { createWorld } from '../../src/physics/world'
import { createVehicle } from '../../src/physics/vehicle'

// One-time RAPIER init — idempotent, shared across all tests.
beforeAll(async () => {
  await RAPIER.init()
})

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Placement: centre of flat start zone, well above ground so it settles. */
const START_X = 10
const START_Y = 3   // above flat ground at y=0; chassis settles to ~0.65

/** Steps to let the vehicle settle before applying throttle. */
const SETTLE_STEPS = 60

/** Steps to run with throttle applied. */
const DRIVE_STEPS = 300

/** Minimum forward displacement expected under positive throttle (metres). */
const MIN_FORWARD_DISPLACEMENT = 1.5

/** Maximum allowed drift with zero throttle after settling (metres). */
const MAX_ZERO_THROTTLE_DRIFT = 0.5

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('createVehicle', () => {
  it('returns a chassis, exactly 2 wheels, and finite position()', async () => {
    const course = buildCourse()
    const world = await createWorld(course)
    const vehicle = createVehicle(world, { x: START_X, y: START_Y })

    expect(vehicle.chassis).toBeDefined()
    expect(vehicle.wheels).toHaveLength(2)

    const pos = vehicle.position()
    expect(Number.isFinite(pos.x)).toBe(true)
    expect(Number.isFinite(pos.y)).toBe(true)
  })
})

describe('forward motion', () => {
  it('with positive throttle, chassis x increases by > threshold after 300 steps', async () => {
    const course = buildCourse()
    const world = await createWorld(course)
    const vehicle = createVehicle(world, { x: START_X, y: START_Y })

    // Settle — no throttle
    for (let i = 0; i < SETTLE_STEPS; i++) world.step()

    const xBefore = vehicle.position().x

    // Apply full forward throttle
    vehicle.setThrottle(1)

    for (let i = 0; i < DRIVE_STEPS; i++) world.step()

    const xAfter = vehicle.position().x
    const displacement = xAfter - xBefore

    expect(displacement).toBeGreaterThan(MIN_FORWARD_DISPLACEMENT)
  })
})

describe('zero throttle / no drift', () => {
  it('with zero throttle, chassis x stays within tolerance after 300 steps', async () => {
    const course = buildCourse()
    const world = await createWorld(course)
    const vehicle = createVehicle(world, { x: START_X, y: START_Y })

    // Settle
    for (let i = 0; i < SETTLE_STEPS; i++) world.step()

    const xBefore = vehicle.position().x

    // Zero throttle — default is already 0 from creation, but be explicit
    vehicle.setThrottle(0)

    for (let i = 0; i < DRIVE_STEPS; i++) world.step()

    const xAfter = vehicle.position().x
    const drift = Math.abs(xAfter - xBefore)

    expect(drift).toBeLessThan(MAX_ZERO_THROTTLE_DRIFT)
  })
})
