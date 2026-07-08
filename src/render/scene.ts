/**
 * Scene3D — Three.js visual layer for Gurpil.
 *
 * Camera choice: PerspectiveCamera at a gentle 3/4 angle.
 * Rationale: the game is a side-scroller (physics on the x-y plane), but a soft
 * perspective — mostly side-on with a touch of yaw/pitch — makes the world read
 * as genuinely 3D (depth, shadows, parallax) rather than flat. The camera
 * follows the chassis in BOTH x and y via smooth lerp, and its distance is
 * derived per-aspect (requiredCameraDistance) so a minimum track width/height
 * around the car is ALWAYS visible — in portrait the camera is pushed further
 * back so the horizontal "track ahead" budget still holds.
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

/**
 * Vertical field of view of the perspective camera (degrees). Kept modest so
 * the 3/4 view reads as a gentle perspective, not a wide-angle fish-eye that
 * would distort the terrain profile and wheels.
 */
const CAM_FOV_Y = 34

/**
 * Minimum HALF-width of track the camera always shows around the car (game
 * metres) — the "track ahead" budget. Full visible width is 2× this. In
 * portrait (narrow) the required camera distance is grown so this much width
 * is still visible; in landscape the height minimum dominates.
 */
const MIN_VISIBLE_HALF_WIDTH = 15

/** Minimum HALF-height the camera always shows around the car (game metres). */
const MIN_VISIBLE_HALF_HEIGHT = 12

/**
 * View-offset direction from the look target to the camera — a GENTLE 3/4:
 * dominated by +z (side-on, so the terrain profile and wheels stay readable),
 * with a touch of +x (slight yaw → shows the front-right) and +y (slight pitch
 * → shows a bit of the top). Normalised so it can be scaled by the required
 * distance without changing the angle (the 3/4 look is identical at any aspect;
 * portrait just moves the camera further back along this same direction).
 * Yaw ≈ atan(0.12) ≈ 6.8°, pitch ≈ atan(0.20) ≈ 11.3°.
 */
const CAM_VIEW_DIR = new THREE.Vector3(0.12, 0.2, 1).normalize()

/** Camera near/far planes — far must clear the most distant parallax hill. */
const CAM_NEAR = 0.5
const CAM_FAR = 400

/**
 * Required camera-to-target distance for a viewport aspect (w/h) so that BOTH
 * minimums (MIN_VISIBLE_HALF_WIDTH, MIN_VISIBLE_HALF_HEIGHT) are guaranteed at
 * the target's depth. The visible half-height at distance d is d·tan(fovY/2)
 * and the half-width is that × aspect, so we take the tighter (larger-distance)
 * of the vertical and horizontal fits. In portrait aspect < 1, so the
 * horizontal fit dominates and the camera is pushed further back — keeping the
 * track-ahead budget met in any orientation.
 */
function requiredCameraDistance(aspect: number): number {
  const t = Math.tan(THREE.MathUtils.degToRad(CAM_FOV_Y) / 2)
  const distForHeight = MIN_VISIBLE_HALF_HEIGHT / t
  const distForWidth = MIN_VISIBLE_HALF_WIDTH / (t * aspect)
  return Math.max(distForHeight, distForWidth)
}

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

/** Bright saturated body color — sunny yellow, Fall-Guys-bean style. */
const BLOB_BODY_COLOR = 0xffd23f
/** Lighter (near-white, warm) belly-patch color. */
const BLOB_BELLY_COLOR = 0xfff8e7
/** Eyes + mouth color — dedicated near-black so the eyes pop against the
 *  bright body (rather than reusing the scooter's dark navy trim). */
const BLOB_EYE_COLOR = 0x1b1b1f
/** Tiny specular highlight dot on each eye. */
const BLOB_HIGHLIGHT_COLOR = 0xffffff

