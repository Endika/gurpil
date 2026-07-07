/**
 * Tests for classifyStroke.
 *
 * Strokes are generated programmatically using deterministic math so results
 * are stable across runs.  Noise (where present) is a fixed sine offset —
 * no random number generator.
 */

import { describe, it, expect } from 'vitest'
import { classifyStroke } from '../../src/core/classifyStroke'
import type { Point } from '../../src/core/classifyStroke'

// ─── Stroke generators ────────────────────────────────────────────────────────

/** Horizontal line from (0.05, 0.5) to (0.95, 0.5). */
function makeHorizontalLine(n = 40): Point[] {
  return Array.from({ length: n }, (_, i) => ({
    x: 0.05 + (i / (n - 1)) * 0.9,
    y: 0.5,
  }))
}

/** Diagonal line from (0.05, 0.05) to (0.95, 0.95). */
function makeDiagonalLine(n = 40): Point[] {
  return Array.from({ length: n }, (_, i) => {
    const t = i / (n - 1)
    return { x: 0.05 + t * 0.9, y: 0.05 + t * 0.9 }
  })
}

/**
 * Circle sampled around its full circumference with deterministic sine noise.
 * Noise amplitude is small enough that the stroke is still visibly circular.
 */
function makeCircle(n = 48, noiseAmp = 0.02): Point[] {
  return Array.from({ length: n + 1 }, (_, i) => {
    const angle = (i / n) * 2 * Math.PI
    // Deterministic "noise": small radial perturbation via a fixed sine pattern
    const noise = noiseAmp * Math.sin(angle * 5)
    const r = 0.35 + noise
    return {
      x: 0.5 + r * Math.cos(angle),
      y: 0.5 + r * Math.sin(angle),
    }
  })
}

/**
 * Triangle: three vertices with points sampled along each edge.
 * Vertices form an upward-pointing equilateral-ish triangle.
 */
function makeTriangle(n = 60): Point[] {
  const vertices: Point[] = [
    { x: 0.5, y: 0.1 }, // top
    { x: 0.9, y: 0.85 }, // bottom-right
    { x: 0.1, y: 0.85 }, // bottom-left
    { x: 0.5, y: 0.1 }, // close back to top
  ]
  return sampleAlongSegments(vertices, n)
}

/**
 * Square: four vertices with points sampled along each edge.
 * Axis-aligned square.
 */
function makeSquare(n = 80): Point[] {
  const vertices: Point[] = [
    { x: 0.1, y: 0.1 },
    { x: 0.9, y: 0.1 },
    { x: 0.9, y: 0.9 },
    { x: 0.1, y: 0.9 },
    { x: 0.1, y: 0.1 }, // close
  ]
  return sampleAlongSegments(vertices, n)
}

/**
 * Distribute `n` points evenly (by arc length) along the given sequence of
 * segment endpoints.  The input `verts` should include the closing vertex if
 * the shape is closed.
 */
function sampleAlongSegments(verts: Point[], n: number): Point[] {
  // Compute cumulative lengths
  const lengths: number[] = [0]
  for (let i = 1; i < verts.length; i++) {
    const dx = verts[i].x - verts[i - 1].x
    const dy = verts[i].y - verts[i - 1].y
    lengths.push(lengths[i - 1] + Math.sqrt(dx * dx + dy * dy))
  }
  const total = lengths[lengths.length - 1]

  const pts: Point[] = []
  let segIdx = 0
  for (let i = 0; i < n; i++) {
    const target = (i / (n - 1)) * total
    while (segIdx < verts.length - 2 && lengths[segIdx + 1] < target) segIdx++
    const segLen = lengths[segIdx + 1] - lengths[segIdx]
    const t = segLen < 1e-12 ? 0 : (target - lengths[segIdx]) / segLen
    pts.push({
      x: verts[segIdx].x + t * (verts[segIdx + 1].x - verts[segIdx].x),
      y: verts[segIdx].y + t * (verts[segIdx + 1].y - verts[segIdx].y),
    })
  }
  return pts
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('classifyStroke', () => {
  // ── Line detection ──────────────────────────────────────────────────────────

  describe('line strokes', () => {
    it('classifies a horizontal near-straight stroke as "line"', () => {
      expect(classifyStroke(makeHorizontalLine())).toBe('line')
    })

    it('classifies a diagonal near-straight stroke as "line"', () => {
      expect(classifyStroke(makeDiagonalLine())).toBe('line')
    })
  })

  // ── Circle detection ────────────────────────────────────────────────────────

  describe('circle strokes', () => {
    it('classifies a closed circular stroke (with sine noise) as "circle"', () => {
      expect(classifyStroke(makeCircle())).toBe('circle')
    })

    it('classifies a noiseless closed circle as "circle"', () => {
      expect(classifyStroke(makeCircle(48, 0))).toBe('circle')
    })
  })

  // ── Triangle detection ──────────────────────────────────────────────────────

  describe('triangle strokes', () => {
    it('classifies a 3-corner closed stroke as "triangle"', () => {
      expect(classifyStroke(makeTriangle())).toBe('triangle')
    })
  })

  // ── Square detection ────────────────────────────────────────────────────────

  describe('square strokes', () => {
    it('classifies a 4-corner closed stroke as "square"', () => {
      expect(classifyStroke(makeSquare())).toBe('square')
    })
  })

  // ── Degenerate inputs ───────────────────────────────────────────────────────

  describe('degenerate inputs', () => {
    it('returns a valid ShapeId for empty input', () => {
      const result = classifyStroke([])
      expect(['circle', 'line', 'square', 'triangle']).toContain(result)
    })

    it('returns a valid ShapeId for single-point input', () => {
      const result = classifyStroke([{ x: 0.5, y: 0.5 }])
      expect(['circle', 'line', 'square', 'triangle']).toContain(result)
    })

    it('returns a valid ShapeId for two identical points', () => {
      const result = classifyStroke([
        { x: 0.3, y: 0.7 },
        { x: 0.3, y: 0.7 },
      ])
      expect(['circle', 'line', 'square', 'triangle']).toContain(result)
    })

    it('returns a valid ShapeId for many identical points', () => {
      const pts: Point[] = Array(20).fill({ x: 0.2, y: 0.8 })
      const result = classifyStroke(pts)
      expect(['circle', 'line', 'square', 'triangle']).toContain(result)
    })

    it('returns a valid ShapeId for exactly two distinct points', () => {
      const result = classifyStroke([
        { x: 0.1, y: 0.1 },
        { x: 0.9, y: 0.9 },
      ])
      expect(['circle', 'line', 'square', 'triangle']).toContain(result)
    })
  })
})
