import { describe, it, expect } from 'vitest'
import { advanceAccumulator } from '../../src/game/loop'
import { PHYSICS_TIMESTEP } from '../../src/physics/world'

const STEP_MS = PHYSICS_TIMESTEP * 1000 // ~16.667 ms

describe('advanceAccumulator', () => {
  describe('exact step frame', () => {
    it('emits exactly 1 step when frameMs === stepMs with no carry-in', () => {
      const { steps, accumulatorMs } = advanceAccumulator(0, STEP_MS, STEP_MS, 5)
      expect(steps).toBe(1)
      expect(accumulatorMs).toBeCloseTo(0, 10)
    })

    it('emits exactly 2 steps when frameMs === 2 * stepMs', () => {
      const { steps, accumulatorMs } = advanceAccumulator(0, STEP_MS * 2, STEP_MS, 5)
      expect(steps).toBe(2)
      expect(accumulatorMs).toBeCloseTo(0, 10)
    })
  })

  describe('sub-step accumulation', () => {
    it('emits 0 steps and carries the frame when frameMs < stepMs', () => {
      const halfStep = STEP_MS / 2
      const { steps, accumulatorMs } = advanceAccumulator(0, halfStep, STEP_MS, 5)
      expect(steps).toBe(0)
      expect(accumulatorMs).toBeCloseTo(halfStep, 10)
    })

    it('emits 1 step once two sub-step frames accumulate past stepMs', () => {
      const halfStep = STEP_MS / 2
      // First frame: 0 steps, carry = halfStep
      const first = advanceAccumulator(0, halfStep, STEP_MS, 5)
      expect(first.steps).toBe(0)
      expect(first.accumulatorMs).toBeCloseTo(halfStep, 10)

      // Second frame: halfStep carry + halfStep frame = stepMs → 1 step, carry ≈ 0
      const second = advanceAccumulator(first.accumulatorMs, halfStep, STEP_MS, 5)
      expect(second.steps).toBe(1)
      expect(second.accumulatorMs).toBeCloseTo(0, 10)
    })

    it('preserves partial carry for the next frame', () => {
      // frameMs = 1.5 * stepMs → 1 step, carry = 0.5 * stepMs
      const { steps, accumulatorMs } = advanceAccumulator(0, STEP_MS * 1.5, STEP_MS, 5)
      expect(steps).toBe(1)
      expect(accumulatorMs).toBeCloseTo(STEP_MS * 0.5, 5)
    })
  })

  describe('spiral-of-death clamp', () => {
    it('caps steps at maxSteps even when a huge frameMs arrives', () => {
      const hugeFrame = STEP_MS * 1000 // 1000x a step — extreme lag spike
      const maxSteps = 5
      const { steps } = advanceAccumulator(0, hugeFrame, STEP_MS, maxSteps)
      expect(steps).toBe(maxSteps)
    })

    it('caps at maxSteps = 1 regardless of frame size', () => {
      const { steps } = advanceAccumulator(0, STEP_MS * 100, STEP_MS, 1)
      expect(steps).toBe(1)
    })

    it('discards excess time when clamped (carry is capped, not unbounded)', () => {
      const maxSteps = 3
      const { steps, accumulatorMs } = advanceAccumulator(0, STEP_MS * 100, STEP_MS, maxSteps)
      expect(steps).toBe(maxSteps)
      // carry should be < stepMs (only the partial remainder of the 3 steps taken)
      expect(accumulatorMs).toBeLessThan(STEP_MS)
    })
  })

  describe('carry preservation across frames', () => {
    it('carry from one frame feeds correctly into the next', () => {
      // Simulate three 10ms frames with a 16.667ms step
      let acc = { steps: 0, accumulatorMs: 0 }
      const frameDt = 10
      acc = advanceAccumulator(acc.accumulatorMs, frameDt, STEP_MS, 5)
      expect(acc.steps).toBe(0) // 10ms < 16.667ms
      acc = advanceAccumulator(acc.accumulatorMs, frameDt, STEP_MS, 5)
      expect(acc.steps).toBe(1) // 20ms ≥ 16.667ms → 1 step, ~3.33ms carry
      acc = advanceAccumulator(acc.accumulatorMs, frameDt, STEP_MS, 5)
      // ~3.33ms + 10ms = ~13.33ms < 16.667ms → 0 steps
      expect(acc.steps).toBe(0)
      // cumulative carry ≈ 13.33ms
      expect(acc.accumulatorMs).toBeCloseTo(30 - STEP_MS, 5)
    })
  })

  describe('defensive: negative frameMs', () => {
    it('clamps a negative frameMs to 0 (no negative steps)', () => {
      const { steps, accumulatorMs } = advanceAccumulator(0, -100, STEP_MS, 5)
      expect(steps).toBe(0)
      expect(accumulatorMs).toBeCloseTo(0, 10)
    })
  })

  describe('pure: no mutation of inputs', () => {
    it('returns a new object each call (pure function)', () => {
      const r1 = advanceAccumulator(0, STEP_MS, STEP_MS, 5)
      const r2 = advanceAccumulator(0, STEP_MS, STEP_MS, 5)
      expect(r1).not.toBe(r2)
      expect(r1.steps).toBe(r2.steps)
    })
  })
})
