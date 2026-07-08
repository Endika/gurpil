/**
 * Terrain mesh builder — converts a Course polyline into a Three.js 3D mesh.
 *
 * The ground is a continuous extruded strip following the polyline, given depth
 * in z so it reads as 3D in the side view. Each segment between two consecutive
 * ground points becomes a quad (two triangles) forming a wall face, plus a top
 * quad for the surface. Color varies per terrain zone for visual clarity.
 *
 * Obstacles render as log trunks or rock boulders (per-obstacle `variant`),
 * placed at the obstacle positions.
 *
 * Pure geometry builder: no DOM, no Rapier, no physics state.
 */

import * as THREE from 'three'
import type { Course, Obstacle } from '../core/course'
import type { Point } from '../core/classifyStroke'
import type { Theme } from '../core/theme'

// ─── Constants ────────────────────────────────────────────────────────────────

/** How far the terrain strip extends in the z direction (metres, visual depth). */
export const TERRAIN_DEPTH = 4

/** Y extent of the "wall" face below each surface point (metres, visual depth). */
const TERRAIN_WALL_DEPTH = 8

/**
 * Visual footprint radius shared by both obstacle variants — kept close to the
 * physics ball's EGG_RADIUS (0.5, see `physics/world.ts`) so the collider reads
 * as fair: what you see is roughly what you hit. Purely visual; the collider
 * itself never changes.
 */
const EGG_VISUAL_RADIUS = 0.6

/**
 * Physically-based material tuning. Terrain is rough (matte ground); obstacles
 * are a touch glossier so they catch the sun. metalness stays 0 (non-metallic).
 */
const TERRAIN_ROUGHNESS = 0.9
const TERRAIN_METALNESS = 0

// ─── Obstacle variant geometry/material tuning ────────────────────────────────

/** Log (fallen tree trunk) cylinder: radius matches EGG_VISUAL_RADIUS, length
 *  spans across the track depth (TERRAIN_DEPTH) so it reads as a trunk lying
 *  across the road rather than a barrel standing on it. */
const LOG_RADIUS = EGG_VISUAL_RADIUS
const LOG_LENGTH = TERRAIN_DEPTH
const LOG_RADIAL_SEGMENTS = 10
const LOG_ROUGHNESS = 0.95
const LOG_METALNESS = 0

/** Rock (boulder): an irregular icosahedron, jittered per-vertex so it doesn't
 *  read as a perfect gem — jitter is derived from each vertex's own position
 *  (deterministic, no Math.random) so the mesh never flickers on rebuild. */
const ROCK_RADIUS = EGG_VISUAL_RADIUS
const ROCK_DETAIL = 1
const ROCK_JITTER_AMOUNT = 0.12
const ROCK_ROUGHNESS = 1
const ROCK_METALNESS = 0

/**
 * z of the egg obstacle meshes — the SAME shared z-plane the vehicle rides on
 * (CHASSIS_Z/WHEEL_Z/MONIGOTE_Z = 0 in scene.ts). The road (this strip's top
 * surface) is positioned in scene.ts, via TERRAIN_Z/ROAD_FRONT_MARGIN, to
 * straddle that same z=0 plane, so an egg sitting here reads as resting ON
 * the road exactly like the vehicle does — not hanging out over its front
 * edge (the earlier "floats/overhangs past the cliff" bug affected both).
 */
const EGG_Z = 0

/**
 * z of the terrain strip's FRONT face (the face nearest the camera), in the
 * mesh's LOCAL space — i.e. before scene.ts applies `terrainMesh.position.z`
 * (TERRAIN_Z) to place the strip in the world.
 *
 * This local origin is arbitrary in isolation; what matters is the resulting
 * WORLD-space front edge, which scene.ts pins to a small, named margin
 * (ROAD_FRONT_MARGIN) just ahead of the vehicle/egg shared z=0 plane — see
 * the TERRAIN_Z doc comment in scene.ts for the full placement rationale
 * (straddling the road depth around the vehicle while keeping the front wall
 * too close to the camera to occlude the wheels).
 */
export const TERRAIN_FRONT_Z = 0.05

/** z of the terrain strip's BACK face (extruded away from the camera). */
const TERRAIN_BACK_Z = TERRAIN_FRONT_Z - TERRAIN_DEPTH

// ─── Foreground apron ─────────────────────────────────────────────────────────

