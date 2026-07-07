import { describe, it, expect } from 'vitest'
import {
  createRun,
  startRun,
  tickRun,
  resetRun,
  type RunPhase,
} from '../../src/core/run'

describe('Run state machine', () => {
  describe('createRun', () => {
    it('creates a run in idle phase with 0 elapsed time', () => {
      const run = createRun()
      expect(run.phase).toBe('idle')
      expect(run.elapsedMs).toBe(0)
    })
  })

  describe('startRun', () => {
    it('transitions idle → racing', () => {
      const idle = createRun()
      const racing = startRun(idle)
      expect(racing.phase).toBe('racing')
      expect(racing.elapsedMs).toBe(0)
    })

    it('does not mutate the input', () => {
      const idle = createRun()
      const racing = startRun(idle)
      expect(idle.phase).toBe('idle')
      expect(racing).not.toBe(idle)
    })

    it('is a no-op on an already-racing run', () => {
      const racing = { phase: 'racing' as RunPhase, elapsedMs: 100 }
      const result = startRun(racing)
      expect(result.phase).toBe('racing')
      expect(result.elapsedMs).toBe(100)
    })

    it('is a no-op on a finished run', () => {
      const finished = { phase: 'finished' as RunPhase, elapsedMs: 500 }
      const result = startRun(finished)
      expect(result.phase).toBe('finished')
      expect(result.elapsedMs).toBe(500)
    })
  })

  describe('tickRun', () => {
    it('does not accumulate time when idle', () => {
      const idle = createRun()
      const ticked = tickRun(idle, 16, 0, 100)
      expect(ticked.phase).toBe('idle')
      expect(ticked.elapsedMs).toBe(0)
    })

    it('does not accumulate time when finished', () => {
      const finished = { phase: 'finished' as RunPhase, elapsedMs: 500 }
      const ticked = tickRun(finished, 16, 150, 100)
      expect(ticked.phase).toBe('finished')
      expect(ticked.elapsedMs).toBe(500)
    })

    it('accumulates time while racing (before finish)', () => {
      const racing = { phase: 'racing' as RunPhase, elapsedMs: 0 }
      const ticked = tickRun(racing, 16, 50, 100)
      expect(ticked.phase).toBe('racing')
      expect(ticked.elapsedMs).toBe(16)
    })

    it('accumulates multiple ticks while racing', () => {
      let state = { phase: 'racing' as RunPhase, elapsedMs: 0 }
      state = tickRun(state, 16, 10, 100)
      state = tickRun(state, 16, 20, 100)
      state = tickRun(state, 16, 30, 100)
      expect(state.elapsedMs).toBe(48)
      expect(state.phase).toBe('racing')
    })

    it('transitions to finished when vehicleX >= finishX', () => {
      const racing = { phase: 'racing' as RunPhase, elapsedMs: 0 }
      const ticked = tickRun(racing, 16, 100, 100)
      expect(ticked.phase).toBe('finished')
      expect(ticked.elapsedMs).toBe(16)
    })

    it('records the tick dt even when crossing the finish line', () => {
      const racing = { phase: 'racing' as RunPhase, elapsedMs: 100 }
      const ticked = tickRun(racing, 25, 150, 100)
      expect(ticked.phase).toBe('finished')
      expect(ticked.elapsedMs).toBe(125)
    })

    it('transitions to finished exactly once (further ticks do not accumulate)', () => {
      let state = { phase: 'racing' as RunPhase, elapsedMs: 100 }
      state = tickRun(state, 16, 150, 100) // Cross finish: 116ms total
      expect(state.phase).toBe('finished')
      expect(state.elapsedMs).toBe(116)

      state = tickRun(state, 16, 200, 100) // Already finished: no accumulation
      expect(state.phase).toBe('finished')
      expect(state.elapsedMs).toBe(116)
    })

    it('clamps negative dtMs to 0', () => {
      const racing = { phase: 'racing' as RunPhase, elapsedMs: 100 }
      const ticked = tickRun(racing, -10, 50, 100)
      expect(ticked.phase).toBe('racing')
      expect(ticked.elapsedMs).toBe(100)
    })

    it('does not mutate the input', () => {
      const racing = { phase: 'racing' as RunPhase, elapsedMs: 0 }
      const ticked = tickRun(racing, 16, 50, 100)
      expect(racing.elapsedMs).toBe(0)
      expect(ticked).not.toBe(racing)
    })
  })

  describe('resetRun', () => {
    it('returns to idle with 0 elapsed time', () => {
      const finished = { phase: 'finished' as RunPhase, elapsedMs: 500 }
      const reset = resetRun(finished)
      expect(reset.phase).toBe('idle')
      expect(reset.elapsedMs).toBe(0)
    })

    it('works on any phase', () => {
      const racing = { phase: 'racing' as RunPhase, elapsedMs: 200 }
      const reset = resetRun(racing)
      expect(reset.phase).toBe('idle')
      expect(reset.elapsedMs).toBe(0)
    })

    it('does not mutate the input', () => {
      const finished = { phase: 'finished' as RunPhase, elapsedMs: 500 }
      const reset = resetRun(finished)
      expect(finished.phase).toBe('finished')
      expect(finished.elapsedMs).toBe(500)
      expect(reset).not.toBe(finished)
    })
  })

  describe('Integration: full race lifecycle', () => {
    it('complete race from idle → racing → finished', () => {
      // Start: idle
      let run = createRun()
      expect(run.phase).toBe('idle')

      // Begin race
      run = startRun(run)
      expect(run.phase).toBe('racing')
      expect(run.elapsedMs).toBe(0)

      // Simulate ticks while racing
      run = tickRun(run, 16, 10, 100)
      expect(run.elapsedMs).toBe(16)
      expect(run.phase).toBe('racing')

      run = tickRun(run, 16, 40, 100)
      expect(run.elapsedMs).toBe(32)
      expect(run.phase).toBe('racing')

      // Cross finish line
      run = tickRun(run, 20, 120, 100)
      expect(run.elapsedMs).toBe(52)
      expect(run.phase).toBe('finished')

      // Further ticks don't accumulate
      run = tickRun(run, 16, 150, 100)
      expect(run.elapsedMs).toBe(52)
      expect(run.phase).toBe('finished')

      // Reset
      run = resetRun(run)
      expect(run.phase).toBe('idle')
      expect(run.elapsedMs).toBe(0)
    })
  })
})
