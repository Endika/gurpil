import { describe, it, expect } from 'vitest'
import {
  emptyRecord,
  updateRecord,
  loadRecord,
  saveResult,
  loadLevelRecord,
  saveLevelResult,
  isLevelUnlocked,
  highestUnlocked,
  loadEndlessBest,
  saveEndlessDistance,
  isEndlessUnlocked,
  type KeyValueStore,
} from '../../src/core/records'
import { CAMPAIGN_SIZE } from '../../src/core/campaign'

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

describe('emptyRecord', () => {
  it('has no best time and no medal', () => {
    expect(emptyRecord()).toEqual({ bestMs: null, bestMedal: 'none' })
  })
})

describe('updateRecord', () => {
  it('sets bestMs and bestMedal from the first result', () => {
    const next = updateRecord(emptyRecord(), 5000, 'silver')
    expect(next).toEqual({ bestMs: 5000, bestMedal: 'silver' })
  })

  it('does not replace bestMs with a slower time', () => {
    const prev = updateRecord(emptyRecord(), 5000, 'silver')
    const next = updateRecord(prev, 8000, 'silver')
    expect(next.bestMs).toBe(5000)
  })

  it('replaces bestMs with a faster time', () => {
    const prev = updateRecord(emptyRecord(), 5000, 'silver')
    const next = updateRecord(prev, 3000, 'bronze')
    expect(next.bestMs).toBe(3000)
  })

  it('upgrades bestMedal when a better medal is achieved, independent of time', () => {
    const prev = updateRecord(emptyRecord(), 5000, 'bronze')
    // Slower run, but a better medal (e.g. an easier track) still upgrades bestMedal.
    const next = updateRecord(prev, 9000, 'gold')
    expect(next.bestMedal).toBe('gold')
    expect(next.bestMs).toBe(5000)
  })

  it('does not downgrade bestMedal with a worse medal', () => {
    const prev = updateRecord(emptyRecord(), 5000, 'gold')
    const next = updateRecord(prev, 3000, 'bronze')
    expect(next.bestMedal).toBe('gold')
    expect(next.bestMs).toBe(3000)
  })

  it('does not mutate the input record', () => {
    const prev = updateRecord(emptyRecord(), 5000, 'silver')
    const snapshot = { ...prev }
    updateRecord(prev, 1000, 'gold')
    expect(prev).toEqual(snapshot)
  })
})

describe('loadRecord / saveResult', () => {
  it('loadRecord returns emptyRecord when nothing was ever saved', () => {
    const store = createMemoryStore()
    expect(loadRecord(store, 'easy')).toEqual(emptyRecord())
  })

  it('saveResult persists and loadRecord round-trips it', () => {
    const store = createMemoryStore()
    const saved = saveResult(store, 'medium', 4200, 'gold')
    expect(saved).toEqual({ bestMs: 4200, bestMedal: 'gold' })
    expect(loadRecord(store, 'medium')).toEqual({ bestMs: 4200, bestMedal: 'gold' })
  })

  it('keeps separate records per difficulty', () => {
    const store = createMemoryStore()
    saveResult(store, 'easy', 3000, 'gold')
    saveResult(store, 'hard', 9000, 'bronze')
    expect(loadRecord(store, 'easy')).toEqual({ bestMs: 3000, bestMedal: 'gold' })
    expect(loadRecord(store, 'hard')).toEqual({ bestMs: 9000, bestMedal: 'bronze' })
  })

  it('saveResult only improves: a slower/worse follow-up does not regress the record', () => {
    const store = createMemoryStore()
    saveResult(store, 'easy', 4000, 'silver')
    const after = saveResult(store, 'easy', 6000, 'bronze')
    expect(after).toEqual({ bestMs: 4000, bestMedal: 'silver' })
  })

  it('saveResult improves on a better follow-up', () => {
    const store = createMemoryStore()
    saveResult(store, 'easy', 4000, 'silver')
    const after = saveResult(store, 'easy', 2500, 'gold')
    expect(after).toEqual({ bestMs: 2500, bestMedal: 'gold' })
  })

  it('loadRecord falls back to emptyRecord on corrupt JSON', () => {
    const store = createMemoryStore()
    store.set('gurpil.record.easy', 'not json{{{')
    expect(loadRecord(store, 'easy')).toEqual(emptyRecord())
  })

  it('loadRecord falls back to emptyRecord on a value with the wrong shape', () => {
    const store = createMemoryStore()
    store.set('gurpil.record.easy', JSON.stringify({ foo: 'bar' }))
    expect(loadRecord(store, 'easy')).toEqual(emptyRecord())
  })

  it('loadRecord falls back to emptyRecord on an invalid medal value', () => {
    const store = createMemoryStore()
    store.set('gurpil.record.easy', JSON.stringify({ bestMs: 100, bestMedal: 'platinum' }))
    expect(loadRecord(store, 'easy')).toEqual(emptyRecord())
  })
})

