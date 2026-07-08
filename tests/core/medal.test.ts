import { describe, it, expect } from 'vitest'
import { parTimeMs, medalFor, medalRank } from '../../src/core/medal'
import { generateCourse, buildCanonicalCourse } from '../../src/core/course'
import type { Course } from '../../src/core/course'

describe('parTimeMs', () => {
  it('is positive for a real course', () => {
    const course = buildCanonicalCourse()
    expect(parTimeMs(course)).toBeGreaterThan(0)
  })

  it('is monotonic in track distance: a longer track has a larger par', () => {
    const shortCourse: Course = { ...buildCanonicalCourse(), startX: 0, finishX: 100 }
    const longCourse: Course = { ...buildCanonicalCourse(), startX: 0, finishX: 200 }
    expect(parTimeMs(longCourse)).toBeGreaterThan(parTimeMs(shortCourse))
  })

  it('scales linearly with distance', () => {
    const base: Course = { ...buildCanonicalCourse(), startX: 0, finishX: 100 }
    const doubled: Course = { ...buildCanonicalCourse(), startX: 0, finishX: 200 }
    expect(parTimeMs(doubled)).toBeCloseTo(parTimeMs(base) * 2, 6)
  })

  it('is unaffected by a shifted (non-zero) startX for the same distance', () => {
    const a: Course = { ...buildCanonicalCourse(), startX: 0, finishX: 100 }
    const b: Course = { ...buildCanonicalCourse(), startX: 50, finishX: 150 }
    expect(parTimeMs(a)).toBeCloseTo(parTimeMs(b), 6)
  })

  it('generated hard tracks are typically longer (and so have larger par) than easy tracks', () => {
    const easy = generateCourse({ difficulty: 'easy', seed: 42 })
    const hard = generateCourse({ difficulty: 'hard', seed: 42 })
    expect(parTimeMs(hard)).toBeGreaterThan(parTimeMs(easy))
  })
})

describe('medalFor', () => {
  const parMs = 10000

  it('awards gold exactly at par', () => {
    expect(medalFor(parMs, parMs)).toBe('gold')
  })

  it('awards gold for anything faster than par', () => {
    expect(medalFor(parMs * 0.5, parMs)).toBe('gold')
  })

  it('awards silver just past the gold threshold', () => {
    expect(medalFor(parMs * 1.01, parMs)).toBe('silver')
  })

  it('awards silver exactly at the silver multiplier', () => {
    expect(medalFor(parMs * 1.3, parMs)).toBe('silver')
  })

  it('awards bronze just past the silver threshold', () => {
    expect(medalFor(parMs * 1.31, parMs)).toBe('bronze')
  })

  it('awards bronze exactly at the bronze multiplier', () => {
    expect(medalFor(parMs * 1.7, parMs)).toBe('bronze')
  })

  it('awards no medal just past the bronze threshold', () => {
    expect(medalFor(parMs * 1.71, parMs)).toBe('none')
  })

  it('awards no medal for a very slow time', () => {
    expect(medalFor(parMs * 5, parMs)).toBe('none')
  })

  it('is monotonic: a slower elapsed time never yields a better medal', () => {
    const times = [
      parMs * 0.5,
      parMs,
      parMs * 1.15,
      parMs * 1.3,
      parMs * 1.5,
      parMs * 1.7,
      parMs * 2,
    ]
    const ranks = times.map((t) => medalRank(medalFor(t, parMs)))
    for (let i = 1; i < ranks.length; i++) {
      expect(ranks[i]).toBeLessThanOrEqual(ranks[i - 1])
    }
  })
})

describe('medalRank', () => {
  it('orders medals worst to best', () => {
    expect(medalRank('none')).toBeLessThan(medalRank('bronze'))
    expect(medalRank('bronze')).toBeLessThan(medalRank('silver'))
    expect(medalRank('silver')).toBeLessThan(medalRank('gold'))
  })
})
