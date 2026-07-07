/**
 * Stroke classification — pure, deterministic, no ML.
 *
 * Takes a raw finger/mouse stroke (array of normalized 0..1 box coordinates)
 * and classifies it to the nearest ShapeId using a heuristic pipeline:
 *   1. Degenerate-input guard
 *   2. Resample to a fixed point count for stability
 *   3. Bounding-box aspect ratio + line-fit residual → 'line'
 *   4. Ramer–Douglas–Peucker simplification → corner count
 *      0 corners + closed → 'circle'
 *      3 corners        → 'triangle'
 *      4+ corners       → 'square'
 */

import type { ShapeId } from './shapes'

// ─── Public API ────────────────────────────────────────────────────────────────

export interface Point {
  x: number
  y: number
}

/** Classify a raw stroke to the nearest ShapeId. Never throws for ≥2-point input. */
export function classifyStroke(points: Point[]): ShapeId {
  // ── 1. Degenerate-input guard ──────────────────────────────────────────────
  if (points.length < 2) return 'circle'

  const allSame = points.every(
    (p) => Math.abs(p.x - points[0].x) < EPSILON && Math.abs(p.y - points[0].y) < EPSILON,
  )
  if (allSame) return 'circle'

  // ── 2. Resample for stability ──────────────────────────────────────────────
  const resampled = resamplePolyline(points, RESAMPLE_COUNT)

  // ── 3. Line detection (elongated + nearly straight) ────────────────────────
  const { aspectRatio } = boundingBox(resampled)
  const lineResidual = maxPerpendicularResidual(resampled)

  if (aspectRatio >= LINE_ASPECT_THRESHOLD && lineResidual < LINE_RESIDUAL_THRESHOLD) {
    return 'line'
  }

  // ── 4. Corner-count classification ────────────────────────────────────────
  const { diagonal } = boundingBox(resampled)
  // RDP epsilon is relative to the stroke's spatial extent for scale-independence
  const rdpEps = RDP_EPSILON * diagonal
  const simplified = rdpSimplify(resampled, rdpEps)
  const closed = isClosedStroke(resampled, CLOSED_DISTANCE_THRESHOLD)

  // For closed strokes the simplified polyline ends with pts[last] === pts[0],
  // forming a loop.  We must count the corner at the wrap-around vertex (e.g.
  // the first vertex of a triangle where the last edge meets the first edge)
  // by treating the simplified polyline as a cyclic sequence.  Open strokes
  // use the simpler linear scan.
  const corners = closed
    ? countSharpCornersWrapped(simplified, CORNER_ANGLE_THRESHOLD)
    : countSharpCorners(simplified, CORNER_ANGLE_THRESHOLD)

  if (corners <= CIRCLE_MAX_CORNERS && closed) return 'circle'
  if (corners === TRIANGLE_CORNERS) return 'triangle'
  if (corners >= SQUARE_MIN_CORNERS) return 'square'

  // Fallback: if not closed and 0–1 corners, treat as line; otherwise circle
  return closed ? 'circle' : 'line'
}

// ─── Tunable constants (no magic numbers) ──────────────────────────────────────

/** Minimum distance below which two points are considered identical. */
const EPSILON = 1e-9

/** Number of evenly-spaced points to resample the stroke to. */
const RESAMPLE_COUNT = 32

/**
 * Aspect ratio (max_extent / min_extent of bounding box) above which the
 * stroke is considered "elongated" for line detection.
 */
const LINE_ASPECT_THRESHOLD = 3.5

/**
 * Maximum perpendicular residual (as a fraction of the start-to-end chord
 * length; falls back to the bounding-box diagonal when the chord is degenerate)
 * below which the stroke is treated as "nearly straight" for line detection.
 */
const LINE_RESIDUAL_THRESHOLD = 0.12

/**
 * Epsilon for Ramer–Douglas–Peucker simplification, expressed as a fraction
 * of the bounding-box diagonal. Larger values → fewer vertices → fewer corners.
 */
const RDP_EPSILON = 0.06

/**
 * Interior-angle (in radians) below which a vertex is considered a sharp corner.
 * π = straight; smaller = sharper.
 *
 * Empirically derived from synthetic strokes:
 *   – Circle corners after RDP: ≥ 118° (2.06 rad)
 *   – Square corners: 87–94° (1.52–1.64 rad)
 *   – Triangle corners: ~64° (1.12 rad)
 * 110° (1.92 rad) sits cleanly between circle and square.
 */
const CORNER_ANGLE_THRESHOLD = 1.92 // ≈ 110°

/** Maximum sharp-corner count for a stroke to be classified as a circle. */
const CIRCLE_MAX_CORNERS = 0

