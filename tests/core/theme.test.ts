/**
 * Visual themes — pure data + deterministic selection tests.
 *
 * No Three.js, no DOM: theme.ts is pure data. These tests guard the contract
 * every render file now relies on — that EVERY theme defines EVERY environment
 * color field as a finite hex number — plus the determinism of pickTheme.
 */

import { describe, it, expect } from 'vitest'
import { THEMES, THEME_IDS, pickTheme, type Theme, type ThemeId } from '../../src/core/theme'

/** Every scalar color field on a Theme (numbers, excluding arrays/nested). */
const SCALAR_COLOR_FIELDS: (keyof Theme)[] = [
  'clearColor',
  'skyTop',
  'skyMid',
  'skyHorizon',
  'fog',
  'fogFar',
  'sunColor',
  'sunIntensity',
  'hemiSky',
  'hemiGround',
  'hemiIntensity',
  'groundBackdrop',
  'terrainRoughness',
  'trunk',
  'grass',
  'logBark',
  'logEndCap',
  'rock',
]

const TERRAIN_ZONES = ['flat', 'rocky', 'uphill', 'mud', 'ice', 'eggs', 'runOut'] as const

const COLOR_ARRAY_FIELDS: (keyof Theme)[] = ['forest', 'foliage', 'bush', 'cloud', 'flower']

function isFiniteHex(n: unknown): boolean {
  return typeof n === 'number' && Number.isFinite(n)
}

describe('THEME_IDS', () => {
  it('matches the ThemeId union (all five, unique, stable order)', () => {
    expect(THEME_IDS).toEqual(['grassland', 'desert', 'snow', 'night', 'lava'])
    expect(new Set(THEME_IDS).size).toBe(THEME_IDS.length)
  })

  it('has a THEMES entry for every id and no extras', () => {
    expect(Object.keys(THEMES).sort()).toEqual([...THEME_IDS].sort())
  })

  it('includes grassland (the baseline that reproduces the pre-theme look)', () => {
    expect(THEME_IDS).toContain('grassland')
    expect(THEMES.grassland).toBeDefined()
  })
})

describe('THEMES completeness', () => {
  for (const id of THEME_IDS) {
    describe(id, () => {
      const theme = THEMES[id]

      it('has a matching id field', () => {
        expect(theme.id).toBe(id)
      })

      it('defines every scalar color/light field as a finite number', () => {
        for (const field of SCALAR_COLOR_FIELDS) {
          expect(isFiniteHex(theme[field]), `${id}.${String(field)}`).toBe(true)
        }
      })

      it('defines all seven terrain zone colors as finite numbers', () => {
        for (const zone of TERRAIN_ZONES) {
          expect(isFiniteHex(theme.terrain[zone]), `${id}.terrain.${zone}`).toBe(true)
        }
      })

      it('defines exactly three parallax hill colors (all finite)', () => {
        expect(theme.hills).toHaveLength(3)
        for (const c of theme.hills) expect(isFiniteHex(c)).toBe(true)
      })

      it('defines non-empty color arrays of finite numbers for scenery layers', () => {
        for (const field of COLOR_ARRAY_FIELDS) {
          const arr = theme[field] as readonly number[]
          expect(Array.isArray(arr), `${id}.${String(field)} is array`).toBe(true)
          expect(arr.length, `${id}.${String(field)} non-empty`).toBeGreaterThan(0)
          for (const c of arr) expect(isFiniteHex(c), `${id}.${String(field)} entry`).toBe(true)
        }
      })

      it('uses positive light intensities', () => {
        expect(theme.sunIntensity).toBeGreaterThan(0)
        expect(theme.hemiIntensity).toBeGreaterThan(0)
      })

      it('uses a valid (0..1) PBR roughness for the terrain', () => {
        expect(theme.terrainRoughness).toBeGreaterThanOrEqual(0)
        expect(theme.terrainRoughness).toBeLessThanOrEqual(1)
      })

      it('uses a positive, sane fog-far distance beyond the global fog-near', () => {
        // FOG_NEAR (scene.ts) is 105 — every theme's fog must fully resolve
        // (fogFar) well beyond that so the near track is never fogged and the
        // far parallax hills still get a chance to fade in before it.
        expect(theme.fogFar).toBeGreaterThan(105)
      })
    })
  }
})

describe('pickTheme', () => {
  it('is deterministic: same seed always yields the same theme', () => {
    for (const seed of [0, 1, 42, 1234, 2 ** 31, 4294967295]) {
      expect(pickTheme(seed)).toBe(pickTheme(seed))
    }
  })

  it('always returns a valid ThemeId', () => {
    for (let seed = 0; seed < 200; seed++) {
      expect(THEME_IDS).toContain(pickTheme(seed))
    }
  })

  it('can return different themes across different seeds (not constant)', () => {
    const seen = new Set<ThemeId>()
    for (let seed = 0; seed < 500; seed++) seen.add(pickTheme(seed))
    // Over a wide seed spread it should reach more than one theme; ideally all.
    expect(seen.size).toBeGreaterThan(1)
  })

  it('reaches every theme across a wide seed spread', () => {
    const seen = new Set<ThemeId>()
    for (let seed = 0; seed < 2000; seed++) seen.add(pickTheme(seed))
    expect(seen.size).toBe(THEME_IDS.length)
  })
})