/** Glossy finish shared by all blob parts (see MeshStandardMaterial) — reads as the reference's smooth, wet-look sheen. */
const BLOB_ROUGHNESS = 0.3
/** Eyes are glossier than the body/belly — reads as a wet, glassy highlight. */
const EYE_ROUGHNESS = 0.15
const BLOB_METALNESS = 0

/** Body: a big, plump upright capsule — short length relative to its radius so
 *  it reads as a fat rounded "bean" rather than an elongated pill. */
const BLOB_BODY_RADIUS = 0.46
const BLOB_BODY_LENGTH = 0.12
const BLOB_CAP_SEGMENTS = 6
const BLOB_RADIAL_SEGMENTS = 14
/** Stands toward the rear-middle of the deck, leaving the stem clear at the front. */
const BLOB_BODY_OFFSET_X = -CHASSIS_HALF_W * 0.3
const BLOB_BODY_OFFSET_Y = STEM_BASE_Y + BLOB_BODY_LENGTH / 2 + BLOB_BODY_RADIUS

/**
 * Head radius (metres) — a fixed fraction of the body radius (~80% of its
 * width) so head and torso read as one continuous bean rather than a small
 * head on a separate body.
 */
const HEAD_RADIUS = BLOB_BODY_RADIUS * 0.8
/** Head sphere smoothness — a bigger sphere needs more segments to stay round. */
const HEAD_WIDTH_SEGMENTS = 16
const HEAD_HEIGHT_SEGMENTS = 12

/**
 * How far the head sinks into the body's top (metres) — deep enough that the
 * two meshes fuse into a single silhouette with no visible neck gap.
 */
const HEAD_EMBED = HEAD_RADIUS * 0.5

/** Head sits directly on top of the body, sunk in deeply to erase the neck. */
const BLOB_HEAD_OFFSET_Y =
  BLOB_BODY_OFFSET_Y + BLOB_BODY_LENGTH / 2 + BLOB_BODY_RADIUS + HEAD_RADIUS - HEAD_EMBED

/** Belly: a flattened patch on the camera-facing side of the body. */
const BELLY_RADIUS = BLOB_BODY_RADIUS * 0.65
/** Scale applied to the belly sphere's z-extent so it hugs the body surface. */
const BELLY_FLATTEN = 0.35
const BELLY_OFFSET_Z = BLOB_BODY_RADIUS * 0.85
const BELLY_OFFSET_Y = BLOB_BODY_OFFSET_Y - BLOB_BODY_RADIUS * 0.1

/** Eyes: two big glossy spheres on the camera-facing side of the head — sized
 *  to be clearly readable, placed high on the face and spaced apart. */
const EYE_RADIUS = HEAD_RADIUS * 0.32
const EYE_OFFSET_X = HEAD_RADIUS * 0.42
const EYE_OFFSET_Y = HEAD_RADIUS * 0.15
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

/** Stub arms reach forward from the shoulders toward the handlebar — kept
 *  small (fractions of the body radius) so they stay tiny stubs even as the
 *  body grows. */
const ARM_RADIUS = BLOB_BODY_RADIUS * 0.18
const ARM_LENGTH = BLOB_BODY_RADIUS * 0.5
const ARM_CAP_SEGMENTS = 4
const ARM_RADIAL_SEGMENTS = 6
const ARM_TILT = -0.4 // radians; tilts the stub from vertical toward the (raised) handlebar
const ARM_OFFSET_X = BLOB_BODY_OFFSET_X + BLOB_BODY_RADIUS * 0.6
const ARM_OFFSET_Y = BLOB_BODY_OFFSET_Y + BLOB_BODY_LENGTH / 2
const ARM_Z_OFFSET = BLOB_BODY_RADIUS * 0.8

/** Tiny feet: flattened spheres resting on the deck under the body — sized as
 *  a fraction of the body radius so they stay tiny stubs. */
