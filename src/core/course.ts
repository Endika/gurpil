/**
 * Course model — pure, framework-agnostic track description.
 *
 * Produces a deterministic polyline (`ground`) and associated metadata for the
 * Gurpil MVP track.  No Three.js, no Rapier, no DOM.
 *
 * Consumers:
 *   - Task 6 (physics): builds Rapier static ground colliders from `ground`;
 *     egg colliders from `obstacles`; applies `surfaceFriction(x)`.
 *   - Task 9 (render): builds the Three.js terrain mesh from `ground`.
 */

import type { Point } from './classifyStroke'

// ─── Public types ──────────────────────────────────────────────────────────────

export type TerrainKind = 'flat' | 'rocky' | 'uphill' | 'mud' | 'ice' | 'eggs'

export interface Obstacle {
  x: number
  y: number
  kind: 'egg'
}

export interface Course {
  /** Left→right polyline of ground surface. x strictly increasing. */
  ground: Point[]
  obstacles: Obstacle[]
  startX: number
  finishX: number
  /** Per-x friction coefficient. Lower on ice, higher on mud. */
  surfaceFriction: (x: number) => number
}

// ─── Segment boundaries (x positions) ────────────────────────────────────────

/** Course origin. */
const X_START = 0

/** End of the flat start zone. */
const X_FLAT_END = 20

/** End of the rocky sawtooth segment. */
const X_ROCKY_END = 50

/** End of the uphill ramp. */
const X_UPHILL_END = 90

/** End of the mud segment. */
const X_MUD_END = 130

/** End of the ice segment. */
const X_ICE_END = 170

/** End of the eggs flat stretch. */
const X_EGGS_END = 210

/** Finish line / end of the run-out. */
const X_FINISH = 230

// ─── Terrain geometry constants ───────────────────────────────────────────────

/** Ground y at the start zone (roughly "sea level"). */
const BASE_Y = 0

/** Peak y value reached at the top of the uphill ramp. */
const UPHILL_PEAK_Y = 15

/** Amplitude of the sawtooth bumps in the rocky zone. */
const ROCKY_BUMP_AMPLITUDE = 1.5

/** Period (x-width) of one full sawtooth cycle in the rocky zone. */
const ROCKY_BUMP_PERIOD = 5

/** Slope of the ice segment: slight downhill (y decreases by this per unit x). */
const ICE_DOWNHILL_SLOPE = 0.05

/** Number of sample points per unit x for the polyline. */
const POINTS_PER_UNIT = 1

// ─── Friction constants ───────────────────────────────────────────────────────

/** Default / base friction applied everywhere outside special zones. */
const FRICTION_BASE = 0.6

/** Friction in the mud zone (high grip). */
const FRICTION_MUD = 1.2

/** Friction in the ice zone (low grip). */
const FRICTION_ICE = 0.15

// ─── Egg obstacle constants ───────────────────────────────────────────────────

/** x positions (absolute) of egg obstacles within the eggs stretch. */
const EGG_X_POSITIONS: readonly number[] = [185, 190, 195, 200, 205]

// ─── Segment definitions (drives both buildCourse and surfaceFriction) ────────

interface SegmentDef {
  kind: TerrainKind
  xStart: number
  xEnd: number
  friction: number
  /** Returns the y value at a given x within this segment. */
  y: (x: number) => number
}

/**
 * Compute y at the start of the uphill ramp (end of rocky zone).
 * Rocky bumps leave the surface at y=BASE_Y on average; the ramp starts there.
 */
function rockyY(x: number): number {
  // Sawtooth: cycles from -amp to +amp over ROCKY_BUMP_PERIOD
  const phase = ((x - X_FLAT_END) % ROCKY_BUMP_PERIOD) / ROCKY_BUMP_PERIOD
  return BASE_Y + ROCKY_BUMP_AMPLITUDE * (2 * phase - 1)
}

