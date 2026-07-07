/**
 * Vehicle physics — motorized two-wheel chassis for Gurpil.
 *
 * Builds a dynamic chassis (cuboid) with two ball-collider wheels (rear, front)
 * each attached to the chassis via a revolute joint with a velocity motor.
 * Positive throttle drives the vehicle forward (+x direction).
 *
 * No Three.js, no DOM. Safe to use in Vitest (Node, WASM headless).
 *
 * Wheel mass is fixed to WHEEL_MASS regardless of shape so Task 8 shape-swaps
 * do not cause a velocity "pop". We use ColliderDesc.setMass(WHEEL_MASS) directly
 * rather than deriving density, which keeps the intent explicit.
 */

import RAPIER from '@dimforge/rapier2d-compat'
import type { PhysicsWorld } from './world'
import type { Point } from '../core/classifyStroke'
import { SHAPES, WHEEL_MASS } from '../core/shapes'

// ─── Named constants ──────────────────────────────────────────────────────────

/** Half-width of the chassis cuboid (metres). */
const CHASSIS_HALF_W = 1.0

/** Half-height of the chassis cuboid (metres). */
const CHASSIS_HALF_H = 0.3

/** Chassis mass (kg). */
const CHASSIS_MASS = 3.0

/** Radius of the wheel ball colliders (metres). */
const WHEEL_RADIUS = 0.35

/**
 * Horizontal offset from the chassis centre to each wheel axle (metres).
 * Positive = front, negative = rear (in chassis local space).
 */
const WHEEL_OFFSET_X = 0.8

/**
 * Vertical offset from the chassis centre to each wheel axle (metres).
 * Negative = below (wheels hang below chassis).
 */
const WHEEL_OFFSET_Y = -(CHASSIS_HALF_H + WHEEL_RADIUS)

/**
 * Motor target speed for full throttle (rad/s).
 * Wheels with radius WHEEL_RADIUS at this speed → linear speed ≈ 7 m/s.
 */
const MAX_MOTOR_SPEED = 20.0

/**
 * Motor damping factor (N·m·s/rad).
 * Higher = more torque applied to reach target velocity.
 * Tuned so the vehicle accelerates reliably on the flat start zone.
 */
const MOTOR_FACTOR = 50.0

// ─── Public types ─────────────────────────────────────────────────────────────

export interface Vehicle {
  /** The main chassis rigid body. */
  chassis: RAPIER.RigidBody
  /** [rear, front] wheel rigid bodies. */
  wheels: RAPIER.RigidBody[]
  /**
   * Apply throttle to the motorized wheels.
   * @param v - Normalised throttle in roughly -1..1. Positive = forward (+x).
   */
  setThrottle(v: number): void
  /** Current chassis world position (x, y). */
  position(): Point
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Create a driveable vehicle in `world` placed with the chassis centred at `at`.
 *
 * The vehicle is spawned slightly above the ground so it settles naturally
 * under gravity. Call `world.step()` a few times before applying throttle to
 * let it reach a stable resting pose.
 */
export function createVehicle(world: PhysicsWorld, at: Point): Vehicle {
  const raw = world.raw

  // ── Chassis ──────────────────────────────────────────────────────────────
  const chassisDesc = RAPIER.RigidBodyDesc.dynamic().setTranslation(at.x, at.y)
  const chassis = raw.createRigidBody(chassisDesc)

  const chassisCollider = RAPIER.ColliderDesc.cuboid(CHASSIS_HALF_W, CHASSIS_HALF_H)
    .setMass(CHASSIS_MASS)
    .setFriction(0.3)
  raw.createCollider(chassisCollider, chassis)

  // ── Wheels ───────────────────────────────────────────────────────────────
  // Wheel positions in world space (derived from chassis spawn position).
  const wheelOffsets = [
    { x: -WHEEL_OFFSET_X, y: WHEEL_OFFSET_Y }, // rear
    { x: WHEEL_OFFSET_X, y: WHEEL_OFFSET_Y },  // front
  ]

  const wheelFriction = SHAPES.circle.friction

  const wheels: RAPIER.RigidBody[] = []
  const joints: RAPIER.RevoluteImpulseJoint[] = []

  for (const offset of wheelOffsets) {
    const wx = at.x + offset.x
    const wy = at.y + offset.y

    const wheelBody = raw.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic().setTranslation(wx, wy),
    )

    raw.createCollider(
      RAPIER.ColliderDesc.ball(WHEEL_RADIUS)
        .setMass(WHEEL_MASS)
        .setFriction(wheelFriction)
        .setRestitution(SHAPES.circle.restitution),
      wheelBody,
    )

    wheels.push(wheelBody)

    // Revolute joint: anchor1 = wheel offset in chassis local frame,
    //                 anchor2 = wheel centre in wheel local frame (origin).
    const jointData = RAPIER.JointData.revolute(
      { x: offset.x, y: offset.y }, // chassis local frame
      { x: 0, y: 0 },               // wheel local frame (its own centre)
    )

    const joint = raw.createImpulseJoint(
      jointData,
      chassis,
      wheelBody,
      true,
    ) as RAPIER.RevoluteImpulseJoint

    // Enable motor with zero initial velocity
    joint.configureMotorVelocity(0, MOTOR_FACTOR)
    joints.push(joint)
  }

  // ── Vehicle interface ─────────────────────────────────────────────────────
  return {
    chassis,
    wheels,

    setThrottle(v: number): void {
      // Sign convention: positive v must move the chassis forward (+x).
      // Empirically (confirmed by test run): Rapier's revolute motor with a
      // positive targetVel rotates the wheel such that it pushes the vehicle
      // in -x.  Negating gives the correct forward direction.
      const targetVel = -v * MAX_MOTOR_SPEED
      for (const joint of joints) {
        joint.configureMotorVelocity(targetVel, MOTOR_FACTOR)
      }
    },

    position(): Point {
      const t = chassis.translation()
      return { x: t.x, y: t.y }
    },
  }
}
