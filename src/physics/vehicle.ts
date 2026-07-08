/**
 * Vehicle physics — motorized two-wheel chassis for Gurpil.
 *
 * STABLE HYBRID wheel model
 * -------------------------
 * The wheel PHYSICS COLLIDER is ALWAYS a ball — never a square/triangle/segment.
 * Real polygon-wheel physics failed playtest (wheels wedged, the car flipped
 * over a corner and tumbled). A ball can never flip over a corner and never
 * wedges. The DRAWN shape does not change the collider geometry; it only changes
 * per-shape TUNING (see `src/core/shapes.ts`):
 *   - `wheelRadiusMul` scales the ball RADIUS (bigger radius rolls over eggs /
 *     rough more easily; smaller catches more),
 *   - `friction` sets grip (matters on the slope / mud / ice),
 *   - `speedMul` scales the motor target speed (top speed / accel on flat).
 *
 * The wheels are ALWAYS driven by their revolute velocity motors (positive
 * throttle → forward = +x). There is no slide/ski drive mode any more — every
 * shape rolls on its ball. The visual mesh (square/triangle/line/circle) is a
 * pure render concern (see `src/render`).
 *
 * Anti-pop mitigation (the #1 risk from the SPIKE): swapping the ball radius can
 * change inertia and produce a velocity/spin "pop". We keep wheel mass FIXED at
 * WHEEL_MASS across all shapes and re-assert each body's pre-swap linear +
 * angular velocity right after the swap. Because the collider stays a ball, this
 * is trivial and reliably pop-free.
 *
 * No Three.js, no DOM. Safe to use in Vitest (Node, WASM headless).
 */

import RAPIER from '@dimforge/rapier2d-compat'
import type { PhysicsWorld } from './world'
import type { Point } from '../core/classifyStroke'
import { SHAPES, SHAPE_IDS, WHEEL_MASS, type ShapeId } from '../core/shapes'

// ─── Named constants ──────────────────────────────────────────────────────────

/** Half-width of the chassis cuboid (metres). */
const CHASSIS_HALF_W = 1.0

/** Half-height of the chassis cuboid (metres). */
const CHASSIS_HALF_H = 0.3

/** Chassis mass (kg). */
const CHASSIS_MASS = 3.0

/** Chassis collider friction (kept low so grip lives in the wheels). */
const CHASSIS_FRICTION = 0.3

/** Base radius of the wheel ball colliders (metres). Scaled per shape. */
const WHEEL_RADIUS = 0.35

/** Largest per-shape radius multiplier (drives the wheel-axle clearance below). */
const MAX_RADIUS_MUL = Math.max(...SHAPE_IDS.map((id) => SHAPES[id].wheelRadiusMul))

/**
 * Vertical gap (metres) kept between the top of the LARGEST wheel ball and the
 * bottom of the chassis, so no shape's ball can ever intersect the chassis
 * cuboid. Without this the biggest ball (the line's) overlapped the chassis and
 * the contact-resolution shoved the car violently backwards.
 */
const WHEEL_CHASSIS_GAP = 0.15

/**
 * Horizontal offset from the chassis centre to each wheel axle (metres).
 * Positive = front, negative = rear (in chassis local space).
 */
const WHEEL_OFFSET_X = 0.8

/**
 * Vertical offset from the chassis centre to each wheel axle (metres).
 * Placed low enough that even the LARGEST ball (MAX_RADIUS_MUL) clears the
 * chassis bottom by WHEEL_CHASSIS_GAP. Smaller balls simply rest a touch higher;
 * the settle step absorbs the difference (the joint is a point anchor).
 */
const WHEEL_OFFSET_Y = -(CHASSIS_HALF_H + WHEEL_RADIUS * MAX_RADIUS_MUL + WHEEL_CHASSIS_GAP)

/**
 * Motor target speed for full throttle at speedMul = 1 (rad/s).
 * The per-shape `speedMul` scales this, so circle (1.0) is fastest and the
 * grippy shapes (square 0.64, triangle 0.8, line 0.85) top out slower.
 */
const MAX_MOTOR_SPEED = 22.0

/**
 * Motor factor / max torque (N·m·s per rad/s of velocity error).
 * Higher = more torque applied to reach the target velocity. Boosted well above
 * the old value so EVERY shape climbs the rocky + uphill stretch from a dead
 * stop (verified by the real-engine traversal tests) — the grippy, slower shapes
 * need extra torque to overcome their lower top speed on the climb.
 */
const MOTOR_FACTOR = 140.0

// ─── Self-right / anti-stuck assist constants ─────────────────────────────────

/**
 * Chassis tilt (radians) beyond which the self-right assist engages. ~55°.
 * Chosen large so it only fires in genuine recovery situations (car pitched onto
 * its side / flipped): normal driving stays well below this, so the assist NEVER
 * interferes with the race feel.
 */
const SELF_RIGHT_THRESHOLD = 0.96 // rad (~55°)