const FOOT_RADIUS = BLOB_BODY_RADIUS * 0.28
/** Scale applied to the foot sphere's y-extent so it reads as a squashed pad. */
const FOOT_FLATTEN = 0.55
const FOOT_OFFSET_X = BLOB_BODY_OFFSET_X
const FOOT_OFFSET_Y = STEM_BASE_Y + FOOT_RADIUS * FOOT_FLATTEN * 0.6
const FOOT_Z_OFFSET = BLOB_BODY_RADIUS * 0.55

/** Pixel ratio cap to limit GPU load on high-DPI mobile. */
const MAX_PIXEL_RATIO = 2

// ─── Max-speed sparks ───────────────────────────────────────────────────────────
// A subtle particle effect that kicks in only near top speed, to signal
// "you're going as fast as this shape allows" without shouting about it.
// Sparks are emitted from the REAR wheel's ground contact and live in WORLD
// space (direct children of `scene`, not of the tilting `body` sub-group) so
// they trail behind the wheel instead of rotating with the chassis.

/**
 * Forward speed (m/s, chassis.linvel().x) above which sparks start flying.
 * The HUD's speed gauge treats MAX_DISPLAY_SPEED=8 as "full"; this is set a
 * bit below the fastest shape's actual top speed so sparks read as a
 * near/at-max-speed cue rather than firing at everyday speeds.
 */
const SPARK_SPEED_THRESHOLD = 6.5

/** Size of the reusable spark pool. Small on purpose — a sparkle, not a fire. */
const SPARK_POOL_SIZE = 12

/** Max sparks (re)spawned in a single frame while at speed — keeps it sparse. */
const SPARK_SPAWN_PER_FRAME = 1

/** Spark lifetime range (seconds). */
const SPARK_LIFETIME_MIN = 0.15
const SPARK_LIFETIME_MAX = 0.35

/** Spark size range (metres, tetrahedron "radius"). */
const SPARK_SIZE_MIN = 0.03
const SPARK_SIZE_MAX = 0.07

/** Spark ejection velocity: mostly backward (-x, trailing the rear wheel) and
 *  slightly upward, with some random spread. */
const SPARK_VEL_X_MIN = -3.5
const SPARK_VEL_X_MAX = -1.0
const SPARK_VEL_Y_MIN = 0.2
const SPARK_VEL_Y_MAX = 1.6

/** Slight downward gravity applied to sparks each frame (m/s^2), lighter than
 *  real gravity so they arc gently rather than dropping like a physics object. */
const SPARK_GRAVITY = -4

/** Offset from the rear wheel's centre to its ground-contact point (metres). */
const SPARK_EMIT_OFFSET_X = -0.15
const SPARK_EMIT_OFFSET_Y = -WHEEL_VISUAL_RADIUS * 0.9

/** z of the spark sprites — same neighbourhood as the wheels so they read as
 *  coming off the ground contact, without z-fighting the disc. */
const SPARK_Z = 0.45

/** Bright warm spark colors — sparks pick one of these at spawn for variety. */
const SPARK_COLORS = [0xfff3b0, 0xffd23f, 0xff9f1c]

interface Spark {
  mesh: THREE.Mesh
  velocity: THREE.Vector3
  /** Seconds remaining before this spark expires and can be respawned. Zero
   *  (or less) means the spark is dead and available for respawn. */
  life: number
  /** Total lifetime this spark was spawned with, for fade/shrink easing. */
  maxLife: number
  /** Size (scale) this spark was spawned with, for the shrink-over-life ease. */
  baseSize: number
}

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

const SKY_COLOR = 0x87ceeb // cornflower blue — renderer clear-color fallback
const SUN_COLOR = 0xfff7e0 // warm sunlight
const SUN_INTENSITY = 1.3
const HEMI_INTENSITY = 0.85
const AMBIENT_SKY = 0x87cefa // sky ambient
const AMBIENT_GROUND = 0x8b6914 // ground ambient

/** Vertical gradient sky: deeper blue up top fading to a pale horizon band. */
const SKY_TOP_COLOR = '#5ba8e6'
const SKY_HORIZON_COLOR = '#d6ecf7'
/** Resolution of the 1×N gradient texture painted onto scene.background. */
const SKY_GRADIENT_HEIGHT = 256

