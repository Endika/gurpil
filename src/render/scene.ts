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

/** Monigote body half-extents (metres). */
const BODY_HALF_W = 0.22
const BODY_HALF_H = 0.35

/** Monigote head radius (metres). */
const HEAD_RADIUS = 0.2

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
      // together; the chassis mesh itself sits at the group-local origin.
      vehicleMeshes.group.position.set(ct.x, ct.y, 0)
      vehicleMeshes.chassis.position.set(0, 0, CHASSIS_Z)
      vehicleMeshes.chassis.rotation.z = cr

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
      camX += (ct.x - camX) * CAM_LERP
      camera.position.x = camX
      camera.lookAt(camX, CAM_Y_OFFSET, 0)
    },

    render(): void {
      renderer.render(scene, camera)
    },
  }
}

// ─── Internal builders ────────────────────────────────────────────────────────

/**
 * Build the vehicle mesh group: chassis box, two wheels, and a simple low-poly
 * "monigote" (body box + head sphere) seated on top of the chassis.
 *
 * All meshes are in group-local space (group is repositioned each sync to
 * match the chassis rigid body position). Wheels are also in group-local space
 * to keep the position math straightforward.
 */
function buildVehicleMeshes(): VehicleMeshes {
  const group = new THREE.Group()

  // ── Chassis ──────────────────────────────────────────────────────────────
  const chassisGeo = new THREE.BoxGeometry(CHASSIS_HALF_W * 2, CHASSIS_HALF_H * 2, 1.2)
  const chassisMat = new THREE.MeshLambertMaterial({ color: 0xe74c3c }) // red
  const chassis = new THREE.Mesh(chassisGeo, chassisMat)
  chassis.position.set(0, 0, CHASSIS_Z)
  group.add(chassis)

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
  const bodyGeo = new THREE.BoxGeometry(BODY_HALF_W * 2, BODY_HALF_H * 2, 0.5)
  const bodyMat = new THREE.MeshLambertMaterial({ color: 0x3498db }) // blue shirt
  const monigoteBody = new THREE.Mesh(bodyGeo, bodyMat)
  // Seat on top of chassis (chassis top edge = CHASSIS_HALF_H)
  monigoteBody.position.set(0, CHASSIS_HALF_H + BODY_HALF_H, MONIGOTE_Z)
  group.add(monigoteBody)

  // ── Monigote head ─────────────────────────────────────────────────────────
  const headGeo = new THREE.SphereGeometry(HEAD_RADIUS, 8, 6)
  const headMat = new THREE.MeshLambertMaterial({ color: 0xf5cba7 }) // skin
  const monigoteHead = new THREE.Mesh(headGeo, headMat)
  // Sits on top of the body
  monigoteHead.position.set(0, CHASSIS_HALF_H + BODY_HALF_H * 2 + HEAD_RADIUS, MONIGOTE_Z)
  group.add(monigoteHead)

  return { group, chassis, wheels, spokes, monigoteBody, monigoteHead }
}
