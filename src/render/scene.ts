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

/** Chassis footprint half-extents in metres (matches physics: CHASSIS_HALF_W=1, CHASSIS_HALF_H=0.3). */
const CHASSIS_HALF_W = 1.0
const CHASSIS_HALF_H = 0.3

// ─── Scooter (patinete) art constants ──────────────────────────────────────────
// Extra decoration meshes turn the plain chassis footprint into a charming
// little kick-scooter silhouette: a rounded deck, a stem rising at the front,
// and a T-shaped handlebar. They are added as children of `body` but are NOT
// part of the VehicleMeshes contract — only `chassis` itself is a tracked
// handle (it points at the deck mesh). Wheels are built and owned separately
// (see "Wheels" below) and are not touched here.

/** Deck paint — bright saturated orange. */
const SCOOTER_DECK_COLOR = 0xff8c42
/** Shared dark trim — stem body and handlebar bar. */
const SCOOTER_TRIM_COLOR = 0x2b2d42
/** Grip / collar accent color. */
const SCOOTER_ACCENT_COLOR = 0xffd166

/**
 * Deck: a capsule lying on its side so both ends read as rounded (front and
 * back of the deck) instead of hard corners. `DECK_RADIUS` sets the capsule's
 * cross-section (i.e. the deck's visual thickness); `DECK_LENGTH` is the
 * straight midsection length so the two half-sphere caps plus the midsection
 * span exactly the chassis footprint width (2 * CHASSIS_HALF_W).
 */
const DECK_RADIUS = CHASSIS_HALF_H * 0.75
const DECK_LENGTH = CHASSIS_HALF_W * 2 - DECK_RADIUS * 2
const DECK_CAP_SEGMENTS = 4
const DECK_RADIAL_SEGMENTS = 10
/** Deck vertical position: keeps the deck's underside flush with the physics
 *  wheel-mount line (-CHASSIS_HALF_H) regardless of the chosen radius. */
const DECK_OFFSET_Y = -CHASSIS_HALF_H + DECK_RADIUS

/**
 * Stem: a vertical post rising from the deck at the front (+x, above the
 * front wheel) up to the handlebar. `STEM_OFFSET_X` approximates the physics
 * front wheel's x offset (0.8) as a fraction of the chassis half-width so the
 * render layer doesn't need to import a physics constant.
 */
const STEM_RADIUS = 0.05
const STEM_HEIGHT = 0.85
const STEM_SEGMENTS = 8
const STEM_OFFSET_X = CHASSIS_HALF_W * 0.85
/** y of the deck's top surface — the stem's base and the rider's foothold. */
const STEM_BASE_Y = DECK_OFFSET_Y + DECK_RADIUS
const STEM_OFFSET_Y = STEM_BASE_Y + STEM_HEIGHT / 2

/** Collar: a short wide cylinder marking where the stem meets the deck. */
const STEM_COLLAR_RADIUS = STEM_RADIUS * 2.2
const STEM_COLLAR_HEIGHT = 0.06

/** Handlebar: a horizontal bar capping the stem, forming a "T" in side view. */
const HANDLEBAR_HALF_W = 0.22
const HANDLEBAR_HALF_H = 0.045
const HANDLEBAR_HALF_D = STEM_RADIUS * 1.6
const HANDLEBAR_OFFSET_Y = STEM_BASE_Y + STEM_HEIGHT

/** Grip knobs: small rounded caps at each end of the handlebar (the "T-bar"). */
const GRIP_RADIUS = HANDLEBAR_HALF_H * 2

// ─── Rider (blob) art constants ────────────────────────────────────────────────
// A cute rounded "soft-bean" mascot standing on the deck and holding the
// handlebar. Only `monigoteBody` and `monigoteHead` are tracked contract
// handles; everything else here (eyes, belly, arms, feet) is decoration
// parented to them or to `body`.

/** Bright saturated body color. */
const BLOB_BODY_COLOR = 0x5ec8d8
/** Lighter belly-patch color. */
const BLOB_BELLY_COLOR = 0xcdf3f7
/** Eyes + mouth color — reuses the scooter trim color so rider and scooter
 *  read as one cohesive palette. */
const BLOB_EYE_COLOR = SCOOTER_TRIM_COLOR
/** Tiny specular highlight dot on each eye. */
const BLOB_HIGHLIGHT_COLOR = 0xffffff

/** Slightly glossy finish shared by all blob parts (see MeshStandardMaterial). */
const BLOB_ROUGHNESS = 0.35
/** Eyes are glossier than the body/belly — reads as a wet, glassy highlight. */
const EYE_ROUGHNESS = 0.15
const BLOB_METALNESS = 0