// ─── Atmosphere (fog) ───────────────────────────────────────────────────────────
// Linear fog tinted to the sky's horizon so distance fades seamlessly into the
// sky. FOG_NEAR is set beyond the largest camera-to-vehicle distance (portrait
// pushes the camera to ≈87 units back) so the car and nearby track are NEVER
// fogged; only the far parallax hills fade.

const FOG_COLOR = 0xd6ecf7 // matches SKY_HORIZON_COLOR
const FOG_NEAR = 105
const FOG_FAR = 320

// ─── Directional-light shadows ──────────────────────────────────────────────────
// The sun casts soft shadows. Both the light and its target follow the vehicle
// each frame so the (modest) shadow map always covers the car and keeps its
// shadow crisp. Offsets are relative to the vehicle position.

const SUN_OFFSET_X = 14
const SUN_OFFSET_Y = 24
const SUN_OFFSET_Z = 12
/** Shadow map resolution — modest (1024²) to stay cheap on mobile. */
const SHADOW_MAP_SIZE = 1024
/** Half-size of the (orthographic) shadow camera around the vehicle (metres). */
const SHADOW_CAM_HALF = 18
const SHADOW_NEAR = 1
const SHADOW_FAR = 90
/** Depth/normal bias to suppress shadow acne on the near-flat terrain top. */
const SHADOW_BIAS = -0.0004
const SHADOW_NORMAL_BIAS = 0.02

// ─── Vehicle material finish ────────────────────────────────────────────────────

/** Scooter deck/stem/handlebar finish — a light satin sheen. */
const SCOOTER_ROUGHNESS = 0.55
const SCOOTER_METALNESS = 0.1
/** Wheel finish — a touch glossier so the shapes catch the sun. */
const WHEEL_ROUGHNESS = 0.45
const WHEEL_METALNESS = 0.05

// ─── Parallax background hills ────────────────────────────────────────────────────
// 2–3 layers of soft, hazy hill silhouettes far in -z. Lighter/bluer as they
// recede (atmospheric perspective) so they fade into the fog. Each layer follows
// the camera by a parallax factor (< 1): far layers track the camera more
// closely (appear more distant / move less relative to it), near layers less.
// Flat unlit silhouettes (fog-affected) — cheap, built once, only repositioned.

/** Half-width of each hill silhouette (metres) — wide enough to always cover
 *  the viewport at its depth across every aspect, given the parallax drift. */
const HILL_HALF_WIDTH = 240
/** Number of segments along a hill's wavy top edge. */
const HILL_SEGMENTS = 48
/** How far a hill extends below its baseline (metres) so its bottom is always
 *  off-screen below the terrain — no gap ever shows under a layer. */
const HILL_SKIRT_DEPTH = 80

interface HillLayerSpec {
  /** z depth (world) — more negative = further back. */
  z: number
  /** Flat silhouette color (lighter/bluer with distance). */
  color: number
  /** Peak bump height of the wavy top edge (metres). */
  amplitude: number
  /** Baseline y offset added on top of the parallax-followed camera y. */
  baseY: number
  /** Parallax follow factor in [0,1): far → closer to 1 (moves less on screen). */
  parallax: number
  /** Spatial frequency of the primary bump wave (radians per metre). */
  frequency: number
  /** Phase offset (radians) so layers don't share identical crests. */
  phase: number
}

