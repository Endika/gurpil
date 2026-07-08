import { describe, it, expect } from 'vitest'
import {
  emptyRecord,
  updateRecord,
  loadRecord,
  saveResult,
  type KeyValueStore,
} from '../../src/core/records'

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
