import { describe, it, expect } from 'vitest'
import { engineFreq, engineGain, finishNotes } from '../../src/audio/audio'

describe('engineFreq', () => {
  it('is at its base value at a standstill', () => {
    expect(engineFreq(0)).toBeCloseTo(55, 5)
  })

  it('reaches its max value at full speed', () => {
    expect(engineFreq(1)).toBeCloseTo(190, 5)
  })

  it('clamps out-of-range input', () => {
    expect(engineFreq(-1)).toBe(engineFreq(0))
    expect(engineFreq(2)).toBe(engineFreq(1))
  })

  it('is monotonically non-decreasing in speedFraction', () => {
    const samples = [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1]
    for (let i = 1; i < samples.length; i++) {
      expect(engineFreq(samples[i])).toBeGreaterThanOrEqual(engineFreq(samples[i - 1]))
    }
  })
})

describe('engineGain', () => {
  it('is near-silent at a standstill', () => {
    expect(engineGain(0)).toBeCloseTo(0.012, 5)
  })

  it('is still subtle at full speed', () => {
    const max = engineGain(1)
    expect(max).toBeCloseTo(0.055, 5)
    expect(max).toBeLessThan(0.2)
  })

  it('clamps out-of-range input', () => {
    expect(engineGain(-5)).toBe(engineGain(0))
    expect(engineGain(5)).toBe(engineGain(1))
  })

  it('is monotonically non-decreasing in speedFraction', () => {
    const samples = [0, 0.2, 0.4, 0.6, 0.8, 1]
    for (let i = 1; i < samples.length; i++) {
      expect(engineGain(samples[i])).toBeGreaterThanOrEqual(engineGain(samples[i - 1]))
    }
  })
})

describe('finishNotes', () => {
  function averageFreq(notes: readonly number[]): number {
    return notes.reduce((sum, n) => sum + n, 0) / notes.length
  }

  it('grades gold brighter (higher average pitch) than silver, bronze and none', () => {
    const gold = averageFreq(finishNotes('gold'))
    const silver = averageFreq(finishNotes('silver'))
    const bronze = averageFreq(finishNotes('bronze'))
    const none = averageFreq(finishNotes('none'))
    expect(gold).toBeGreaterThan(silver)
    expect(silver).toBeGreaterThan(bronze)
    expect(bronze).toBeGreaterThan(none)
  })

  it('returns a non-empty arpeggio for every medal', () => {
    for (const medal of ['gold', 'silver', 'bronze', 'none'] as const) {
      expect(finishNotes(medal).length).toBeGreaterThan(0)
    }
  })
})