/** Three layers, near → far. Colors trend toward the horizon/fog color. */
const HILL_LAYERS: HillLayerSpec[] = [
  { z: -50, color: 0x7fb4d8, amplitude: 6, baseY: -4, parallax: 0.72, frequency: 0.05, phase: 0 },
  { z: -80, color: 0xa6cce0, amplitude: 8, baseY: 1, parallax: 0.82, frequency: 0.035, phase: 1.7 },
  { z: -110, color: 0xc4dcec, amplitude: 11, baseY: 6, parallax: 0.91, frequency: 0.025, phase: 3.1 },
]

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
  // Soft shadows — the biggest 3D-pop lever. PCF-soft keeps edges gentle at a
  // modest map size (mobile-friendly).
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFSoftShadowMap
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
  // Vertical gradient sky (deep blue → pale horizon) instead of a flat color,
  // plus horizon-tinted fog so distance reads with depth.
  scene.background = buildSkyGradientTexture()
  scene.fog = new THREE.Fog(FOG_COLOR, FOG_NEAR, FOG_FAR)

  // Hemisphere light (sky from above, ground bounce from below)
  const hemi = new THREE.HemisphereLight(AMBIENT_SKY, AMBIENT_GROUND, HEMI_INTENSITY)
  hemi.position.set(0, 1, 0)
  scene.add(hemi)

  // Directional sun light — casts the soft shadows. Both the light and its
  // target follow the vehicle each frame (see sync) so the shadow map stays
  // centred on the car.
  const sun = new THREE.DirectionalLight(SUN_COLOR, SUN_INTENSITY)
  sun.position.set(SUN_OFFSET_X, SUN_OFFSET_Y, SUN_OFFSET_Z)
  sun.castShadow = true
  sun.shadow.mapSize.set(SHADOW_MAP_SIZE, SHADOW_MAP_SIZE)
  sun.shadow.bias = SHADOW_BIAS
  sun.shadow.normalBias = SHADOW_NORMAL_BIAS
  const shadowCam = sun.shadow.camera
  shadowCam.near = SHADOW_NEAR
  shadowCam.far = SHADOW_FAR
  shadowCam.left = -SHADOW_CAM_HALF
  shadowCam.right = SHADOW_CAM_HALF
  shadowCam.top = SHADOW_CAM_HALF
  shadowCam.bottom = -SHADOW_CAM_HALF
  shadowCam.updateProjectionMatrix()
  scene.add(sun)
  scene.add(sun.target)

  // ── Parallax background hills ──────────────────────────────────────────────────
  const hills = buildHillLayers()
  for (const hill of hills) scene.add(hill.mesh)

  // ── Camera ──────────────────────────────────────────────────────────────────
  const aspect = window.innerWidth / window.innerHeight
  let camDist = requiredCameraDistance(aspect)
  const camera = new THREE.PerspectiveCamera(CAM_FOV_Y, aspect, CAM_NEAR, CAM_FAR)
  // Reusable scratch vectors — no per-frame allocation.
  const camTarget = new THREE.Vector3(course.startX, CAM_Y_OFFSET, 0)
  const camPos = new THREE.Vector3()
  camPos.copy(CAM_VIEW_DIR).multiplyScalar(camDist).add(camTarget)
  camera.position.copy(camPos)
  camera.lookAt(camTarget)

  // ── Terrain ──────────────────────────────────────────────────────────────────
  const terrainMesh = buildTerrainMesh(course)
  terrainMesh.position.z = TERRAIN_Z
  terrainMesh.receiveShadow = true
  scene.add(terrainMesh)

  const obstacleMeshes = buildObstacleMeshes(course.obstacles)
  scene.add(obstacleMeshes)

  // ── Vehicle meshes ───────────────────────────────────────────────────────────
  const vehicleMeshes = buildVehicleMeshes()
  // Vehicle casts (and receives, so the rider shadows the deck) soft shadows.
  vehicleMeshes.group.traverse((obj) => {
    const mesh = obj as THREE.Mesh
    if (mesh.isMesh) {
      mesh.castShadow = true
      mesh.receiveShadow = true
    }
  })
  scene.add(vehicleMeshes.group)

  // ── Max-speed sparks ─────────────────────────────────────────────────────────
  // World-space pool: added directly to `scene` (not to vehicleMeshes.group/body)
  // so sparks stay put in the world and trail behind the rear wheel instead of
  // moving/tilting with the chassis.
  const sparks = buildSparkPool()
  for (const spark of sparks) scene.add(spark.mesh)

  // ── Resize handler ───────────────────────────────────────────────────────────
  window.addEventListener('resize', () => {
    const w = window.innerWidth
    const h = window.innerHeight
    const aspectNow = w / h
    // Recompute the follow distance so the min track-width/height guarantee
    // holds at the new aspect (portrait pushes the camera further back).
    camDist = requiredCameraDistance(aspectNow)
    camera.aspect = aspectNow
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
      let rearWheelX = 0
      let rearWheelY = 0
      for (let i = 0; i < 2; i++) {
        const wt = vehicle.wheels[i].translation()
        const wr = vehicle.wheels[i].rotation()
        const wm = vehicleMeshes.wheels[i]
        // Wheels are world-positioned: subtract group (chassis) position
        wm.position.set(wt.x - ct.x, wt.y - ct.y, WHEEL_Z)
        wm.rotation.z = wr
        if (i === 0) {
          // wheels[0] is the rear wheel — remember its world position for sparks.
          rearWheelX = wt.x
          rearWheelY = wt.y
        }
      }

      // ── Max-speed sparks ────────────────────────────────────────────────────
      const forwardSpeed = vehicle.chassis.linvel().x
      updateSparks(sparks, forwardSpeed, rearWheelX, rearWheelY, dtSec)

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
          ;(wm.material as THREE.MeshStandardMaterial).color.set(flashColor)
        }

        // Mark animation done once both sub-animations have finished
        if (scaleProg >= 1 && flashProg >= 1) {
          // Snap to exact final values
          for (const wm of vehicleMeshes.wheels) {
            wm.scale.set(1, 1, 1)
            ;(wm.material as THREE.MeshStandardMaterial).color.set(juice.targetColor)
          }
          juice = null
        }
      } else {
        // No animation running: keep color synced to current shape (no cost).
        const color = new THREE.Color(SHAPES[shape].colorHex)
        for (const wm of vehicleMeshes.wheels) {
          ;(wm.material as THREE.MeshStandardMaterial).color.set(color)
        }
      }

      // ── Monigote stays fixed relative to chassis ───────────────────────────
      // Body and head are in group-local space; their local positions are set at
      // creation time and don't change (they ride the chassis group).

      // ── Camera follow ─────────────────────────────────────────────────────
      // Follow the car in BOTH axes (smooth lerp) so it stays framed on steep
      // climbs — otherwise a tall uphill carries the car out of the top of view.
      // The camera sits at target + CAM_VIEW_DIR·camDist (the 3/4 offset); the
      // distance guarantees the min track width/height around the car for the
      // current aspect (recomputed on resize).
      camX += (ct.x - camX) * CAM_LERP
      camY += (ct.y + CAM_Y_OFFSET - camY) * CAM_LERP
      camTarget.set(camX, camY, 0)
      camPos.copy(CAM_VIEW_DIR).multiplyScalar(camDist).add(camTarget)
      camera.position.copy(camPos)
      camera.lookAt(camTarget)

      // ── Sun + shadow follow ────────────────────────────────────────────────
      // Keep the light (and thus its shadow camera) centred on the vehicle so
      // the modest shadow map stays crisp wherever the car is on the course.
      sun.position.set(ct.x + SUN_OFFSET_X, ct.y + SUN_OFFSET_Y, SUN_OFFSET_Z)
      sun.target.position.set(ct.x, ct.y, 0)
      sun.target.updateMatrixWorld()

      // ── Parallax hills ─────────────────────────────────────────────────────
      // Each layer follows the camera by its parallax factor: far layers track
      // more closely (appear more distant), near layers less (drift more).
      for (const hill of hills) {
        hill.mesh.position.x = camX * hill.parallax
        hill.mesh.position.y = camY * hill.parallax + hill.baseY
      }
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
  const deckMat = new THREE.MeshStandardMaterial({
    color: SCOOTER_DECK_COLOR,
    roughness: SCOOTER_ROUGHNESS,
    metalness: SCOOTER_METALNESS,
  })
  const chassis = new THREE.Mesh(deckGeo, deckMat)
  chassis.position.set(0, DECK_OFFSET_Y, CHASSIS_Z)
  body.add(chassis)

  // ── Stem + handlebar ─────────────────────────────────────────────────────
  // Purely cosmetic extra meshes (not part of the VehicleMeshes contract):
  // a vertical stem at the front topped by a horizontal handlebar bar with
  // grip knobs, forming a "T" in side view. Materials are shared across
  // meshes of the same color — cheap and never mutated at runtime.
  const trimMat = new THREE.MeshStandardMaterial({
    color: SCOOTER_TRIM_COLOR,
    roughness: SCOOTER_ROUGHNESS,
    metalness: SCOOTER_METALNESS,
  })
  const accentMat = new THREE.MeshStandardMaterial({
    color: SCOOTER_ACCENT_COLOR,
    roughness: SCOOTER_ROUGHNESS,
    metalness: SCOOTER_METALNESS,
  })

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
  const spokeMat = new THREE.MeshStandardMaterial({
    color: SPOKE_COLOR,
    roughness: SCOOTER_ROUGHNESS,
    metalness: SCOOTER_METALNESS,
  })
  for (let i = 0; i < 2; i++) {
    const geo = wheelGeometry('circle')
    const mat = new THREE.MeshStandardMaterial({
      color: SHAPES.circle.colorHex,
      roughness: WHEEL_ROUGHNESS,
      metalness: WHEEL_METALNESS,
    })
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
  const headGeo = new THREE.SphereGeometry(HEAD_RADIUS, HEAD_WIDTH_SEGMENTS, HEAD_HEIGHT_SEGMENTS)
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

/** A background hill layer plus the parallax params used to reposition it. */
interface HillLayer {
  mesh: THREE.Mesh
  parallax: number
  baseY: number
}

/**
 * Build the vertical gradient sky as a 1×N canvas texture (deep blue up top
 * fading to a pale horizon band), painted onto scene.background. Cheap: one
 * small texture, generated once.
 */
function buildSkyGradientTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 1
  canvas.height = SKY_GRADIENT_HEIGHT
  const ctx = canvas.getContext('2d')!
  const grad = ctx.createLinearGradient(0, 0, 0, SKY_GRADIENT_HEIGHT)
  grad.addColorStop(0, SKY_TOP_COLOR)
  grad.addColorStop(1, SKY_HORIZON_COLOR)
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, 1, SKY_GRADIENT_HEIGHT)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

