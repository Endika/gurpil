import { describe, it, expect } from 'vitest'
import { hasFallenOffEdge } from '../../src/game/game'

describe('hasFallenOffEdge', () => {
  it('is false while the chassis is at or above the threshold', () => {
    expect(hasFallenOffEdge(0, -6)).toBe(false)
    expect(hasFallenOffEdge(-6, -6)).toBe(false)
    expect(hasFallenOffEdge(-5.999, -6)).toBe(false)
  })

  it('is true once the chassis drops below the threshold', () => {
    expect(hasFallenOffEdge(-6.001, -6)).toBe(true)
    expect(hasFallenOffEdge(-50, -6)).toBe(true)
  })

  it('is unaffected by ordinary above-ground driving heights', () => {
    // Normal driving/hill/jump heights stay well above any sane fall
    // threshold — the predicate should never fire for those.
    for (const y of [0.5, 1, 3, 10]) {
      expect(hasFallenOffEdge(y, -6)).toBe(false)
    }
  })
})