describe('loadLevelRecord / saveLevelResult (per-level)', () => {
  it('loadLevelRecord returns emptyRecord when nothing was ever saved', () => {
    const store = createMemoryStore()
    expect(loadLevelRecord(store, 1)).toEqual(emptyRecord())
  })

  it('saveLevelResult persists and loadLevelRecord round-trips it', () => {
    const store = createMemoryStore()
    const saved = saveLevelResult(store, 3, 4200, 'gold')
    expect(saved).toEqual({ bestMs: 4200, bestMedal: 'gold' })
    expect(loadLevelRecord(store, 3)).toEqual({ bestMs: 4200, bestMedal: 'gold' })
  })

  it('keeps separate records per level number', () => {
    const store = createMemoryStore()
    saveLevelResult(store, 1, 3000, 'gold')
    saveLevelResult(store, 2, 9000, 'bronze')
    expect(loadLevelRecord(store, 1)).toEqual({ bestMs: 3000, bestMedal: 'gold' })
    expect(loadLevelRecord(store, 2)).toEqual({ bestMs: 9000, bestMedal: 'bronze' })
  })

  it('does not collide with the per-difficulty record key space', () => {
    const store = createMemoryStore()
    saveResult(store, 'easy', 5000, 'silver')
    // Level 1 shares no storage with difficulty "easy".
    expect(loadLevelRecord(store, 1)).toEqual(emptyRecord())
  })

  it('saveLevelResult only improves: slower/worse follow-up does not regress', () => {
    const store = createMemoryStore()
    saveLevelResult(store, 5, 4000, 'silver')
    const after = saveLevelResult(store, 5, 6000, 'bronze')
    expect(after).toEqual({ bestMs: 4000, bestMedal: 'silver' })
  })

  it('saveLevelResult improves on a better follow-up', () => {
    const store = createMemoryStore()
    saveLevelResult(store, 5, 4000, 'silver')
    const after = saveLevelResult(store, 5, 2500, 'gold')
    expect(after).toEqual({ bestMs: 2500, bestMedal: 'gold' })
  })

  it('loadLevelRecord falls back to emptyRecord on corrupt JSON', () => {
    const store = createMemoryStore()
    store.set('gurpil.levelRecord.1', 'not json{{{')
    expect(loadLevelRecord(store, 1)).toEqual(emptyRecord())
  })

  it('loadLevelRecord falls back to emptyRecord on a wrong-shaped value', () => {
    const store = createMemoryStore()
    store.set('gurpil.levelRecord.1', JSON.stringify({ foo: 'bar' }))
    expect(loadLevelRecord(store, 1)).toEqual(emptyRecord())
  })
})

