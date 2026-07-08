/**
 * Course model — pure, framework-agnostic track description.
 *
 * Produces a deterministic polyline (`ground`) and associated metadata for the
 * Gurpil track.  No Three.js, no Rapier, no DOM.
 *
 * Two ways to obtain a Course:
 *   - `buildCourse()` / `buildCanonicalCourse()` → the fixed, hand-tuned
 *     "canonical" track. This is the STABLE REFERENCE the physics is tuned
 *     against; the physics tests drive it so their per-shape gates stay valid.
 *   - `generateCourse({ difficulty, seed })` → a SEEDED, difficulty-scaled track
 *     assembled from the SAME tuned per-zone physics parameters, so every
 *     generated track is always completable with the right sequence of shapes.
 *
 * Consumers:
 *   - physics (`src/physics`): builds Rapier static ground colliders from
 *     `ground`; egg colliders from `obstacles`; applies `surfaceFriction(x)`.
 *   - render (`src/render`): builds the Three.js terrain mesh from `ground`.
 */

import type { Point } from './classifyStroke'

// ─── Public types ──────────────────────────────────────────────────────────────

export type TerrainKind = 'flat' | 'rocky' | 'uphill' | 'mud' | 'ice' | 'eggs'

export interface Obstacle {
  x: number
  y: number
  kind: 'egg'
}

/** A contiguous terrain zone, exposed so tests + later stages can LOCATE a zone
 *  (e.g. "the uphill", "the eggs") without hardcoding absolute x positions. */
export interface Zone {
  kind: TerrainKind
  xStart: number
  xEnd: number
}

export interface Course {
  /** Left→right polyline of ground surface. x strictly increasing. */
  ground: Point[]
  obstacles: Obstacle[]
  startX: number
  finishX: number
  /** Per-x friction coefficient. Lower on ice, higher on mud. */
  surfaceFriction: (x: number) => number
  /** Ordered terrain zones spanning [startX, finishX]. */
  zones: Zone[]
}

export type Difficulty = 'easy' | 'medium' | 'hard'

export interface CourseOptions {
  difficulty: Difficulty
  seed: number
}

// ─── Shared terrain physics constants (canonical AND generated) ───────────────
//
// These are the hand-tuned values the physics is calibrated against. The
// generator REUSES them verbatim so a generated track's zones behave exactly
// like the canonical ones the shape gates were tuned on — this is what keeps
// every generated track completable with the right shape.

/** Ground y baseline ("sea level"). Every zone starts AND ends here, so zones
 *  compose in any random order with a continuous surface. */
const BASE_Y = 0

/** Default / base friction applied everywhere outside special zones. */
const FRICTION_BASE = 0.6

/** Friction in the mud zone (high grip). */
const FRICTION_MUD = 1.2

/** Friction in the ice zone (low grip). */
const FRICTION_ICE = 0.15

/**
 * Friction of the UPHILL ramp SURFACE — deliberately slippery (the "triangle /
 * square gate", mirroring the "eggs → line" gate).
 *
 * Rapier combines the two contacting frictions with the default AVERAGE rule, so
 * the effective grip on the ramp is (wheelFriction + FRICTION_UPHILL) / 2:
 *   - circle   (0.55): (0.55 + 0.1)/2 = 0.325  < tan(26.6°)=0.50 → SLIPS.
 *   - square   (1.1) : (1.1  + 0.1)/2 = 0.60   > 0.50 → grips and climbs.
 *   - triangle (1.3) : (1.3  + 0.1)/2 = 0.70   > 0.50 → grips and climbs easily.
 */
const FRICTION_UPHILL = 0.1

/**
 * Maximum uphill GRADE (rise/run) the generator will ever emit. This is the
 * canonical ramp grade (rise 20 over run 40 = 0.5, ~26.6°): the KNOWN-SAFE
 * ceiling where the grippy triangle still summits but the low-grip circle slips.
 * Generated hills are capped here so a triangle can always clear them.
 */
const UPHILL_MAX_GRADE = 0.5

/**
 * Maximum local slope allowed on the rocky sine bumps. Matches the canonical
 * rocky wave's peak slope (amp 0.45, period 6 → 0.45·2π/6 ≈ 0.47). The generator
 * derives each rocky zone's wave period from its amplitude so this cap is never
 * exceeded — guaranteeing a circle can always mount the bumps (no wedging).
 */
const ROCKY_MAX_SLOPE = 0.47

/** Egg spacing / lead-in / trailing run within an eggs zone (metres).
 *  Spacing is the canonical value so the LINE still clears the eggs. */
