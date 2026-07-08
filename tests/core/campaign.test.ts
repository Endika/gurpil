/**
 * Campaign — pure data + determinism tests.
 *
 * No Three.js, no Rapier, no DOM: campaign.ts is pure data derived from named
 * constants. These tests guard the campaign contract 2b will build the UI on:
 * a fixed, deterministic, contiguous, non-decreasing-difficulty, theme-rotating
 * list of distinctly-seeded levels.
 */

import { describe, it, expect } from 'vitest'
import {
  CAMPAIGN,
  CAMPAIGN_SIZE,
  LEVELS_PER_TIER,
  levelByNumber,
  type Level,
} from '../../src/core/campaign'
import { DIFFICULTY_TIERS, type DifficultyTier } from '../../src/core/course'
import { THEME_IDS } from '../../src/core/theme'

/** Difficulty tier ordinal (position in the easiest→hardest tier order). */
function tierRank(d: DifficultyTier): number {
  return DIFFICULTY_TIERS.indexOf(d)
}

describe('CAMPAIGN_SIZE', () => {
  it('is five tiers × LEVELS_PER_TIER', () => {
    expect(CAMPAIGN_SIZE).toBe(DIFFICULTY_TIERS.length * LEVELS_PER_TIER)
  })

  it('matches the campaign length', () => {
    expect(CAMPAIGN).toHaveLength(CAMPAIGN_SIZE)
  })
})

describe('CAMPAIGN determinism', () => {
  it('references a stable, non-empty ordered list', () => {
    expect(CAMPAIGN.length).toBeGreaterThan(0)
    // Same reference on every read (built once at module load, no randomness).
    expect(CAMPAIGN).toBe(CAMPAIGN)
  })

  it('every level is fully specified (finite integer number/seed, valid tier/theme)', () => {
    for (const lvl of CAMPAIGN) {
      expect(Number.isInteger(lvl.number)).toBe(true)
      expect(Number.isInteger(lvl.seed)).toBe(true)
      expect(Number.isFinite(lvl.seed)).toBe(true)
      expect(DIFFICULTY_TIERS).toContain(lvl.difficulty)
      expect(THEME_IDS).toContain(lvl.themeId)
    }
  })
})

describe('CAMPAIGN numbering', () => {
  it('numbers are 1 … CAMPAIGN_SIZE, contiguous and in order', () => {
    expect(CAMPAIGN.map((l) => l.number)).toEqual(
      Array.from({ length: CAMPAIGN_SIZE }, (_, i) => i + 1),
    )
  })
})

describe('CAMPAIGN difficulty ramp', () => {
  it('difficulty is non-decreasing across the campaign', () => {
    for (let i = 1; i < CAMPAIGN.length; i++) {
      expect(tierRank(CAMPAIGN[i].difficulty)).toBeGreaterThanOrEqual(
        tierRank(CAMPAIGN[i - 1].difficulty),
      )
    }
  })

  it('starts at the easiest tier and ends at the hardest', () => {
    expect(CAMPAIGN[0].difficulty).toBe(DIFFICULTY_TIERS[0])
    expect(CAMPAIGN[CAMPAIGN.length - 1].difficulty).toBe(
      DIFFICULTY_TIERS[DIFFICULTY_TIERS.length - 1],
    )
  })

  it('every tier appears exactly LEVELS_PER_TIER times', () => {
    for (const tier of DIFFICULTY_TIERS) {
      const count = CAMPAIGN.filter((l) => l.difficulty === tier).length
      expect(count).toBe(LEVELS_PER_TIER)
    }
  })
})

describe('CAMPAIGN themes', () => {
  it('rotates through the themes: adjacent levels never repeat a theme', () => {
    // With a full rotation over all five themes, consecutive levels differ.
    for (let i = 1; i < CAMPAIGN.length; i++) {
      expect(CAMPAIGN[i].themeId).not.toBe(CAMPAIGN[i - 1].themeId)
    }
  })

  it('uses more than one theme (visual variety)', () => {
    expect(new Set(CAMPAIGN.map((l) => l.themeId)).size).toBeGreaterThan(1)
  })

  it('every theme is used at least once across the campaign', () => {
    const used = new Set(CAMPAIGN.map((l) => l.themeId))
    expect(used.size).toBe(THEME_IDS.length)
  })
})

describe('CAMPAIGN seeds', () => {
  it('every level has a distinct seed', () => {
    const seeds = CAMPAIGN.map((l) => l.seed)
    expect(new Set(seeds).size).toBe(seeds.length)
  })
})

describe('levelByNumber', () => {
  it('returns the matching level for every valid number', () => {
    for (let n = 1; n <= CAMPAIGN_SIZE; n++) {
      const lvl = levelByNumber(n) as Level
      expect(lvl).toBeDefined()
      expect(lvl.number).toBe(n)
      expect(lvl).toBe(CAMPAIGN[n - 1])
    }
  })

  it('returns undefined for out-of-range or non-integer numbers', () => {
    expect(levelByNumber(0)).toBeUndefined()
    expect(levelByNumber(-1)).toBeUndefined()
    expect(levelByNumber(CAMPAIGN_SIZE + 1)).toBeUndefined()
    expect(levelByNumber(1.5)).toBeUndefined()
  })
})
