import { describe, it, expect } from 'vitest'
import { parsePendingRace, serializePendingRace } from '../../src/game/pendingRace'
import { CAMPAIGN_SIZE } from '../../src/core/campaign'

describe('serializePendingRace / parsePendingRace', () => {
  it('round-trips a valid pending race', () => {
    const pending = { levelNumber: 5 }
    expect(parsePendingRace(serializePendingRace(pending))).toEqual(pending)
  })

  it('round-trips every campaign level number', () => {
    for (let n = 1; n <= CAMPAIGN_SIZE; n++) {
      const pending = { levelNumber: n }
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

  it('returns null for a non-numeric level number', () => {
    expect(parsePendingRace(JSON.stringify({ levelNumber: 'one' }))).toBeNull()
  })

  it('returns null for a non-integer level number', () => {
    expect(parsePendingRace(JSON.stringify({ levelNumber: 2.5 }))).toBeNull()
  })

  it('returns null for a level number below 1', () => {
    expect(parsePendingRace(JSON.stringify({ levelNumber: 0 }))).toBeNull()
  })

  it('returns null for a level number above the campaign size', () => {
    expect(parsePendingRace(JSON.stringify({ levelNumber: CAMPAIGN_SIZE + 1 }))).toBeNull()
  })
})