/**
 * The road's front edge used to present a single sheer wall dropping straight
 * down (TERRAIN_WALL_DEPTH) — reading as a CLIFF/PRECIPICE right under the car
 * at this 3/4 camera. We now skin the front with a gentle grassy APRON that
 * slopes from the front-top edge DOWN and TOWARD the camera (+z), so the near
 * edge reads as a planted bank, not a ledge over a void. The old vertical wall
 * is kept purely to close the geometry underneath — the apron occludes it from
 * every on-screen angle.
 *
 * Occlusion safety: the apron's HIGHEST point is the road's own front-top edge
 * (at ground level, world z = ROAD_FRONT_MARGIN); every other apron vertex is
 * BELOW that and further toward the camera. At the camera's fixed, near-side-on
 * 3/4 angle (slight downward pitch) the line of sight to the wheel/egg ground
 * contact (at z=0) passes ABOVE the entire apron, so the apron never occludes
 * the wheels, chassis, rider or egg obstacles — exactly like the old front-top
 * edge it replaces, which already grazed just above the wheel-contact sightline.
 */
/** How far the apron reaches toward the camera (+z) from the front edge (m). */
export const APRON_RUN = 2.5
/** How far the apron's near edge drops below the front-top edge (m). */
export const APRON_DROP = 3
/** Apron-near vertices are darkened vs the zone color → a shaded-bank gradient
 *  that gives the slope depth instead of a flat card. */
const APRON_DARKEN = 0.72

// ─── Ground backdrop ──────────────────────────────────────────────────────────

/**
 * A large, continuous ground plane filling the space BEHIND and BELOW the road
 * out to the parallax hills, so the world has a real floor: the road no longer
 * reads as a strip floating over a void, and the roadside forest/scenery reads
 * as planted on ground rather than marching off to infinity. It sits just below
 * the road surface and starts at the road's back edge, extending far back in z
 * (past the distant forest band) and well beyond the course in x; fog fades its
 * far reaches into the horizon exactly like the hills. Being behind (z ≤ road
 * back edge) and below the play plane, it never occludes the vehicle/track.
 */
const GROUND_BACKDROP_Y = -0.25
/** Front edge (world z) — meets the road strip's back edge (ROAD_BACK_EDGE_Z in
 *  scenery.ts / TERRAIN back edge) so there's no gap behind the road. */
const GROUND_BACKDROP_FRONT_Z = -3.5
/** Back edge (world z) — past the distant forest band (~-125) and hills so it
 *  always underlies them; its far reach is fully fogged before it ends. */
const GROUND_BACKDROP_BACK_Z = -170
/** How far the plane extends past startX / finishX (m) — comfortably beyond the
 *  frustum's width at the far ground depth for any aspect, so the course
 *  start/finish never reveal a bare edge. */
const GROUND_BACKDROP_X_MARGIN = 260
const GROUND_BACKDROP_ROUGHNESS = 1

/**
 * How far the terrain strip's BACK-edge vertex colors (top-back / bot-back,
 * at TERRAIN_BACK_Z) shift toward GROUND_BACKDROP_COLOR, vs. the strip's
 * FRONT edge which stays the true zone color (see terrainColorAt). Under the
 * 3/4 camera the strip's top face is the only thing separating the terrain
 * zone color (e.g. rocky/mud brown) from the green ground backdrop it butts
 * up against at the back edge — with both edges the same flat zone color that
 * boundary read as an abrupt cut. Blending the back edge toward the backdrop
 * color turns the top face into a gradient across its own depth, so the zone
 * color has already faded most of the way to the backdrop's green by the time
 * it reaches that seam. Pure vertex-color change: no new geometry, no effect
 * on collision/camera/gameplay.
 */
const BACK_EDGE_BACKDROP_BLEND = 0.65

// ─── Terrain color zones ──────────────────────────────────────────────────────

/**
 * Color the terrain strip by x position to match the course zones, reading the
 * per-zone palette from the active `theme` (the single source of truth for
 * environment color — see core/theme.ts). Returns a hex color number.
 */
export function terrainColorAt(x: number, theme: Theme): number {
  const t = theme.terrain
  if (x < 20) return t.flat // flat
  if (x < 50) return t.rocky // rocky
  if (x < 90) return t.uphill // uphill
  if (x < 130) return t.mud // mud
  if (x < 170) return t.ice // ice
  if (x < 210) return t.eggs // eggs zone
  return t.runOut // run-out
}

