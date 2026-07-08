/**
 * Best-time records — pure persistence logic for per-difficulty best runs.
 *
 * Storage-agnostic: callers inject a `KeyValueStore` (a minimal get/set
 * string interface). `src/ui/localStorageStore.ts` provides the real
 * browser-backed implementation; tests use an in-memory fake. No DOM here.
 */

import type { Difficulty } from './course'
import type { Medal } from './medal'
import { medalRank } from './medal'
import { CAMPAIGN_SIZE } from './campaign'

// ─── Public types ───────────────────────────────────────────────────────────

/** The best result achieved so far for a difficulty. */
export interface Record {
  bestMs: number | null
  bestMedal: Medal
}

/** A single completed run, as reported by the game loop. */
export interface RunResult {
  difficulty: Difficulty
  elapsedMs: number
  medal: Medal
}

/** Minimal storage the record store needs. Implemented by localStorage,
 *  an in-memory Map, or anything else with string get/set semantics. */
export interface KeyValueStore {
  get(key: string): string | null
  set(key: string, value: string): void
}

// ─── Record logic (pure, immutable) ────────────────────────────────────────

/** A record with no run recorded yet. */
export function emptyRecord(): Record {
  return { bestMs: null, bestMedal: 'none' }
}

/**
 * Merge a new result into a previous record, keeping the best of each field
 * independently: the lowest elapsed time ever achieved, and the highest
 * medal ever achieved. Either can improve without the other doing so in the
 * same run. Pure — returns a new object, never mutates `prev`.
 */
export function updateRecord(prev: Record, elapsedMs: number, medal: Medal): Record {
  const bestMs = prev.bestMs === null || elapsedMs < prev.bestMs ? elapsedMs : prev.bestMs
  const bestMedal = medalRank(medal) > medalRank(prev.bestMedal) ? medal : prev.bestMedal
  return { bestMs, bestMedal }
}

// ─── Storage (JSON-serialized, corruption-tolerant) ────────────────────────

const STORAGE_KEY_PREFIX = 'gurpil.record.'

function keyFor(difficulty: Difficulty): string {
  return `${STORAGE_KEY_PREFIX}${difficulty}`
}

const VALID_MEDALS: readonly Medal[] = ['none', 'bronze', 'silver', 'gold']

/** Type-guard: is `value` a well-formed, persisted Record? */
function isRecord(value: unknown): value is Record {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as { bestMs?: unknown; bestMedal?: unknown }
  const bestMsOk = candidate.bestMs === null || typeof candidate.bestMs === 'number'
  const bestMedalOk =
    typeof candidate.bestMedal === 'string' &&
    VALID_MEDALS.includes(candidate.bestMedal as Medal)
  return bestMsOk && bestMedalOk
}

/**
 * Load the persisted record for a difficulty. Tolerates a missing key,
 * invalid JSON, or a value that doesn't match the Record shape — all fall
 * back to `emptyRecord()` rather than throwing.
 */
export function loadRecord(store: KeyValueStore, difficulty: Difficulty): Record {
  const raw = store.get(keyFor(difficulty))
  if (raw === null) return emptyRecord()

  try {
    const parsed: unknown = JSON.parse(raw)
    return isRecord(parsed) ? parsed : emptyRecord()
  } catch {
    return emptyRecord()
  }
}

/**
 * Load the current record, merge in a new result, persist it, and return the
 * (possibly improved) record. Only ever improves — see `updateRecord`.
 */
export function saveResult(
  store: KeyValueStore,
  difficulty: Difficulty,
  elapsedMs: number,
  medal: Medal,
): Record {
  const prev = loadRecord(store, difficulty)
  const next = updateRecord(prev, elapsedMs, medal)
  store.set(keyFor(difficulty), JSON.stringify(next))
  return next
}

// ─── Per-level records (campaign) ──────────────────────────────────────────
//
// The campaign (see `core/campaign.ts`) stores a best result PER LEVEL NUMBER,
// independently of the per-difficulty records above. Same Record shape, same
// corruption tolerance and only-improves semantics; just a different key space.

const LEVEL_STORAGE_KEY_PREFIX = 'gurpil.levelRecord.'

function keyForLevel(levelNumber: number): string {
  return `${LEVEL_STORAGE_KEY_PREFIX}${levelNumber}`
}

/**
 * Load the persisted record for a campaign level number. Tolerates a missing
 * key, invalid JSON, or a wrong-shaped value — all fall back to `emptyRecord()`.
 */
export function loadLevelRecord(store: KeyValueStore, levelNumber: number): Record {
  const raw = store.get(keyForLevel(levelNumber))
  if (raw === null) return emptyRecord()

  try {
    const parsed: unknown = JSON.parse(raw)
    return isRecord(parsed) ? parsed : emptyRecord()
  } catch {
    return emptyRecord()
  }
}

/**
 * Load the current record for a level, merge in a new result, persist it, and
 * return the (possibly improved) record. Only ever improves — see `updateRecord`.
 */
export function saveLevelResult(
  store: KeyValueStore,
  levelNumber: number,
  elapsedMs: number,
  medal: Medal,
): Record {
  const prev = loadLevelRecord(store, levelNumber)
  const next = updateRecord(prev, elapsedMs, medal)
  store.set(keyForLevel(levelNumber), JSON.stringify(next))
  return next
}

// ─── Unlock progression ────────────────────────────────────────────────────
//
// Level 1 is always unlocked; every later level unlocks once its PREDECESSOR
// has been BEATEN. "Beaten" = has any recorded finish (a stored best time),
// regardless of medal — finishing at all is enough to progress. Corrupt/missing
// storage yields an empty record (no best time), so everything beyond level 1
// stays locked until the player actually finishes.

/** Has this level ever been finished (has a recorded best time)? */
function isLevelBeaten(store: KeyValueStore, levelNumber: number): boolean {
  return loadLevelRecord(store, levelNumber).bestMs !== null
}

/**
 * Is the given campaign level unlocked? Level 1 is always unlocked; level N
 * (1 < N ≤ CAMPAIGN_SIZE) is unlocked iff level N-1 has been beaten. Numbers
 * outside 1 … CAMPAIGN_SIZE are never unlocked.
 */
export function isLevelUnlocked(store: KeyValueStore, levelNumber: number): boolean {
  if (!Number.isInteger(levelNumber) || levelNumber < 1 || levelNumber > CAMPAIGN_SIZE) {
    return false
  }
  if (levelNumber === 1) return true
  return isLevelBeaten(store, levelNumber - 1)
}

/**
 * The highest currently-unlocked level number (≥ 1, capped at CAMPAIGN_SIZE):
 * the furthest point the player can reach given what they have beaten so far.
 */
export function highestUnlocked(store: KeyValueStore): number {
  let highest = 1
  while (highest < CAMPAIGN_SIZE && isLevelUnlocked(store, highest + 1)) {
    highest++
  }
  return highest
}
