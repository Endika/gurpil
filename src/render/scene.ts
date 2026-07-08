/**
 * Scene3D — Three.js visual layer for Gurpil.
 *
 * Camera choice: OrthographicCamera.
 * Rationale: the game is a pure side-scroller (physics on the x-y plane).
 * An orthographic camera gives a clean 2D-game-like read without perspective
 * distortion; depth (z) is used only for layering meshes, not for perspective
 * foreshortening. The frustum half-height is fixed in "game metres" so the
 * car and terrain always appear at the same pixel size regardless of window
 * width, and the camera follows chassis x via smooth lerp.
 *
 * Coordinate mapping:
 *   physics x  → scene x  (1:1)
 *   physics y  → scene y  (1:1, +y up in both)
 *   rotation   → mesh.rotation.z (Rapier angle is CCW in 2D = Three.js CCW from +z)
 *
 * Terrain z layering (z=0 plane is the physics plane):
 *   terrain strip:  z = -0.5 (behind vehicle)
 *   wheel meshes:   z =  0.4 (in front of chassis)
 *   chassis mesh:   z =  0.0
 *   monigote:       z =  0.1
 */

import * as THREE from 'three'
import type { Course } from '../core/course'
import type { Vehicle } from '../physics/vehicle'
import { SHAPES } from '../core/shapes'
import type { ShapeId } from '../core/shapes'
import { buildTerrainMesh, buildObstacleMeshes } from './terrain'
import { wheelGeometry, WHEEL_VISUAL_RADIUS } from './wheelMesh'

// ─── Constants ────────────────────────────────────────────────────────────────

/** Half-height of the orthographic frustum in game metres. Controls zoom level. */
const CAM_HALF_HEIGHT = 12

/** z distance of the camera from the x-y plane (orthographic depth budget). */
const CAM_Z = 50

/**
 * How far the camera leads/lags the vehicle in x (lerp factor per frame).
 * 1.0 = instant snap; lower = smoother follow.
 */
const CAM_LERP = 0.1

/** Camera y offset: keeps the car slightly below centre for sky headroom. */
const CAM_Y_OFFSET = 2

/** z position of the chassis mesh. */
const CHASSIS_Z = 0

/** z position of each wheel (in front of chassis for visibility). */
const WHEEL_Z = 0.4

/** z position of the monigote body+head meshes. */
const MONIGOTE_Z = 0.1

/**
 * z offset applied to the whole terrain mesh so it sits BEHIND the entire
 * vehicle from the camera's view.
 *
 * The terrain strip is extruded away from the camera (front face at
 * TERRAIN_FRONT_Z ≈ +0.05 in terrain.ts) and then shifted back by this amount,
 * putting its frontmost face at ≈ -0.45 world-z — safely behind the chassis
 * (z=0), the monigote (0.1) and especially the wheels (WHEEL_Z=0.4), which sit
 * at ground level and used to be hidden behind the terrain's front wall.
 */
const TERRAIN_Z = -0.5

/** Chassis box half-extents in metres (matches physics: CHASSIS_HALF_W=1, CHASSIS_HALF_H=0.3). */
const CHASSIS_HALF_W = 1.0
const CHASSIS_HALF_H = 0.3
/** Chassis depth (into/out of the screen); purely visual, no physics counterpart. */
const CHASSIS_HALF_D = 0.6

/** Monigote body half-extents (metres). */
const BODY_HALF_W = 0.22
const BODY_HALF_H = 0.35
/** Monigote body depth (into/out of the screen); purely visual, no physics counterpart. */
const BODY_HALF_D = 0.25

/** Monigote head radius (metres). */
const HEAD_RADIUS = 0.2

// ─── Car body art constants ────────────────────────────────────────────────────
// Extra decoration meshes turn the plain chassis box into a charming little
// kart silhouette. They are added as children of `body` but are NOT part of
// the VehicleMeshes contract — only `chassis` itself is a tracked handle.

/** Main body paint — a playful saturated orange instead of flat red. */
const CAR_BODY_COLOR = 0xff6f3c
/** Racing-stripe / hood / spoiler-wing accent color. */
const CAR_ACCENT_COLOR = 0xffd23f
/**
 * Shared dark trim color — used for the car's bumper, cockpit rim, spoiler
 * strut and exhaust, AND reused for the driver's visor, eyes and smile so
 * the car and driver read as one cohesive livery.
 */
