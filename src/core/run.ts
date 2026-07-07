/**
 * Run state machine — pure core for a racing session.
 * Idle → racing → finished, with elapsed-time accumulation.
 *
 * Pure module: no Date.now(), no side effects, no time source inside.
 * The game loop (Task 12) passes dtMs and vehicleX; we manage state transitions.
 */

export type RunPhase = 'idle' | 'racing' | 'finished'

export interface RunState {
  phase: RunPhase
  elapsedMs: number
}

/**
 * Create a new run in idle state with 0 elapsed time.
 */
export function createRun(): RunState {
  return { phase: 'idle', elapsedMs: 0 }
}

/**
 * Start a run: transition from idle to racing.
 * Safe to call on an already-racing or finished run (no-op-ish — returns the same phase).
 * Rationale: idempotent; a caller that re-calls start should not break state.
 */
export function startRun(s: RunState): RunState {
  if (s.phase === 'idle') {
    return { ...s, phase: 'racing' }
  }
  // Already racing or finished: no-op.
  return s
}

/**
 * Tick the run: accumulate time, detect finish.
 * - Only accumulates elapsedMs while phase === 'racing'.
 * - When racing and vehicleX >= finishX, transition to 'finished'.
 * - Defends against negative dtMs (clamps to 0).
 */
export function tickRun(
  s: RunState,
  dtMs: number,
  vehicleX: number,
  finishX: number,
): RunState {
  // Clamp negative dtMs to 0 (defensive).
  const safeDtMs = Math.max(0, dtMs)

  // If not racing, freeze time and return as-is.
  if (s.phase !== 'racing') {
    return s
  }

  // Accumulate time.
  const newElapsedMs = s.elapsedMs + safeDtMs

  // Check if we've crossed the finish line.
  if (vehicleX >= finishX) {
    return { phase: 'finished', elapsedMs: newElapsedMs }
  }

  // Still racing, no finish yet.
  return { ...s, elapsedMs: newElapsedMs }
}

/**
 * Reset the run back to idle with 0 elapsed time.
 */
export function resetRun(_s: RunState): RunState {
  return createRun()
}
