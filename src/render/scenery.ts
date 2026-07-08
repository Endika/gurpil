/**
 * scenery.ts — decorative landscape props around the road: a hazy distant
 * forest band (behind the existing parallax hills), roadside trees & bushes,
 * a handful of sky clouds, and sparse low grass/flowers hugging the road's
 * back edge.
 *
 * Pure decoration: no physics, no collision, no gameplay effect whatsoever.
 * Every prop is placed DETERMINISTICALLY from a hash of its index/x (no
 * Math.random, no Date) so rebuilding the scene never shuffles the world —
 * same course, same scenery, every time.
 *
 * Z-DEPTH SAFETY (the constraint this whole module is built around): the
 * road's top surface spans world z ∈ [-3.5, 0.5] (see TERRAIN_Z /
 * TERRAIN_FRONT_Z in scene.ts / terrain.ts) and the vehicle rides at z = 0,
 * comfortably inside that span. EVERY prop placed here sits at
 * z <= ROAD_BACK_EDGE_Z, i.e. already behind the road's own back edge, or
 * further still (bushes/trees/forest/clouds). Nothing in this module is ever
 * placed in FRONT of the road (z > ROAD_BACK_EDGE_Z), so nothing here can
 * occlude the vehicle, the wheels or the track profile from the 3/4 camera.
 *
 * PERFORMANCE: every repeated prop type is a single (or a small, fixed
 * number of) THREE.InstancedMesh sharing one geometry + material, built once
 * up front. Per-instance variety (size/color/depth) comes from
 * `setMatrixAt`/`setColorAt`, never from separate meshes or materials.
 * Instance counts are budgeted (see MAX_*_INSTANCES) so a very long
 * generated course never blows past a modest total prop count — spacing
 * widens instead (see `spacingForBudget`).
 */

import * as THREE from 'three'
import type { Course } from '../core/course'
import type { Point } from '../core/classifyStroke'

// ─── Course extension margin ───────────────────────────────────────────────

/** How far scenery extends before startX / after finishX (metres) so props
 *  are already in view at the very start/end of the course, not popping in. */
const COURSE_MARGIN = 40

// ─── Determinism seeds ──────────────────────────────────────────────────────
// Arbitrary, mutually distinct constants so each layer's hash stream is
// uncorrelated with the others (no shared pattern between e.g. tree and bush
// placement) while staying fully reproducible.

const SEED_FOREST = 11
const SEED_TREES = 23
const SEED_BUSHES = 41
const SEED_CLOUDS = 59
const SEED_GRASS = 71

// ─── Roadside z-safety ──────────────────────────────────────────────────────

/** The road's own back edge (world z) — see the file header. Every prop
 *  layer below is placed at or beyond this depth. */
const ROAD_BACK_EDGE_Z = -3.5

// ─── Distant forest band ────────────────────────────────────────────────────
// A single hazy, unlit InstancedMesh of simple cone silhouettes sitting just
// behind the farthest parallax hill layer (z=-110, see scene.ts HILL_LAYERS).
// Like the hills, it follows the camera by a parallax factor so it always
// fills the horizon regardless of how long the course is — this is the ONE
// layer that needs a per-frame update (exposed via Scenery.update).

const FOREST_BAND_Z = -125
const FOREST_BAND_PARALLAX = 0.94
const FOREST_BASE_Y = 3
const FOREST_BAND_HALF_WIDTH = 260
/** Dense spacing (canopies well wider than this) so the band reads as one
 *  CONTINUOUS hazy tree line, not a row of separated spikes. */
const FOREST_BAND_SPACING = 5
/**
 * Canopy heights/radii tuned so the tallest-thinnest tree is only ~2.6× as tall
 * as it is wide — soft, rounded firs, NOT the sharp spires the old (up to 7×)
 * ratio produced. Half the canopies are ROUNDED BLOBS (see FOREST_BLOB_FRACTION)
 * which further breaks up any remaining pointiness.
 */