const CAR_TRIM_COLOR = 0x22223b
/** Windshield glass color. */
const CAR_GLASS_COLOR = 0x8ecae6

/**
 * Overlap depth (metres) used so decoration meshes sink slightly into the
 * chassis instead of touching it edge-on — avoids visible seams.
 */
const CAR_EMBED = 0.03

/** Hood: a sloped accent panel on the nose half of the chassis. */
const HOOD_HALF_W = 0.4
const HOOD_HALF_H = 0.12
const HOOD_HALF_D = 0.5
const HOOD_OFFSET_X = 0.4
const HOOD_OFFSET_Y = CHASSIS_HALF_H + HOOD_HALF_H - CAR_EMBED
const HOOD_TILT = 0.35 // radians; slopes the nose down for a raked look

/** Front bumper: a small trim block at the nose. */
const BUMPER_HALF_W = 0.12
const BUMPER_HALF_H = 0.14
const BUMPER_HALF_D = 0.55
const BUMPER_OFFSET_X = CHASSIS_HALF_W + BUMPER_HALF_W - CAR_EMBED
const BUMPER_OFFSET_Y = -CHASSIS_HALF_H * 0.25

/** Cockpit tub the driver sits in, behind the hood. */
const COCKPIT_HALF_W = 0.28
const COCKPIT_HALF_H = 0.16
const COCKPIT_HALF_D = 0.52
const COCKPIT_OFFSET_X = -0.2
const COCKPIT_OFFSET_Y = CHASSIS_HALF_H + COCKPIT_HALF_H - CAR_EMBED

/** Windshield: thin raked glass panel bridging hood and cockpit. */
const WINDSHIELD_HALF_W = 0.04
const WINDSHIELD_HALF_H = 0.16
const WINDSHIELD_HALF_D = 0.45
const WINDSHIELD_OFFSET_X = 0.05
const WINDSHIELD_OFFSET_Y = COCKPIT_OFFSET_Y + COCKPIT_HALF_H + WINDSHIELD_HALF_H
const WINDSHIELD_TILT = 0.5

/** Rear spoiler: a strut holding up a small wing. */
const SPOILER_STRUT_HALF_W = 0.04
const SPOILER_STRUT_HALF_H = 0.16
const SPOILER_STRUT_HALF_D = 0.5
const SPOILER_STRUT_OFFSET_X = -CHASSIS_HALF_W + SPOILER_STRUT_HALF_W - CAR_EMBED
const SPOILER_STRUT_OFFSET_Y = CHASSIS_HALF_H + SPOILER_STRUT_HALF_H - CAR_EMBED
const SPOILER_WING_HALF_W = 0.1
const SPOILER_WING_HALF_H = 0.04
const SPOILER_WING_HALF_D = 0.55
const SPOILER_WING_OFFSET_X = SPOILER_STRUT_OFFSET_X - 0.03
const SPOILER_WING_OFFSET_Y = SPOILER_STRUT_OFFSET_Y + SPOILER_STRUT_HALF_H + SPOILER_WING_HALF_H

/** Exhaust pipe poking out the back, near the ground. */
const EXHAUST_RADIUS = 0.06
const EXHAUST_LENGTH = 0.3
const EXHAUST_OFFSET_X = -CHASSIS_HALF_W - EXHAUST_LENGTH * 0.35
const EXHAUST_OFFSET_Y = -CHASSIS_HALF_H * 0.5

/** Racing stripe painted along the top of the chassis. */
const STRIPE_HALF_W = CHASSIS_HALF_W * 0.85
const STRIPE_HALF_H = 0.03
const STRIPE_HALF_D = 0.1
const STRIPE_OFFSET_Y = CHASSIS_HALF_H + STRIPE_HALF_H - CAR_EMBED

// ─── Character (monigote) art constants ────────────────────────────────────────
// Extra decoration meshes (helmet, visor, eyes, smile, arms, steering wheel)
// turn the plain box-and-sphere monigote into a charming little driver. Only
// `monigoteBody` and `monigoteHead` are tracked contract handles; everything
// else here is decoration parented to them or to `body`.