/** Exact corner count that triggers 'triangle' classification. */
const TRIANGLE_CORNERS = 3

/** Minimum corner count that triggers 'square' classification. */
const SQUARE_MIN_CORNERS = 4

/**
 * Maximum distance between first and last resampled point (as a fraction of
 * the bounding-box diagonal) for the stroke to be considered "closed".
 */
const CLOSED_DISTANCE_THRESHOLD = 0.25

// ─── Internal helpers ──────────────────────────────────────────────────────────

/** Euclidean distance between two points. */
function dist(a: Point, b: Point): number {
  const dx = a.x - b.x
  const dy = a.y - b.y
  return Math.sqrt(dx * dx + dy * dy)
}

/** Cumulative arc-length along a polyline. */
function arcLengths(pts: Point[]): number[] {
  const lengths: number[] = [0]
  for (let i = 1; i < pts.length; i++) {
    lengths.push(lengths[i - 1] + dist(pts[i - 1], pts[i]))
  }
  return lengths
}

/**
 * Resample a polyline to exactly `n` evenly-spaced points by arc length.
 * Preserves first and last points.
 */
function resamplePolyline(pts: Point[], n: number): Point[] {
  if (pts.length === 0) return []
  if (pts.length === 1) return Array(n).fill(pts[0]) as Point[]

  const lengths = arcLengths(pts)
  const totalLength = lengths[lengths.length - 1]

  if (totalLength < EPSILON) {
    // All points coincide — return copies of the first point
    return Array(n).fill({ ...pts[0] }) as Point[]
  }

  const result: Point[] = []
  let srcIdx = 0

  for (let i = 0; i < n; i++) {
    const targetLen = (i / (n - 1)) * totalLength

    // Advance source index until the segment contains targetLen
    while (srcIdx < pts.length - 2 && lengths[srcIdx + 1] < targetLen) {
      srcIdx++
    }

    const segStart = lengths[srcIdx]
    const segEnd = lengths[srcIdx + 1]
    const segLen = segEnd - segStart

    if (segLen < EPSILON) {
      result.push({ ...pts[srcIdx] })
    } else {
      const t = (targetLen - segStart) / segLen
      result.push({
        x: pts[srcIdx].x + t * (pts[srcIdx + 1].x - pts[srcIdx].x),
        y: pts[srcIdx].y + t * (pts[srcIdx + 1].y - pts[srcIdx].y),
      })
    }
  }

  return result
}

/** Axis-aligned bounding box and aspect ratio of a point set. */
function boundingBox(pts: Point[]): {
  minX: number
  maxX: number
  minY: number
  maxY: number
  width: number
  height: number
  diagonal: number
  aspectRatio: number
} {
  let minX = pts[0].x
  let maxX = pts[0].x
  let minY = pts[0].y
  let maxY = pts[0].y

  for (const p of pts) {
    if (p.x < minX) minX = p.x
    if (p.x > maxX) maxX = p.x
    if (p.y < minY) minY = p.y
    if (p.y > maxY) maxY = p.y
  }

  const width = maxX - minX
  const height = maxY - minY
  const diagonal = Math.sqrt(width * width + height * height)
  const maxExtent = Math.max(width, height)
  const minExtent = Math.min(width, height)
  const aspectRatio = minExtent < EPSILON ? Infinity : maxExtent / minExtent

  return { minX, maxX, minY, maxY, width, height, diagonal, aspectRatio }
}

/**
 * Maximum perpendicular distance of any point from the line through first→last,
 * normalized by the length of the start→end segment (or bounding-box diagonal
 * as fallback).  Low values mean the stroke is nearly straight.
 */
function maxPerpendicularResidual(pts: Point[]): number {
  const a = pts[0]
  const b = pts[pts.length - 1]
  const lineLen = dist(a, b)

  if (lineLen < EPSILON) {
    // Degenerate: start === end; residual is max distance from start point
    const { diagonal } = boundingBox(pts)
    if (diagonal < EPSILON) return 0
    let maxDist = 0
    for (const p of pts) {
      const d = dist(p, a)
      if (d > maxDist) maxDist = d
    }
    return maxDist / diagonal
  }

  // Direction vector of the start→end line
  const dx = (b.x - a.x) / lineLen
  const dy = (b.y - a.y) / lineLen

  let maxPerp = 0
  for (const p of pts) {
    // Perpendicular distance = |cross product| of (p - a) with direction
    const perpDist = Math.abs((p.x - a.x) * dy - (p.y - a.y) * dx)
    if (perpDist > maxPerp) maxPerp = perpDist
  }

  // Normalize by line length so the threshold is scale-independent
  return maxPerp / lineLen
}

