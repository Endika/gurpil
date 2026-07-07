/**
 * Wheel geometry factory — maps ShapeId to a Three.js BufferGeometry.
 *
 * Each shape produces a distinct 3D form:
 *   circle   → CylinderGeometry (disc, axis aligned with z)
 *   square   → BoxGeometry (equal width × height × depth)
 *   triangle → Triangular prism (extruded isosceles triangle)
 *   line     → Thin flat bar (wide × thin × medium depth BoxGeometry)
 *
 * All shapes are sized consistently around WHEEL_VISUAL_RADIUS so they
 * appear the same "size" on screen even though their bounding boxes differ.
 *
 * Pure geometry data helpers (`wheelGeometryData`) are exported separately
 * from the Three.js constructor wrappers so they can be tested in Node
 * (BufferGeometry is pure JS, no WebGL).
 */

import * as THREE from 'three'
import type { ShapeId } from '../core/shapes'

// ─── Constants ────────────────────────────────────────────────────────────────

/**
 * Visual radius used for all wheel shapes. Matches the physics WHEEL_RADIUS
 * so the visual and physics extents stay aligned. Imported by scene.ts to
 * keep both layers in sync.
 */
export const WHEEL_VISUAL_RADIUS = 0.35

/** Depth (z thickness) of the wheel disc / prism. */
const WHEEL_DEPTH = 1.0

/** Radial segments for the circle disc cylinder. */
const CIRCLE_SEGMENTS = 16

/**
 * Triangular prism geometry data.
 *
 * An isosceles triangle with vertices in the xz plane (the "face" of the
 * prism), extruded in the y direction. In side view the wheel reads as a
 * triangle.
 *
 * Vertex layout (face, z=+WHEEL_DEPTH/2):
 *   v0: bottom-left   (-R, -R)
 *   v1: bottom-right  (+R, -R)
 *   v2: apex          ( 0, +R)
 *
 * (Same triangle mirrored at z=-WHEEL_DEPTH/2 for the back face, plus
 * three rectangular side faces.)
 *
 * Returns: { positions, indices, normals } all as plain Float32Array /
 * Uint16Array — NO Three.js constructors — so this function is testable
 * in Node without WebGL.
 */
export function wheelTriangleData(r: number, depth: number): {
  positions: Float32Array
  indices: Uint16Array
  normals: Float32Array
} {
  const d = depth / 2

  // 6 vertices: front face (z=+d) + back face (z=-d)
  // v0..v2: front face CCW, v3..v5: back face
  const positions = new Float32Array([
    -r, -r, d, // v0 front bottom-left
    r, -r, d, // v1 front bottom-right
    0, r, d, // v2 front apex
    -r, -r, -d, // v3 back  bottom-left
    r, -r, -d, // v4 back  bottom-right
    0, r, -d, // v5 back  apex
  ])

  // Triangles:
  //   front face:  0,1,2
  //   back  face:  3,5,4 (reversed winding for outward normals)
  //   side bottom: 0,3,4  0,4,1
  //   side left:   2,0,3  2,3,5
  //   side right:  1,4,5  1,5,2
  const indices = new Uint16Array([
    0, 1, 2,
    3, 5, 4,
    0, 3, 4, 0, 4, 1,
    2, 0, 3, 2, 3, 5,
    1, 4, 5, 1, 5, 2,
  ])

  // Flat normals per face (approximate — good enough for MeshLambertMaterial)
  const normals = new Float32Array(positions.length)
  // We'll let Three.js compute them from the indexed geometry
  // (this array is zeroed; computeVertexNormals() fills it in)

  return { positions, indices, normals }
}

/**
 * Bounding box of the geometry produced for a given ShapeId and radius.
 *
 * Returns the approximate { width, height, depth } in metres.
 * This is pure (no Three.js constructors) and is exported for testing.
 */
export function wheelGeometryBounds(
  shape: ShapeId,
  r = WHEEL_VISUAL_RADIUS,
): { width: number; height: number; depth: number } {
  switch (shape) {
    case 'circle':
      return { width: r * 2, height: r * 2, depth: WHEEL_DEPTH }
    case 'square':
      return { width: r * 2, height: r * 2, depth: WHEEL_DEPTH }
    case 'triangle':
      return { width: r * 2, height: r * 2, depth: WHEEL_DEPTH }
    case 'line':
      // Line/ski: wide (3× diameter) and very thin
      return { width: r * 2 * 3, height: r * 0.4, depth: WHEEL_DEPTH }
  }
}

// ─── Three.js geometry constructors ──────────────────────────────────────────

/**
 * Build and return a Three.js BufferGeometry for the given ShapeId.
 *
 * The geometry is pre-rotated so the shape "faces" the camera (side view).
 * Caller owns the geometry and must call `.dispose()` when swapping.
 */
export function wheelGeometry(shape: ShapeId): THREE.BufferGeometry {
  switch (shape) {
    case 'circle': {
      const geo = new THREE.CylinderGeometry(
        WHEEL_VISUAL_RADIUS,
        WHEEL_VISUAL_RADIUS,
        WHEEL_DEPTH,
        CIRCLE_SEGMENTS,
      )
      // Rotate so the cylinder axis faces the camera (z-axis = camera axis)
      geo.rotateX(Math.PI / 2)
      return geo
    }

    case 'square': {
      return new THREE.BoxGeometry(
        WHEEL_VISUAL_RADIUS * 2,
        WHEEL_VISUAL_RADIUS * 2,
        WHEEL_DEPTH,
      )
    }

    case 'triangle': {
      const { positions, indices } = wheelTriangleData(WHEEL_VISUAL_RADIUS, WHEEL_DEPTH)
      const geo = new THREE.BufferGeometry()
      geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
      geo.setIndex(new THREE.BufferAttribute(indices, 1))
      geo.computeVertexNormals()
      return geo
    }

    case 'line': {
      // Flat bar: wide (3× diameter), thin (40% of radius), wheel depth thick
      return new THREE.BoxGeometry(
        WHEEL_VISUAL_RADIUS * 6,
        WHEEL_VISUAL_RADIUS * 0.4,
        WHEEL_DEPTH,
      )
    }
  }
}
