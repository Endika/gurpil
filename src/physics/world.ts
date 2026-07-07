/**
 * Physics world — Rapier2d static terrain setup.
 *
 * Creates a headless Rapier world with:
 *   - Static ground built from Course.ground polyline (chained segments,
 *     per-segment friction from Course.surfaceFriction).
 *   - Static egg obstacle colliders (fixed ball per obstacle).
 *
 * No Three.js, no DOM. Safe to use in Vitest (Node, WASM headless).
 */

import RAPIER from '@dimforge/rapier2d-compat'
import type { Course } from '../core/course'

// ─── Constants ────────────────────────────────────────────────────────────────

/** Gravity vector: earth-like downward acceleration (m/s²). */
const GRAVITY = { x: 0, y: -9.81 } as const

/**
 * Physics fixed timestep in seconds (1/60 s ≈ 16.67 ms per tick).
 *
 * This is the single source of truth for the physics dt. `createWorld`
 * writes it to `world.timestep`, and the Task 12 game loop must use the
 * same value for its fixed-step accumulator so the two never drift.
 */
export const PHYSICS_TIMESTEP = 1 / 60

/** Radius of egg obstacle ball colliders (metres). */
export const EGG_RADIUS = 0.5

// ─── Public types ─────────────────────────────────────────────────────────────

export interface PhysicsWorld {
  raw: RAPIER.World
  step(): void
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Create and return a PhysicsWorld populated with the static terrain from
 * `course`.  Async because Rapier's compat build must initialise its
 * embedded WASM before any API calls.
 *
 * Calling this multiple times is safe — `RAPIER.init()` is idempotent.
 */
export async function createWorld(course: Course): Promise<PhysicsWorld> {
  await RAPIER.init()

  const world = new RAPIER.World(GRAVITY)
  world.timestep = PHYSICS_TIMESTEP

  buildStaticGround(world, course)
  buildEggObstacles(world, course)

  return {
    raw: world,
    step(): void {
      world.step()
    },
  }
}

// ─── Internal builders ────────────────────────────────────────────────────────

/**
 * Build the static ground from the course polyline.
 *
 * Creates a single fixed rigid body and attaches one `ColliderDesc.segment`
 * per consecutive pair of ground points.  Friction is applied per segment
 * using the midpoint x of each pair, sourced from `course.surfaceFriction`.
 *
 * Per-segment segments (rather than a single polyline) are used because
 * Rapier's polyline collider does not expose per-segment friction; we need
 * different friction values across terrain zones (ice, mud, etc.).
 */
function buildStaticGround(world: RAPIER.World, course: Course): void {
  const groundBody = world.createRigidBody(RAPIER.RigidBodyDesc.fixed())

  const pts = course.ground
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i]
    const b = pts[i + 1]
    const midX = (a.x + b.x) / 2
    const friction = course.surfaceFriction(midX)

    const desc = RAPIER.ColliderDesc.segment({ x: a.x, y: a.y }, { x: b.x, y: b.y }).setFriction(
      friction,
    )
    world.createCollider(desc, groundBody)
  }
}

/**
 * Build static egg obstacle colliders.
 *
 * Each egg gets its own fixed rigid body positioned at the obstacle
 * coordinates, with a ball collider of radius EGG_RADIUS.
 */
function buildEggObstacles(world: RAPIER.World, course: Course): void {
  for (const obs of course.obstacles) {
    if (obs.kind !== 'egg') continue

    const body = world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(obs.x, obs.y),
    )
    world.createCollider(RAPIER.ColliderDesc.ball(EGG_RADIUS), body)
  }
}