// ─── Pure geometry helpers ────────────────────────────────────────────────────

/**
 * Build a flat strip of vertices and indices from a polyline.
 *
 * For each pair of consecutive ground points (a, b) we emit a quad:
 *   - Top face: a_front, b_front, a_back, b_back   (y = ground y)
 *   - Wall face: front-bottom-a, front-bottom-b at y = groundY - TERRAIN_WALL_DEPTH
 *
 * Returns arrays ready for a THREE.BufferGeometry.
 *
 * This function is pure (no Three.js constructors) and is exported for testing.
 */
export function buildTerrainStrip(ground: Point[], theme: Theme): {
  positions: Float32Array
  colors: Float32Array
  indices: Uint32Array
} {
  const n = ground.length
  if (n < 2) {
    return {
      positions: new Float32Array(0),
      colors: new Float32Array(0),
      indices: new Uint32Array(0),
    }
  }

  const zFront = TERRAIN_FRONT_Z
  const zBack = TERRAIN_BACK_Z
  const wallBottom = -TERRAIN_WALL_DEPTH
  const zApron = zFront + APRON_RUN
  // Built once (not per-point) — see BACK_EDGE_BACKDROP_BLEND doc comment.
  const backdropColor = new THREE.Color(theme.groundBackdrop)

  // Per point i we emit 5 vertices:
  //   - top edge:  front (zFront) + back (zBack), at y = ground y
  //   - bottom edge: front + back, at y = wallBottom (closes the strip underside)
  //   - apron near: (y - APRON_DROP) at zApron — the foreground grass bank
  // Total: 5*n verts. Each segment (n-1) emits 3 quads (top, front wall, apron)
  // → 3 quads × 2 tris × 3 verts = 18 indices per segment.

  const vertsPerPoint = 5
  const vertCount = vertsPerPoint * n
  const positions = new Float32Array(vertCount * 3)
  const colors = new Float32Array(vertCount * 3)
  const indices = new Uint32Array((n - 1) * 18)

  // Layout per point i:
  //   vIdx 5i+0: top-front   (x, y, zFront)
  //   vIdx 5i+1: top-back    (x, y, zBack)
  //   vIdx 5i+2: bot-front   (x, wallBottom, zFront)
  //   vIdx 5i+3: bot-back    (x, wallBottom, zBack)
  //   vIdx 5i+4: apron-near  (x, y - APRON_DROP, zApron)

  for (let i = 0; i < n; i++) {
    const { x, y } = ground[i]
    const vi = i * vertsPerPoint
    const pi = vi * 3

    // top-front
    positions[pi + 0] = x
    positions[pi + 1] = y
    positions[pi + 2] = zFront
    // top-back
    positions[pi + 3] = x
    positions[pi + 4] = y
    positions[pi + 5] = zBack
    // bot-front
    positions[pi + 6] = x
    positions[pi + 7] = wallBottom
    positions[pi + 8] = zFront
    // bot-back
    positions[pi + 9] = x
    positions[pi + 10] = wallBottom
    positions[pi + 11] = zBack
    // apron-near (toward the camera and down)
    positions[pi + 12] = x
    positions[pi + 13] = y - APRON_DROP
    positions[pi + 14] = zApron

    const col = new THREE.Color(terrainColorAt(x, theme))
    // Back-edge verts (top-back, bot-back) blend toward the ground backdrop's
    // color so the top face fades into it across the strip's depth instead of
    // meeting it in a hard, single-color line at TERRAIN_BACK_Z (see
    // BACK_EDGE_BACKDROP_BLEND doc comment above).
    const backEdgeCol = col.clone().lerp(backdropColor, BACK_EDGE_BACKDROP_BLEND)

    // Front-edge verts (0: top-front, 2: bot-front) keep the true zone color.
    for (const k of [0, 2]) {
      colors[(vi + k) * 3 + 0] = col.r
      colors[(vi + k) * 3 + 1] = col.g
      colors[(vi + k) * 3 + 2] = col.b
    }
    // Back-edge verts (1: top-back, 3: bot-back) use the backdrop-blended color.
    for (const k of [1, 3]) {
      colors[(vi + k) * 3 + 0] = backEdgeCol.r
      colors[(vi + k) * 3 + 1] = backEdgeCol.g
      colors[(vi + k) * 3 + 2] = backEdgeCol.b
    }
    // Apron-near vert (4) is darkened off the true (front) zone color so the
    // bank shades into depth rather than reading as a flat card.
    colors[(vi + 4) * 3 + 0] = col.r * APRON_DARKEN
    colors[(vi + 4) * 3 + 1] = col.g * APRON_DARKEN
    colors[(vi + 4) * 3 + 2] = col.b * APRON_DARKEN
  }

  // Indices: for each pair (i, i+1) emit the top, front-wall and apron quads.
  let idx = 0
  for (let i = 0; i < n - 1; i++) {
    const a = i * vertsPerPoint
    const b = (i + 1) * vertsPerPoint
    const tf = a // top-front a
    const tb = a + 1 // top-back a
    const bf = a + 2 // bot-front a
    const af = a + 4 // apron-near a
    const ntf = b // top-front b
    const ntb = b + 1 // top-back b
    const nbf = b + 2 // bot-front b
    const naf = b + 4 // apron-near b

    // Top face (CCW from above: +z = front)
    indices[idx++] = tf
    indices[idx++] = ntf
    indices[idx++] = ntb
    indices[idx++] = tf
    indices[idx++] = ntb
    indices[idx++] = tb

    // Front wall face (kept to close the underside; occluded by the apron)
    indices[idx++] = tf
    indices[idx++] = bf
    indices[idx++] = nbf
    indices[idx++] = tf
    indices[idx++] = nbf
    indices[idx++] = ntf

    // Apron face (front-top edge → apron-near edge; normals face up + toward camera)
    indices[idx++] = tf
    indices[idx++] = af
    indices[idx++] = naf
    indices[idx++] = tf
    indices[idx++] = naf
    indices[idx++] = ntf
  }

  return { positions, colors, indices }
}