const FOREST_TREE_HEIGHT_MIN = 5
const FOREST_TREE_HEIGHT_MAX = 8
const FOREST_TREE_RADIUS_MIN = 3
const FOREST_TREE_RADIUS_MAX = 4.5
/** Radial segments of the softened cone canopies (smoother than the old 7). */
const FOREST_CONE_SEGMENTS = 9
/** Fraction of canopies rendered as rounded blobs instead of (fat) cones. */
const FOREST_BLOB_FRACTION = 0.5
/** Extra depth spread within the band, so it doesn't read as one flat card. */
const FOREST_Z_JITTER = 12
/** Hazy, fog-tinted greens — deliberately muted/desaturated at this distance. */
const FOREST_COLORS = [0x5c7d68, 0x4a6b58, 0x6f8f78, 0x7a9384]

// ─── Roadside trees ──────────────────────────────────────────────────────────
// Trunk cylinder + two foliage spheres (low + high tier), set back well
// behind ROAD_BACK_EDGE_Z. Grounded on the actual terrain profile via
// sampleGroundY so they sit correctly on slopes/hills, not just BASE_Y.

const TREE_Z_NEAR = -6
const TREE_Z_FAR = -15
const TREE_BASE_SPACING = 9
const MAX_TREE_INSTANCES = 130

const TRUNK_RADIUS = 0.16
const TRUNK_RADIUS_SCALE_MIN = 0.8
const TRUNK_RADIUS_SCALE_MAX = 1.3
const TRUNK_HEIGHT_MIN = 1.6
const TRUNK_HEIGHT_MAX = 2.8
const TRUNK_COLOR = 0x6b4226
const TRUNK_ROUGHNESS = 0.95

const FOLIAGE_LOW_RADIUS_MIN = 1.0
const FOLIAGE_LOW_RADIUS_MAX = 1.7
const FOLIAGE_HIGH_RADIUS_MIN = 0.6
const FOLIAGE_HIGH_RADIUS_MAX = 1.1
const FOLIAGE_ROUGHNESS = 0.9
const FOLIAGE_COLORS = [0x3f7d3f, 0x2f6b34, 0x4a8f4a]

// ─── Roadside bushes ─────────────────────────────────────────────────────────

const BUSH_Z_NEAR = -4.4
const BUSH_Z_FAR = -8
const BUSH_BASE_SPACING = 5.5
const MAX_BUSH_INSTANCES = 160
const BUSH_RADIUS_MIN = 0.45
const BUSH_RADIUS_MAX = 0.9
/** Y-scale applied to the bush sphere so it reads as a squashed, rounded mound. */
const BUSH_FLATTEN = 0.75
const BUSH_ROUGHNESS = 0.95
const BUSH_COLORS = [0x5a9a4c, 0x6bab5a, 0x4a8a3e]

// ─── Clouds ──────────────────────────────────────────────────────────────────
// Each "cluster" is a handful of flattened-sphere puffs offset from a shared
// center, all baked into ONE InstancedMesh (no per-cluster grouping needed).

const CLOUD_BASE_SPACING = 45
const MAX_CLOUD_CLUSTERS = 26
const CLOUD_PUFFS_PER_CLUSTER = 3
const CLOUD_Z_MIN = -45
const CLOUD_Z_MAX = -95
const CLOUD_HEIGHT_ABOVE_GROUND_MIN = 26
const CLOUD_HEIGHT_ABOVE_GROUND_MAX = 40
const CLOUD_PUFF_RADIUS_MIN = 1.6
const CLOUD_PUFF_RADIUS_MAX = 3.2
/** How far a puff can drift from its cluster's center (metres). */
const CLOUD_PUFF_SPREAD_XZ = 2.4
const CLOUD_PUFF_SPREAD_Y = 0.7
const CLOUD_FLATTEN = 0.55
const CLOUD_OPACITY = 0.9
const CLOUD_COLORS = [0xffffff, 0xf3f6fa]

// ─── Foreground grass / flowers ──────────────────────────────────────────────
// Deliberately LOW and set at the road's own back edge depth — they read as
// a fringe where the road meets the roadside vegetation, never as a layer in
// front of the road (see ROAD_BACK_EDGE_Z / the file header).

