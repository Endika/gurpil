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
import { zoneAt, type Course, type Obstacle, type TerrainKind, type Zone } from '../core/course'
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
 * Color for a terrain zone KIND, reading the per-zone palette from the active
 * `theme` (the single source of truth for environment color — see core/theme.ts).
 * This is the zone-accurate path used for GENERATED courses (which interleave
 * ramps / water / bridges in any order); `terrainColorAt` is the x-based
 * approximation kept for the canonical layout. Returns a hex color number.
 */
export function terrainColorForKind(kind: TerrainKind, theme: Theme): number {
  const t = theme.terrain
  switch (kind) {
    case 'flat':
      return t.flat
    case 'rocky':
      return t.rocky
    case 'uphill':
      return t.uphill
    case 'mud':
      return t.mud
    case 'ice':
      return t.ice
    case 'eggs':
      return t.eggs
    case 'ramp':
      return t.ramp
    case 'water':
      return t.water
    case 'bridge':
      return t.bridge
  }
}

/**
 * Color the terrain strip by x position to match the CANONICAL course zones,
 * reading the per-zone palette from the active `theme`. Kept for the canonical
 * layout and as the fallback when no zone lookup is supplied to
 * `buildTerrainStrip`. Returns a hex color number.
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
export function buildTerrainStrip(
  ground: Point[],
  theme: Theme,
  /**
   * Optional zone-KIND lookup by x. When supplied (generated courses), each point
   * is colored by its ACTUAL zone kind via `terrainColorForKind` — so interleaved
   * ramps / water / bridges get their themed color. When omitted (canonical /
   * unit tests), coloring falls back to the x-based `terrainColorAt`.
   */
  zoneKindAt?: (x: number) => TerrainKind | undefined,
): {
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

    const kind = zoneKindAt?.(x)
    const colorHex = kind !== undefined ? terrainColorForKind(kind, theme) : terrainColorAt(x, theme)
    const col = new THREE.Color(colorHex)
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

// ─── Stage-4 terrain feature geometry (water / bridge / ramp) ─────────────────
//
// Water, bridges and ramps used to be pure COLOR over the flat/ramp ground.
// This section adds real decorative geometry on top of the existing
// traversable strip built above: it never changes course.ground (the
// collider), only what sits visually on top of it.
//
// OCCLUSION SAFETY: the vehicle rides at world z=0 and the strip's own front
// (near-camera) edge already sits only a small margin ahead of it (see the
// TERRAIN_FRONT_Z / scene.ts TERRAIN_Z doc comments). Flat, thin overlays
// (the water surface, bridge planks) stay coplanar with the ground — same
// risk class as the terrain's own top face — so they may span the strip's
// full depth. TALL decorations (bridge rails/posts, ramp struts) are instead
// placed at the two DECOR_ROW_*_Z rows below, both drawn from the BACK HALF
// of the strip's depth — mirroring the safe convention already used for
// raised props in scenery.ts (roadside trees/bushes sit behind the road's own
// back edge) — so nothing added here can ever occlude the vehicle.

/** Pure helper: linearly interpolate the ground polyline's y at world x.
 *  Used to place decoration at the correct height without assuming BASE_Y —
 *  works for the flat water/bridge zones and the sloped ramp faces alike. */
export function sampleGroundY(ground: Point[], x: number): number {
  if (ground.length === 0) return 0
  if (x <= ground[0].x) return ground[0].y
  for (let i = 0; i < ground.length - 1; i++) {
    const a = ground[i]
    const b = ground[i + 1]
    if (x >= a.x && x <= b.x) {
      const t = b.x === a.x ? 0 : (x - a.x) / (b.x - a.x)
      return a.y + t * (b.y - a.y)
    }
  }
  return ground[ground.length - 1].y
}

/** Pure helper: the highest ground point within [xStart, xEnd] — the ramp's
 *  kicker peak (where the up-face meets the down-face). Returns undefined for
 *  a degenerate/empty range (defensive; every generated ramp has one). */
export function findRampPeak(ground: Point[], xStart: number, xEnd: number): Point | undefined {
  let peak: Point | undefined
  for (const p of ground) {
    if (p.x < xStart || p.x > xEnd) continue
    if (!peak || p.y > peak.y) peak = p
  }
  return peak
}

/**
 * Pure helper: deterministic, evenly-spaced element centers across [xStart,
 * xEnd) at roughly `spacing` apart — used for bridge plank slats and rail
 * posts alike. Always fits at least one element and spaces the actual count
 * evenly across the full span (no leftover gap at one end).
 */
export function bridgePlankPositions(xStart: number, xEnd: number, spacing: number): number[] {
  const span = xEnd - xStart
  if (span <= 0 || spacing <= 0) return []
  const count = Math.max(1, Math.round(span / spacing))
  const actualSpacing = span / count
  return Array.from({ length: count }, (_, i) => xStart + actualSpacing * (i + 0.5))
}

// ── Shared depth rows for TALL decorations (see OCCLUSION SAFETY above) ───────

/** Margin pulling flat overlays (water surface, bridge deck) in from the
 *  strip's true front/back edges, avoiding z-fighting with the terrain mesh's
 *  own edge triangles. */
const FEATURE_EDGE_MARGIN = 0.3

/** Near depth row for tall decorations: the strip's own mid-depth — already
 *  well clear of the front edge / vehicle plane. */
const DECOR_ROW_NEAR_Z = (TERRAIN_FRONT_Z + TERRAIN_BACK_Z) / 2
/** Far depth row: close to the strip's back edge, matching the scenery.ts
 *  "raised props stay behind the road" convention. */
const DECOR_ROW_FAR_Z = TERRAIN_BACK_Z + FEATURE_EDGE_MARGIN

// ── Water surface ───────────────────────────────────────────────────────────

const WATER_Y_OFFSET = 0.03
const WATER_SECOND_LAYER_Y_OFFSET = 0.09
const WATER_OPACITY = 0.62
const WATER_SECOND_LAYER_OPACITY = 0.28
const WATER_ROUGHNESS = 0.25
const WATER_METALNESS = 0.05
/** Ripple amplitude/frequency: a gentle static sine wave along x — fully
 *  deterministic (no Math.random), never animated, so it never flickers. */
const WATER_RIPPLE_AMPLITUDE = 0.05
const WATER_RIPPLE_FREQUENCY = 0.35
/** Second layer's ripple is phase-shifted so it doesn't sit exactly in sync
 *  with the first, reading as two loosely-related wave layers. */
const WATER_SECOND_LAYER_PHASE = Math.PI / 2
const WATER_RIPPLE_SEGMENT_LENGTH = 2
const WATER_DEPTH_SEGMENTS = 2

function buildWaterLayer(
  zone: Zone,
  groundY: number,
  color: number,
  yOffset: number,
  opacity: number,
  phase: number,
): THREE.Mesh {
  const len = zone.xEnd - zone.xStart
  const segmentsX = Math.max(1, Math.round(len / WATER_RIPPLE_SEGMENT_LENGTH))
  const geo = new THREE.PlaneGeometry(len, TERRAIN_DEPTH, segmentsX, WATER_DEPTH_SEGMENTS)
  geo.rotateX(-Math.PI / 2) // lie flat, normal +y

  const pos = geo.getAttribute('position')
  const midX = zone.xStart + len / 2
  for (let i = 0; i < pos.count; i++) {
    const worldX = midX + pos.getX(i)
    const ripple = WATER_RIPPLE_AMPLITUDE * Math.sin(worldX * WATER_RIPPLE_FREQUENCY + phase)
    pos.setY(i, ripple)
  }
  pos.needsUpdate = true
  geo.computeVertexNormals()

  const mat = new THREE.MeshStandardMaterial({
    color,
    transparent: true,
    opacity,
    roughness: WATER_ROUGHNESS,
    metalness: WATER_METALNESS,
    side: THREE.DoubleSide,
  })
  const mesh = new THREE.Mesh(geo, mat)
  mesh.position.set(midX, groundY + yOffset, (TERRAIN_FRONT_Z + TERRAIN_BACK_Z) / 2)
  mesh.receiveShadow = true
  return mesh
}

/** Build a water zone's visual surface: two translucent, gently-rippled
 *  layers over the (unchanged) flat ford ground so it reads as real water. */
function buildWaterFeature(zone: Zone, ground: Point[], theme: Theme): THREE.Group {
  const group = new THREE.Group()
  const groundY = sampleGroundY(ground, (zone.xStart + zone.xEnd) / 2)
  group.add(buildWaterLayer(zone, groundY, theme.terrain.water, WATER_Y_OFFSET, WATER_OPACITY, 0))
  group.add(
    buildWaterLayer(
      zone,
      groundY,
      theme.terrain.waterHighlight,
      WATER_SECOND_LAYER_Y_OFFSET,
      WATER_SECOND_LAYER_OPACITY,
      WATER_SECOND_LAYER_PHASE,
    ),
  )
  return group
}

// ── Bridge planks + railing ─────────────────────────────────────────────────

const BRIDGE_PLANK_SPACING = 1.6
const BRIDGE_PLANK_WIDTH_X = 1.1
const BRIDGE_PLANK_HEIGHT = 0.12
const BRIDGE_PLANK_Y_OFFSET = BRIDGE_PLANK_HEIGHT / 2
const BRIDGE_PLANK_ROUGHNESS = 0.85

const BRIDGE_RAIL_POST_SPACING = 4
const BRIDGE_RAIL_POST_HEIGHT = 0.6
const BRIDGE_RAIL_POST_RADIUS = 0.06
const BRIDGE_RAIL_POST_SEGMENTS = 6
const BRIDGE_RAIL_HEIGHT_Y = 0.55
const BRIDGE_RAIL_THICKNESS = 0.08
const BRIDGE_RAIL_ROUGHNESS = 0.8

function buildBridgePlanks(zone: Zone, groundY: number, theme: Theme): THREE.InstancedMesh {
  const positions = bridgePlankPositions(zone.xStart, zone.xEnd, BRIDGE_PLANK_SPACING)
  const plankDepth = TERRAIN_DEPTH - 2 * FEATURE_EDGE_MARGIN
  const geo = new THREE.BoxGeometry(BRIDGE_PLANK_WIDTH_X, BRIDGE_PLANK_HEIGHT, plankDepth)
  const mat = new THREE.MeshStandardMaterial({ color: theme.terrain.bridge, roughness: BRIDGE_PLANK_ROUGHNESS })
  const mesh = new THREE.InstancedMesh(geo, mat, positions.length)
  const midZ = (TERRAIN_FRONT_Z + TERRAIN_BACK_Z) / 2
  const m = new THREE.Matrix4()
  positions.forEach((x, i) => {
    m.makeTranslation(x, groundY + BRIDGE_PLANK_Y_OFFSET, midZ)
    mesh.setMatrixAt(i, m)
  })
  mesh.castShadow = true
  mesh.receiveShadow = true
  return mesh
}

/** Rail posts at both DECOR_ROW depth rows (see OCCLUSION SAFETY above) — a
 *  single InstancedMesh for every post across both rows. */
function buildBridgeRailPosts(zone: Zone, groundY: number, theme: Theme): THREE.InstancedMesh {
  const positions = bridgePlankPositions(zone.xStart, zone.xEnd, BRIDGE_RAIL_POST_SPACING)
  const geo = new THREE.CylinderGeometry(
    BRIDGE_RAIL_POST_RADIUS,
    BRIDGE_RAIL_POST_RADIUS,
    BRIDGE_RAIL_POST_HEIGHT,
    BRIDGE_RAIL_POST_SEGMENTS,
  )
  const mat = new THREE.MeshStandardMaterial({ color: theme.terrain.bridgeRail, roughness: BRIDGE_RAIL_ROUGHNESS })
  const mesh = new THREE.InstancedMesh(geo, mat, positions.length * 2)
  const m = new THREE.Matrix4()
  let idx = 0
  for (const x of positions) {
    for (const z of [DECOR_ROW_NEAR_Z, DECOR_ROW_FAR_Z]) {
      m.makeTranslation(x, groundY + BRIDGE_RAIL_POST_HEIGHT / 2, z)
      mesh.setMatrixAt(idx++, m)
    }
  }
  mesh.castShadow = true
  return mesh
}

/** The two horizontal rail bars running the bridge's full length, one per
 *  DECOR_ROW depth row. */
function buildBridgeRailBars(zone: Zone, groundY: number, theme: Theme): THREE.Group {
  const group = new THREE.Group()
  const len = zone.xEnd - zone.xStart
  const geo = new THREE.BoxGeometry(len, BRIDGE_RAIL_THICKNESS, BRIDGE_RAIL_THICKNESS)
  const mat = new THREE.MeshStandardMaterial({ color: theme.terrain.bridgeRail, roughness: BRIDGE_RAIL_ROUGHNESS })
  for (const z of [DECOR_ROW_NEAR_Z, DECOR_ROW_FAR_Z]) {
    const rail = new THREE.Mesh(geo, mat)
    rail.position.set(zone.xStart + len / 2, groundY + BRIDGE_RAIL_HEIGHT_Y, z)
    rail.castShadow = true
    group.add(rail)
  }
  return group
}

/** Build a bridge zone's visual deck: wooden plank slats across the span plus
 *  simple post-and-rail railing along its length. Purely decorative — the
 *  collider is the unchanged flat course.ground strip underneath. */
function buildBridgeFeature(zone: Zone, ground: Point[], theme: Theme): THREE.Group {
  const group = new THREE.Group()
  const groundY = sampleGroundY(ground, (zone.xStart + zone.xEnd) / 2)
  group.add(buildBridgePlanks(zone, groundY, theme))
  group.add(buildBridgeRailPosts(zone, groundY, theme))
  group.add(buildBridgeRailBars(zone, groundY, theme))
  return group
}

// ── Ramp kicker lip + support struts ────────────────────────────────────────

const RAMP_LIP_WIDTH_X = 0.6
const RAMP_LIP_HEIGHT = 0.18
const RAMP_LIP_Y_OFFSET = RAMP_LIP_HEIGHT / 2
const RAMP_LIP_ROUGHNESS = 0.6

const RAMP_STRUT_THICKNESS = 0.25
/** Struts sit slightly BELOW the ramp's own up-face line so they read as a
 *  support beam under the surface rather than floating on top of it. */
const RAMP_STRUT_Y_DROP = 0.2
const RAMP_STRUT_ROUGHNESS = 0.7

function buildRampLip(peak: Point, theme: Theme): THREE.Mesh {
  const depth = TERRAIN_DEPTH - 2 * FEATURE_EDGE_MARGIN
  const geo = new THREE.BoxGeometry(RAMP_LIP_WIDTH_X, RAMP_LIP_HEIGHT, depth)
  const mat = new THREE.MeshStandardMaterial({ color: theme.terrain.rampAccent, roughness: RAMP_LIP_ROUGHNESS })
  const mesh = new THREE.Mesh(geo, mat)
  mesh.position.set(peak.x, peak.y + RAMP_LIP_Y_OFFSET, (TERRAIN_FRONT_Z + TERRAIN_BACK_Z) / 2)
  mesh.castShadow = true
  mesh.receiveShadow = true
  return mesh
}

/** A single diagonal support beam along the ramp's up-face, from its base to
 *  its peak, at one of the two DECOR_ROW depth rows (see OCCLUSION SAFETY). */
function buildRampStrut(baseX: number, baseY: number, peak: Point, z: number, theme: Theme): THREE.Mesh {
  const dx = peak.x - baseX
  const dy = peak.y - baseY
  const length = Math.hypot(dx, dy)
  const angle = Math.atan2(dy, dx)
  const geo = new THREE.BoxGeometry(length, RAMP_STRUT_THICKNESS, RAMP_STRUT_THICKNESS)
  const mat = new THREE.MeshStandardMaterial({ color: theme.terrain.rampAccent, roughness: RAMP_STRUT_ROUGHNESS })
  const mesh = new THREE.Mesh(geo, mat)
  mesh.rotation.z = angle
  mesh.position.set((baseX + peak.x) / 2, (baseY + peak.y) / 2 - RAMP_STRUT_Y_DROP, z)
  mesh.castShadow = true
  mesh.receiveShadow = true
  return mesh
}

/** Build a ramp zone's visual kicker: an accent lip at the peak plus a pair
 *  of support struts under the up-face, so it reads as a BUILT jump ramp
 *  rather than plain sloped ground. Purely decorative — the collider is the
 *  unchanged course.ground slope underneath. Returns undefined for a
 *  degenerate zone (no discernible peak); defensive, never hit in practice. */
function buildRampFeature(zone: Zone, ground: Point[], theme: Theme): THREE.Group | undefined {
  const peak = findRampPeak(ground, zone.xStart, zone.xEnd)
  if (!peak || peak.x <= zone.xStart) return undefined

  const baseY = sampleGroundY(ground, zone.xStart)
  const group = new THREE.Group()
  group.add(buildRampLip(peak, theme))
  group.add(buildRampStrut(zone.xStart, baseY, peak, DECOR_ROW_NEAR_Z, theme))
  group.add(buildRampStrut(zone.xStart, baseY, peak, DECOR_ROW_FAR_Z, theme))
  return group
}

/**
 * Build the decorative geometry for every water/bridge/ramp zone in the
 * course. Returns a single Group (empty if the course has none) meant to be
 * added as a CHILD of the terrain mesh, so it inherits the same local→world
 * placement (TERRAIN_Z) scene.ts applies to the strip itself.
 */
export function buildTerrainFeatureMeshes(course: Course, theme: Theme): THREE.Group {
  const group = new THREE.Group()
  for (const zone of course.zones) {
    switch (zone.kind) {
      case 'water':
        group.add(buildWaterFeature(zone, course.ground, theme))
        break
      case 'bridge':
        group.add(buildBridgeFeature(zone, course.ground, theme))
        break
      case 'ramp': {
        const rampGroup = buildRampFeature(zone, course.ground, theme)
        if (rampGroup) group.add(rampGroup)
        break
      }
      default:
        break
    }
  }
  return group
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
  // Color by the ACTUAL zone kind at each x so generated courses (which interleave
  // ramps / water / bridges in any order) get their themed colors.
  const { positions, colors, indices } = buildTerrainStrip(
    course.ground,
    theme,
    (x) => zoneAt(course, x)?.kind,
  )

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

  const mesh = new THREE.Mesh(geo, mat)

  // Water/bridge/ramp decorative geometry, added as CHILDREN so it inherits
  // the mesh's own position.z (TERRAIN_Z, applied by the caller) automatically
  // — see buildTerrainFeatureMeshes doc comment.
  mesh.add(buildTerrainFeatureMeshes(course, theme))

  return mesh
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