/**
 * Overlap depth (metres) used so decoration meshes (head into body, etc.)
 * sink slightly into their parent instead of touching it edge-on — avoids
 * visible seams.
 */
const BLOB_EMBED = 0.03

/** Head radius (metres) — big relative to the body for a cute mascot look. */
const HEAD_RADIUS = 0.34

/** Body: an upright capsule (rounded "bean" torso). */
const BLOB_BODY_RADIUS = 0.3
const BLOB_BODY_LENGTH = 0.22
const BLOB_CAP_SEGMENTS = 4
const BLOB_RADIAL_SEGMENTS = 10
/** Stands toward the rear-middle of the deck, leaving the stem clear at the front. */
const BLOB_BODY_OFFSET_X = -CHASSIS_HALF_W * 0.3
const BLOB_BODY_OFFSET_Y = STEM_BASE_Y + BLOB_BODY_LENGTH / 2 + BLOB_BODY_RADIUS

/** Head sits on top of the body, sunk in slightly to avoid a seam. */
const BLOB_HEAD_OFFSET_Y =
  BLOB_BODY_OFFSET_Y + BLOB_BODY_LENGTH / 2 + BLOB_BODY_RADIUS + HEAD_RADIUS - BLOB_EMBED

/** Belly: a flattened patch on the camera-facing side of the body. */
const BELLY_RADIUS = BLOB_BODY_RADIUS * 0.65
/** Scale applied to the belly sphere's z-extent so it hugs the body surface. */
const BELLY_FLATTEN = 0.35
const BELLY_OFFSET_Z = BLOB_BODY_RADIUS * 0.85
const BELLY_OFFSET_Y = BLOB_BODY_OFFSET_Y - BLOB_BODY_RADIUS * 0.1

/** Eyes: two big glossy spheres on the camera-facing side of the head. */
const EYE_RADIUS = HEAD_RADIUS * 0.26
const EYE_OFFSET_X = HEAD_RADIUS * 0.42
const EYE_OFFSET_Y = HEAD_RADIUS * 0.08
const EYE_OFFSET_Z = HEAD_RADIUS * 0.88

/** Highlight dot: tiny bright sphere offset toward the light on each eye. */
const HIGHLIGHT_RADIUS = EYE_RADIUS * 0.35
const HIGHLIGHT_OFFSET_X = EYE_RADIUS * 0.4
const HIGHLIGHT_OFFSET_Y = EYE_RADIUS * 0.4
const HIGHLIGHT_OFFSET_Z = EYE_RADIUS * 0.55

/** Mouth: the bottom arc of a thin torus reads as a simple curved smile. */
const MOUTH_RADIUS = HEAD_RADIUS * 0.22
const MOUTH_TUBE = HEAD_RADIUS * 0.05
const MOUTH_ARC = Math.PI * 0.55
const MOUTH_OFFSET_Y = -HEAD_RADIUS * 0.28
const MOUTH_OFFSET_Z = HEAD_RADIUS * 0.9

/** Stub arms reach forward from the shoulders toward the handlebar. */
const ARM_RADIUS = 0.07
const ARM_LENGTH = 0.26
const ARM_CAP_SEGMENTS = 4
const ARM_RADIAL_SEGMENTS = 6
const ARM_TILT = -0.4 // radians; tilts the stub from vertical toward the (raised) handlebar
const ARM_OFFSET_X = BLOB_BODY_OFFSET_X + BLOB_BODY_RADIUS * 0.6
const ARM_OFFSET_Y = BLOB_BODY_OFFSET_Y + BLOB_BODY_LENGTH / 2
const ARM_Z_OFFSET = BLOB_BODY_RADIUS * 0.8

/** Tiny feet: flattened spheres resting on the deck under the body. */
const FOOT_RADIUS = 0.12
/** Scale applied to the foot sphere's y-extent so it reads as a squashed pad. */
const FOOT_FLATTEN = 0.55
const FOOT_OFFSET_X = BLOB_BODY_OFFSET_X
const FOOT_OFFSET_Y = STEM_BASE_Y + FOOT_RADIUS * FOOT_FLATTEN * 0.6
const FOOT_Z_OFFSET = BLOB_BODY_RADIUS * 0.55

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
 * Build the vehicle mesh group: a rounded kick-scooter (deck + stem +
 * handlebar), two wheels, and a cute rounded "blob" rider (body + head +
 * face + stub arms + feet) standing on the deck holding the handlebar.
 *
 * All meshes are in group-local space (group is repositioned each sync to
 * match the chassis rigid body position). Wheels are also in group-local space
 * to keep the position math straightforward.
 */