const EGG_SPACING = 5
const EGG_LEAD_IN = 15
const EGG_TRAIL = 10

/**
 * Sample points per unit x for STRAIGHT segments (flat / linear ramps). One per
 * unit is plenty — a straight line needs only its endpoints. Kept at 1 so the
 * flat start zone's collider layout is unchanged (the swap anti-pop tests settle
 * the vehicle there and are sensitive to extra contact points).
 */
const POINTS_PER_UNIT = 1

/**
 * Sample points per unit x for CURVED segments (the rocky sine). Denser so the
 * smooth curve is approximated by many short chords rather than a few long ones
 * — long chords would reintroduce sharp corners (mini-cliffs) at the sample
 * joints and re-create the wedging bug.
 */
const CURVED_POINTS_PER_UNIT = 4

// ─── Internal segment model (drives ground + surfaceFriction + zones) ─────────

interface SegmentDef {
  kind: TerrainKind
  xStart: number
  xEnd: number
  friction: number
  /** Returns the y value at a given x within this segment. */
  y: (x: number) => number
  /** Curved segments are sampled densely (see CURVED_POINTS_PER_UNIT). */
  curved?: boolean
}

// ─── Shared assemblers (used by canonical AND generated builders) ─────────────

function buildGroundFrom(segments: SegmentDef[], finishX: number): Point[] {
  const points: Point[] = []

  for (const seg of segments) {
    const density = seg.curved ? CURVED_POINTS_PER_UNIT : POINTS_PER_UNIT
    const step = 1 / density
    // Emit one point at every step; the first point of each segment is at
    // seg.xStart. Stop just before xEnd so the next segment's xStart is the next
    // point (strictly increasing x, no duplicate at joins).
    for (let x = seg.xStart; x < seg.xEnd - 1e-9; x += step) {
      points.push({ x, y: seg.y(x) })
    }
  }

  // Cap the polyline at finishX with an explicit final point.
  const lastSeg = segments[segments.length - 1]
  points.push({ x: finishX, y: lastSeg.y(finishX) })

  return points
}

function makeSurfaceFriction(segments: SegmentDef[]): (x: number) => number {
  return (x: number): number => {
    for (const seg of segments) {
      if (x >= seg.xStart && x < seg.xEnd) return seg.friction
    }
    // Exact finish boundary or beyond course bounds.
    return FRICTION_BASE
  }
}

function toZones(segments: SegmentDef[]): Zone[] {
  return segments.map((s) => ({ kind: s.kind, xStart: s.xStart, xEnd: s.xEnd }))
}

function assembleCourse(
  segments: SegmentDef[],
  obstacles: Obstacle[],
  startX: number,
  finishX: number,
): Course {
  return {
    ground: buildGroundFrom(segments, finishX),
    obstacles,
    startX,
    finishX,
    surfaceFriction: makeSurfaceFriction(segments),
    zones: toZones(segments),
  }
}

// ─── Zone location helpers (for tests + later stages) ─────────────────────────

/** All zones of a given kind, in order. */
export function zonesOf(course: Course, kind: TerrainKind): Zone[] {
  return course.zones.filter((z) => z.kind === kind)
}

/** The first zone of a given kind, or undefined if the course has none. */
export function firstZoneOf(course: Course, kind: TerrainKind): Zone | undefined {
  return course.zones.find((z) => z.kind === kind)
}

/** The zone containing x (xStart ≤ x < xEnd), or undefined if out of bounds. */
export function zoneAt(course: Course, x: number): Zone | undefined {
  return course.zones.find((z) => x >= z.xStart && x < z.xEnd)
}

// ═══════════════════════════════════════════════════════════════════════════════
//  CANONICAL COURSE — the fixed, hand-tuned reference track.
//  The physics is tuned against THIS layout; the physics tests drive it.
// ═══════════════════════════════════════════════════════════════════════════════

/** Course origin. */
const X_START = 0
/** End of the flat start zone. */
const X_FLAT_END = 20
/** End of the rocky bump segment. */
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

/** Peak y at the top of the canonical uphill ramp (metres above BASE_Y). Grade
 *  = 20/40 = 0.5 = UPHILL_MAX_GRADE: the tuned ceiling where the triangle
 *  summits and the circle slips. */
const UPHILL_PEAK_Y = 20