/** Driver racing-suit color. */
const DRIVER_SUIT_COLOR = 0x2ec4b6
/** Driver skin tone. */
const DRIVER_SKIN_COLOR = 0xffd3a8

/** Helmet dome, slightly larger than the head so it reads as worn over it. */
const HELMET_RADIUS = HEAD_RADIUS * 1.2
/** How far down the sphere the helmet dome extends (from the top pole, in radians). */
const HELMET_THETA_LENGTH = Math.PI * 0.62
const HELMET_OFFSET_Y = HEAD_RADIUS * 0.15

/** Visor brim across the front-top of the helmet, above the eyes. */
const VISOR_HALF_W = HEAD_RADIUS * 0.75
const VISOR_HALF_H = HEAD_RADIUS * 0.18
const VISOR_HALF_D = HEAD_RADIUS * 0.15
const VISOR_OFFSET_Y = HEAD_RADIUS * 0.55
const VISOR_OFFSET_Z = HEAD_RADIUS * 0.95

/** Eyes: two small dark spheres on the camera-facing side of the head. */
const EYE_RADIUS = HEAD_RADIUS * 0.14
const EYE_OFFSET_X = HEAD_RADIUS * 0.42
const EYE_OFFSET_Y = HEAD_RADIUS * 0.1
const EYE_OFFSET_Z = HEAD_RADIUS * 0.92

/** Smile: the bottom arc of a thin torus reads as a simple curved grin. */
const MOUTH_RADIUS = HEAD_RADIUS * 0.35
const MOUTH_TUBE = HEAD_RADIUS * 0.06
const MOUTH_ARC = Math.PI * 0.6
const MOUTH_OFFSET_Y = -HEAD_RADIUS * 0.25
const MOUTH_OFFSET_Z = HEAD_RADIUS * 0.92

/** Arms reach forward from the shoulders toward the steering wheel. */
const ARM_RADIUS = 0.05
const ARM_LENGTH = 0.4
const ARM_TILT = -0.9 // radians; tilts the cylinder from vertical to reach forward-down
const ARM_Z_OFFSET = BODY_HALF_D * 0.9
const ARM_OFFSET_X = COCKPIT_OFFSET_X + 0.35
const ARM_OFFSET_Y = CHASSIS_HALF_H + 0.32

/** Small steering wheel the arms reach toward. */
const STEERING_WHEEL_RADIUS = 0.16
const STEERING_WHEEL_TUBE = 0.03
const STEERING_WHEEL_OFFSET_X = COCKPIT_OFFSET_X + 0.55
const STEERING_WHEEL_OFFSET_Y = CHASSIS_HALF_H + 0.3

/** Pixel ratio cap to limit GPU load on high-DPI mobile. */
const MAX_PIXEL_RATIO = 2

// ─── Wheel spin marker (spoke) ─────────────────────────────────────────────────

/**
 * A uniform-colored disc gives no visual cue that it is spinning. To make the
 * circle wheel's rotation perceptible we parent a thin contrasting "spoke" bar to
 * each wheel mesh: it inherits the wheel's rotation.z, so it visibly sweeps
 * around as the car rolls. The spoke is shown ONLY for the circle — the square,
 * triangle and line already show their orientation through their silhouette.
 */
const SPOKE_COLOR = 0x222831 // near-black, high contrast on the coral disc

/** Spoke length as a fraction of the wheel diameter (spans the disc). */
const SPOKE_LENGTH = WHEEL_VISUAL_RADIUS * 2 * 0.9

/** Spoke thickness (metres) — thin bar. */
const SPOKE_THICKNESS = WHEEL_VISUAL_RADIUS * 0.28

/** Spoke z: just in front of the disc face so it is never z-fought or hidden. */
const SPOKE_Z = 0.55

// ─── Juice animation constants ────────────────────────────────────────────────

/**
 * Peak scale multiplier during the swap pop (applied to wheel meshes).
 * 1.35 gives a snappy but not jarring "pop".
 */
const JUICE_SCALE_PEAK = 1.35

/**
 * Total duration of the scale-pop animation in seconds.
 * Pop reaches peak at half this time, then eases back to 1.
 */
const JUICE_SCALE_DURATION = 0.25