// ─── Obstacle variant mesh builders ────────────────────────────────────────────

/**
 * Deterministic pseudo-random float in [0, 1) from an arbitrary seed number.
 * Classic sine-hash: NOT a statistically strong RNG, but fine for cosmetic
 * per-vertex jitter — same input always yields the same output (no flicker on
 * rebuild), and no Math.random/Date is involved.
 */
function hash01(n: number): number {
  const s = Math.sin(n) * 43758.5453
  return s - Math.floor(s)
}

/** Build a fallen-log mesh: a cylinder lying across the track (axis along z),
 *  with a darker end-cap so the cut faces read distinct from the bark. */
function buildLogMesh(theme: Theme): THREE.Mesh {
  const geo = new THREE.CylinderGeometry(LOG_RADIUS, LOG_RADIUS, LOG_LENGTH, LOG_RADIAL_SEGMENTS)
  // CylinderGeometry's local axis is Y; rotate 90° about X so the axis runs
  // along Z (across the track depth) once placed in the scene.
  geo.rotateX(Math.PI / 2)

  const barkMat = new THREE.MeshStandardMaterial({
    color: theme.logBark,
    roughness: LOG_ROUGHNESS,
    metalness: LOG_METALNESS,
  })
  const endCapMat = new THREE.MeshStandardMaterial({
    color: theme.logEndCap,
    roughness: LOG_ROUGHNESS,
    metalness: LOG_METALNESS,
  })
  // CylinderGeometry emits 3 groups: [0] side, [1] top cap, [2] bottom cap.
  return new THREE.Mesh(geo, [barkMat, endCapMat, endCapMat])
}

/**
 * Build a boulder mesh: a low-poly icosahedron with deterministic per-vertex
 * jitter (derived from `seedX`, e.g. the obstacle's x) so each rock reads as a
 * distinct, irregular stone rather than a perfect geometric solid — while
 * staying stable across rebuilds (no Math.random).
 */
function buildRockMesh(seedX: number, theme: Theme): THREE.Mesh {
  const geo = new THREE.IcosahedronGeometry(ROCK_RADIUS, ROCK_DETAIL)
  const pos = geo.getAttribute('position')
  const v = new THREE.Vector3()
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i)
    const jitter = 1 + (hash01(seedX * 12.9898 + i * 78.233) - 0.5) * ROCK_JITTER_AMOUNT
    v.multiplyScalar(jitter)
    pos.setXYZ(i, v.x, v.y, v.z)
  }
  pos.needsUpdate = true
  geo.computeVertexNormals()

  const mat = new THREE.MeshStandardMaterial({
    color: theme.rock,
    roughness: ROCK_ROUGHNESS,
    metalness: ROCK_METALNESS,
    flatShading: true,
  })
  return new THREE.Mesh(geo, mat)
}

