/**
 * Wheel geometry factory — maps ShapeId to a Three.js BufferGeometry.
 *
 * Each shape produces a distinct 3D form:
 *   circle   → CylinderGeometry (disc, axis aligned with z)
 *   square   → BoxGeometry (equal width × height × depth)
 *   triangle → Triangular prism (extruded isosceles triangle)
 *   line     → CapsuleGeometry (elongated rounded roller — real thickness and
 *              rounded ends, so it reads as a solid rolling shape rather than
 *              a thin stick at any spin angle; wheels are motor-driven and
 *              spin continuously)
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
 * 'line' wheel — solid rounded roller (CapsuleGeometry) tuning.
 *
 * The capsule's cross-section RADIUS sets its thickness; its total end-to-end
 * LENGTH (straight segment + the two rounded end caps) sets its "long" reach.
 * Both are named as a single source of truth shared by `wheelGeometry` (the
 * real Three.js geometry) and `wheelGeometryBounds` (the pure bounding-box
 * data used by tests), so the two never drift apart.
 */
/** Cross-section (thickness) radius — a full diameter of one WHEEL_VISUAL_RADIUS,
 *  clearly thicker than the old thin bar (which was 0.4× the radius tall) so the
 *  shape reads as a solid roller, not a sliver, at any spin angle. */
const LINE_RADIUS = WHEEL_VISUAL_RADIUS * 0.5
/** Overall end-to-end length — matches the old flat bar's width (3× the wheel
 *  diameter) so the shape keeps the same "long" silhouette on screen. */
const LINE_LENGTH = WHEEL_VISUAL_RADIUS * 6
/** Straight cylindrical segment fed to CapsuleGeometry: overall length minus
 *  the two rounded hemispherical end caps (each LINE_RADIUS deep). */
const LINE_SEGMENT_LENGTH = LINE_LENGTH - 2 * LINE_RADIUS
/** Hemispherical end-cap subdivision — smooth enough to read as rounded. */
const LINE_CAP_SEGMENTS = 4
/** Radial subdivision around the roller's cross-section. */
const LINE_RADIAL_SEGMENTS = 12

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
    case 'line': {
      // Line: elongated rounded roller — wide (matches the old bar's overall
      // length) but with a solid cross-section thickness, not a thin sliver.
      // Scaled by r/WHEEL_VISUAL_RADIUS so callers passing a non-default r
      // still get proportionally correct bounds.
      const scale = r / WHEEL_VISUAL_RADIUS
      return { width: LINE_LENGTH * scale, height: LINE_RADIUS * 2 * scale, depth: WHEEL_DEPTH }
    }
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
      // Elongated rounded roller: real cross-section thickness (LINE_RADIUS)
      // with hemispherical end caps, so it reads as a solid rolling shape —
      // not a thin flailing stick — at any spin angle.
      const geo = new THREE.CapsuleGeometry(
        LINE_RADIUS,
        LINE_SEGMENT_LENGTH,
        LINE_CAP_SEGMENTS,
        LINE_RADIAL_SEGMENTS,
      )
      // CapsuleGeometry's local axis is Y; rotate 90° about Z so the long
      // axis runs along X (matches the old bar's horizontal orientation).
      geo.rotateZ(Math.PI / 2)
      // Independently rescale the depth (z) axis to match WHEEL_DEPTH, like
      // every other wheel shape — this only stretches the depth, it does not
      // touch the camera-facing x/y silhouette (the rounded roller profile).
      geo.scale(1, 1, WHEEL_DEPTH / (LINE_RADIUS * 2))
      geo.computeVertexNormals()
      return geo
    }
  }
}