/**
 * Total duration of the color-flash animation in seconds.
 * Briefly flashes white then settles to the shape's color.
 */
const JUICE_FLASH_DURATION = 0.18

/** Color used for the flash peak (pure white). */
const JUICE_FLASH_COLOR = 0xffffff

// ─── Sky / lighting colors ────────────────────────────────────────────────────

const SKY_COLOR = 0x87ceeb // cornflower blue
const SUN_COLOR = 0xfff7e0 // warm sunlight
const AMBIENT_SKY = 0x87cefa // sky ambient
const AMBIENT_GROUND = 0x8b6914 // ground ambient

// ─── Public types ─────────────────────────────────────────────────────────────

export interface Scene3D {
  sync(vehicle: Vehicle): void
  render(): void
}

// ─── Internal types ───────────────────────────────────────────────────────────

interface VehicleMeshes {
  group: THREE.Group
  /** Sub-group holding chassis + monigote; rotated by the chassis angle so the
   *  rider tilts with the car. Wheels stay direct children of `group`. */
  body: THREE.Group
  chassis: THREE.Mesh
  wheels: THREE.Mesh[]
  /** Per-wheel spin-marker spokes (children of the wheels); circle-only. */
  spokes: THREE.Mesh[]
  monigoteBody: THREE.Mesh
  monigoteHead: THREE.Mesh
}

/**
 * Juice animation state, tracked per shape-swap event.
 * Both timers count upward from 0; animation is active while < duration.
 */