/**
 * Build the parallax hill layers: soft, flat, unlit silhouettes far in -z.
 * Each is a wide bumpy-topped shape; being flat + MeshBasicMaterial (fog-
 * affected) they fade into the fog with distance. Built once; only their x/y
 * are updated each frame (see sync) for the parallax scroll.
 */
function buildHillLayers(): HillLayer[] {
  const layers: HillLayer[] = []
  for (const spec of HILL_LAYERS) {
    const shape = new THREE.Shape()
    const topAt = (x: number): number =>
      spec.amplitude *
      (0.6 * Math.sin(spec.frequency * x + spec.phase) +
        0.4 * Math.sin(spec.frequency * 2.3 * x + spec.phase * 1.7))
    shape.moveTo(-HILL_HALF_WIDTH, -HILL_SKIRT_DEPTH)
    shape.lineTo(-HILL_HALF_WIDTH, topAt(-HILL_HALF_WIDTH))
    for (let s = 1; s <= HILL_SEGMENTS; s++) {
      const x = -HILL_HALF_WIDTH + (2 * HILL_HALF_WIDTH * s) / HILL_SEGMENTS
      shape.lineTo(x, topAt(x))
    }
    shape.lineTo(HILL_HALF_WIDTH, -HILL_SKIRT_DEPTH)
    shape.closePath()

    const geo = new THREE.ShapeGeometry(shape)
    const mat = new THREE.MeshBasicMaterial({ color: spec.color, fog: true })
    const mesh = new THREE.Mesh(geo, mat)
    mesh.position.z = spec.z
    layers.push({ mesh, parallax: spec.parallax, baseY: spec.baseY })
  }
  return layers
}

