/**
 * Terrain mesh builder — converts a Course polyline into a Three.js 3D mesh.
 *
 * The ground is a continuous extruded strip following the polyline, given depth
 * in z so it reads as 3D in the side view. Each segment between two consecutive
 * ground points becomes a quad (two triangles) forming a wall face, plus a top
 * quad for the surface. Color varies per terrain zone for visual clarity.
 *
 * Obstacle eggs are simple sphere meshes placed at the obstacle positions.
 *
 * Pure geometry builder: no DOM, no Rapier, no physics state.
 */

import * as THREE from 'three'
import type { Course, Obstacle } from '../core/course'
import type { Point } from '../core/classifyStroke'

// ─── Constants ────────────────────────────────────────────────────────────────

/** How far the terrain strip extends in the z direction (metres, visual depth). */
export const TERRAIN_DEPTH = 4

/** Y extent of the "wall" face below each surface point (metres, visual depth). */
const TERRAIN_WALL_DEPTH = 8

/** Radius of egg obstacle spheres (visual, slightly larger than physics). */
const EGG_VISUAL_RADIUS = 0.6

/**
 * Physically-based material tuning. Terrain is rough (matte ground); eggs are
 * a touch glossier so they catch the sun. metalness stays 0 (non-metallic).
 */
const TERRAIN_ROUGHNESS = 0.9
const TERRAIN_METALNESS = 0
const EGG_ROUGHNESS = 0.4
const EGG_METALNESS = 0

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

// ─── Terrain color zones ──────────────────────────────────────────────────────

/**
 * Color the terrain strip by x position to match the course zones.
 * Returns a hex color number.
 */
export function terrainColorAt(x: number): number {
  if (x < 20) return 0x5cb85c // flat: green
  if (x < 50) return 0x8b7355 // rocky: brown
  if (x < 90) return 0xe67e22 // uphill: orange
  if (x < 130) return 0x795548 // mud: dark brown
  if (x < 170) return 0x87ceeb // ice: light blue
  if (x < 210) return 0xf39c12 // eggs zone: amber
  return 0x4caf50 // run-out: bright green
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
export function buildTerrainStrip(ground: Point[]): {
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

  // Per segment (n-1 quads), we emit 4 vertices (front-top, back-top, front-bottom, back-bottom)
  // for the top+wall combined face. Actually let's use a simpler approach:
  // For n points we have:
  //   - 2 verts per point on the top edge (front and back at z=zFront/zBack)
  //   - 2 verts per point on the bottom edge (front and back at y=wallBottom)
  // Total: 4*n verts; (n-1)*4 quads → (n-1)*8 triangles → (n-1)*8*3 indices

  const vertCount = 4 * n
  const positions = new Float32Array(vertCount * 3)
  const colors = new Float32Array(vertCount * 3)
  const indices = new Uint32Array((n - 1) * 12) // 2 quads (top + front wall) × 2 tris × 3 verts = 12 per segment

  // Layout per point i:
  //   vIdx 4i+0: top-front (x, y, zFront)
  //   vIdx 4i+1: top-back  (x, y, zBack)
  //   vIdx 4i+2: bot-front (x, wallBottom, zFront)
  //   vIdx 4i+3: bot-back  (x, wallBottom, zBack)

  for (let i = 0; i < n; i++) {
    const { x, y } = ground[i]
    const vi = i * 4
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

    const col = new THREE.Color(terrainColorAt(x))
    // Same color for all 4 verts at this x
    for (let k = 0; k < 4; k++) {
      colors[(vi + k) * 3 + 0] = col.r
      colors[(vi + k) * 3 + 1] = col.g
      colors[(vi + k) * 3 + 2] = col.b
    }
  }

  // Indices: for each pair (i, i+1), emit quads:
  //   Top face:   (4i+0, 4i+1, 4(i+1)+0) + (4i+1, 4(i+1)+1, 4(i+1)+0)
  //   Front wall: (4i+0, 4i+2, 4(i+1)+0) + (4i+2, 4(i+1)+2, 4(i+1)+0)
  //   Back wall:  (4i+1, 4(i+1)+1, 4i+3) + (4(i+1)+1, 4(i+1)+3, 4i+3) (winding reversed)
  //   Bottom face (optional, skip for perf)

  let idx = 0
  for (let i = 0; i < n - 1; i++) {
    const a = i * 4
    const b = (i + 1) * 4
    const tf = a // top-front a
    const tb = a + 1 // top-back a
    const bf = a + 2 // bot-front a
    // const bb = a + 3 // bot-back a (unused winding)
    const ntf = b // top-front b
    const ntb = b + 1 // top-back b
    const nbf = b + 2 // bot-front b
    // const nbb = b + 3 // bot-back b (unused winding)

    // Top face (CCW from above: +z = front)
    indices[idx++] = tf
    indices[idx++] = ntf
    indices[idx++] = ntb
    indices[idx++] = tf
    indices[idx++] = ntb
    indices[idx++] = tb

    // Front wall face (CCW from front: +z = viewer)
    indices[idx++] = tf
    indices[idx++] = bf
    indices[idx++] = nbf
    indices[idx++] = tf
    indices[idx++] = nbf
    indices[idx++] = ntf
  }

  return { positions, colors, indices }
}

// ─── Public builders ──────────────────────────────────────────────────────────

/**
 * Build the terrain mesh from course.ground.
 * Returns a THREE.Mesh using vertex colors for zone tinting.
 */
export function buildTerrainMesh(course: Course): THREE.Mesh {
  const { positions, colors, indices } = buildTerrainStrip(course.ground)

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
 * Build obstacle meshes (egg/sphere) from course.obstacles.
 * Returns one Group containing all obstacle meshes.
 */
export function buildObstacleMeshes(obstacles: Obstacle[]): THREE.Group {
  const group = new THREE.Group()

  const eggGeo = new THREE.SphereGeometry(EGG_VISUAL_RADIUS, 10, 8)
  const eggMat = new THREE.MeshStandardMaterial({
    color: 0xff6b6b,
    roughness: EGG_ROUGHNESS,
    metalness: EGG_METALNESS,
  })

  for (const obs of obstacles) {
    if (obs.kind !== 'egg') continue
    const mesh = new THREE.Mesh(eggGeo, eggMat)
    mesh.position.set(obs.x, obs.y + EGG_VISUAL_RADIUS, EGG_Z)
    mesh.castShadow = true
    mesh.receiveShadow = true
    group.add(mesh)
  }

  return group
}