/** Amplitude of the canonical rocky bumps (smooth sine, no vertical cliffs). */
const ROCKY_BUMP_AMPLITUDE = 0.45
/** Period (x-width) of one canonical rocky sine cycle. 5 whole cycles in [20,50). */
const ROCKY_BUMP_PERIOD = 6
/** Slope of the canonical ice segment: slight downhill. */
const ICE_DOWNHILL_SLOPE = 0.05
/** x positions (absolute) of the canonical egg obstacles. */
const EGG_X_POSITIONS: readonly number[] = [185, 190, 195, 200, 205]

function canonicalRockyY(x: number): number {
  const phase = (x - X_FLAT_END) / ROCKY_BUMP_PERIOD
  return BASE_Y + ROCKY_BUMP_AMPLITUDE * Math.sin(2 * Math.PI * phase)
}
function canonicalUphillY(x: number): number {
  const t = (x - X_ROCKY_END) / (X_UPHILL_END - X_ROCKY_END)
  return BASE_Y + t * UPHILL_PEAK_Y
}
function canonicalIceY(x: number): number {
  const dx = x - X_MUD_END
  return UPHILL_PEAK_Y - dx * ICE_DOWNHILL_SLOPE
}
const CANONICAL_EGGS_Y = UPHILL_PEAK_Y - (X_ICE_END - X_MUD_END) * ICE_DOWNHILL_SLOPE

const CANONICAL_SEGMENTS: SegmentDef[] = [
  { kind: 'flat', xStart: X_START, xEnd: X_FLAT_END, friction: FRICTION_BASE, y: () => BASE_Y },
  { kind: 'rocky', xStart: X_FLAT_END, xEnd: X_ROCKY_END, friction: FRICTION_BASE, y: canonicalRockyY, curved: true },
  { kind: 'uphill', xStart: X_ROCKY_END, xEnd: X_UPHILL_END, friction: FRICTION_UPHILL, y: canonicalUphillY },
  { kind: 'mud', xStart: X_UPHILL_END, xEnd: X_MUD_END, friction: FRICTION_MUD, y: () => UPHILL_PEAK_Y },
  { kind: 'ice', xStart: X_MUD_END, xEnd: X_ICE_END, friction: FRICTION_ICE, y: canonicalIceY },
  { kind: 'eggs', xStart: X_ICE_END, xEnd: X_EGGS_END, friction: FRICTION_BASE, y: () => CANONICAL_EGGS_Y },
  { kind: 'flat', xStart: X_EGGS_END, xEnd: X_FINISH, friction: FRICTION_BASE, y: () => CANONICAL_EGGS_Y },
]

/**
 * Build the fixed, hand-tuned canonical course. Deterministic and pure: two
 * calls always yield identical ground/obstacles/startX/finishX (no random state).
 */
export function buildCanonicalCourse(): Course {
  const eggSeg = CANONICAL_SEGMENTS.find((s) => s.kind === 'eggs')!
  const obstacles: Obstacle[] = EGG_X_POSITIONS.map((x) => ({ x, y: eggSeg.y(x), kind: 'egg' as const }))
  return assembleCourse(CANONICAL_SEGMENTS, obstacles, X_START, X_FINISH)
}

/**
 * Build the default MVP course.
 *
 * Thin wrapper over `buildCanonicalCourse()` so a STABLE reference track exists:
 * the physics is tuned against it and the physics tests drive it. Deterministic.
 */
export function buildCourse(): Course {
  return buildCanonicalCourse()
}

// ═══════════════════════════════════════════════════════════════════════════════
//  SEEDED, DIFFICULTY-BASED GENERATOR
// ═══════════════════════════════════════════════════════════════════════════════

// ─── Seeded PRNG (mulberry32) — deterministic, no Math.random/Date ────────────

/**
 * mulberry32: a tiny, fast, deterministic 32-bit PRNG. Same seed → same stream.
 * Returns a function yielding floats in [0, 1).
 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return function (): number {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

type Rng = () => number

/** Float in [min, max). */
function randRange(rng: Rng, min: number, max: number): number {
  return min + rng() * (max - min)
}
/** Integer in [min, max] inclusive. */
function randInt(rng: Rng, min: number, max: number): number {
  return Math.floor(randRange(rng, min, max + 1))
}
/** A random element of a non-empty array. */
function pick<T>(rng: Rng, items: readonly T[]): T {
  return items[Math.floor(rng() * items.length)]
}

// ─── Difficulty parameter table ───────────────────────────────────────────────
//
// Every hazard parameter is a named range here — no magic values scattered in
// the generator. Easy = shorter, gentler, fewer hazards; hard = longer, steeper,
// more hazards. Steepness/spacing are bounded by the shared tuned ceilings above
// (UPHILL_MAX_GRADE, ROCKY_MAX_SLOPE, EGG_SPACING) so every difficulty stays
// completable with the right shape.