function buildVehicleMeshes(): VehicleMeshes {
  const group = new THREE.Group()

  // Scooter + rider live in this sub-group so they tilt together with the
  // chassis angle; wheels stay direct children of `group` (world-positioned).
  const body = new THREE.Group()
  group.add(body)

  // ── Deck ─────────────────────────────────────────────────────────────────
  // A capsule lying along x so both ends read as rounded; spans the exact
  // chassis footprint width (2 * CHASSIS_HALF_W) so it visually rests on the
  // wheels correctly. `chassis` is the tracked contract handle for this mesh.
  const deckGeo = new THREE.CapsuleGeometry(
    DECK_RADIUS,
    DECK_LENGTH,
    DECK_CAP_SEGMENTS,
    DECK_RADIAL_SEGMENTS,
  )
  deckGeo.rotateZ(Math.PI / 2) // default capsule axis is y; lay it flat along x
  const deckMat = new THREE.MeshLambertMaterial({ color: SCOOTER_DECK_COLOR })
  const chassis = new THREE.Mesh(deckGeo, deckMat)
  chassis.position.set(0, DECK_OFFSET_Y, CHASSIS_Z)
  body.add(chassis)

  // ── Stem + handlebar ─────────────────────────────────────────────────────
  // Purely cosmetic extra meshes (not part of the VehicleMeshes contract):
  // a vertical stem at the front topped by a horizontal handlebar bar with
  // grip knobs, forming a "T" in side view. Materials are shared across
  // meshes of the same color — cheap and never mutated at runtime.
  const trimMat = new THREE.MeshLambertMaterial({ color: SCOOTER_TRIM_COLOR })
  const accentMat = new THREE.MeshLambertMaterial({ color: SCOOTER_ACCENT_COLOR })

  const stemCollar = new THREE.Mesh(
    new THREE.CylinderGeometry(STEM_COLLAR_RADIUS, STEM_COLLAR_RADIUS, STEM_COLLAR_HEIGHT, STEM_SEGMENTS),
    accentMat,
  )
  stemCollar.position.set(STEM_OFFSET_X, STEM_BASE_Y, CHASSIS_Z)
  body.add(stemCollar)

  const stem = new THREE.Mesh(
    new THREE.CylinderGeometry(STEM_RADIUS, STEM_RADIUS, STEM_HEIGHT, STEM_SEGMENTS),
    trimMat,
  )
  stem.position.set(STEM_OFFSET_X, STEM_OFFSET_Y, CHASSIS_Z)
  body.add(stem)

  const handlebar = new THREE.Mesh(
    new THREE.BoxGeometry(HANDLEBAR_HALF_W * 2, HANDLEBAR_HALF_H * 2, HANDLEBAR_HALF_D * 2),
    trimMat,
  )
  handlebar.position.set(STEM_OFFSET_X, HANDLEBAR_OFFSET_Y, CHASSIS_Z)
  body.add(handlebar)

  const gripGeo = new THREE.SphereGeometry(GRIP_RADIUS, 8, 6)
  for (const side of [-1, 1]) {
    const grip = new THREE.Mesh(gripGeo, accentMat)
    grip.position.set(STEM_OFFSET_X + side * HANDLEBAR_HALF_W, HANDLEBAR_OFFSET_Y, CHASSIS_Z)
    body.add(grip)
  }

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

  // ── Blob body ────────────────────────────────────────────────────────────
  // An upright capsule reads as a chunky rounded "bean" torso. Slightly
  // glossy (MeshStandardMaterial) — the scene's hemisphere + directional
  // lights give it a soft sheen.
  const bodyGeo = new THREE.CapsuleGeometry(
    BLOB_BODY_RADIUS,
    BLOB_BODY_LENGTH,
    BLOB_CAP_SEGMENTS,
    BLOB_RADIAL_SEGMENTS,
  )
  const bodyMat = new THREE.MeshStandardMaterial({
    color: BLOB_BODY_COLOR,
    roughness: BLOB_ROUGHNESS,
    metalness: BLOB_METALNESS,
  })
  const monigoteBody = new THREE.Mesh(bodyGeo, bodyMat)
  // Stand on the deck, toward the rear-middle (front is reserved for the stem).
  monigoteBody.position.set(BLOB_BODY_OFFSET_X, BLOB_BODY_OFFSET_Y, MONIGOTE_Z)
  body.add(monigoteBody)

  // Belly patch: a flattened lighter sphere hugging the camera-facing side.
  const belly = new THREE.Mesh(
    new THREE.SphereGeometry(BELLY_RADIUS, 8, 6),
    new THREE.MeshStandardMaterial({
      color: BLOB_BELLY_COLOR,
      roughness: BLOB_ROUGHNESS,
      metalness: BLOB_METALNESS,
    }),
  )
  belly.position.set(BLOB_BODY_OFFSET_X, BELLY_OFFSET_Y, MONIGOTE_Z + BELLY_OFFSET_Z)
  belly.scale.z = BELLY_FLATTEN
  body.add(belly)

  // ── Blob head + face ─────────────────────────────────────────────────────
  // Reuses bodyMat: mascots like this read as a single-color bean with only
  // the belly patch lighter, so the head shares the body's color and finish.
  const headGeo = new THREE.SphereGeometry(HEAD_RADIUS, 10, 8)
  const monigoteHead = new THREE.Mesh(headGeo, bodyMat)
  // Sits on top of the body, sunk in slightly to avoid a visible seam.
  monigoteHead.position.set(BLOB_BODY_OFFSET_X, BLOB_HEAD_OFFSET_Y, MONIGOTE_Z)
  body.add(monigoteHead)

  // Eyes sit on the camera-facing side of the head (+z) — the fixed
  // orthographic camera looks down -z, so this is the side that actually
  // reads on screen; the small +x spread also nods toward the +x direction
  // of travel. Glossier than the body/belly for a wet, glassy look, with a
  // tiny bright highlight dot offset toward the light.
  const eyeMat = new THREE.MeshStandardMaterial({
    color: BLOB_EYE_COLOR,
    roughness: EYE_ROUGHNESS,
    metalness: BLOB_METALNESS,
  })
  const highlightMat = new THREE.MeshBasicMaterial({ color: BLOB_HIGHLIGHT_COLOR })
  const eyeGeo = new THREE.SphereGeometry(EYE_RADIUS, 8, 6)
  const highlightGeo = new THREE.SphereGeometry(HIGHLIGHT_RADIUS, 6, 6)
  for (const side of [-1, 1]) {
    const eye = new THREE.Mesh(eyeGeo, eyeMat)
    eye.position.set(side * EYE_OFFSET_X, EYE_OFFSET_Y, EYE_OFFSET_Z)
    monigoteHead.add(eye)

    const highlight = new THREE.Mesh(highlightGeo, highlightMat)
    highlight.position.set(HIGHLIGHT_OFFSET_X, HIGHLIGHT_OFFSET_Y, HIGHLIGHT_OFFSET_Z)
    eye.add(highlight)
  }

  // Mouth: the bottom arc of a thin torus reads as a simple curved smile.
  const mouth = new THREE.Mesh(
    new THREE.TorusGeometry(MOUTH_RADIUS, MOUTH_TUBE, 6, 12, MOUTH_ARC),
    eyeMat,
  )
  mouth.position.set(0, MOUTH_OFFSET_Y, MOUTH_OFFSET_Z)
  mouth.rotation.z = -Math.PI / 2 - MOUTH_ARC / 2 // centers the arc at the bottom of the ring
  monigoteHead.add(mouth)

  // ── Stub arms ────────────────────────────────────────────────────────────
  // Tiny stub arms reaching forward toward the (raised) handlebar; reuses
  // bodyMat since they're an extension of the torso.
  const armGeo = new THREE.CapsuleGeometry(ARM_RADIUS, ARM_LENGTH, ARM_CAP_SEGMENTS, ARM_RADIAL_SEGMENTS)
  for (const side of [-1, 1]) {
    const arm = new THREE.Mesh(armGeo, bodyMat)
    arm.position.set(ARM_OFFSET_X, ARM_OFFSET_Y, MONIGOTE_Z + side * ARM_Z_OFFSET)
    arm.rotation.z = ARM_TILT
    body.add(arm)
  }

  // ── Feet ─────────────────────────────────────────────────────────────────
  // Tiny flattened-sphere pads resting on the deck under the body.
  const footGeo = new THREE.SphereGeometry(FOOT_RADIUS, 8, 6)
  for (const side of [-1, 1]) {
    const foot = new THREE.Mesh(footGeo, bodyMat)
    foot.position.set(FOOT_OFFSET_X, FOOT_OFFSET_Y, MONIGOTE_Z + side * FOOT_Z_OFFSET)
    foot.scale.y = FOOT_FLATTEN
    body.add(foot)
  }

  return { group, body, chassis, wheels, spokes, monigoteBody, monigoteHead }
}