/**
 * Base corrective angular impulse (N·m·s) applied every recovery step, in the
 * upright direction. A constant floor guarantees the assist can un-wedge a
 * chassis that is fully flipped and pinned against terrain.
 */
const SELF_RIGHT_BASE_IMPULSE = 1.2

/**
 * Additional corrective impulse per radian of tilt past the threshold
 * (N·m·s/rad). Scales the nudge with how far over the car is.
 */
const SELF_RIGHT_GAIN = 1.0

/**
 * Angular-velocity damping applied alongside the corrective impulse while
 * recovering. Bleeds off spin so the chassis settles upright instead of
 * oscillating past vertical. Fraction of current angvel removed per step.
 */
const SELF_RIGHT_ANGVEL_DAMP = 0.15

// ─── Public types ─────────────────────────────────────────────────────────────

export interface Vehicle {
  /** The main chassis rigid body. */
  chassis: RAPIER.RigidBody
  /** [rear, front] wheel rigid bodies. */
  wheels: RAPIER.RigidBody[]
  /**
   * Apply throttle to the vehicle. Always drives the wheel motors; the target
   * speed is scaled by the current shape's `speedMul`.
   * @param v - Normalised throttle in roughly -1..1. Positive = forward (+x).
   */
  setThrottle(v: number): void
  /**
   * Kept for game-loop / test call-cadence compatibility. In the stable-hybrid
   * model every shape rolls on its motor, so there is no per-step drive to
   * sustain and this is a no-op. Safe to call once per physics step.
   */
  applyDrive(): void
  /**
   * Self-right / anti-stuck assist. MUST be called once per physics step (before
   * `world.step()`). When the chassis tilt exceeds a large recovery threshold it
   * applies a gentle corrective torque toward upright so the car can never be
   * permanently flipped/wedged. Below the threshold it is a no-op.
   */
  stabilize(): void
  /**
   * Change the wheel ball radius + friction + mass to match `shape`, re-asserting
   * velocity for a pop-free swap. Does NOT reset the vehicle.
   */
  swapShape(shape: ShapeId): void
  /** The shape currently mounted on the wheels. */
  currentShape(): ShapeId
  /** Current chassis world position (x, y). */
  position(): Point
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Create a driveable vehicle in `world` placed with the chassis centred at `at`.
 * Wheels start as circles ('circle').
 *
 * The vehicle is spawned slightly above the ground so it settles naturally under
 * gravity. Call `world.step()` a few times before applying throttle to let it
 * reach a stable resting pose.
 */
export function createVehicle(world: PhysicsWorld, at: Point): Vehicle {
  const raw = world.raw

  // ── Chassis ──────────────────────────────────────────────────────────────
  // Anti-sleep (playtest "se queda bloqueado" fix): Rapier auto-sleeps bodies
  // that stay at rest for ~2 s. A sleeping body ignores joint-motor velocity
  // targets, so once the car had settled `setThrottle()` silently did nothing
  // and the car was stuck forever. Keeping the chassis + wheels permanently
  // awake guarantees the motor always responds.
  const chassisDesc = RAPIER.RigidBodyDesc.dynamic()
    .setTranslation(at.x, at.y)
    .setCanSleep(false)
  const chassis = raw.createRigidBody(chassisDesc)

  const chassisCollider = RAPIER.ColliderDesc.cuboid(CHASSIS_HALF_W, CHASSIS_HALF_H)
    .setMass(CHASSIS_MASS)
    .setFriction(CHASSIS_FRICTION)
  raw.createCollider(chassisCollider, chassis)

  // ── Wheels ───────────────────────────────────────────────────────────────
  const wheelOffsets = [
    { x: -WHEEL_OFFSET_X, y: WHEEL_OFFSET_Y }, // rear
    { x: WHEEL_OFFSET_X, y: WHEEL_OFFSET_Y }, // front
  ]

  const initial = SHAPES.circle

  const wheels: RAPIER.RigidBody[] = []
  const wheelColliders: RAPIER.Collider[] = []
  const joints: RAPIER.RevoluteImpulseJoint[] = []

  for (const offset of wheelOffsets) {
    const wx = at.x + offset.x
    const wy = at.y + offset.y

    // setCanSleep(false): see the chassis anti-sleep note above.
    const wheelBody = raw.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic().setTranslation(wx, wy).setCanSleep(false),
    )

    // Collider is ALWAYS a ball; radius scaled by the shape's wheelRadiusMul.
    const collider = raw.createCollider(
      RAPIER.ColliderDesc.ball(WHEEL_RADIUS * initial.wheelRadiusMul)
        .setMass(WHEEL_MASS)
        .setFriction(initial.friction)
        .setRestitution(initial.restitution),
      wheelBody,
    )

    wheels.push(wheelBody)
    wheelColliders.push(collider)

    // Revolute joint: anchor1 = wheel offset in chassis local frame,
    //                 anchor2 = wheel centre in wheel local frame (origin).
    const jointData = RAPIER.JointData.revolute(
      { x: offset.x, y: offset.y },
      { x: 0, y: 0 },
    )

    const joint = raw.createImpulseJoint(
      jointData,
      chassis,
      wheelBody,
      true,
    ) as RAPIER.RevoluteImpulseJoint

    // Enable motor with zero initial velocity.
    joint.configureMotorVelocity(0, MOTOR_FACTOR)
    joints.push(joint)
  }