const GRASS_Z = -4
const GRASS_BASE_SPACING = 2.2
const MAX_GRASS_INSTANCES = 220
const GRASS_HEIGHT_MIN = 0.18
const GRASS_HEIGHT_MAX = 0.4
const GRASS_RADIUS = 0.05
const GRASS_COLOR = 0x6fae4a
const GRASS_ROUGHNESS = 0.9
/** Fraction of scattered tufts that become a tiny flower dot instead of grass. */
const FLOWER_CHANCE = 0.18
const FLOWER_RADIUS = 0.07
const FLOWER_ROUGHNESS = 0.7
const FLOWER_COLORS = [0xffd166, 0xff6b81, 0xffffff]

// ─── Pure helpers (deterministic, unit-tested) ───────────────────────────────

/**
 * Deterministic pseudo-random float in [0, 1) from an arbitrary seed number.
 * Sine-hash — the same pattern used in terrain.ts for per-vertex jitter: not
 * a statistically strong RNG, but stable across rebuilds (no Math.random/
 * Date) and good enough for cosmetic placement variety.
 */
export function sceneryHash(seed: number): number {
  const s = Math.sin(seed) * 43758.5453123
  return s - Math.floor(s)
}

/** Map a [0,1) hash into [min, max). */
function lerpRange(hash: number, min: number, max: number): number {
  return min + hash * (max - min)
}

/** Deterministically pick one element of `items` from a [0,1) hash. */
function pickFromHash<T>(hash: number, items: readonly T[]): T {
  const i = Math.min(items.length - 1, Math.floor(hash * items.length))
  return items[i]
}

/**
 * Sample the course ground polyline's y at an arbitrary x via linear
 * interpolation between the two bracketing points (clamped to the polyline's
 * own ends beyond its range). Pure; lets scenery sit ON the actual terrain
 * profile (slopes, hills) rather than a flat baseline.
 */
export function sampleGroundY(ground: readonly Point[], x: number): number {
  if (ground.length === 0) return 0
  if (x <= ground[0].x) return ground[0].y
  const last = ground[ground.length - 1]
  if (x >= last.x) return last.y
  for (let i = 0; i < ground.length - 1; i++) {
    const a = ground[i]
    const b = ground[i + 1]
    if (x >= a.x && x <= b.x) {
      const t = (x - a.x) / (b.x - a.x)
      return a.y + (b.y - a.y) * t
    }
  }
  return last.y
}

/**
 * Shrink a base spacing, if needed, so a range of length `rangeLen` never
 * yields more than `maxCount` scatter points — keeps instance counts bounded
 * (perf) even on a very long generated (hard-difficulty) course.
 */
export function spacingForBudget(rangeLen: number, baseSpacing: number, maxCount: number): number {
  if (rangeLen <= 0 || maxCount <= 0) return baseSpacing
  const naiveCount = rangeLen / baseSpacing
  return naiveCount <= maxCount ? baseSpacing : rangeLen / maxCount
}

export interface ScatterPoint {
  /** World x, jittered off its nominal grid slot. */
  x: number
  /** Deterministic [0,1) hash unique to this point — the seed for any
   *  further per-instance variety (size, color, depth, ...). */
  hash: number
}

/**
 * Scatter points across [startX, endX] at roughly `spacing` intervals, each
 * jittered off its grid slot by a deterministic hash of its index and
 * `seed`. DETERMINISTIC: the same (startX, endX, spacing, seed) always
 * yields the same points — no Math.random, so rebuilding the scenery for the
 * same course never shuffles it.
 */
export function scatterAlongCourse(startX: number, endX: number, spacing: number, seed: number): ScatterPoint[] {
  const points: ScatterPoint[] = []
  if (endX <= startX || spacing <= 0) return points
  let i = 0
  for (let gridX = startX; gridX <= endX; gridX += spacing) {
    const jitterHash = sceneryHash(seed + i * 12.9898)
    const varietyHash = sceneryHash(seed + i * 78.233 + 4.11)
    const jitter = (jitterHash - 0.5) * spacing * 0.7
    points.push({ x: gridX + jitter, hash: varietyHash })
    i++
  }
  return points
}