/**
 * Ramer–Douglas–Peucker polyline simplification.
 * `eps` is the absolute perpendicular-distance tolerance.
 */
function rdpSimplify(pts: Point[], eps: number): Point[] {
  if (pts.length <= 2) return [...pts]

  // Find the point with maximum perpendicular distance from the start→end line
  const a = pts[0]
  const b = pts[pts.length - 1]
  const lineLen = dist(a, b)

  let maxDist = 0
  let maxIdx = 0

  for (let i = 1; i < pts.length - 1; i++) {
    let d: number
    if (lineLen < EPSILON) {
      d = dist(pts[i], a)
    } else {
      const dx = (b.x - a.x) / lineLen
      const dy = (b.y - a.y) / lineLen
      d = Math.abs((pts[i].x - a.x) * dy - (pts[i].y - a.y) * dx)
    }
    if (d > maxDist) {
      maxDist = d
      maxIdx = i
    }
  }

  if (maxDist <= eps) {
    // All intermediate points are within tolerance: keep only endpoints
    return [pts[0], pts[pts.length - 1]]
  }

  // Recursively simplify both sub-segments and join (drop duplicate middle point)
  const left = rdpSimplify(pts.slice(0, maxIdx + 1), eps)
  const right = rdpSimplify(pts.slice(maxIdx), eps)
  return [...left.slice(0, -1), ...right]
}

/**
 * Count sharp corners in a simplified polyline.
 * A corner is a vertex where the interior angle (angle between incoming and
 * outgoing segments) is below `angleThreshold` (radians).
 * Sharp = small angle → the direction changes abruptly.
 */
function countSharpCorners(pts: Point[], angleThreshold: number): number {
  if (pts.length < 3) return 0

  let count = 0
  for (let i = 1; i < pts.length - 1; i++) {
    const prev = pts[i - 1]
    const curr = pts[i]
    const next = pts[i + 1]

    // Vectors incoming and outgoing
    const inDx = curr.x - prev.x
    const inDy = curr.y - prev.y
    const outDx = next.x - curr.x
    const outDy = next.y - curr.y

    const inLen = Math.sqrt(inDx * inDx + inDy * inDy)
    const outLen = Math.sqrt(outDx * outDx + outDy * outDy)

    if (inLen < EPSILON || outLen < EPSILON) continue

    const dot = (inDx * outDx + inDy * outDy) / (inLen * outLen)
    // Clamp for numerical safety before acos
    const angle = Math.acos(Math.max(-1, Math.min(1, dot)))

    // angle close to π → straight; angle close to 0 → sharp U-turn
    // Interior angle = π − angle (the supplement)
    const interiorAngle = Math.PI - angle
    if (interiorAngle < angleThreshold) count++
  }

  return count
}

/**
 * Count sharp corners in a CLOSED simplified polyline (last point === first point).
 *
 * For a closed stroke the standard linear scan misses the corner at the
 * wrap-around vertex (where the last segment meets the first segment).
 * This variant treats the simplified polyline as a cyclic sequence, iterating
 * over all `n - 1` unique vertices (last == first is the repeated closing vertex).
 */
function countSharpCornersWrapped(pts: Point[], angleThreshold: number): number {
  const n = pts.length - 1 // unique vertex count (pts[n] === pts[0])
  if (n < 3) return 0

  let count = 0
  for (let i = 0; i < n; i++) {
    const prev = pts[(i - 1 + n) % n]
    const curr = pts[i]
    const next = pts[(i + 1) % n]

    const inDx = curr.x - prev.x
    const inDy = curr.y - prev.y
    const outDx = next.x - curr.x
    const outDy = next.y - curr.y

    const inLen = Math.sqrt(inDx * inDx + inDy * inDy)
    const outLen = Math.sqrt(outDx * outDx + outDy * outDy)

    if (inLen < EPSILON || outLen < EPSILON) continue

    const dot = (inDx * outDx + inDy * outDy) / (inLen * outLen)
    const angle = Math.acos(Math.max(-1, Math.min(1, dot)))
    const interiorAngle = Math.PI - angle
    if (interiorAngle < angleThreshold) count++
  }

  return count
}

/**
 * Returns true if the stroke's start and end points are close enough to be
 * considered a closed loop.  Threshold is a fraction of the bounding diagonal.
 */
function isClosedStroke(pts: Point[], threshold: number): boolean {
  const endDist = dist(pts[0], pts[pts.length - 1])
  const { diagonal } = boundingBox(pts)
  if (diagonal < EPSILON) return true // all same point
  return endDist / diagonal < threshold
}