  // ── Mutable drive state ────────────────────────────────────────────────────
  let mounted: ShapeId = 'circle'
  /** Current wheel-ball radius, tracked so a swap can offset the anti-pop lift. */
  let mountedRadius = WHEEL_RADIUS * initial.wheelRadiusMul
  let throttle = 0

  /** Apply the current throttle to the wheel motors (always rolling). */
  function driveMotors(): void {
    // Sign convention: positive throttle must move the chassis forward (+x).
    // Rapier's revolute motor with a positive targetVel rotates the wheel such
    // that it pushes the vehicle in -x; negating gives the correct direction.
    // Scale by the current shape's speedMul (circle fastest, grippy shapes slower).
    const targetVel = -throttle * MAX_MOTOR_SPEED * SHAPES[mounted].speedMul
    for (const joint of joints) {
      joint.configureMotorVelocity(targetVel, MOTOR_FACTOR)
    }
  }

  return {
    chassis,
    wheels,

    setThrottle(v: number): void {
      throttle = v
      driveMotors()
    },

    applyDrive(): void {
      // No-op in the stable-hybrid model: the motors roll continuously. Kept so
      // the game loop / tests can call it once per step without special-casing.
    },

    swapShape(id: ShapeId): void {
      const def = SHAPES[id]

      // ── Record pre-swap state (anti-pop) ──────────────────────────────────
      const chassisLin = chassis.linvel()
      const chassisAng = chassis.angvel()
      const wheelLin = wheels.map((w) => w.linvel())
      const wheelAng = wheels.map((w) => w.angvel())

      // ── Swap ball radius + re-apply per-shape material and fixed mass ──────
      const radius = WHEEL_RADIUS * def.wheelRadiusMul
      const dRadius = radius - mountedRadius
      for (const collider of wheelColliders) {
        collider.setShape(new RAPIER.Ball(radius))
        collider.setMass(WHEEL_MASS)
        collider.setFriction(def.friction)
        collider.setRestitution(def.restitution)
      }
      mountedRadius = radius

      mounted = id

      // ── Anti-pop lift: keep the ball's contact point fixed ────────────────
      // Growing the ball while the axle stays put would make the new, bigger ball
      // penetrate the ground; Rapier would resolve that in one step with a violent
      // upward shove (a huge velocity pop). Shrinking it would drop the car. So we
      // translate the whole vehicle vertically by the radius delta: the new ball
      // rests exactly where the old one did, and the swap stays contact-neutral.
      if (dRadius !== 0) {
        const ct = chassis.translation()
        chassis.setTranslation({ x: ct.x, y: ct.y + dRadius }, true)
        wheels.forEach((w) => {
          const wt = w.translation()
          w.setTranslation({ x: wt.x, y: wt.y + dRadius }, true)
        })
      }

      // ── Re-assert velocities immediately (anti-pop) ───────────────────────
      // The collider stays a ball, so preserving both linear and angular
      // velocity keeps the momentum and the roll — no spin whip, no pop.
      chassis.setLinvel(chassisLin, true)
      chassis.setAngvel(chassisAng, true)
      wheels.forEach((w, i) => {
        w.setLinvel(wheelLin[i], true)
        w.setAngvel(wheelAng[i], true)
      })

      // ── Re-apply the motor target for the new shape's speedMul ─────────────
      driveMotors()
    },

    stabilize(): void {
      // Wrap rotation to [-π, π] so tilt magnitude is measured the short way.
      const rawAngle = chassis.rotation()
      const angle = Math.atan2(Math.sin(rawAngle), Math.cos(rawAngle))
      const tilt = Math.abs(angle)
      if (tilt <= SELF_RIGHT_THRESHOLD) return // upright enough — no interference

      // Corrective impulse toward upright: a constant floor (to un-wedge a pinned
      // flip) plus a term scaled by how far past the threshold we are.
      const excess = tilt - SELF_RIGHT_THRESHOLD
      const magnitude = SELF_RIGHT_BASE_IMPULSE + SELF_RIGHT_GAIN * excess
      const corrective = -Math.sign(angle) * magnitude
      chassis.applyTorqueImpulse(corrective, true)

      // Bleed off spin so the chassis settles instead of oscillating past vertical.
      const w = chassis.angvel()
      chassis.setAngvel(w * (1 - SELF_RIGHT_ANGVEL_DAMP), true)
    },

    currentShape(): ShapeId {
      return mounted
    },

    position(): Point {
      const t = chassis.translation()
      return { x: t.x, y: t.y }
    },
  }
}
