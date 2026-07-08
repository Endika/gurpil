import { describe, it, expect } from 'vitest'
import { DIFFICULTY_ORDER, difficultyMessageKey } from '../../src/ui/difficultySelect'
import type { Difficulty } from '../../src/core/course'

describe('DIFFICULTY_ORDER', () => {
  it('lists every difficulty exactly once, easiest first', () => {
    expect(DIFFICULTY_ORDER).toEqual(['easy', 'medium', 'hard'])
  })
})

describe('difficultyMessageKey', () => {
  it('maps every difficulty to its own i18n key', () => {
    expect(difficultyMessageKey('easy')).toBe('difficulty.easy')
    expect(difficultyMessageKey('medium')).toBe('difficulty.medium')
    expect(difficultyMessageKey('hard')).toBe('difficulty.hard')
  })

  it('returns a distinct key for every difficulty', () => {
    const keys = DIFFICULTY_ORDER.map((d: Difficulty) => difficultyMessageKey(d))
    expect(new Set(keys).size).toBe(DIFFICULTY_ORDER.length)
  })
})
