/**
 * Time medals — pure scoring derived from a Course + an elapsed run time.
 *
 * Tracks are procedurally generated (Stage A) and vary in LENGTH per
 * difficulty/seed, so a FIXED time threshold would make random long tracks
 * unfair. Instead we derive a PAR time from the track's own distance and
 * grade medals as multiples of that par — scaling automatically with
 * whatever length the generator produced.
 *
 * Pure module: no DOM, no Date.now(), no side effects.
 */

import type { Course } from './course'

// ─── Tunable constants ──────────────────────────────────────────────────────

/**
 * Reference speed (metres/second) used to derive par time from track
 * distance. Chosen as a representative "clean, competent run" pace — fast
 * enough to reward good driving, slow enough that hazards (mud, uphill,
 * ice, eggs) don't make par unreachable. Not the vehicle's top speed.
 */
const PAR_REFERENCE_SPEED = 5.5

/** Elapsed ≤ par × GOLD_MULT → gold. */
const GOLD_MULT = 1.0
/** Elapsed ≤ par × SILVER_MULT → silver. */
const SILVER_MULT = 1.3
/** Elapsed ≤ par × BRONZE_MULT → bronze. Above this → no medal. */
const BRONZE_MULT = 1.7

// ─── Public types ───────────────────────────────────────────────────────────

export type Medal = 'none' | 'bronze' | 'silver' | 'gold'

// ─── Par time ───────────────────────────────────────────────────────────────

/**
 * Par time (milliseconds) for a course: its distance divided by the
 * reference speed. Longer/harder-generated tracks (which are longer, per the
 * Stage A difficulty table) automatically get a proportionally larger par,
 * so the same medal multipliers stay fair across difficulties and seeds.
 */
export function parTimeMs(course: Course): number {
  const distance = course.finishX - course.startX
  return (distance / PAR_REFERENCE_SPEED) * 1000
}

// ─── Medal grading ──────────────────────────────────────────────────────────

/**
 * Grade an elapsed time against a par time. Pure, monotonic: a slower
 * elapsedMs never yields a better medal.
 */
export function medalFor(elapsedMs: number, parMs: number): Medal {
  if (elapsedMs <= parMs * GOLD_MULT) return 'gold'
  if (elapsedMs <= parMs * SILVER_MULT) return 'silver'
  if (elapsedMs <= parMs * BRONZE_MULT) return 'bronze'
  return 'none'
}

/** Ordinal rank of a medal, for comparisons (higher = better). */
export function medalRank(medal: Medal): number {
  switch (medal) {
    case 'gold':
      return 3
    case 'silver':
      return 2
    case 'bronze':
      return 1
    case 'none':
      return 0
  }
}
