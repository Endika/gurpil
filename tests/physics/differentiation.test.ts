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
 *   - SLOPE  : on the ACTUAL course uphill the grip difference is a hard GATE —
 *              driving from the base of the slippery ramp, the grippy `triangle`
 *              grips and climbs the slope while the low-grip `circle` slips, gains
 *              no real height and slides back down. This is the fix for the "no
 *              veo que en las cuestas el círculo se penalice" playtest report: the
 *              drawn shape is now UNMISTAKABLE on the hill (pass/fail).
 *
 * The EGGS scenario (line vs circle over the egg field) was removed: the line's
 * advantage there is a subtle +25% effective radius, and proving it needs a long
 * run over discrete ball-on-ball contacts — a chaotic sim whose outcome is not
 * reproducible across CI runner environments (it flaked failure/success/failure
 * on the same commit). FLAT and SLOPE cover shape differentiation robustly.
 */

import { describe, it, expect, beforeAll } from 'vitest'
import RAPIER from '@dimforge/rapier2d-compat'
import { buildCourse, firstZoneOf } from '../../src/core/course'
import { createWorld } from '../../src/physics/world'
import { createVehicle } from '../../src/physics/vehicle'
import { SHAPE_IDS, type ShapeId } from '../../src/core/shapes'

beforeAll(async () => {
  await RAPIER.init()
})

// ─── Shared constants ───────────────────────────────────────────────────────

/** Steps to let the vehicle settle before applying throttle / measuring. */
const SETTLE_STEPS = 60

// ─── Zone-relative anchors (located on the canonical course, not hardcoded x) ──
//
// The course is now generated; the physics is tuned against the canonical
// reference (buildCourse). We LOCATE the uphill on it instead of hardcoding an
// absolute x, so the slope gate stays meaningful if the canonical layout shifts.
const CANONICAL = buildCourse()
const UPHILL_ZONE = firstZoneOf(CANONICAL, 'uphill')!

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Run a vehicle on the real course from a start pose and return net motion. */
async function runOnCourse(
  shape: ShapeId,
  start: { x: number; y: number },
  throttle: number,
  driveSteps: number,
): Promise<{ dx: number; finalY: number }> {
  const course = buildCourse()
  const world = await createWorld(course)
  const vehicle = createVehicle(world, start)
  for (let i = 0; i < SETTLE_STEPS; i++) world.step()
  if (shape !== 'circle') vehicle.swapShape(shape)

  const startX = vehicle.position().x
  vehicle.setThrottle(throttle)
  for (let i = 0; i < driveSteps; i++) {
    vehicle.applyDrive()
    vehicle.stabilize()
    world.step()
  }
  const finalPos = vehicle.position()
  return { dx: finalPos.x - startX, finalY: finalPos.y }
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

// ─── SLOPE: the drawn shape MATTERS on the actual course uphill ───────────────

describe('SLOPE differentiation (actual course uphill)', () => {
  /**
   * Settled start just past the BASE of the course uphill ramp. Both shapes
   * begin from the same pose and drive up at full throttle for the same window.
   * Located relative to the canonical uphill zone (no hardcoded x).
   */
  const UPHILL_BASE = { x: UPHILL_ZONE.xStart + 2, y: 4 }
  const CLIMB_STEPS = 300

  /**
   * Minimum net-x margin (metres) by which the grippy triangle must out-climb
   * the slipping circle over CLIMB_STEPS. Measured margin ≈ 16 m (triangle
   * dx ≈ +15, circle dx ≈ −2 as it slips back); we assert a comfortable,
   * non-tautological fraction of it.
   */
  const MIN_UPHILL_MARGIN = 8

  /** Minimum HEIGHT (m) the grippy triangle must gain climbing the ramp. */
  const MIN_TRIANGLE_HEIGHT = 5
  /** The slipping circle must NOT gain real height (it slips / slides back). */
  const MAX_CIRCLE_HEIGHT = 3

  it('grippy triangle climbs the uphill while the low-grip circle slips and slides back', async () => {
    const circle = await runOnCourse('circle', UPHILL_BASE, 1, CLIMB_STEPS)
    const triangle = await runOnCourse('triangle', UPHILL_BASE, 1, CLIMB_STEPS)

    // The grippy triangle grips the slope and climbs markedly further than the
    // slipping circle — the drawn shape is a hard gate uphill (real margin).
    expect(triangle.dx).toBeGreaterThan(circle.dx + MIN_UPHILL_MARGIN)
    // The triangle gains real HEIGHT; the circle slips and gains none (slides back).
    expect(triangle.finalY).toBeGreaterThan(MIN_TRIANGLE_HEIGHT)
    expect(circle.finalY).toBeLessThan(MAX_CIRCLE_HEIGHT)
    expect(triangle.finalY).toBeGreaterThan(circle.finalY)
  })
})
