/**
 * Fixed-step loop helper for Gurpil.
 *
 * Physics must run at a fixed timestep (PHYSICS_TIMESTEP) so that simulation
 * results are deterministic regardless of frame-rate. This module provides the
 * accumulator logic that converts variable-rate rAF wall-clock deltas into a
 * fixed number of physics steps per frame.
 *
 * The "spiral of death" is avoided by clamping the maximum number of steps that
 * can be run in a single frame. If the machine cannot keep up, physics slows
 * down rather than running an unbounded number of catch-up steps.
 *
 * `advanceAccumulator` is a PURE function — no side effects, no globals — so it
 * can be unit-tested in isolation.
 */

// ─── Constants ────────────────────────────────────────────────────────────────

/** Maximum physics steps allowed per rAF frame (spiral-of-death guard). */
export const MAX_STEPS_PER_FRAME = 5

// ─── Pure accumulator ─────────────────────────────────────────────────────────

export interface AccumulatorResult {
  /** Number of fixed physics steps to run this frame. */
  steps: number
  /**
   * Leftover accumulator value (ms) to carry into the next frame.
   * Always in [0, stepMs).
   */
  accumulatorMs: number
}

/**
 * Advance the fixed-step accumulator by one real frame.
 *
 * @param accumulatorMs - Leftover ms carried over from the previous frame.
 * @param frameMs       - Wall-clock time elapsed this frame (ms). Negative
 *                        values are clamped to 0 to guard against bogus deltas.
 * @param stepMs        - Fixed physics timestep in ms (= PHYSICS_TIMESTEP * 1000).
 * @param maxSteps      - Maximum steps to emit this frame (spiral-of-death cap).
 * @returns             Steps to run + carry for next frame.
 */
export function advanceAccumulator(
  accumulatorMs: number,
  frameMs: number,
  stepMs: number,
  maxSteps: number,
): AccumulatorResult {
  const safeFrameMs = Math.max(0, frameMs)
  const total = accumulatorMs + safeFrameMs

  // How many full steps fit — capped to avoid runaway.
  const rawSteps = Math.floor(total / stepMs)
  const clamped = rawSteps > maxSteps

  const steps = Math.min(rawSteps, maxSteps)

  // Carry calculation:
  //   - Normal case (not clamped): leftover sub-step time from the full total.
  //   - Clamped case: we discard the excess time that put us over the cap.
  //     Carry is only the sub-step remainder of the maxSteps we actually ran.
  //     This is the intended "slow down, don't spiral" trade-off.
  const carry = clamped ? total % stepMs : total - steps * stepMs

  return { steps, accumulatorMs: carry }
}