function uphillY(x: number): number {
  const t = (x - X_ROCKY_END) / (X_UPHILL_END - X_ROCKY_END)
  return BASE_Y + t * UPHILL_PEAK_Y
}

function iceY(x: number): number {
  // Slight downhill from UPHILL_PEAK_Y, starting at y=UPHILL_PEAK_Y at X_MUD_END
  const dx = x - X_MUD_END
  return UPHILL_PEAK_Y - dx * ICE_DOWNHILL_SLOPE
}

const SEGMENTS: SegmentDef[] = [
  {
    kind: 'flat',
    xStart: X_START,
    xEnd: X_FLAT_END,
    friction: FRICTION_BASE,
    y: () => BASE_Y,
  },
  {
    kind: 'rocky',
    xStart: X_FLAT_END,
    xEnd: X_ROCKY_END,
    friction: FRICTION_BASE,
    y: rockyY,
  },
  {
    kind: 'uphill',
    xStart: X_ROCKY_END,
    xEnd: X_UPHILL_END,
    friction: FRICTION_BASE,
    y: uphillY,
  },
  {
    kind: 'mud',
    xStart: X_UPHILL_END,
    xEnd: X_MUD_END,
    friction: FRICTION_MUD,
    y: () => UPHILL_PEAK_Y,
  },
  {
    kind: 'ice',
    xStart: X_MUD_END,
    xEnd: X_ICE_END,
    friction: FRICTION_ICE,
    y: iceY,
  },
  {
    kind: 'eggs',
    xStart: X_ICE_END,
    xEnd: X_EGGS_END,
    friction: FRICTION_BASE,
    y: () => UPHILL_PEAK_Y - (X_ICE_END - X_MUD_END) * ICE_DOWNHILL_SLOPE,
  },
  {
    kind: 'flat',
    xStart: X_EGGS_END,
    xEnd: X_FINISH,
    friction: FRICTION_BASE,
    y: () => UPHILL_PEAK_Y - (X_ICE_END - X_MUD_END) * ICE_DOWNHILL_SLOPE,
  },
]

// ─── Public API ────────────────────────────────────────────────────────────────

/**
 * Build the deterministic MVP course.
 *
 * Calling `buildCourse()` twice always yields identical `ground`, `obstacles`,
 * `startX`, and `finishX` — no random state used.
 */
export function buildCourse(): Course {
  const ground = buildGround()
  const obstacles = buildObstacles()

  return {
    ground,
    obstacles,
    startX: X_START,
    finishX: X_FINISH,
    surfaceFriction: surfaceFriction,
  }
}

// ─── Internal builders ─────────────────────────────────────────────────────────

function buildGround(): Point[] {
  const points: Point[] = []

  for (const seg of SEGMENTS) {
    const step = 1 / POINTS_PER_UNIT
    // Emit one point at every step; for continuity the first point of each
    // segment is at seg.xStart (the last segment's final point is at xEnd).
    for (let x = seg.xStart; x < seg.xEnd; x += step) {
      points.push({ x, y: seg.y(x) })
    }
  }

  // Add the final finish point explicitly to cap the polyline at X_FINISH
  const lastSeg = SEGMENTS[SEGMENTS.length - 1]
  points.push({ x: X_FINISH, y: lastSeg.y(X_FINISH) })

  return points
}

function buildObstacles(): Obstacle[] {
  const eggSeg = SEGMENTS.find((s) => s.kind === 'eggs')!
  return EGG_X_POSITIONS.map((x) => ({
    x,
    y: eggSeg.y(x),
    kind: 'egg' as const,
  }))
}

/**
 * Returns the friction coefficient at position `x`.
 * Looks up the matching segment; falls back to FRICTION_BASE for out-of-range x.
 */
function surfaceFriction(x: number): number {
  for (const seg of SEGMENTS) {
    if (x >= seg.xStart && x < seg.xEnd) {
      return seg.friction
    }
  }
  // Exact finish boundary or beyond course bounds
  return FRICTION_BASE
}
