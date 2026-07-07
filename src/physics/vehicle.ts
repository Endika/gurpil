/**
 * Vehicle physics — motorized two-wheel chassis for Gurpil.
 *
 * Builds a dynamic chassis (cuboid) with two wheel-collider "wheels" (rear,
 * front) each attached to the chassis via a revolute joint with a velocity
 * motor. Positive throttle drives the vehicle forward (+x direction).
 *
 * Task 8 — live shape-swap: `swapShape(id)` replaces both wheel colliders in
 * place to match the drawn shape (circle/square/triangle/line) WITHOUT
 * resetting the vehicle. Two behaviours are differentiated per shape:
 *   - Geometry: ball / cuboid / triangle / segment collider.
 *   - Drive mode: 'roll' shapes are driven by the revolute wheel motors;
 *     the 'slide' shape (line/ski) disables the wheel motors and is instead
 *     propelled by a governed forward impulse applied to the chassis each step
 *     (a spinning ski would be physically wrong). `applyDrive()` must be called
 *     once per physics step to sustain the slide drive (see game loop / tests).
 *
 * Anti-pop mitigation (the #1 risk from the SPIKE): swapping a collider can
 * change mass/inertia and produce a velocity/spin "pop". We keep wheel mass
 * FIXED at WHEEL_MASS across all shapes, and immediately re-assert each body's
 * pre-swap linear+angular velocity after the swap.
 *
 * No Three.js, no DOM. Safe to use in Vitest (Node, WASM headless).
 */

import RAPIER from '@dimforge/rapier2d-compat'
import type { PhysicsWorld } from './world'
import type { Point } from '../core/classifyStroke'
import { SHAPES, WHEEL_MASS, type ShapeId } from '../core/shapes'

// ─── Named constants ──────────────────────────────────────────────────────────

/** Half-width of the chassis cuboid (metres). */
const CHASSIS_HALF_W = 1.0

/** Half-height of the chassis cuboid (metres). */
const CHASSIS_HALF_H = 0.3

/** Chassis mass (kg). */
const CHASSIS_MASS = 3.0

/** Radius / half-extent of the wheel colliders (metres). */
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

// ─── Self-right / anti-stuck assist constants ─────────────────────────────────

/**
 * Chassis tilt (radians) beyond which the self-right assist engages. ~55°.
 * Chosen large so it only fires in genuine recovery situations (car pitched
 * onto its side / flipped): normal driving and every Task 8 differentiation
 * scenario stay well below this, so the assist NEVER interferes with them.
 */
const SELF_RIGHT_THRESHOLD = 0.96 // rad (~55°)

/**
 * Base corrective angular impulse (N·m·s) applied every recovery step, in the
 * upright direction. A constant floor guarantees the assist can un-wedge a
 * chassis that is fully flipped and pinned against terrain with its wheel motors
 * still running — a purely tilt-proportional torque was too weak at large tilt
 * and let the car stay stuck.
 */
const SELF_RIGHT_BASE_IMPULSE = 1.2

/**
 * Additional corrective impulse per radian of tilt past the threshold
 * (N·m·s/rad). Scales the nudge with how far over the car is, so a mild lean
 * gets a mild correction and a full flip gets a firm one.
 */
const SELF_RIGHT_GAIN = 1.0

/**
 * Angular-velocity damping applied alongside the corrective impulse while
 * recovering. Bleeds off spin so the chassis settles upright instead of
 * oscillating past vertical. Fraction of current angvel removed per step.
 */
const SELF_RIGHT_ANGVEL_DAMP = 0.15

// ─── Slide-mode (line/ski) drive constants ────────────────────────────────────

/**
 * Forward impulse (N·s) applied to the chassis per step at full throttle when
 * the current shape is a 'slide' shape (the line/ski). The ski is not driven by
 * a spinning motor; instead it glides while this per-step impulse propels it.
 * A per-step impulse (not a persistent force) is used so it can be gated by the
 * speed governor without leaving residual force applied on later steps.
 */
const SLIDE_DRIVE_IMPULSE = 2.5

/**
 * Target cruise speed (m/s) for the ski. On a near-frictionless glide an
 * un-gated push would integrate to unbounded speed, so `applyDrive()` acts as a
 * speed governor: it only pushes while the chassis is slower than this. This
 * gives the ski a stable, realistic cruise instead of a runaway.
 */
const SLIDE_TARGET_SPEED = 7.0

// ─── Wheel geometry constants (per shape) ─────────────────────────────────────

/** Half-extent of the square (cuboid) wheel — matches the ball radius. */
const SQUARE_HALF = WHEEL_RADIUS

/**
 * Triangle wheel vertices (isosceles, point-up) in wheel local space, sized
 * ~WHEEL_RADIUS. Point-up so it tumbles/grips over obstacles like a cog.
 */
const TRIANGLE_VERTICES: readonly [Point, Point, Point] = [
  { x: -WHEEL_RADIUS, y: -WHEEL_RADIUS }, // bottom-left
  { x: WHEEL_RADIUS, y: -WHEEL_RADIUS }, // bottom-right
  { x: 0, y: WHEEL_RADIUS }, // top
]