describe('isLevelUnlocked / highestUnlocked', () => {
  it('level 1 is always unlocked, even on an empty store', () => {
    const store = createMemoryStore()
    expect(isLevelUnlocked(store, 1)).toBe(true)
  })

  it('locks every level beyond 1 on a fresh store', () => {
    const store = createMemoryStore()
    expect(isLevelUnlocked(store, 2)).toBe(false)
    expect(isLevelUnlocked(store, CAMPAIGN_SIZE)).toBe(false)
  })

  it('unlocks level N once level N-1 is beaten (any finish, even no medal)', () => {
    const store = createMemoryStore()
    expect(isLevelUnlocked(store, 2)).toBe(false)
    saveLevelResult(store, 1, 12000, 'none')
    expect(isLevelUnlocked(store, 2)).toBe(true)
  })

  it('does not unlock level N+2 just because N was beaten', () => {
    const store = createMemoryStore()
    saveLevelResult(store, 1, 5000, 'gold')
    expect(isLevelUnlocked(store, 2)).toBe(true)
    expect(isLevelUnlocked(store, 3)).toBe(false)
  })

  it('never unlocks numbers outside 1 … CAMPAIGN_SIZE', () => {
    const store = createMemoryStore()
    expect(isLevelUnlocked(store, 0)).toBe(false)
    expect(isLevelUnlocked(store, -1)).toBe(false)
    expect(isLevelUnlocked(store, CAMPAIGN_SIZE + 1)).toBe(false)
    expect(isLevelUnlocked(store, 1.5)).toBe(false)
  })

  it('treats corrupt predecessor storage as not-beaten (stays locked)', () => {
    const store = createMemoryStore()
    store.set('gurpil.levelRecord.1', 'not json{{{')
    expect(isLevelUnlocked(store, 2)).toBe(false)
  })

  it('highestUnlocked is 1 on a fresh store', () => {
    const store = createMemoryStore()
    expect(highestUnlocked(store)).toBe(1)
  })

  it('highestUnlocked advances as consecutive levels are beaten', () => {
    const store = createMemoryStore()
    saveLevelResult(store, 1, 5000, 'gold')
    expect(highestUnlocked(store)).toBe(2)
    saveLevelResult(store, 2, 5000, 'silver')
    expect(highestUnlocked(store)).toBe(3)
  })

  it('highestUnlocked stops at the first unbeaten level (no skipping gaps)', () => {
    const store = createMemoryStore()
    saveLevelResult(store, 1, 5000, 'gold')
    // Beat level 3 but NOT level 2 — the chain breaks at 2.
    saveLevelResult(store, 3, 5000, 'gold')
    expect(highestUnlocked(store)).toBe(2)
  })

  it('highestUnlocked never exceeds CAMPAIGN_SIZE (whole campaign beaten)', () => {
    const store = createMemoryStore()
    for (let n = 1; n <= CAMPAIGN_SIZE; n++) saveLevelResult(store, n, 5000, 'gold')
    expect(highestUnlocked(store)).toBe(CAMPAIGN_SIZE)
  })
})

describe('loadEndlessBest / saveEndlessDistance', () => {
  it('loadEndlessBest is 0 on a fresh store', () => {
    expect(loadEndlessBest(createMemoryStore())).toBe(0)
  })

  it('saveEndlessDistance persists and loadEndlessBest round-trips it', () => {
    const store = createMemoryStore()
    const saved = saveEndlessDistance(store, 1234.5)
    expect(saved).toBe(1234.5)
    expect(loadEndlessBest(store)).toBe(1234.5)
  })

  it('only increases: a shorter follow-up does not regress the best', () => {
    const store = createMemoryStore()
    saveEndlessDistance(store, 900)
    const after = saveEndlessDistance(store, 300)
    expect(after).toBe(900)
    expect(loadEndlessBest(store)).toBe(900)
  })

  it('improves on a longer follow-up', () => {
    const store = createMemoryStore()
    saveEndlessDistance(store, 500)
    const after = saveEndlessDistance(store, 1500)
    expect(after).toBe(1500)
  })

  it('treats a negative distance as 0', () => {
    const store = createMemoryStore()
    expect(saveEndlessDistance(store, -50)).toBe(0)
    expect(loadEndlessBest(store)).toBe(0)
  })

  it('loadEndlessBest falls back to 0 on a corrupt (non-numeric) value', () => {
    const store = createMemoryStore()
    store.set('gurpil.endless.best', 'not a number')
    expect(loadEndlessBest(store)).toBe(0)
  })

  it('loadEndlessBest falls back to 0 on a negative stored value', () => {
    const store = createMemoryStore()
    store.set('gurpil.endless.best', '-42')
    expect(loadEndlessBest(store)).toBe(0)
  })

  it('does not collide with the per-difficulty or per-level key space', () => {
    const store = createMemoryStore()
    saveResult(store, 'easy', 5000, 'gold')
    saveLevelResult(store, 1, 5000, 'gold')
    expect(loadEndlessBest(store)).toBe(0)
  })
})

describe('isEndlessUnlocked', () => {
  it('is locked on a fresh store', () => {
    expect(isEndlessUnlocked(createMemoryStore())).toBe(false)
  })

  it('stays locked while the final level is unbeaten (even most beaten)', () => {
    const store = createMemoryStore()
    for (let n = 1; n < CAMPAIGN_SIZE; n++) saveLevelResult(store, n, 5000, 'gold')
    expect(isEndlessUnlocked(store)).toBe(false)
  })

  it('unlocks once the final level is beaten (any finish, even no medal)', () => {
    const store = createMemoryStore()
    saveLevelResult(store, CAMPAIGN_SIZE, 20000, 'none')
    expect(isEndlessUnlocked(store)).toBe(true)
  })

  it('treats corrupt final-level storage as not-beaten (stays locked)', () => {
    const store = createMemoryStore()
    store.set(`gurpil.levelRecord.${CAMPAIGN_SIZE}`, 'not json{{{')
    expect(isEndlessUnlocked(store)).toBe(false)
  })
})