// ─── Instance matrix scratch (reused — no per-instance allocation) ──────────

const scratchPos = new THREE.Vector3()
const scratchScale = new THREE.Vector3()
/** Scenery props never rotate — every geometry here (cylinders, cones,
 *  spheres) is radially symmetric about y, so identity rotation is enough. */
const scratchQuat = new THREE.Quaternion()
const scratchMatrix = new THREE.Matrix4()

function matrixAt(x: number, y: number, z: number, sx: number, sy: number, sz: number): THREE.Matrix4 {
  scratchPos.set(x, y, z)
  scratchScale.set(sx, sy, sz)
  return scratchMatrix.compose(scratchPos, scratchQuat, scratchScale)
}

// ─── Public API ───────────────────────────────────────────────────────────────

export interface Scenery {
  /** Root group containing every scenery layer; add directly to the scene. */
  group: THREE.Group
  /**
   * Per-frame update. ONLY the distant forest band needs this — it follows
   * the camera by a parallax factor (exactly like the background hills in
   * scene.ts) so it always fills the horizon regardless of course length.
   * Roadside trees/bushes/clouds/grass are static world-space props tied to
   * the course's own x range and need no per-frame repositioning.
   */
  update(camX: number, camY: number): void
}

/** Build every scenery layer for `course`. Deterministic and pure aside from
 *  Three.js object construction: the same course always yields identical
 *  scenery geometry/placement. */
export function buildScenery(course: Course): Scenery {
  const group = new THREE.Group()

  const forest = buildForestBand()
  group.add(forest.group)

  group.add(buildTrees(course))

  const bushes = buildBushes(course)
  if (bushes) group.add(bushes)

  const clouds = buildClouds(course)
  if (clouds) group.add(clouds)

  group.add(buildGrass(course))

  return {
    group,
    update(camX: number, camY: number): void {
      forest.group.position.x = camX * forest.parallax
      forest.group.position.y = camY * forest.parallax + forest.baseY
    },
  }
}

// ─── Internal builders ────────────────────────────────────────────────────────

interface ForestBand {
  /** Sub-group holding both canopy meshes; the whole group parallax-follows the
   *  camera each frame (see Scenery.update). */
  group: THREE.Group
  parallax: number
  baseY: number
}

/**
 * Build the distant forest band: a hazy, CONTINUOUS tree line just behind the
 * farthest parallax hill, fading into the fog like the hills do. Softened vs the
 * old sharp spires — canopies are FAT rounded cones AND rounded blobs (mixed
 * ~50/50, see FOREST_BLOB_FRACTION), placed densely so overlapping crowns read
 * as one soft band rather than pointy firs marching to infinity. Two unlit
 * (fog-affected) InstancedMeshes — cheap, deterministic, no shadows.
 */
function buildForestBand(): ForestBand {
  const points = scatterAlongCourse(-FOREST_BAND_HALF_WIDTH, FOREST_BAND_HALF_WIDTH, FOREST_BAND_SPACING, SEED_FOREST)

  // Split points into cone vs blob canopies deterministically (by hash).
  const coneIndices: number[] = []
  const blobIndices: number[] = []
  for (let i = 0; i < points.length; i++) {
    const kindHash = sceneryHash(SEED_FOREST + i * 2.7 + 6.6)
    if (kindHash < FOREST_BLOB_FRACTION) blobIndices.push(i)
    else coneIndices.push(i)
  }

  // Fat, many-sided cone (softer than the old 7-sided spire) and a rounded blob.
  // Both are unit shapes with their BASE at local y=0 and a unit height/diameter,
  // so the per-instance (radius, height, radius) scale sets the world size and
  // the base always rests on the band's baseline.
  const coneGeo = new THREE.ConeGeometry(1, 1, FOREST_CONE_SEGMENTS)
  coneGeo.translate(0, 0.5, 0) // base at y=0, apex at y=1
  const blobGeo = new THREE.SphereGeometry(1, 10, 6)
  blobGeo.translate(0, 1, 0) // base at y=0, top at y=2 (→ scale.y = height/2, below)

  const coneMesh = fillForestMesh(coneGeo, points, coneIndices, false)
  const blobMesh = fillForestMesh(blobGeo, points, blobIndices, true)

  const group = new THREE.Group()
  group.add(coneMesh, blobMesh)
  group.position.set(0, FOREST_BASE_Y, FOREST_BAND_Z)

  return { group, parallax: FOREST_BAND_PARALLAX, baseY: FOREST_BASE_Y }
}