interface DifficultyParams {
  /** Flat run-in length at the start (metres). */
  flatStartLen: number
  /** Flat run-out length before the finish (metres). */
  flatEndLen: number
  /** Number of hazard zones between the start and end flats (inclusive range). */
  hazardCount: [number, number]
  /** Which hazard kinds may appear at this difficulty. */
  hazards: readonly TerrainKind[]
  /** Uphill grade (rise/run) range; clamped to UPHILL_MAX_GRADE. */
  hillGrade: [number, number]
  /** Uphill total (up-and-over) length range (metres). */
  hillLen: [number, number]
  /** Rocky sine amplitude range (metres). */
  rockyAmp: [number, number]
  /** Rocky zone length range (metres). */
  rockyLen: [number, number]
  /** Mud zone length range (metres). */
  mudLen: [number, number]
  /** Ice zone length range (metres). */
  iceLen: [number, number]
  /** Number of eggs in an eggs zone (inclusive range). */
  eggCount: [number, number]
}

export const DIFFICULTY_PARAMS: Record<Difficulty, DifficultyParams> = {
  easy: {
    flatStartLen: 20,
    flatEndLen: 20,
    hazardCount: [2, 3],
    hazards: ['rocky', 'uphill', 'mud', 'eggs'],
    hillGrade: [0.28, 0.4],
    hillLen: [24, 40],
    rockyAmp: [0.3, 0.45],
    rockyLen: [18, 28],
    mudLen: [18, 28],
    iceLen: [18, 28],
    eggCount: [3, 4],
  },
  medium: {
    flatStartLen: 20,
    flatEndLen: 20,
    hazardCount: [3, 5],
    hazards: ['rocky', 'uphill', 'mud', 'ice', 'eggs'],
    hillGrade: [0.38, 0.46],
    hillLen: [36, 64],
    rockyAmp: [0.4, 0.55],
    rockyLen: [24, 36],
    mudLen: [28, 44],
    iceLen: [28, 44],
    eggCount: [4, 6],
  },
  hard: {
    flatStartLen: 20,
    flatEndLen: 20,
    hazardCount: [5, 7],
    hazards: ['rocky', 'uphill', 'mud', 'ice', 'eggs'],
    hillGrade: [0.44, 0.5],
    hillLen: [56, 90],
    rockyAmp: [0.5, 0.62],
    rockyLen: [30, 46],
    mudLen: [40, 58],
    iceLen: [40, 58],
    eggCount: [6, 9],
  },
}

/** Canonical seed used when a stable "default generated" track is wanted. */
export const CANONICAL_SEED = 1

// ─── Zone builders (each returns a SegmentDef starting/ending at BASE_Y) ──────

interface BuiltZone {
  seg: SegmentDef
  obstacles?: Obstacle[]
}

function flatZone(xStart: number, len: number): BuiltZone {
  return {
    seg: { kind: 'flat', xStart, xEnd: xStart + len, friction: FRICTION_BASE, y: () => BASE_Y },
  }
}

function rockyZone(rng: Rng, xStart: number, p: DifficultyParams): BuiltZone {
  const amp = randRange(rng, p.rockyAmp[0], p.rockyAmp[1])
  const len = Math.round(randRange(rng, p.rockyLen[0], p.rockyLen[1]))
  // Derive the number of whole sine cycles so the local slope never exceeds
  // ROCKY_MAX_SLOPE. slope_max = amp·2π/period ≤ cap ⇒ period ≥ amp·2π/cap.
  // floor keeps period ≥ that minimum (slope ≤ cap); whole cycles return to BASE_Y.
  const minPeriod = (amp * 2 * Math.PI) / ROCKY_MAX_SLOPE
  const cycles = Math.max(1, Math.floor(len / minPeriod))
  const period = len / cycles
  const xEnd = xStart + len
  return {
    seg: {
      kind: 'rocky',
      xStart,
      xEnd,
      friction: FRICTION_BASE,
      curved: true,
      y: (x: number) => BASE_Y + amp * Math.sin((2 * Math.PI * (x - xStart)) / period),
    },
  }
}

