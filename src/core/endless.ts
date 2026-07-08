/**
 * Endless-mode run state — pure core for the arcade checkpoint-timer mode.
 *
 * Rules (distinct from the finite `run.ts` state machine — do NOT reuse that):
 *   - The player starts with a small time budget (`START_TIME_MS`).
 *   - Time depletes every tick; each checkpoint reached adds `CHECKPOINT_BONUS_MS`
 *     (capped at `MAX_TIME_MS`) and pushes the next checkpoint further out.
 *   - The run is OVER the moment the timer hits zero — the timer is the ONLY fail
 *     condition (the vehicle, by physics design, never gets permanently stuck).
 *   - Score = distance travelled (a monotonic maximum of `vehicleX - startX`).
 *
 * Pure module: no Date.now(), no side effects, no time source inside. The caller
 * (Stage E2's game loop) passes `dtMs` and `vehicleX`; we own the state machine.
 * Every transition returns a NEW object — inputs are never mutated.
 */

// ─── Tunable constants (named — no magic values) ──────────────────────────────

/** Starting time budget (ms). Deliberately small: the player must reach the
 *  first checkpoint quickly to keep the run alive. */
export const START_TIME_MS = 20_000

/** Time (ms) added to the clock for every checkpoint reached. */
export const CHECKPOINT_BONUS_MS = 8_000

/** Distance (course units) between consecutive checkpoints. */
export const CHECKPOINT_SPACING = 50

/** Upper bound (ms) on the clock: checkpoint bonuses never bank more than this,
 *  so time cannot snowball into an effectively infinite run. */
export const MAX_TIME_MS = 30_000

// ─── Public types ─────────────────────────────────────────────────────────────

export type EndlessPhase = 'idle' | 'running' | 'over'

export interface EndlessState {
  phase: EndlessPhase
  /** Remaining time on the clock (ms). Reaches 0 → phase 'over'. */
  timeLeftMs: number
  /** Furthest distance reached so far (monotonic max of vehicleX − startX). */
  distance: number
  /** Distance at which the NEXT checkpoint bonus is awarded. */
  nextCheckpoint: number
  /** How many checkpoints have been reached so far. */
  checkpointsHit: number
}

// ─── State machine (pure, immutable) ──────────────────────────────────────────

/**
 * Create a fresh endless run in idle: full starting budget, zero distance, the
 * first checkpoint one spacing ahead, no checkpoints hit.
 */
export function createEndless(): EndlessState {
  return {
    phase: 'idle',
    timeLeftMs: START_TIME_MS,
    distance: 0,
    nextCheckpoint: CHECKPOINT_SPACING,
    checkpointsHit: 0,
  }
}

/**
 * Start an idle run (idle → running). Idempotent: calling on an already-running
 * or finished run is a no-op (returns the same state), so a caller that re-starts
 * cannot corrupt state.
 */
export function startEndless(s: EndlessState): EndlessState {
  if (s.phase === 'idle') {
    return { ...s, phase: 'running' }
  }
  return s
}

/**
 * Advance a running endless run by `dtMs`, given the vehicle's current world x and
 * the course origin `startX`.
 *
 * While running:
 *   1. distance = max(distance, vehicleX − startX)  (monotonic — never regresses).
 *   2. Deplete the clock by dtMs (negative dt is clamped to 0, defensive).
 *   3. For EVERY checkpoint the new distance has now passed (possibly several in
 *      one big tick): add CHECKPOINT_BONUS_MS (clamped to MAX_TIME_MS), advance
 *      nextCheckpoint by CHECKPOINT_SPACING, and increment checkpointsHit.
 *   4. If the clock is now ≤ 0 → phase 'over' with the distance FROZEN.
 *
 * When not running, returns the state unchanged (frozen).
 */
export function tickEndless(
  s: EndlessState,
  dtMs: number,
  vehicleX: number,
  startX: number,
): EndlessState {
  if (s.phase !== 'running') {
    return s
  }

  const safeDtMs = Math.max(0, dtMs)
  const distance = Math.max(s.distance, vehicleX - startX)

  let timeLeftMs = s.timeLeftMs - safeDtMs
  let nextCheckpoint = s.nextCheckpoint
  let checkpointsHit = s.checkpointsHit

  // Award every checkpoint the vehicle has now crossed (handles several at once).
  while (distance >= nextCheckpoint) {
    timeLeftMs = Math.min(MAX_TIME_MS, timeLeftMs + CHECKPOINT_BONUS_MS)
    nextCheckpoint += CHECKPOINT_SPACING
    checkpointsHit += 1
  }

  if (timeLeftMs <= 0) {
    // Timer ran out: freeze distance, clamp the clock to 0, end the run.
    return { phase: 'over', timeLeftMs: 0, distance, nextCheckpoint, checkpointsHit }
  }

  return { phase: 'running', timeLeftMs, distance, nextCheckpoint, checkpointsHit }
}