/**
 * Build one canopy InstancedMesh for the forest band: places every point in
 * `indices` using its deterministic per-index hashes (height, radius, z-jitter,
 * color). `isBlob` halves the y-scale so the y=0..2 blob geometry spans the same
 * 0..height as the y=0..1 cone geometry. Shared by the cone + blob layers.
 */
function fillForestMesh(
  geo: THREE.BufferGeometry,
  points: ScatterPoint[],
  indices: number[],
  isBlob: boolean,
): THREE.InstancedMesh {
  const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, fog: true })
  const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, indices.length))

  for (let j = 0; j < indices.length; j++) {
    const i = indices[j]
    const p = points[i]
    const heightHash = sceneryHash(SEED_FOREST + i * 5.1)
    const radiusHash = sceneryHash(SEED_FOREST + i * 7.3 + 0.9)
    const zHash = sceneryHash(SEED_FOREST + i * 3.3 + 1.4)
    const colorHash = sceneryHash(SEED_FOREST + i * 9.9 + 2.1)

    const height = lerpRange(heightHash, FOREST_TREE_HEIGHT_MIN, FOREST_TREE_HEIGHT_MAX)
    const radius = lerpRange(radiusHash, FOREST_TREE_RADIUS_MIN, FOREST_TREE_RADIUS_MAX)
    const zJitter = lerpRange(zHash, -FOREST_Z_JITTER, FOREST_Z_JITTER)
    const scaleY = isBlob ? height / 2 : height

    mesh.setMatrixAt(j, matrixAt(p.x, 0, zJitter, radius, scaleY, radius))
    mesh.setColorAt(j, new THREE.Color(pickFromHash(colorHash, FOREST_COLORS)))
  }

  mesh.instanceMatrix.needsUpdate = true
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
  mesh.castShadow = false
  mesh.receiveShadow = false
  return mesh
}

/**
 * Build roadside trees: trunk + two-tier foliage, three InstancedMeshes
 * sharing index-aligned transforms so each trunk lines up with its own
 * foliage. Set back at TREE_Z_NEAR..TREE_Z_FAR — always behind
 * ROAD_BACK_EDGE_Z, never in front of the road.
 */