function uphillZone(rng: Rng, xStart: number, p: DifficultyParams): BuiltZone {
  const grade = Math.min(UPHILL_MAX_GRADE, randRange(rng, p.hillGrade[0], p.hillGrade[1]))
  const len = Math.round(randRange(rng, p.hillLen[0], p.hillLen[1]))
  const half = len / 2
  const xEnd = xStart + len
  // Up-and-over hill: rises at `grade` to a peak at the midpoint, then descends
  // back to BASE_Y. The up-side is identical physics to the canonical ramp, so
  // the triangle summits it and the circle slips — the SAME grip gate.
  return {
    seg: {
      kind: 'uphill',
      xStart,
      xEnd,
      friction: FRICTION_UPHILL,
      y: (x: number): number => {
        const dx = x - xStart
        return BASE_Y + (dx <= half ? dx : len - dx) * grade
      },
    },
  }
}

function mudZone(rng: Rng, xStart: number, p: DifficultyParams): BuiltZone {
  const len = Math.round(randRange(rng, p.mudLen[0], p.mudLen[1]))
  return { seg: { kind: 'mud', xStart, xEnd: xStart + len, friction: FRICTION_MUD, y: () => BASE_Y } }
}

function iceZone(rng: Rng, xStart: number, p: DifficultyParams): BuiltZone {
  const len = Math.round(randRange(rng, p.iceLen[0], p.iceLen[1]))
  return { seg: { kind: 'ice', xStart, xEnd: xStart + len, friction: FRICTION_ICE, y: () => BASE_Y } }
}

function eggsZone(rng: Rng, xStart: number, p: DifficultyParams): BuiltZone {
  const count = randInt(rng, p.eggCount[0], p.eggCount[1])
  // Length derived from the egg count so the eggs always fit with a lead-in and
  // a trailing run, at the canonical EGG_SPACING (keeps the LINE able to clear).
  const len = EGG_LEAD_IN + (count - 1) * EGG_SPACING + EGG_TRAIL
  const obstacles: Obstacle[] = []
  for (let i = 0; i < count; i++) {
    obstacles.push({ x: xStart + EGG_LEAD_IN + i * EGG_SPACING, y: BASE_Y, kind: 'egg' })
  }
  return {
    seg: { kind: 'eggs', xStart, xEnd: xStart + len, friction: FRICTION_BASE, y: () => BASE_Y },
    obstacles,
  }
}

function buildHazard(kind: TerrainKind, rng: Rng, xStart: number, p: DifficultyParams): BuiltZone {
  switch (kind) {
    case 'rocky':
      return rockyZone(rng, xStart, p)
    case 'uphill':
      return uphillZone(rng, xStart, p)
    case 'mud':
      return mudZone(rng, xStart, p)
    case 'ice':
      return iceZone(rng, xStart, p)
    case 'eggs':
      return eggsZone(rng, xStart, p)
    case 'flat':
      return flatZone(xStart, Math.round(randRange(rng, p.mudLen[0], p.mudLen[1])))
  }
}

// ─── Public generator ──────────────────────────────────────────────────────────

/**
 * Generate a SEEDED, difficulty-scaled course.
 *
 * DETERMINISTIC: identical `{ difficulty, seed }` → identical ground / obstacles
 * / startX / finishX. Uses only the seeded PRNG (no Math.random / Date).
 *
 * Structure: a flat start run-in → a randomized sequence of hazard zones (each
 * starting and ending at BASE_Y so they compose in any order) → a flat run-out →
 * the finish. Difficulty scales total length, hazard count, uphill steepness,
 * egg density, mud/ice presence and length, and rocky amplitude — all bounded by
 * the shared tuned ceilings so every generated track stays completable with the
 * right sequence of shapes.
 */
export function generateCourse(opts: CourseOptions): Course {
  const p = DIFFICULTY_PARAMS[opts.difficulty]
  const rng = mulberry32(opts.seed)

  const segments: SegmentDef[] = []
  const obstacles: Obstacle[] = []
  let x = X_START

  // Flat start run-in.
  const start = flatZone(x, p.flatStartLen)
  segments.push(start.seg)
  x = start.seg.xEnd

  // Randomized hazard sequence.
  const nHazards = randInt(rng, p.hazardCount[0], p.hazardCount[1])
  for (let i = 0; i < nHazards; i++) {
    const kind = pick(rng, p.hazards)
    const built = buildHazard(kind, rng, x, p)
    segments.push(built.seg)
    if (built.obstacles) obstacles.push(...built.obstacles)
    x = built.seg.xEnd
  }

  // Flat run-out.
  const end = flatZone(x, p.flatEndLen)
  segments.push(end.seg)
  x = end.seg.xEnd

  return assembleCourse(segments, obstacles, X_START, x)
}
