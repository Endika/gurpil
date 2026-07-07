/**
 * Tests for the Rapier physics world + static terrain (Task 6).
 *
 * Uses the REAL Rapier2d engine — no mocks.  Because RAPIER.init() is async,
 * all tests are async.  The vitest environment is "node" (set globally in
 * vitest.config.ts), so the embedded WASM loads fine via base64 decode.
 *
 * Determinism note: Rapier with a fixed timestep and no random state is
 * fully deterministic.  Step counts and epsilon values are chosen so the
 * assertions are stable across runs.
 */

import RAPIER from '@dimforge/rapier2d-compat'
import { describe, it, expect, beforeAll } from 'vitest'
import { buildCourse } from '../../src/core/course'
import { createWorld, EGG_RADIUS, PHYSICS_TIMESTEP } from '../../src/physics/world'

// ─── One-time RAPIER init (idempotent, but we init early so all tests share
//     a single WASM load) ──────────────────────────────────────────────────────
beforeAll(async () => {
  await RAPIER.init()
})

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Drop a dynamic ball from (x, y) and return the y translation after
 * `steps` physics steps.
 */
async function dropBall(
  x: number,
  y: number,
  steps: number,
): Promise<{ finalY: number; yHistory: number[] }> {
  const course = buildCourse()
  const pw = await createWorld(course)

  const dynBody = pw.raw.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic().setTranslation(x, y),
  )
  pw.raw.createCollider(RAPIER.ColliderDesc.ball(0.3), dynBody)

  const yHistory: number[] = []
  for (let i = 0; i < steps; i++) {
    pw.step()
    yHistory.push(dynBody.translation().y)
  }

  return { finalY: dynBody.translation().y, yHistory }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('createWorld', () => {
  it('resolves and exposes raw (RAPIER.World) and a callable step()', async () => {
    const course = buildCourse()
    const pw = await createWorld(course)

    // raw is a Rapier.World instance — spot-check a method that only World has
    expect(typeof pw.raw.step).toBe('function')
    expect(typeof pw.raw.createRigidBody).toBe('function')

    // step() is callable without throwing
    expect(() => pw.step()).not.toThrow()

    // the world actually applies PHYSICS_TIMESTEP (guards future drift with
    // the Task 12 accumulator, which must use the same dt). Precision 6:
    // Rapier stores dt as float32, so 1/60 round-trips to ~8.7e-10 off the
    // JS double — well within 1e-6, but any real drift (e.g. 1/120) is caught.
    expect(pw.raw.timestep).toBeCloseTo(PHYSICS_TIMESTEP, 6)
  })

  it('exports PHYSICS_TIMESTEP as ~1/60', () => {
    // Document and guard the canonical value
    expect(PHYSICS_TIMESTEP).toBeCloseTo(1 / 60, 10)
  })

  it('exports EGG_RADIUS as a positive number', () => {
    expect(EGG_RADIUS).toBeGreaterThan(0)
    expect(Number.isFinite(EGG_RADIUS)).toBe(true)
  })
})

describe('static bodies (ground + eggs)', () => {
  it('ground body does not move under gravity after 300 steps', async () => {
    const course = buildCourse()
    const pw = await createWorld(course)

    // Collect initial translations of all rigid bodies
    type Vec2 = { x: number; y: number }
    const initialPositions: Vec2[] = []
    pw.raw.forEachRigidBody((body) => {
      if (body.isFixed()) {
        initialPositions.push({ ...body.translation() })
      }
    })

    expect(initialPositions.length).toBeGreaterThan(0)

    // Step the world
    for (let i = 0; i < 300; i++) pw.step()

    // Verify static bodies have not moved
    let idx = 0
    pw.raw.forEachRigidBody((body) => {
      if (body.isFixed()) {
        const t = body.translation()
        expect(t.x).toBeCloseTo(initialPositions[idx].x, 6)
        expect(t.y).toBeCloseTo(initialPositions[idx].y, 6)
        idx++
      }
    })
  })
})

describe('dynamic ball drop', () => {
  /**
   * The flat start zone is at y=0 (x in [0, 20]).
   * We drop a ball from y=5 above x=10 (safely in the flat zone).
   * After 300 steps the ball should have come to rest on the ground.
   */
  const DROP_X = 10
  const DROP_Y = 5
  const STEPS = 300

  it('ball comes to rest — y stabilises over last 50 steps (delta < 1e-4)', async () => {
    const { yHistory } = await dropBall(DROP_X, DROP_Y, STEPS)

    // Compare the last 50 step positions: max delta must be tiny
    const tail = yHistory.slice(-50)
    const maxDelta = Math.max(...tail) - Math.min(...tail)
    expect(maxDelta).toBeLessThan(1e-4)
  })

  it('ball rests above the ground surface (y > -2), not fallen to -infinity', async () => {
    const { finalY } = await dropBall(DROP_X, DROP_Y, STEPS)
    // Ground at x=10 is at y=0; ball radius is 0.3, so resting y ≈ 0.3.
    // We allow generous tolerance: y must be above -2 (definitely not fallen through).
    expect(finalY).toBeGreaterThan(-2)
    // And it must not still be at the drop height (it did fall)
    expect(finalY).toBeLessThan(DROP_Y)
  })

  it('ball lands near ground surface (y within 1 unit of 0)', async () => {
    const { finalY } = await dropBall(DROP_X, DROP_Y, STEPS)
    // Flat zone ground is y=0; ball collider radius is 0.3.
    // Resting y should be close to 0.3 (ball centre above flat ground).
    expect(finalY).toBeGreaterThanOrEqual(-0.5)
    expect(finalY).toBeLessThanOrEqual(1.5)
  })
})

describe('terrain coverage', () => {
  it('world has colliders for ground segments (>= course.ground.length - 1)', async () => {
    const course = buildCourse()
    const pw = await createWorld(course)

    // Count colliders
    let colliderCount = 0
    pw.raw.forEachCollider(() => {
      colliderCount++
    })

    // There must be at least (ground.length - 1) ground segment colliders
    // plus obstacle colliders.
    const minExpected = course.ground.length - 1
    expect(colliderCount).toBeGreaterThanOrEqual(minExpected)
  })

  it('world has at least as many static bodies as egg obstacles', async () => {
    const course = buildCourse()
    const pw = await createWorld(course)

    let fixedCount = 0
    pw.raw.forEachRigidBody((body) => {
      if (body.isFixed()) fixedCount++
    })

    // 1 ground body + 1 body per egg obstacle (minimum)
    const eggCount = course.obstacles.filter((o) => o.kind === 'egg').length
    expect(fixedCount).toBeGreaterThanOrEqual(1 + eggCount)
  })
})