function buildTrees(course: Course): THREE.Group {
  const group = new THREE.Group()
  const rangeLen = course.finishX - course.startX + 2 * COURSE_MARGIN
  const spacing = spacingForBudget(rangeLen, TREE_BASE_SPACING, MAX_TREE_INSTANCES)
  const points = scatterAlongCourse(course.startX - COURSE_MARGIN, course.finishX + COURSE_MARGIN, spacing, SEED_TREES)
  const count = points.length
  if (count === 0) return group

  const trunkGeo = new THREE.CylinderGeometry(TRUNK_RADIUS * 0.7, TRUNK_RADIUS, 1, 6)
  trunkGeo.translate(0, 0.5, 0) // base at local y=0, top at y=1 → scale.y = world height
  const trunkMat = new THREE.MeshStandardMaterial({
    color: TRUNK_COLOR,
    roughness: TRUNK_ROUGHNESS,
    metalness: 0,
  })
  const trunkMesh = new THREE.InstancedMesh(trunkGeo, trunkMat, count)

  const foliageGeo = new THREE.SphereGeometry(1, 8, 6)
  const foliageMat = (): THREE.MeshStandardMaterial =>
    new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: FOLIAGE_ROUGHNESS, metalness: 0 })
  const foliageLowMesh = new THREE.InstancedMesh(foliageGeo, foliageMat(), count)
  const foliageHighMesh = new THREE.InstancedMesh(foliageGeo, foliageMat(), count)

  for (let i = 0; i < count; i++) {
    const p = points[i]
    const x = p.x
    const zHash = sceneryHash(SEED_TREES + i * 33.7 + 1.9)
    const heightHash = sceneryHash(SEED_TREES + i * 5.53)
    const radiusHash = sceneryHash(SEED_TREES + i * 9.17 + 2.3)
    const foliageLowHash = sceneryHash(SEED_TREES + i * 3.31 + 0.7)
    const foliageHighHash = sceneryHash(SEED_TREES + i * 6.61 + 1.1)
    const colorHashLow = sceneryHash(SEED_TREES + i * 8.02 + 3.3)
    const colorHashHigh = sceneryHash(SEED_TREES + i * 8.02 + 5.5)

    const z = lerpRange(zHash, TREE_Z_FAR, TREE_Z_NEAR)
    const groundY = sampleGroundY(course.ground, x)
    const trunkHeight = lerpRange(heightHash, TRUNK_HEIGHT_MIN, TRUNK_HEIGHT_MAX)
    const trunkScaleXZ = lerpRange(radiusHash, TRUNK_RADIUS_SCALE_MIN, TRUNK_RADIUS_SCALE_MAX)
    trunkMesh.setMatrixAt(i, matrixAt(x, groundY, z, trunkScaleXZ, trunkHeight, trunkScaleXZ))

    const foliageLowRadius = lerpRange(foliageLowHash, FOLIAGE_LOW_RADIUS_MIN, FOLIAGE_LOW_RADIUS_MAX)
    const foliageLowY = groundY + trunkHeight + foliageLowRadius * 0.4
    foliageLowMesh.setMatrixAt(i, matrixAt(x, foliageLowY, z, foliageLowRadius, foliageLowRadius, foliageLowRadius))
    foliageLowMesh.setColorAt(i, new THREE.Color(pickFromHash(colorHashLow, FOLIAGE_COLORS)))

    const foliageHighRadius = lerpRange(foliageHighHash, FOLIAGE_HIGH_RADIUS_MIN, FOLIAGE_HIGH_RADIUS_MAX)
    const foliageHighY = foliageLowY + foliageLowRadius * 0.7 + foliageHighRadius * 0.6
    foliageHighMesh.setMatrixAt(i, matrixAt(x, foliageHighY, z, foliageHighRadius, foliageHighRadius, foliageHighRadius))
    foliageHighMesh.setColorAt(i, new THREE.Color(pickFromHash(colorHashHigh, FOLIAGE_COLORS)))
  }

  trunkMesh.instanceMatrix.needsUpdate = true
  foliageLowMesh.instanceMatrix.needsUpdate = true
  foliageHighMesh.instanceMatrix.needsUpdate = true
  if (foliageLowMesh.instanceColor) foliageLowMesh.instanceColor.needsUpdate = true
  if (foliageHighMesh.instanceColor) foliageHighMesh.instanceColor.needsUpdate = true

  // Roadside trees are close enough to matter visually; let them cast soft
  // shadows (cheap at this instance count, sharing the scene's one shadow
  // map). They never receive shadows themselves (no perceptible benefit).
  trunkMesh.castShadow = true
  foliageLowMesh.castShadow = true
  foliageHighMesh.castShadow = true

  group.add(trunkMesh, foliageLowMesh, foliageHighMesh)
  return group
}

/**
 * Build roadside bushes: one InstancedMesh of flattened spheres, closer to
 * the road than the trees (still safely behind ROAD_BACK_EDGE_Z) so they
 * read as low undergrowth in front of the tree line.
 */
