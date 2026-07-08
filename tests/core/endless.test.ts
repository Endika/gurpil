/**
 * Tests for the endless-mode state machine — pure, no mocks, no time source.
 * The caller supplies dtMs + vehicleX; we assert the timer, checkpoints, distance
 * monotonicity, the game-over transition and immutability.
 */

import { describe, it, expect } from 'vitest'
import {
  createEndless,
  startEndless,
  tickEndless,
  START_TIME_MS,
  CHECKPOINT_BONUS_MS,
  CHECKPOINT_SPACING,
  MAX_TIME_MS,
  type EndlessState,
} from '../../src/core/endless'

const START_X = 100

describe('createEndless', () => {
  it('starts idle with the full budget, zero distance, first checkpoint one spacing out', () => {
    expect(createEndless()).toEqual({
      phase: 'idle',
      timeLeftMs: START_TIME_MS,
      distance: 0,
      nextCheckpoint: CHECKPOINT_SPACING,
      checkpointsHit: 0,
    })
  })
})

describe('startEndless', () => {
  it('transitions idle → running without touching the clock', () => {
    const s = startEndless(createEndless())
    expect(s.phase).toBe('running')
    expect(s.timeLeftMs).toBe(START_TIME_MS)
  })

  it('does not mutate its input', () => {
    const idle = createEndless()
    const running = startEndless(idle)
    expect(idle.phase).toBe('idle')
    expect(running).not.toBe(idle)
  })

  it('is a no-op on an already-running or over run', () => {
    const running: EndlessState = { ...createEndless(), phase: 'running' }
    expect(startEndless(running)).toBe(running)
    const over: EndlessState = { ...createEndless(), phase: 'over' }
    expect(startEndless(over)).toBe(over)
  })
})

describe('tickEndless — timer', () => {
  it('depletes the clock by dtMs while running (no distance progress)', () => {
    const s = startEndless(createEndless())
    const next = tickEndless(s, 1000, START_X, START_X)
    expect(next.timeLeftMs).toBe(START_TIME_MS - 1000)
    expect(next.phase).toBe('running')
    expect(next.distance).toBe(0)
  })

  it('clamps a negative dt to 0 (no free time, no drain)', () => {
    const s = startEndless(createEndless())
    const next = tickEndless(s, -5000, START_X, START_X)
    expect(next.timeLeftMs).toBe(START_TIME_MS)
  })

  it('does nothing when not running (idle and over are frozen)', () => {
    const idle = createEndless()
    expect(tickEndless(idle, 1000, START_X + 999, START_X)).toBe(idle)
    const over: EndlessState = { ...createEndless(), phase: 'over' }
    expect(tickEndless(over, 1000, START_X + 999, START_X)).toBe(over)
  })
})

describe('tickEndless — distance', () => {
  it('records distance as vehicleX − startX', () => {
    const s = startEndless(createEndless())
    const next = tickEndless(s, 100, START_X + 30, START_X)
    expect(next.distance).toBe(30)
  })

  it('is a monotonic maximum — never regresses when the vehicle moves back', () => {
    let s = startEndless(createEndless())
    s = tickEndless(s, 100, START_X + 40, START_X)
    expect(s.distance).toBe(40)
    s = tickEndless(s, 100, START_X + 10, START_X) // slid backwards
    expect(s.distance).toBe(40)
  })
})

describe('tickEndless — checkpoints', () => {
  it('adds bonus time and advances the checkpoint when one is reached', () => {
    const s = startEndless(createEndless())
    const next = tickEndless(s, 1000, START_X + CHECKPOINT_SPACING, START_X)
    expect(next.checkpointsHit).toBe(1)
    expect(next.nextCheckpoint).toBe(CHECKPOINT_SPACING * 2)
    expect(next.timeLeftMs).toBe(START_TIME_MS - 1000 + CHECKPOINT_BONUS_MS)
  })

  it('awards several checkpoints crossed in a single big tick', () => {
    const s = startEndless(createEndless())
    // Jump well past three checkpoints in one tick.
    const next = tickEndless(s, 500, START_X + CHECKPOINT_SPACING * 3 + 1, START_X)
    expect(next.checkpointsHit).toBe(3)
    expect(next.nextCheckpoint).toBe(CHECKPOINT_SPACING * 4)
  })

  it('caps banked time at MAX_TIME_MS however many checkpoints fall in one tick', () => {
    const s = startEndless(createEndless())
    const next = tickEndless(s, 100, START_X + CHECKPOINT_SPACING * 10, START_X)
    expect(next.timeLeftMs).toBeLessThanOrEqual(MAX_TIME_MS)
    expect(next.timeLeftMs).toBe(MAX_TIME_MS)
  })
})

describe('tickEndless — game over', () => {
  it('transitions to over and clamps the clock to 0 when time runs out', () => {
    const s = startEndless(createEndless())
    const next = tickEndless(s, START_TIME_MS + 1000, START_X + 10, START_X)
    expect(next.phase).toBe('over')
    expect(next.timeLeftMs).toBe(0)
  })

  it('freezes distance once over (further ticks are ignored)', () => {
    let s = startEndless(createEndless())
    s = tickEndless(s, 100, START_X + 25, START_X)
    s = tickEndless(s, START_TIME_MS, START_X + 25, START_X) // drain to 0
    expect(s.phase).toBe('over')
    const frozenDistance = s.distance
    const after = tickEndless(s, 100, START_X + 9999, START_X)
    expect(after).toBe(s)
    expect(after.distance).toBe(frozenDistance)
  })

  it('a checkpoint reached in the same tick can keep the run alive', () => {
    // Small budget left, but crossing a checkpoint tops it up above zero.
    const s: EndlessState = {
      phase: 'running',
      timeLeftMs: 500,
      distance: CHECKPOINT_SPACING - 5,
      nextCheckpoint: CHECKPOINT_SPACING,
      checkpointsHit: 0,
    }
    const next = tickEndless(s, 1000, START_X + CHECKPOINT_SPACING, START_X)
    expect(next.phase).toBe('running')
    expect(next.timeLeftMs).toBe(500 - 1000 + CHECKPOINT_BONUS_MS)
  })
})

describe('tickEndless — immutability', () => {
  it('never mutates the input state on a running tick', () => {
    const s = startEndless(createEndless())
    const snapshot = { ...s }
    const next = tickEndless(s, 1000, START_X + CHECKPOINT_SPACING, START_X)
    expect(s).toEqual(snapshot)
    expect(next).not.toBe(s)
  })
})