/** Ski half-length as a multiple of WHEEL_RADIUS. */
const SKI_HALF_LEN_FACTOR = 1.6

/** Ski front-tip upturn as a multiple of WHEEL_RADIUS. */
const SKI_UPTURN_FACTOR = 0.4

/**
 * Half-length of the ski/runner segment (metres). The segment spans
 * 2*SKI_HALF_LEN horizontally so the line acts as a runner whose bottom rides
 * up and over egg-sized bumps instead of butting into them like a small wheel.
 */
const SKI_HALF_LEN = WHEEL_RADIUS * SKI_HALF_LEN_FACTOR

/**
 * Upturn of the ski's leading (front, +x) tip in wheel local space (metres).
 * A raised front tip lets the ski mount obstacles like a real ski over a mogul
 * rather than catching its flat leading edge on the obstacle's flank.
 */
const SKI_FRONT_UPTURN = WHEEL_RADIUS * SKI_UPTURN_FACTOR

/** Ski segment endpoints in wheel local space (rear low, front upturned). */
const SKI_A: Point = { x: -SKI_HALF_LEN, y: 0 }
const SKI_B: Point = { x: SKI_HALF_LEN, y: SKI_FRONT_UPTURN }

// ─── Public types ─────────────────────────────────────────────────────────────

export interface Vehicle {
  /** The main chassis rigid body. */
  chassis: RAPIER.RigidBody
  /** [rear, front] wheel rigid bodies. */
  wheels: RAPIER.RigidBody[]
  /**
   * Apply throttle to the vehicle. Respects the current drive mode:
   *   - 'roll' shapes: sets the wheel motor target velocity.
   *   - 'slide' shape: records the throttle used by `applyDrive()` to push
   *     the chassis; wheel motors stay disabled.
   * @param v - Normalised throttle in roughly -1..1. Positive = forward (+x).
   */
  setThrottle(v: number): void
  /**
   * Sustain per-step drive. MUST be called once per physics step (before
   * `world.step()`). No-op for 'roll' shapes (their motors run continuously);
   * applies the ski's governed forward impulse for 'slide' shapes.
   */
  applyDrive(): void
  /**
   * Self-right / anti-stuck assist. MUST be called once per physics step (after
   * `applyDrive()`, before `world.step()`). When the chassis tilt exceeds a
   * large recovery threshold it applies a gentle corrective torque toward
   * upright so the car can never be permanently flipped/wedged. Below the
   * threshold it is a no-op, so normal driving and the Task 8 differentiation
   * scenarios are unaffected.
   */
  stabilize(): void
  /** Replace both wheel colliders live to match `shape` (anti-pop). */
  swapShape(shape: ShapeId): void
  /** The shape currently mounted on the wheels. */
  currentShape(): ShapeId
  /** Current chassis world position (x, y). */
  position(): Point
}

// ─── Shape → Rapier collider shape ────────────────────────────────────────────

/**
 * Build the Rapier `Shape` for a given ShapeId, sized around WHEEL_RADIUS.
 * Returned shapes are consumed by `collider.setShape()`.
 */