function buildBushes(course: Course): THREE.InstancedMesh | null {
  const rangeLen = course.finishX - course.startX + 2 * COURSE_MARGIN
  const spacing = spacingForBudget(rangeLen, BUSH_BASE_SPACING, MAX_BUSH_INSTANCES)
  const points = scatterAlongCourse(course.startX - COURSE_MARGIN, course.finishX + COURSE_MARGIN, spacing, SEED_BUSHES)
  const count = points.length
  if (count === 0) return null

  const geo = new THREE.SphereGeometry(1, 8, 6)
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: BUSH_ROUGHNESS, metalness: 0 })
  const mesh = new THREE.InstancedMesh(geo, mat, count)

  for (let i = 0; i < count; i++) {
    const p = points[i]
    const zHash = sceneryHash(SEED_BUSHES + i * 21.1 + 0.3)
    const radiusHash = sceneryHash(SEED_BUSHES + i * 4.7)
    const colorHash = sceneryHash(SEED_BUSHES + i * 6.3 + 1.7)

    const z = lerpRange(zHash, BUSH_Z_FAR, BUSH_Z_NEAR)
    const groundY = sampleGroundY(course.ground, p.x)
    const radius = lerpRange(radiusHash, BUSH_RADIUS_MIN, BUSH_RADIUS_MAX)
    const y = groundY + radius * BUSH_FLATTEN * 0.6

    mesh.setMatrixAt(i, matrixAt(p.x, y, z, radius, radius * BUSH_FLATTEN, radius))
    mesh.setColorAt(i, new THREE.Color(pickFromHash(colorHash, BUSH_COLORS)))
  }

  mesh.instanceMatrix.needsUpdate = true
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
  mesh.castShadow = false
  mesh.receiveShadow = false
  return mesh
}

/**
 * Build sky clouds: a handful of "clusters", each a few flattened-sphere
 * puffs offset from a shared center, all baked into one InstancedMesh.
 * Height is anchored to the terrain profile below (+ a generous offset) so
 * clouds always sit well above the tallest hazard regardless of course shape.
 */
function buildClouds(course: Course): THREE.InstancedMesh | null {
  const rangeLen = course.finishX - course.startX + 2 * COURSE_MARGIN
  const spacing = spacingForBudget(rangeLen, CLOUD_BASE_SPACING, MAX_CLOUD_CLUSTERS)
  const clusters = scatterAlongCourse(course.startX - COURSE_MARGIN, course.finishX + COURSE_MARGIN, spacing, SEED_CLOUDS)
  const count = clusters.length * CLOUD_PUFFS_PER_CLUSTER
  if (count === 0) return null

  const geo = new THREE.SphereGeometry(1, 8, 6)
  const mat = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    fog: true,
    transparent: true,
    opacity: CLOUD_OPACITY,
  })
  const mesh = new THREE.InstancedMesh(geo, mat, count)

  let idx = 0
  for (let c = 0; c < clusters.length; c++) {
    const cluster = clusters[c]
    const zHash = sceneryHash(SEED_CLOUDS + c * 11.3)
    const heightHash = sceneryHash(SEED_CLOUDS + c * 4.4 + 0.6)
    const z = lerpRange(zHash, CLOUD_Z_MAX, CLOUD_Z_MIN)
    const groundY = sampleGroundY(course.ground, cluster.x)
    const clusterY = groundY + lerpRange(heightHash, CLOUD_HEIGHT_ABOVE_GROUND_MIN, CLOUD_HEIGHT_ABOVE_GROUND_MAX)

    for (let puff = 0; puff < CLOUD_PUFFS_PER_CLUSTER; puff++) {
      const offsetHashX = sceneryHash(SEED_CLOUDS + c * 13.7 + puff * 2.2)
      const offsetHashY = sceneryHash(SEED_CLOUDS + c * 17.9 + puff * 3.1)
      const radiusHash = sceneryHash(SEED_CLOUDS + c * 6.6 + puff * 1.3)
      const colorHash = sceneryHash(SEED_CLOUDS + c * 8.8 + puff * 1.7)

      const radius = lerpRange(radiusHash, CLOUD_PUFF_RADIUS_MIN, CLOUD_PUFF_RADIUS_MAX)
      const offsetX = lerpRange(offsetHashX, -CLOUD_PUFF_SPREAD_XZ, CLOUD_PUFF_SPREAD_XZ)
      const offsetY = lerpRange(offsetHashY, -CLOUD_PUFF_SPREAD_Y, CLOUD_PUFF_SPREAD_Y)

      mesh.setMatrixAt(
        idx,
        matrixAt(cluster.x + offsetX, clusterY + offsetY, z, radius, radius * CLOUD_FLATTEN, radius),
      )
      mesh.setColorAt(idx, new THREE.Color(pickFromHash(colorHash, CLOUD_COLORS)))
      idx++
    }
  }

  mesh.instanceMatrix.needsUpdate = true
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
  mesh.castShadow = false
  mesh.receiveShadow = false
  return mesh
}

