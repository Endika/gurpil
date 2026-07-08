import { describe, it, expect } from 'vitest'
import { parsePendingRace, serializePendingRace } from '../../src/game/pendingRace'

describe('serializePendingRace / parsePendingRace', () => {
  it('round-trips a valid pending race', () => {
    const pending = { difficulty: 'hard' as const, seed: 12345 }
    expect(parsePendingRace(serializePendingRace(pending))).toEqual(pending)
  })

  it('round-trips every difficulty', () => {
    for (const difficulty of ['easy', 'medium', 'hard'] as const) {
      const pending = { difficulty, seed: 1 }
      expect(parsePendingRace(serializePendingRace(pending))).toEqual(pending)
    }
  })

  it('returns null for a missing value', () => {
    expect(parsePendingRace(null)).toBeNull()
  })

  it('returns null for invalid JSON', () => {
    expect(parsePendingRace('not json{{{')).toBeNull()
  })

  it('returns null for a value with the wrong shape', () => {
    expect(parsePendingRace(JSON.stringify({ foo: 'bar' }))).toBeNull()
  })

  it('returns null for an invalid difficulty', () => {
    expect(parsePendingRace(JSON.stringify({ difficulty: 'extreme', seed: 1 }))).toBeNull()
  })

  it('returns null for a non-numeric seed', () => {
    expect(parsePendingRace(JSON.stringify({ difficulty: 'easy', seed: 'one' }))).toBeNull()
  })

  it('returns null for a non-finite seed', () => {
    expect(parsePendingRace(JSON.stringify({ difficulty: 'easy', seed: null }))).toBeNull()
  })
})
