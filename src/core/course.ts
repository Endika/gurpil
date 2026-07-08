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

export type TerrainKind =
  | 'flat'
  | 'rocky'
  | 'uphill'
  | 'mud'
  | 'ice'
  | 'eggs'
  // ── Stage-3 terrain-variety features (all traversable ground) ──
  /** Up-and-over kicker: a grippy launch ramp with a generous flat landing. */
  | 'ramp'
  /** A flat, slippery/slow water crossing (a ford at road level — never a pit). */
  | 'water'
  /** A flat, solid wooden bridge span over a decorative dip. */
  | 'bridge'

/** Visual style of an obstacle. Purely cosmetic — the collider (a fixed-radius
 *  ball, see `physics/world.ts`) and gameplay are IDENTICAL for every variant;
 *  this only picks which mesh `render/terrain.ts` draws. */
export type ObstacleVariant = 'log' | 'rock'

export interface Obstacle {
  x: number
  y: number
  kind: 'egg'
  /** Deterministic, seed-driven visual variant (log or rock). See `ObstacleVariant`. */
  variant: ObstacleVariant
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

/**
 * The three difficulty tiers offered by the Stage-1 difficulty-select MENU.
 * Kept exactly as-is so the existing UI (`difficultySelect`, `pendingRace`) and
 * the per-difficulty records API stay valid without change.
 */
export type Difficulty = 'easy' | 'medium' | 'hard'

/**
 * The FULL set of five course difficulty tiers, easiest → hardest, used by the
 * generator, the campaign and the per-level records. It ADDS a gentler
 * `'beginner'` below `'easy'` and a harder `'expert'` above `'hard'`, while
 * keeping the three menu tiers unchanged (`Difficulty` ⊂ `DifficultyTier`, so
 * every existing caller that passes a `Difficulty` still type-checks).
 *
 * (Named separately from `Difficulty` on purpose: the Stage-1 UI hard-codes a
 * `Record<Difficulty, …>` over exactly the three menu tiers, so widening the
 * `Difficulty` symbol itself would break that UI — out of scope for this core
 * stage. 2b will wire the extra tiers into the UI.)
 */
export type DifficultyTier = 'beginner' | Difficulty | 'expert'

/** All five difficulty tiers in easiest→hardest order (single source of truth). */
export const DIFFICULTY_TIERS: readonly DifficultyTier[] = [
  'beginner',
  'easy',
  'medium',
  'hard',
  'expert',
]

export interface CourseOptions {
  difficulty: DifficultyTier
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

// ─── Stage-3 terrain-variety feature constants ────────────────────────────────
//
// JUMP RAMP, WATER and BRIDGE. Every one is TRAVERSABLE GROUND that begins AND
// ends at BASE_Y, so they compose in any random order exactly like the existing
// zones. Their parameters are bounded by known-safe ceilings (below) so every
// generated track stays completable — proven headless by the real-Rapier
// completability tests.

/**
 * Friction of the WATER crossing surface — slippery/slow (between ice and base).
 * The water is a FLAT ford at road level (BASE_Y, see waterZone): being flat it
 * needs no grip to drive across, so even the low-grip shapes cross it; the low
 * friction only makes it feel loose/slow, never a trap. Modelled flat (not a
 * recessed basin) ON PURPOSE — a flat ford can never be a pit you fall into and
 * get stuck, which is the overriding completability requirement.
 */
const FRICTION_WATER = 0.3

/**
 * Friction of the BRIDGE deck — the same base grip as flat ground. The bridge is
 * purely a themed, SOLID flat span (see bridgeZone): zero dead-end risk.
 */
const FRICTION_BRIDGE = FRICTION_BASE

/**
 * Friction of the JUMP-RAMP surface — deliberately GRIPPY (base grip), NOT the
 * slippery FRICTION_UPHILL. The ramp is a launch feature, not a grip gate: every
 * shape must be able to climb it and get over. With base grip the low-grip circle
 * still climbs ((0.55 + 0.6)/2 = 0.575 > RAMP_UP_GRADE), so the ramp never
 * becomes an accidental wall — it always launches or is simply driven over.
 */
const FRICTION_RAMP = FRICTION_BASE

/**
 * Up-slope grade of the ramp take-off face (rise/run). ≤ UPHILL_MAX_GRADE (0.5)
 * so it is always climbable, and grippy (FRICTION_RAMP) so EVERY shape summits it
 * from speed. The convex peak between the up face and the steeper down face is
 * the launch point: a fast shape flies off it (fun air), a slow one simply rolls
 * down the far side — either way it continues onto the flat landing.
 */
const RAMP_UP_GRADE = 0.4

/**
 * Down-slope grade of the ramp's launch face (rise/run). Steeper than the up face
 * for a snappier kick, but still a SLOPE (never a vertical edge), so a shape that
 * doesn't launch just rolls down it — no mini-cliff, no wedge.
 */
const RAMP_DOWN_GRADE = 0.6

/**
 * Flat landing run after the ramp (metres). Long and level so the vehicle lands
 * on solid ground and recovers well before the zone ends; and because every zone
 * ends at BASE_Y, whatever follows is also solid ground at road level — there is
 * never a gap to overshoot into.
 */
const RAMP_LAND_RUN = 24

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

/**
 * Fixed seed for the canonical course's obstacle visual variants. The canonical
 * course itself takes no seed (it's the one fixed hand-tuned track), but variant
 * assignment still goes through the SAME seeded-PRNG path as the generator (for
 * one shared, deterministic mechanism) rather than a hardcoded array.
 */
const CANONICAL_VARIANT_SEED = 7

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
  const variantRng = mulberry32(CANONICAL_VARIANT_SEED)
  const obstacles: Obstacle[] = EGG_X_POSITIONS.map((x) => ({
    x,
    y: eggSeg.y(x),
    kind: 'egg' as const,
    variant: pickVariant(variantRng),
  }))
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

/** The two obstacle visual variants, in pick() order (used for the ~50/50 mix). */
const OBSTACLE_VARIANTS: readonly ObstacleVariant[] = ['log', 'rock']

/** Draw the next obstacle's visual variant from a seeded PRNG (roughly 50/50). */
function pickVariant(rng: Rng): ObstacleVariant {
  return pick(rng, OBSTACLE_VARIANTS)
}

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
  /** Jump-ramp peak height range (metres). Height drives the up/down run lengths
   *  at the fixed RAMP_UP_GRADE/RAMP_DOWN_GRADE, so a taller ramp is a longer,
   *  bigger jump — never a steeper (uncompletable) one. */
  rampHeight: [number, number]
  /** Water (ford) crossing length range (metres). */
  waterLen: [number, number]
  /** Bridge span length range (metres). */
  bridgeLen: [number, number]
}

export const DIFFICULTY_PARAMS: Record<DifficultyTier, DifficultyParams> = {
  beginner: {
    // Gentler than easy on every monotonic metric: fewer/shorter hazards,
    // flatter hills, smaller bumps, fewer eggs. No ice (like easy).
    flatStartLen: 20,
    flatEndLen: 20,
    hazardCount: [1, 2],
    // Gentle features only (bridge + water); NO ramps at the beginner tier so
    // beginner tracks stay the flattest (keeps the max-height monotonicity clean).
    hazards: ['rocky', 'uphill', 'mud', 'eggs', 'bridge', 'water'],
    hillGrade: [0.2, 0.3],
    hillLen: [18, 30],
    rockyAmp: [0.2, 0.35],
    rockyLen: [14, 22],
    mudLen: [14, 22],
    iceLen: [14, 22],
    eggCount: [2, 3],
    rampHeight: [2, 2.5],
    waterLen: [12, 18],
    bridgeLen: [12, 18],
  },
  easy: {
    flatStartLen: 20,
    flatEndLen: 20,
    hazardCount: [2, 3],
    hazards: ['rocky', 'uphill', 'mud', 'eggs', 'bridge', 'water', 'ramp'],
    hillGrade: [0.28, 0.4],
    hillLen: [24, 40],
    rockyAmp: [0.3, 0.45],
    rockyLen: [18, 28],
    mudLen: [18, 28],
    iceLen: [18, 28],
    eggCount: [3, 4],
    rampHeight: [2, 3],
    waterLen: [14, 20],
    bridgeLen: [14, 20],
  },
  medium: {
    flatStartLen: 20,
    flatEndLen: 20,
    hazardCount: [3, 5],
    hazards: ['rocky', 'uphill', 'mud', 'ice', 'eggs', 'bridge', 'water', 'ramp'],
    hillGrade: [0.38, 0.46],
    hillLen: [36, 64],
    rockyAmp: [0.4, 0.55],
    rockyLen: [24, 36],
    mudLen: [28, 44],
    iceLen: [28, 44],
    eggCount: [4, 6],
    rampHeight: [2.5, 4],
    waterLen: [18, 26],
    bridgeLen: [18, 26],
  },
  hard: {
    flatStartLen: 20,
    flatEndLen: 20,
    hazardCount: [5, 7],
    hazards: ['rocky', 'uphill', 'mud', 'ice', 'eggs', 'bridge', 'water', 'ramp'],
    hillGrade: [0.44, 0.5],
    hillLen: [56, 90],
    rockyAmp: [0.5, 0.62],
    rockyLen: [30, 46],
    mudLen: [40, 58],
    iceLen: [40, 58],
    eggCount: [6, 9],
    rampHeight: [3.5, 5],
    waterLen: [22, 32],
    bridgeLen: [22, 32],
  },
  expert: {
    // Harder than hard on every monotonic metric: more/longer hazards, taller
    // hills (longer up-and-over at the steepest allowed grade → higher peak),
    // more eggs. Steepness stays AT the completable ceiling (hillGrade clamped
    // to UPHILL_MAX_GRADE = 0.5; rocky slope still bounded by ROCKY_MAX_SLOPE
    // via the auto-derived period; eggs still at the canonical EGG_SPACING), so
    // an expert track is always clearable with the right sequence of shapes.
    flatStartLen: 20,
    flatEndLen: 20,
    hazardCount: [7, 9],
    hazards: ['rocky', 'uphill', 'mud', 'ice', 'eggs', 'bridge', 'water', 'ramp'],
    hillGrade: [0.47, 0.5],
    hillLen: [70, 110],
    rockyAmp: [0.58, 0.66],
    rockyLen: [34, 52],
    mudLen: [46, 66],
    iceLen: [46, 66],
    eggCount: [8, 12],
    rampHeight: [4, 6],
    waterLen: [26, 38],
    bridgeLen: [26, 38],
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
    obstacles.push({
      x: xStart + EGG_LEAD_IN + i * EGG_SPACING,
      y: BASE_Y,
      kind: 'egg',
      variant: pickVariant(rng),
    })
  }
  return {
    seg: { kind: 'eggs', xStart, xEnd: xStart + len, friction: FRICTION_BASE, y: () => BASE_Y },
    obstacles,
  }
}

/**
 * JUMP RAMP: an up-and-over kicker with a generous flat landing.
 *
 * Profile (all grippy FRICTION_RAMP ground, starting AND ending at BASE_Y):
 *   1. up face:  BASE_Y → peak, at ≤ RAMP_UP_GRADE (climbable by every shape),
 *   2. down face: peak → BASE_Y, steeper (RAMP_DOWN_GRADE) — the launch face,
 *   3. landing:  a long flat run at BASE_Y (RAMP_LAND_RUN).
 *
 * The convex peak is the launch point: a fast shape flies off it for real air and
 * lands on the flat landing; a slow shape just rolls down the far face onto the
 * same landing. Either way it always continues — there is NEVER a gap (the zone,
 * and whatever follows, are solid ground at BASE_Y). The runs are derived from
 * the peak height at fixed grades, so a taller ramp is a BIGGER jump, never a
 * steeper (uncompletable) one. `ceil` on each run keeps the actual grade ≤ its
 * ceiling.
 */
function rampZone(rng: Rng, xStart: number, p: DifficultyParams): BuiltZone {
  const height = randRange(rng, p.rampHeight[0], p.rampHeight[1])
  const upRun = Math.ceil(height / RAMP_UP_GRADE)
  const downRun = Math.ceil(height / RAMP_DOWN_GRADE)
  const upGrade = height / upRun // ≤ RAMP_UP_GRADE (ceil rounded the run up)
  const downGrade = height / downRun // ≤ RAMP_DOWN_GRADE
  const len = upRun + downRun + RAMP_LAND_RUN
  const xEnd = xStart + len
  return {
    seg: {
      kind: 'ramp',
      xStart,
      xEnd,
      friction: FRICTION_RAMP,
      y: (x: number): number => {
        const dx = x - xStart
        if (dx <= upRun) return BASE_Y + dx * upGrade // up face → peak
        if (dx <= upRun + downRun) return BASE_Y + height - (dx - upRun) * downGrade // launch face → BASE_Y
        return BASE_Y // flat landing
      },
    },
  }
}

/**
 * WATER crossing: a FLAT, slippery ford at road level (BASE_Y).
 *
 * Modelled flat (not a recessed basin) on purpose: a flat ford can never be a pit
 * you fall into and get stuck, which is the overriding completability rule. The
 * low FRICTION_WATER makes it read as a loose/slow water crossing; because it is
 * flat, even the low-grip shapes drive straight across it. Rendered blue (per
 * theme) so it reads as water — see render/terrain.ts.
 */
function waterZone(rng: Rng, xStart: number, p: DifficultyParams): BuiltZone {
  const len = Math.round(randRange(rng, p.waterLen[0], p.waterLen[1]))
  return {
    seg: { kind: 'water', xStart, xEnd: xStart + len, friction: FRICTION_WATER, y: () => BASE_Y },
  }
}

/**
 * BRIDGE: a flat, SOLID wooden span at road level (BASE_Y), base grip.
 *
 * Purely a themed variation of flat ground — the crossing itself is solid (no
 * fall-through), so it carries zero dead-end risk. Rendered as a wooden deck (per
 * theme) over a decorative dip — see render/terrain.ts.
 */
function bridgeZone(rng: Rng, xStart: number, p: DifficultyParams): BuiltZone {
  const len = Math.round(randRange(rng, p.bridgeLen[0], p.bridgeLen[1]))
  return {
    seg: { kind: 'bridge', xStart, xEnd: xStart + len, friction: FRICTION_BRIDGE, y: () => BASE_Y },
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
    case 'ramp':
      return rampZone(rng, xStart, p)
    case 'water':
      return waterZone(rng, xStart, p)
    case 'bridge':
      return bridgeZone(rng, xStart, p)
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

// ═══════════════════════════════════════════════════════════════════════════════
//  ENDLESS COURSE — a very long, distance-ramped track for the arcade mode.
// ═══════════════════════════════════════════════════════════════════════════════
//
// Structure mirrors generateCourse (flat start-in → hazard sequence → flat run-out)
// but is MUCH longer and its difficulty RAMPS with x: gentle near the start,
// progressively harder further along. The ramp is a single interpolation between
// the tuned `beginner` params (easiest) and the tuned `expert` params (hardest):
// because every hazard builder ALREADY clamps steepness/slope/spacing to the
// shared completable ceilings (UPHILL_MAX_GRADE, ROCKY_MAX_SLOPE, EGG_SPACING),
// ANY point on that interpolation is still clearable with the right shape — so the
// whole ramp stays completable everywhere, no dead-ends. Deterministic (seed only;
// difficulty is a function of x, not a tier).

/** Flat run-in at the very start of an endless course (metres). */
const ENDLESS_START_FLAT_LEN = 24
/** Flat run-out capping the far end of an endless course (metres). */
const ENDLESS_END_FLAT_LEN = 20
/**
 * Distance (metres from startX) over which difficulty ramps from the `beginner`
 * floor up to the `expert` ceiling. Past this the course stays at max difficulty.
 */
const ENDLESS_RAMP_DISTANCE = 3000
/**
 * Target total length (metres). Long enough that a good run rarely reaches the end
 * within the time budget; if it does, that's fine — the timer ends the run.
 */
const ENDLESS_TARGET_LENGTH = 6000
/**
 * Ramp progress at which harder hazard kinds unlock, so the opening stays gentle:
 * ramps join once past this fraction of the ramp, ice once past twice it.
 */
const ENDLESS_RAMP_UNLOCK = 0.12
const ENDLESS_ICE_UNLOCK = 0.24

/** Gentle hazard palette used at the very start (no ramps, no ice). */
const ENDLESS_HAZARDS_GENTLE: readonly TerrainKind[] = [
  'rocky',
  'uphill',
  'mud',
  'eggs',
  'bridge',
  'water',
]

/** Linear interpolation between a and b at t∈[0,1]. */
function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

/** Interpolate an inclusive numeric range between two tiers at ramp progress t. */
function lerpRange(a: readonly [number, number], b: readonly [number, number], t: number): [number, number] {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t)]
}

/**
 * Difficulty params at ramp progress t∈[0,1], interpolated field-by-field from the
 * `beginner` floor (t=0) to the `expert` ceiling (t=1). Every metric is monotonic
 * in t (beginner ≤ expert on all of them), so the course genuinely gets harder the
 * further you go, while each value stays within its tuned completable range.
 */
function endlessParamsAt(t: number): DifficultyParams {
  const lo = DIFFICULTY_PARAMS.beginner
  const hi = DIFFICULTY_PARAMS.expert
  const c = Math.min(1, Math.max(0, t))
  return {
    flatStartLen: ENDLESS_START_FLAT_LEN,
    flatEndLen: ENDLESS_END_FLAT_LEN,
    // hazardCount is unused in the endless loop (we place zones until the target
    // length), but keep a sensible interpolated value for shape completeness.
    hazardCount: [Math.round(lerp(lo.hazardCount[0], hi.hazardCount[0], c)), Math.round(lerp(lo.hazardCount[1], hi.hazardCount[1], c))],
    hazards: endlessHazardsAt(c),
    hillGrade: lerpRange(lo.hillGrade, hi.hillGrade, c),
    hillLen: lerpRange(lo.hillLen, hi.hillLen, c),
    rockyAmp: lerpRange(lo.rockyAmp, hi.rockyAmp, c),
    rockyLen: lerpRange(lo.rockyLen, hi.rockyLen, c),
    mudLen: lerpRange(lo.mudLen, hi.mudLen, c),
    iceLen: lerpRange(lo.iceLen, hi.iceLen, c),
    eggCount: lerpRange(lo.eggCount, hi.eggCount, c),
    rampHeight: lerpRange(lo.rampHeight, hi.rampHeight, c),
    waterLen: lerpRange(lo.waterLen, hi.waterLen, c),
    bridgeLen: lerpRange(lo.bridgeLen, hi.bridgeLen, c),
  }
}

/** Hazard palette at ramp progress t: gentle early, unlocking ramps then ice. */
function endlessHazardsAt(t: number): readonly TerrainKind[] {
  const kinds: TerrainKind[] = [...ENDLESS_HAZARDS_GENTLE]
  if (t >= ENDLESS_RAMP_UNLOCK) kinds.push('ramp')
  if (t >= ENDLESS_ICE_UNLOCK) kinds.push('ice')
  return kinds
}

/**
 * Generate a VERY LONG, distance-ramped endless course.
 *
 * DETERMINISTIC: identical `seed` → identical track (seeded PRNG only, no
 * Math.random / Date). Difficulty is a function of x (the ramp), not a tier.
 * `finishX` is the far end of the track; Stage E2 treats endless as no-finish —
 * the timer ends the run — so reaching finishX is not expected, just harmless.
 */
export function generateEndlessCourse(opts: { seed: number }): Course {
  const rng = mulberry32(opts.seed)

  const segments: SegmentDef[] = []
  const obstacles: Obstacle[] = []
  let x = X_START

  // Gentle flat start run-in (safe spawn).
  const start = flatZone(x, ENDLESS_START_FLAT_LEN)
  segments.push(start.seg)
  x = start.seg.xEnd

  // Ramped hazard sequence until we reach the target length.
  while (x - X_START < ENDLESS_TARGET_LENGTH) {
    const t = (x - X_START) / ENDLESS_RAMP_DISTANCE
    const p = endlessParamsAt(t)
    const kind = pick(rng, p.hazards)
    const built = buildHazard(kind, rng, x, p)
    segments.push(built.seg)
    if (built.obstacles) obstacles.push(...built.obstacles)
    x = built.seg.xEnd
  }

  // Flat run-out capping the far end.
  const end = flatZone(x, ENDLESS_END_FLAT_LEN)
  segments.push(end.seg)
  x = end.seg.xEnd

  return assembleCourse(segments, obstacles, X_START, x)
}