/**
 * Build sparse, LOW foreground grass tufts and tiny flower dots at the
 * road's own back edge (GRASS_Z, already behind ROAD_BACK_EDGE_Z) — a thin
 * fringe where the road meets the roadside vegetation. Kept short (see
 * GRASS_HEIGHT_*) so it never rises into the vehicle/wheel sightline.
 */
function buildGrass(course: Course): THREE.Group {
  const group = new THREE.Group()
  const rangeLen = course.finishX - course.startX + 2 * COURSE_MARGIN
  const spacing = spacingForBudget(rangeLen, GRASS_BASE_SPACING, MAX_GRASS_INSTANCES)
  const points = scatterAlongCourse(course.startX - COURSE_MARGIN, course.finishX + COURSE_MARGIN, spacing, SEED_GRASS)
  if (points.length === 0) return group

  const grassPoints: ScatterPoint[] = []
  const flowerPoints: ScatterPoint[] = []
  for (const p of points) {
    if (p.hash < FLOWER_CHANCE) flowerPoints.push(p)
    else grassPoints.push(p)
  }

  if (grassPoints.length > 0) {
    const geo = new THREE.ConeGeometry(GRASS_RADIUS, 1, 5)
    geo.translate(0, 0.5, 0) // base at local y=0, tip at y=1 → scale.y = world height
    const mat = new THREE.MeshStandardMaterial({ color: GRASS_COLOR, roughness: GRASS_ROUGHNESS, metalness: 0 })
    const mesh = new THREE.InstancedMesh(geo, mat, grassPoints.length)
    for (let i = 0; i < grassPoints.length; i++) {
      const p = grassPoints[i]
      const heightHash = sceneryHash(SEED_GRASS + i * 5.9 + 9.1)
      const height = lerpRange(heightHash, GRASS_HEIGHT_MIN, GRASS_HEIGHT_MAX)
      const groundY = sampleGroundY(course.ground, p.x)
      mesh.setMatrixAt(i, matrixAt(p.x, groundY, GRASS_Z, 1, height, 1))
    }
    mesh.instanceMatrix.needsUpdate = true
    mesh.castShadow = false
    mesh.receiveShadow = false
    group.add(mesh)
  }

  if (flowerPoints.length > 0) {
    const geo = new THREE.SphereGeometry(FLOWER_RADIUS, 6, 5)
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: FLOWER_ROUGHNESS, metalness: 0 })
    const mesh = new THREE.InstancedMesh(geo, mat, flowerPoints.length)
    for (let i = 0; i < flowerPoints.length; i++) {
      const p = flowerPoints[i]
      const colorHash = sceneryHash(SEED_GRASS + i * 7.1 + 3.3)
      const groundY = sampleGroundY(course.ground, p.x)
      mesh.setMatrixAt(i, matrixAt(p.x, groundY + FLOWER_RADIUS * 0.8, GRASS_Z, 1, 1, 1))
      mesh.setColorAt(i, new THREE.Color(pickFromHash(colorHash, FLOWER_COLORS)))
    }
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    mesh.castShadow = false
    mesh.receiveShadow = false
    group.add(mesh)
  }

  return group
}

// Re-exported so tests / callers can reference the road-edge z-safety line
// without duplicating the magic number.
export { ROAD_BACK_EDGE_Z }