/**
 * Build the reusable spark pool: small tetrahedra, all dead (invisible) at
 * start. All sparks share one geometry; each gets its own material instance
 * (created once, here) since opacity/fade differs per spark over its life.
 */
function buildSparkPool(): Spark[] {
  const geometry = new THREE.TetrahedronGeometry(1)
  const sparks: Spark[] = []
  for (let i = 0; i < SPARK_POOL_SIZE; i++) {
    const material = new THREE.MeshBasicMaterial({
      color: SPARK_COLORS[i % SPARK_COLORS.length],
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })
    const mesh = new THREE.Mesh(geometry, material)
    mesh.visible = false
    sparks.push({ mesh, velocity: new THREE.Vector3(), life: 0, maxLife: 1, baseSize: SPARK_SIZE_MIN })
  }
  return sparks
}

/**
 * Advance the spark pool by one frame: integrate every live spark (move,
 * gravity, fade + shrink over its remaining life, hide once expired), and —
 * only while at/near max speed — respawn a few expired sparks at the rear
 * wheel's ground contact with a small random backward+upward kick.
 *
 * Sparks live in world space, so `rearWheelX`/`rearWheelY` must already be
 * world coordinates (not group-local).
 */
function updateSparks(sparks: Spark[], forwardSpeed: number, rearWheelX: number, rearWheelY: number, dtSec: number): void {
  const atMaxSpeed = Math.abs(forwardSpeed) >= SPARK_SPEED_THRESHOLD
  let spawnedThisFrame = 0

  for (const spark of sparks) {
    if (spark.life > 0) {
      // ── Integrate a live spark ──────────────────────────────────────────
      spark.life -= dtSec
      spark.velocity.y += SPARK_GRAVITY * dtSec
      spark.mesh.position.x += spark.velocity.x * dtSec
      spark.mesh.position.y += spark.velocity.y * dtSec

      if (spark.life <= 0) {
        spark.mesh.visible = false
      } else {
        // Ease out over the remaining life: shrink and fade toward 0.
        const lifeFrac = spark.life / spark.maxLife
        spark.mesh.scale.setScalar(spark.baseSize * lifeFrac)
        ;(spark.mesh.material as THREE.MeshBasicMaterial).opacity = lifeFrac
      }
      continue
    }

    // ── Respawn an expired spark, only while genuinely at max speed ────────
    if (atMaxSpeed && spawnedThisFrame < SPARK_SPAWN_PER_FRAME) {
      spawnedThisFrame++

      spark.maxLife = THREE.MathUtils.randFloat(SPARK_LIFETIME_MIN, SPARK_LIFETIME_MAX)
      spark.life = spark.maxLife
      spark.baseSize = THREE.MathUtils.randFloat(SPARK_SIZE_MIN, SPARK_SIZE_MAX)

      spark.velocity.set(
        THREE.MathUtils.randFloat(SPARK_VEL_X_MIN, SPARK_VEL_X_MAX),
        THREE.MathUtils.randFloat(SPARK_VEL_Y_MIN, SPARK_VEL_Y_MAX),
        0,
      )
      spark.mesh.position.set(rearWheelX + SPARK_EMIT_OFFSET_X, rearWheelY + SPARK_EMIT_OFFSET_Y, SPARK_Z)
      spark.mesh.scale.setScalar(spark.baseSize)
      ;(spark.mesh.material as THREE.MeshBasicMaterial).opacity = 1
      spark.mesh.visible = true
    }
  }
}