// ─── Public builders ──────────────────────────────────────────────────────────

/**
 * Build the terrain mesh from course.ground.
 * Returns a THREE.Mesh using vertex colors for zone tinting.
 */
export function buildTerrainMesh(course: Course, theme: Theme): THREE.Mesh {
  const { positions, colors, indices } = buildTerrainStrip(course.ground, theme)

  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  geo.setIndex(new THREE.BufferAttribute(indices, 1))
  geo.computeVertexNormals()

  // Standard (PBR) material keeps the per-zone vertex colors but adds relief:
  // roughness-driven shading so hills and walls catch the sun and cast/receive
  // soft shadows for a genuinely 3D read.
  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    side: THREE.DoubleSide,
    roughness: TERRAIN_ROUGHNESS,
    metalness: TERRAIN_METALNESS,
  })

  return new THREE.Mesh(geo, mat)
}

/**
 * Extent of the ground backdrop plane in world space, derived from the course's
 * x range. Pure (no Three.js) so the placement math is unit-testable:
 *   - width / centerX: span the course plus GROUND_BACKDROP_X_MARGIN each side
 *   - depth  / centerZ: from the road's back edge far back past the hills
 */
export function groundBackdropExtent(
  startX: number,
  finishX: number,
): { width: number; centerX: number; depth: number; centerZ: number } {
  const width = finishX - startX + 2 * GROUND_BACKDROP_X_MARGIN
  const centerX = (startX + finishX) / 2
  const depth = GROUND_BACKDROP_FRONT_Z - GROUND_BACKDROP_BACK_Z
  const centerZ = (GROUND_BACKDROP_FRONT_Z + GROUND_BACKDROP_BACK_Z) / 2
  return { width, centerX, depth, centerZ }
}

/**
 * Build the large continuous ground plane that floors the world behind and
 * below the road (see the GROUND_BACKDROP_* doc block above). A single flat,
 * fog-affected quad — cheap — colored a muted terrain green so it fades into
 * the horizon fog just like the parallax hills. Positioned fully in world space
 * (front edge at the road's back edge, well below the road surface); the caller
 * just adds it to the scene.
 */
export function buildGroundBackdrop(course: Course, theme: Theme): THREE.Mesh {
  const { width, centerX, depth, centerZ } = groundBackdropExtent(course.startX, course.finishX)

  const geo = new THREE.PlaneGeometry(width, depth)
  geo.rotateX(-Math.PI / 2) // lie flat in the xz-plane, normal facing +y

  const mat = new THREE.MeshStandardMaterial({
    color: theme.groundBackdrop,
    roughness: GROUND_BACKDROP_ROUGHNESS,
    metalness: 0,
  })

  const mesh = new THREE.Mesh(geo, mat)
  mesh.position.set(centerX, GROUND_BACKDROP_Y, centerZ)
  mesh.receiveShadow = true
  return mesh
}

/**
 * Build obstacle meshes (log trunks / rock boulders) from course.obstacles.
 *
 * Purely a visual reskin: which mesh is built is driven by `obs.variant`
 * (assigned deterministically by the seeded course generator), never by
 * `Math.random`. The collider obstacles jam remains an invisible ball of
 * EGG_RADIUS (see `physics/world.ts`) regardless of variant — gameplay is
 * unchanged, only the mesh sitting on top of it differs.
 *
 * Returns one Group containing all obstacle meshes.
 */
export function buildObstacleMeshes(obstacles: Obstacle[], theme: Theme): THREE.Group {
  const group = new THREE.Group()

  for (const obs of obstacles) {
    if (obs.kind !== 'egg') continue
    const mesh = obs.variant === 'log' ? buildLogMesh(theme) : buildRockMesh(obs.x, theme)
    mesh.position.set(obs.x, obs.y + EGG_VISUAL_RADIUS, EGG_Z)
    mesh.castShadow = true
    mesh.receiveShadow = true
    group.add(mesh)
  }

  return group
}
