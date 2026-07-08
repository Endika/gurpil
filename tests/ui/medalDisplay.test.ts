import { describe, it, expect } from 'vitest'
import { medalMessageKey, medalColorVar } from '../../src/ui/medalDisplay'
import type { Medal } from '../../src/core/medal'

const ALL_MEDALS: readonly Medal[] = ['gold', 'silver', 'bronze', 'none']

describe('medalMessageKey', () => {
  it('maps every medal to its own i18n key', () => {
    expect(medalMessageKey('gold')).toBe('medal.gold')
    expect(medalMessageKey('silver')).toBe('medal.silver')
    expect(medalMessageKey('bronze')).toBe('medal.bronze')
    expect(medalMessageKey('none')).toBe('medal.none')
  })

  it('returns a distinct key for every medal', () => {
    const keys = ALL_MEDALS.map(medalMessageKey)
    expect(new Set(keys).size).toBe(ALL_MEDALS.length)
  })
})

describe('medalColorVar', () => {
  it('returns a distinct CSS var() reference for every medal', () => {
    const colors = ALL_MEDALS.map(medalColorVar)
    for (const color of colors) {
      expect(color).toMatch(/^var\(--gurpil-medal-\w+\)$/)
    }
    expect(new Set(colors).size).toBe(ALL_MEDALS.length)
  })
})