function shapeFor(id: ShapeId): RAPIER.Shape {
  switch (id) {
    case 'circle':
      return new RAPIER.Ball(WHEEL_RADIUS)
    case 'square':
      return new RAPIER.Cuboid(SQUARE_HALF, SQUARE_HALF)
    case 'triangle': {
      const [a, b, c] = TRIANGLE_VERTICES
      return new RAPIER.Triangle(a, b, c)
    }
    case 'line':
      return new RAPIER.Segment(SKI_A, SKI_B)
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Create a driveable vehicle in `world` placed with the chassis centred at `at`.
 * Wheels start as circles ('circle').
 *
 * The vehicle is spawned slightly above the ground so it settles naturally
 * under gravity. Call `world.step()` a few times before applying throttle to
 * let it reach a stable resting pose.
 */
export function createVehicle(world: PhysicsWorld, at: Point): Vehicle {
  const raw = world.raw

  // ── Chassis ──────────────────────────────────────────────────────────────
  // Anti-sleep (playtest "se queda bloqueado" fix): Rapier auto-sleeps bodies
  // that stay at rest for ~2 s. A sleeping body ignores joint-motor velocity
  // targets, so once the car had settled (the player pausing before drawing, or
  // after a slow crawl) `setThrottle()` silently did nothing and the car was
  // stuck forever. Keeping the chassis and wheels permanently awake costs almost
  // nothing for one vehicle and guarantees the motor always responds. This flag
  // is the single source of truth for the behaviour — do NOT rely on ad-hoc
  // wakeUp() calls scattered through the drive code.
  const chassisDesc = RAPIER.RigidBodyDesc.dynamic()
    .setTranslation(at.x, at.y)
    .setCanSleep(false)
  const chassis = raw.createRigidBody(chassisDesc)

  const chassisCollider = RAPIER.ColliderDesc.cuboid(CHASSIS_HALF_W, CHASSIS_HALF_H)
    .setMass(CHASSIS_MASS)
    .setFriction(0.3)
  raw.createCollider(chassisCollider, chassis)

  // ── Wheels ───────────────────────────────────────────────────────────────
  // Wheel positions in world space (derived from chassis spawn position).
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

    // setCanSleep(false): see the chassis anti-sleep note above — a sleeping
    // wheel would freeze its motor and leave the car stuck.
    const wheelBody = raw.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic().setTranslation(wx, wy).setCanSleep(false),
    )

    const collider = raw.createCollider(
      RAPIER.ColliderDesc.ball(WHEEL_RADIUS)
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
      { x: offset.x, y: offset.y }, // chassis local frame
      { x: 0, y: 0 }, // wheel local frame (its own centre)
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

  // ── Mutable drive state ────────────────────────────────────────────────────
  let mounted: ShapeId = 'circle'
  let throttle = 0

  /** Apply the current throttle to the wheel motors (roll mode). */
  function driveMotors(): void {
    // Sign convention: positive throttle must move the chassis forward (+x).
    // Empirically (confirmed by test run): Rapier's revolute motor with a
    // positive targetVel rotates the wheel such that it pushes the vehicle
    // in -x.  Negating gives the correct forward direction.
    const targetVel = -throttle * MAX_MOTOR_SPEED
    for (const joint of joints) {
      joint.configureMotorVelocity(targetVel, MOTOR_FACTOR)
    }
  }

  /** Fully disable the wheel motors (slide mode — free-spinning wheels). */
  function stopMotors(): void {
    for (const joint of joints) {
      joint.configureMotorVelocity(0, 0)
    }
  }

  return {
    chassis,
    wheels,

    setThrottle(v: number): void {
      throttle = v
      if (SHAPES[mounted].driveMode === 'roll') {
        driveMotors()
      } else {
        // Slide mode: motors stay off; the force is applied in applyDrive().
        stopMotors()
      }
    },

    applyDrive(): void {
      if (SHAPES[mounted].driveMode !== 'slide') return
      // Governor: only push while below the target cruise speed. A per-step
      // impulse (not a persistent force) is used so nothing carries over once
      // the ski reaches cruise speed — otherwise it would run away on the
      // near-frictionless glide.
      if (throttle <= 0) return
      const vx = chassis.linvel().x
      if (vx < throttle * SLIDE_TARGET_SPEED) {
        chassis.applyImpulse({ x: throttle * SLIDE_DRIVE_IMPULSE, y: 0 }, true)
      }
    },

    swapShape(id: ShapeId): void {
      const def = SHAPES[id]

      // ── Record pre-swap state (anti-pop) ──────────────────────────────────
      const chassisLin = chassis.linvel()
      const chassisAng = chassis.angvel()
      const wheelLin = wheels.map((w) => w.linvel())
      const wheelAng = wheels.map((w) => w.angvel())

      // ── Swap collider shape + re-apply per-shape material and fixed mass ───
      for (const collider of wheelColliders) {
        collider.setShape(shapeFor(id))
        collider.setMass(WHEEL_MASS)
        collider.setFriction(def.friction)
        collider.setRestitution(def.restitution)
      }

      mounted = id

      // ── Re-assert velocities immediately (anti-pop) ───────────────────────
      // Linear velocity is always preserved so the chassis keeps its momentum.
      // Angular (spin) handling depends on drive mode: for 'slide' (the ski)
      // the wheels must NOT spin — a spinning segment whips its long endpoints
      // into the ground and produces a huge one-step velocity pop. We zero the
      // wheel spin so the ski glides flat instead.
      const slide = def.driveMode === 'slide'
      chassis.setLinvel(chassisLin, true)
      chassis.setAngvel(chassisAng, true)
      wheels.forEach((w, i) => {
        w.setLinvel(wheelLin[i], true)
        w.setAngvel(slide ? 0 : wheelAng[i], true)
      })

      // ── Reconfigure drive to match the new mode ───────────────────────────
      if (slide) {
        stopMotors()
      } else {
        driveMotors()
      }
    },

    stabilize(): void {
      // Wrap rotation to [-π, π] so tilt magnitude is measured the short way.
      const raw = chassis.rotation()
      const angle = Math.atan2(Math.sin(raw), Math.cos(raw))
      const tilt = Math.abs(angle)
      if (tilt <= SELF_RIGHT_THRESHOLD) return // upright enough — no interference

      // Corrective impulse toward upright: a constant floor (to un-wedge a
      // pinned flip) plus a term scaled by how far past the threshold we are.
      // Sign points back to angle 0 (−sign(angle)).
      const excess = tilt - SELF_RIGHT_THRESHOLD
      const magnitude = SELF_RIGHT_BASE_IMPULSE + SELF_RIGHT_GAIN * excess
      const corrective = -Math.sign(angle) * magnitude
      chassis.applyTorqueImpulse(corrective, true)

      // Bleed off spin so the chassis settles instead of oscillating past
      // vertical (over-correcting into a flip the other way).
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
