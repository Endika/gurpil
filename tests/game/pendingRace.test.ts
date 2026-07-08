import { describe, it, expect } from 'vitest'
import { parsePendingRace, serializePendingRace } from '../../src/game/pendingRace'
import { CAMPAIGN_SIZE } from '../../src/core/campaign'

describe('serializePendingRace / parsePendingRace — campaign level', () => {
  it('round-trips a valid level', () => {
    const pending = { mode: 'level', number: 5 } as const
    expect(parsePendingRace(serializePendingRace(pending))).toEqual(pending)
  })

  it('round-trips every campaign level number', () => {
    for (let n = 1; n <= CAMPAIGN_SIZE; n++) {
      const pending = { mode: 'level', number: n } as const
      expect(parsePendingRace(serializePendingRace(pending))).toEqual(pending)
    }
  })

  it('returns null for a non-numeric level number', () => {
    expect(parsePendingRace(JSON.stringify({ mode: 'level', number: 'one' }))).toBeNull()
  })

  it('returns null for a non-integer level number', () => {
    expect(parsePendingRace(JSON.stringify({ mode: 'level', number: 2.5 }))).toBeNull()
  })

  it('returns null for a level number below 1', () => {
    expect(parsePendingRace(JSON.stringify({ mode: 'level', number: 0 }))).toBeNull()
  })

  it('returns null for a level number above the campaign size', () => {
    expect(parsePendingRace(JSON.stringify({ mode: 'level', number: CAMPAIGN_SIZE + 1 }))).toBeNull()
  })
})

describe('serializePendingRace / parsePendingRace — endless', () => {
  it('round-trips a valid endless run', () => {
    const pending = { mode: 'endless', seed: 123456 } as const
    expect(parsePendingRace(serializePendingRace(pending))).toEqual(pending)
  })

  it('round-trips seed 0 and the max uint32 seed', () => {
    for (const seed of [0, 0xffffffff]) {
      const pending = { mode: 'endless', seed } as const
      expect(parsePendingRace(serializePendingRace(pending))).toEqual(pending)
    }
  })

  it('returns null for a non-integer seed', () => {
    expect(parsePendingRace(JSON.stringify({ mode: 'endless', seed: 1.5 }))).toBeNull()
  })

  it('returns null for a negative seed', () => {
    expect(parsePendingRace(JSON.stringify({ mode: 'endless', seed: -1 }))).toBeNull()
  })

  it('returns null for a seed above uint32', () => {
    expect(parsePendingRace(JSON.stringify({ mode: 'endless', seed: 0x1_0000_0000 }))).toBeNull()
  })

  it('returns null for a missing seed', () => {
    expect(parsePendingRace(JSON.stringify({ mode: 'endless' }))).toBeNull()
  })
})

describe('parsePendingRace — invalid input', () => {
  it('returns null for a missing value', () => {
    expect(parsePendingRace(null)).toBeNull()
  })

  it('returns null for invalid JSON', () => {
    expect(parsePendingRace('not json{{{')).toBeNull()
  })

  it('returns null for a value with no mode', () => {
    expect(parsePendingRace(JSON.stringify({ number: 3 }))).toBeNull()
  })

  it('returns null for an unknown mode', () => {
    expect(parsePendingRace(JSON.stringify({ mode: 'timeAttack', number: 3 }))).toBeNull()
  })

  it('returns null for the legacy (pre-discriminator) shape', () => {
    expect(parsePendingRace(JSON.stringify({ levelNumber: 5 }))).toBeNull()
  })
})
