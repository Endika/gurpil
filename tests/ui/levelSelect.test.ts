import { describe, it, expect } from 'vitest'
import {
  levelCardView,
  campaignCardViews,
  themeMessageKey,
} from '../../src/ui/levelSelect'
import { CAMPAIGN, CAMPAIGN_SIZE, levelByNumber } from '../../src/core/campaign'
import { saveLevelResult, type KeyValueStore } from '../../src/core/records'
import { THEME_IDS } from '../../src/core/theme'

/** A real, in-memory KeyValueStore fake (not a mock) backed by a Map. */
function createMemoryStore(): KeyValueStore {
  const map = new Map<string, string>()
  return {
    get: (key) => map.get(key) ?? null,
    set: (key, value) => {
      map.set(key, value)
    },
  }
}

function level(n: number) {
  const l = levelByNumber(n)
  if (l === undefined) throw new Error(`no level ${n}`)
  return l
}

describe('levelCardView', () => {
  it('reports level 1 as unlocked with no record on a fresh store', () => {
    const store = createMemoryStore()
    expect(levelCardView(store, level(1))).toEqual({
      number: 1,
      locked: false,
      medal: 'none',
      bestMs: null,
    })
  })

  it('reports later levels as locked on a fresh store', () => {
    const store = createMemoryStore()
    const view = levelCardView(store, level(2))
    expect(view.locked).toBe(true)
    expect(view.bestMs).toBeNull()
    expect(view.medal).toBe('none')
  })

  it('surfaces the stored medal and best time for a finished unlocked level', () => {
    const store = createMemoryStore()
    saveLevelResult(store, 1, 4200, 'silver')
    expect(levelCardView(store, level(1))).toEqual({
      number: 1,
      locked: false,
      medal: 'silver',
      bestMs: 4200,
    })
  })

  it('unlocks the next level once its predecessor is finished', () => {
    const store = createMemoryStore()
    expect(levelCardView(store, level(2)).locked).toBe(true)
    saveLevelResult(store, 1, 5000, 'bronze')
    expect(levelCardView(store, level(2)).locked).toBe(false)
  })

  it('never reveals a record for a locked level', () => {
    const store = createMemoryStore()
    // Record a result for level 3 without unlocking it (level 2 unbeaten).
    saveLevelResult(store, 3, 1000, 'gold')
    const view = levelCardView(store, level(3))
    expect(view.locked).toBe(true)
    expect(view.bestMs).toBeNull()
    expect(view.medal).toBe('none')
  })
})

describe('campaignCardViews', () => {
  it('returns one view per campaign level, in order', () => {
    const store = createMemoryStore()
    const views = campaignCardViews(store)
    expect(views).toHaveLength(CAMPAIGN_SIZE)
    expect(views.map((v) => v.number)).toEqual(CAMPAIGN.map((l) => l.number))
  })

  it('has only level 1 unlocked on a fresh store', () => {
    const store = createMemoryStore()
    const unlocked = campaignCardViews(store).filter((v) => !v.locked)
    expect(unlocked.map((v) => v.number)).toEqual([1])
  })

  it('unlocks a contiguous prefix as levels are beaten', () => {
    const store = createMemoryStore()
    saveLevelResult(store, 1, 5000, 'bronze')
    saveLevelResult(store, 2, 5000, 'bronze')
    const unlocked = campaignCardViews(store)
      .filter((v) => !v.locked)
      .map((v) => v.number)
    expect(unlocked).toEqual([1, 2, 3])
  })
})

describe('themeMessageKey', () => {
  it('maps every theme id to its own i18n key', () => {
    for (const id of THEME_IDS) {
      expect(themeMessageKey(id)).toBe(`theme.${id}`)
    }
  })

  it('returns a distinct key per theme', () => {
    const keys = THEME_IDS.map((id) => themeMessageKey(id))
    expect(new Set(keys).size).toBe(THEME_IDS.length)
  })
})