interface JuiceState {
  /** Elapsed time in the scale-pop animation (seconds). */
  scaleElapsed: number
  /** Elapsed time in the color-flash animation (seconds). */
  flashElapsed: number
  /** Target shape color (settled state after flash). */
  targetColor: THREE.Color
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Create and return a Scene3D that renders the given course in side view.
 *
 * The renderer is appended to document.body. The scene is ready immediately;
 * call `sync(vehicle)` each frame before `render()`.
 */
export function createScene(course: Course): Scene3D {
  // ── Renderer ────────────────────────────────────────────────────────────────
  const renderer = new THREE.WebGLRenderer({ antialias: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO))
  renderer.setSize(window.innerWidth, window.innerHeight)
  renderer.setClearColor(SKY_COLOR)
  // Pin the canvas to the full viewport so other body children (draw-box, HUD)
  // can never push it out of the layout flow.
  Object.assign(renderer.domElement.style, {
    position: 'fixed',
    inset: '0',
    width: '100%',
    height: '100%',
    zIndex: '0',
  } satisfies Partial<CSSStyleDeclaration>)
  document.body.appendChild(renderer.domElement)

  // ── Scene ───────────────────────────────────────────────────────────────────
  const scene = new THREE.Scene()
  scene.background = new THREE.Color(SKY_COLOR)

  // Hemisphere light (sky from above, ground bounce from below)
  const hemi = new THREE.HemisphereLight(AMBIENT_SKY, AMBIENT_GROUND, 0.8)
  hemi.position.set(0, 1, 0)
  scene.add(hemi)

  // Directional sun light
  const sun = new THREE.DirectionalLight(SUN_COLOR, 1.2)
  sun.position.set(10, 20, 15)
  scene.add(sun)

  // ── Camera ──────────────────────────────────────────────────────────────────
  const aspect = window.innerWidth / window.innerHeight
  const halfH = CAM_HALF_HEIGHT
  const halfW = halfH * aspect
  const camera = new THREE.OrthographicCamera(-halfW, halfW, halfH, -halfH, 0.1, 200)
  camera.position.set(0, CAM_Y_OFFSET, CAM_Z)
  camera.lookAt(0, CAM_Y_OFFSET, 0)

  // ── Terrain ──────────────────────────────────────────────────────────────────
  const terrainMesh = buildTerrainMesh(course)
  terrainMesh.position.z = TERRAIN_Z
  scene.add(terrainMesh)

  const obstacleMeshes = buildObstacleMeshes(course.obstacles)
  scene.add(obstacleMeshes)

  // ── Vehicle meshes ───────────────────────────────────────────────────────────
  const vehicleMeshes = buildVehicleMeshes()
  scene.add(vehicleMeshes.group)

  // ── Resize handler ───────────────────────────────────────────────────────────
  window.addEventListener('resize', () => {
    const w = window.innerWidth
    const h = window.innerHeight
    const asp = w / h
    const hw = CAM_HALF_HEIGHT * asp
    camera.left = -hw
    camera.right = hw
    camera.top = CAM_HALF_HEIGHT
    camera.bottom = -CAM_HALF_HEIGHT
    camera.updateProjectionMatrix()
    renderer.setSize(w, h)
  })

  // ── Camera x state (lerp target) ─────────────────────────────────────────────
  let camX = course.startX
  let camY = CAM_Y_OFFSET

  // ── Shape swap tracking ───────────────────────────────────────────────────────
  // Track which shape is currently displayed so we can detect a swap each frame.
  let lastShape: ShapeId = 'circle'

  // ── Internal clock for framerate-independent juice animation ─────────────────
  const clock = new THREE.Clock()

  // Active juice state — null when no animation is running.
  let juice: JuiceState | null = null

  return {
    sync(vehicle: Vehicle): void {
      const dtSec = clock.getDelta()

      // ── Chassis ────────────────────────────────────────────────────────────
      const ct = vehicle.chassis.translation()
      const cr = vehicle.chassis.rotation()

      // Keep the group at the chassis world position so all children move
      // together; the chassis + monigote sub-group tilts with the car angle,
      // while the wheels (below) are world-positioned independently.
      vehicleMeshes.group.position.set(ct.x, ct.y, 0)
      vehicleMeshes.body.rotation.z = cr

      // ── Wheels ────────────────────────────────────────────────────────────
      for (let i = 0; i < 2; i++) {
        const wt = vehicle.wheels[i].translation()
        const wr = vehicle.wheels[i].rotation()
        const wm = vehicleMeshes.wheels[i]
        // Wheels are world-positioned: subtract group (chassis) position
        wm.position.set(wt.x - ct.x, wt.y - ct.y, WHEEL_Z)
        wm.rotation.z = wr
      }

      // ── Shape morph detection ──────────────────────────────────────────────
      const shape = vehicle.currentShape()

      if (shape !== lastShape) {
        // Swap geometry on each wheel mesh
        for (const wm of vehicleMeshes.wheels) {
          const oldGeo = wm.geometry
          wm.geometry = wheelGeometry(shape)
          oldGeo.dispose()
        }

        // Spin marker only makes sense for the circle (a featureless disc);
        // the other shapes already reveal their spin through their silhouette.
        for (const spoke of vehicleMeshes.spokes) {
          spoke.visible = shape === 'circle'
        }

        // Start juice animation
        juice = {
          scaleElapsed: 0,
          flashElapsed: 0,
          targetColor: new THREE.Color(SHAPES[shape].colorHex),
        }

        lastShape = shape
      }

      // ── Juice animation ────────────────────────────────────────────────────
      if (juice !== null) {
        juice.scaleElapsed += dtSec
        juice.flashElapsed += dtSec

        // Scale pop: ramp up to peak at t=duration/2, back down to 1 by t=duration.
        // Use a symmetric triangle wave clamped to [1, JUICE_SCALE_PEAK].
        let scale: number
        const scaleProg = Math.min(juice.scaleElapsed / JUICE_SCALE_DURATION, 1)
        if (scaleProg < 0.5) {
          // Rising: 0 → JUICE_SCALE_PEAK
          scale = 1 + (JUICE_SCALE_PEAK - 1) * (scaleProg / 0.5)
        } else {
          // Falling: JUICE_SCALE_PEAK → 1
          scale = 1 + (JUICE_SCALE_PEAK - 1) * ((1 - scaleProg) / 0.5)
        }

        // Color flash: lerp from white → targetColor over flash duration.
        const flashProg = Math.min(juice.flashElapsed / JUICE_FLASH_DURATION, 1)
        const flashColor = new THREE.Color(JUICE_FLASH_COLOR)
        flashColor.lerp(juice.targetColor, flashProg)

        for (const wm of vehicleMeshes.wheels) {
          wm.scale.set(scale, scale, scale)
          ;(wm.material as THREE.MeshLambertMaterial).color.set(flashColor)
        }

        // Mark animation done once both sub-animations have finished
        if (scaleProg >= 1 && flashProg >= 1) {
          // Snap to exact final values
          for (const wm of vehicleMeshes.wheels) {
            wm.scale.set(1, 1, 1)
            ;(wm.material as THREE.MeshLambertMaterial).color.set(juice.targetColor)
          }
          juice = null
        }
      } else {
        // No animation running: keep color synced to current shape (no cost).
        const color = new THREE.Color(SHAPES[shape].colorHex)
        for (const wm of vehicleMeshes.wheels) {
          ;(wm.material as THREE.MeshLambertMaterial).color.set(color)
        }
      }

      // ── Monigote stays fixed relative to chassis ───────────────────────────
      // Body and head are in group-local space; their local positions are set at
      // creation time and don't change (they ride the chassis group).

      // ── Camera follow ─────────────────────────────────────────────────────
      // Follow the car in BOTH axes (smooth lerp) so it stays framed on steep
      // climbs — otherwise a tall uphill carries the car out of the top of view.
      camX += (ct.x - camX) * CAM_LERP
      camY += (ct.y + CAM_Y_OFFSET - camY) * CAM_LERP
      camera.position.x = camX
      camera.position.y = camY
      camera.lookAt(camX, camY, 0)
    },

    render(): void {
      renderer.render(scene, camera)
    },
  }
}

// ─── Internal builders ────────────────────────────────────────────────────────

/**
 * Build the vehicle mesh group: a decorated low-poly kart chassis, two
 * wheels, and a charming little "monigote" driver (body + head + helmet +
 * face + arms) seated on top of the chassis.
 *
 * All meshes are in group-local space (group is repositioned each sync to
 * match the chassis rigid body position). Wheels are also in group-local space
 * to keep the position math straightforward.
 */
function buildVehicleMeshes(): VehicleMeshes {
  const group = new THREE.Group()

  // Chassis + monigote live in this sub-group so they tilt together with the
  // car's angle; wheels stay direct children of `group` (world-positioned).
  const body = new THREE.Group()
  group.add(body)

  // ── Chassis ──────────────────────────────────────────────────────────────
  // Keeps the exact physics footprint (2*CHASSIS_HALF_W x 2*CHASSIS_HALF_H x
  // 2*CHASSIS_HALF_D) so the car visually rests on its wheels correctly; the
  // "kart" charm comes entirely from the extra decoration meshes below.
  const chassisGeo = new THREE.BoxGeometry(
    CHASSIS_HALF_W * 2,
    CHASSIS_HALF_H * 2,
    CHASSIS_HALF_D * 2,
  )
  const chassisMat = new THREE.MeshLambertMaterial({ color: CAR_BODY_COLOR })
  const chassis = new THREE.Mesh(chassisGeo, chassisMat)
  chassis.position.set(0, 0, CHASSIS_Z)
  body.add(chassis)

  // ── Car decoration ───────────────────────────────────────────────────────
  // Purely cosmetic extra meshes (not part of the VehicleMeshes contract):
  // hood, front bumper, cockpit tub, windshield, rear spoiler, exhaust and a
  // racing stripe. Materials are shared across meshes of the same color —
  // cheap and never mutated at runtime.
  const trimMat = new THREE.MeshLambertMaterial({ color: CAR_TRIM_COLOR })
  const accentMat = new THREE.MeshLambertMaterial({ color: CAR_ACCENT_COLOR })

  const hood = new THREE.Mesh(
    new THREE.BoxGeometry(HOOD_HALF_W * 2, HOOD_HALF_H * 2, HOOD_HALF_D * 2),
    accentMat,
  )
  hood.position.set(HOOD_OFFSET_X, HOOD_OFFSET_Y, CHASSIS_Z)
  hood.rotation.z = -HOOD_TILT
  body.add(hood)

  const bumper = new THREE.Mesh(
    new THREE.BoxGeometry(BUMPER_HALF_W * 2, BUMPER_HALF_H * 2, BUMPER_HALF_D * 2),
    trimMat,
  )
  bumper.position.set(BUMPER_OFFSET_X, BUMPER_OFFSET_Y, CHASSIS_Z)
  body.add(bumper)

  const cockpit = new THREE.Mesh(
    new THREE.BoxGeometry(COCKPIT_HALF_W * 2, COCKPIT_HALF_H * 2, COCKPIT_HALF_D * 2),
    trimMat,
  )
  cockpit.position.set(COCKPIT_OFFSET_X, COCKPIT_OFFSET_Y, CHASSIS_Z)
  body.add(cockpit)

  const windshield = new THREE.Mesh(
    new THREE.BoxGeometry(WINDSHIELD_HALF_W * 2, WINDSHIELD_HALF_H * 2, WINDSHIELD_HALF_D * 2),
    new THREE.MeshLambertMaterial({ color: CAR_GLASS_COLOR }),
  )
  windshield.position.set(WINDSHIELD_OFFSET_X, WINDSHIELD_OFFSET_Y, CHASSIS_Z)
  windshield.rotation.z = -WINDSHIELD_TILT
  body.add(windshield)

  const spoilerStrut = new THREE.Mesh(
    new THREE.BoxGeometry(
      SPOILER_STRUT_HALF_W * 2,
      SPOILER_STRUT_HALF_H * 2,
      SPOILER_STRUT_HALF_D * 2,
    ),
    trimMat,
  )
  spoilerStrut.position.set(SPOILER_STRUT_OFFSET_X, SPOILER_STRUT_OFFSET_Y, CHASSIS_Z)
  body.add(spoilerStrut)

  const spoilerWing = new THREE.Mesh(
    new THREE.BoxGeometry(
      SPOILER_WING_HALF_W * 2,
      SPOILER_WING_HALF_H * 2,
      SPOILER_WING_HALF_D * 2,
    ),
    accentMat,
  )
  spoilerWing.position.set(SPOILER_WING_OFFSET_X, SPOILER_WING_OFFSET_Y, CHASSIS_Z)
  body.add(spoilerWing)

  const exhaust = new THREE.Mesh(
    new THREE.CylinderGeometry(EXHAUST_RADIUS, EXHAUST_RADIUS, EXHAUST_LENGTH, 8),
    trimMat,
  )
  exhaust.position.set(EXHAUST_OFFSET_X, EXHAUST_OFFSET_Y, CHASSIS_Z)
  exhaust.rotation.z = Math.PI / 2 // cylinder axis (default y) now points along x
  body.add(exhaust)

  const stripe = new THREE.Mesh(
    new THREE.BoxGeometry(STRIPE_HALF_W * 2, STRIPE_HALF_H * 2, STRIPE_HALF_D * 2),
    accentMat,
  )
  stripe.position.set(0, STRIPE_OFFSET_Y, CHASSIS_Z)
  body.add(stripe)

  // ── Wheels ───────────────────────────────────────────────────────────────
  // Start as circle wheels; geometry and color are swapped in sync() when
  // the vehicle's currentShape() changes.
  const wheels: THREE.Mesh[] = []
  const spokes: THREE.Mesh[] = []
  // One shared geometry + material for both spokes (cheap; never mutated).
  const spokeGeo = new THREE.BoxGeometry(SPOKE_LENGTH, SPOKE_THICKNESS, 0.05)
  const spokeMat = new THREE.MeshLambertMaterial({ color: SPOKE_COLOR })
  for (let i = 0; i < 2; i++) {
    const geo = wheelGeometry('circle')
    const mat = new THREE.MeshLambertMaterial({ color: SHAPES.circle.colorHex })
    const mesh = new THREE.Mesh(geo, mat)
    mesh.position.set(0, 0, WHEEL_Z)
    group.add(mesh)
    wheels.push(mesh)

    // Spin-marker spoke: child of the wheel so it inherits its rotation.z and
    // sweeps visibly as the disc rolls. Shown only for the circle (see sync()).
    const spoke = new THREE.Mesh(spokeGeo, spokeMat)
    spoke.position.set(0, 0, SPOKE_Z - WHEEL_Z) // local: sits just in front of the disc
    mesh.add(spoke)
    spokes.push(spoke)
  }

  // ── Monigote body ─────────────────────────────────────────────────────────
  const bodyGeo = new THREE.BoxGeometry(BODY_HALF_W * 2, BODY_HALF_H * 2, BODY_HALF_D * 2)
  const bodyMat = new THREE.MeshLambertMaterial({ color: DRIVER_SUIT_COLOR })
  const monigoteBody = new THREE.Mesh(bodyGeo, bodyMat)
  // Seat on top of chassis, tucked into the cockpit tub (chassis top edge = CHASSIS_HALF_H).
  monigoteBody.position.set(COCKPIT_OFFSET_X, CHASSIS_HALF_H + BODY_HALF_H, MONIGOTE_Z)
  body.add(monigoteBody)

  // ── Monigote head + face ─────────────────────────────────────────────────
  const headGeo = new THREE.SphereGeometry(HEAD_RADIUS, 8, 6)
  const headMat = new THREE.MeshLambertMaterial({ color: DRIVER_SKIN_COLOR })
  const monigoteHead = new THREE.Mesh(headGeo, headMat)
  // Sits on top of the body
  monigoteHead.position.set(
    COCKPIT_OFFSET_X,
    CHASSIS_HALF_H + BODY_HALF_H * 2 + HEAD_RADIUS,
    MONIGOTE_Z,
  )
  body.add(monigoteHead)

  // Helmet: a dome covering the top of the head, plus a small forward brim.
  // Reuses accentMat (same color as the hood/spoiler) so car and driver read
  // as one team livery.
  const helmet = new THREE.Mesh(
    new THREE.SphereGeometry(HELMET_RADIUS, 8, 6, 0, Math.PI * 2, 0, HELMET_THETA_LENGTH),
    accentMat,
  )
  helmet.position.set(0, HELMET_OFFSET_Y, 0)
  monigoteHead.add(helmet)

  const visor = new THREE.Mesh(
    new THREE.BoxGeometry(VISOR_HALF_W * 2, VISOR_HALF_H * 2, VISOR_HALF_D * 2),
    trimMat,
  )
  visor.position.set(0, VISOR_OFFSET_Y, VISOR_OFFSET_Z)
  monigoteHead.add(visor)

  // Eyes + smile sit on the camera-facing side of the head (+z) — the fixed
  // orthographic camera looks down -z, so this is the side that actually
  // reads on screen; the small +x spread also nods toward the car's +x
  // direction of travel.
  const eyeGeo = new THREE.SphereGeometry(EYE_RADIUS, 6, 6)
  for (const side of [-1, 1]) {
    const eye = new THREE.Mesh(eyeGeo, trimMat)
    eye.position.set(side * EYE_OFFSET_X, EYE_OFFSET_Y, EYE_OFFSET_Z)
    monigoteHead.add(eye)
  }

  // Smile: the bottom arc of a thin torus reads as a simple curved grin.
  const mouth = new THREE.Mesh(
    new THREE.TorusGeometry(MOUTH_RADIUS, MOUTH_TUBE, 6, 12, MOUTH_ARC),
    trimMat,
  )
  mouth.position.set(0, MOUTH_OFFSET_Y, MOUTH_OFFSET_Z)
  mouth.rotation.z = -Math.PI / 2 - MOUTH_ARC / 2 // centers the arc at the bottom of the ring
  monigoteHead.add(mouth)

  // ── Arms + steering wheel ────────────────────────────────────────────────
  // Little arms reaching forward as if holding the wheel; reuses bodyMat
  // (same suit color) since they're an extension of the torso.
  const armGeo = new THREE.CylinderGeometry(ARM_RADIUS, ARM_RADIUS, ARM_LENGTH, 6)
  for (const side of [-1, 1]) {
    const arm = new THREE.Mesh(armGeo, bodyMat)
    arm.position.set(ARM_OFFSET_X, ARM_OFFSET_Y, MONIGOTE_Z + side * ARM_Z_OFFSET)
    arm.rotation.z = ARM_TILT
    body.add(arm)
  }

  const steeringWheel = new THREE.Mesh(
    new THREE.TorusGeometry(STEERING_WHEEL_RADIUS, STEERING_WHEEL_TUBE, 6, 10),
    trimMat,
  )
  steeringWheel.position.set(STEERING_WHEEL_OFFSET_X, STEERING_WHEEL_OFFSET_Y, MONIGOTE_Z)
  body.add(steeringWheel)

  return { group, body, chassis, wheels, spokes, monigoteBody, monigoteHead }
}
