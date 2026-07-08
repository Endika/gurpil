/**
 * Pending-race handoff — pure (de)serialization for the state carried across
 * a `location.reload()`.
 *
 * Why a reload at all: `game.ts` boots a Rapier `World` and a Three.js
 * `WebGLRenderer` that appends its own `<canvas>` directly to `document.body`
 * (see `src/render/scene.ts`). Neither owns a teardown path today, so calling
 * the boot sequence a second time in the same page would leak a physics
 * world and stack a second WebGL canvas. Rather than build first-class
 * teardown for both subsystems just for this, the finish-overlay actions
 * ("Retry" / "Next level") do a full page reload — the simplest reset already
 * used by the MVP restart flow — but first stash WHICH campaign LEVEL the next
 * boot should land on in `sessionStorage`. "Levels" (back to the grid) clears
 * it. `game.ts` reads and clears that on boot.
 *
 * This module holds only the PURE parse/serialize logic so it is unit
 * testable without touching `sessionStorage`; `game.ts` wraps it with the
 * actual storage read/write (impure, browser-only).
 *
 * A pending race is a DISCRIMINATED UNION on `mode`: either a campaign LEVEL
 * (carrying its 1-based number) or an ENDLESS run (carrying its run seed). The
 * reload boots directly into whichever it describes; a `null` result means "no
 * pending race — show the level-select grid".
 */

import { CAMPAIGN_SIZE } from '../core/campaign'

export const PENDING_RACE_STORAGE_KEY = 'gurpil.pendingRace'

/** A reload should boot directly into this campaign level (skipping the grid). */
export interface PendingLevel {
  mode: 'level'
  /** 1-based campaign level number (1 … CAMPAIGN_SIZE). */
  number: number
}

/** A reload should boot directly into a fresh endless run with this seed. */
export interface PendingEndless {
  mode: 'endless'
  /** Seed for `generateEndlessCourse` / `pickTheme` — fixes the run's track+look. */
  seed: number
}

/** What the next boot should land on: a campaign level OR an endless run. */
export type PendingRace = PendingLevel | PendingEndless

/** Is `n` a valid 1-based campaign level number (1 … CAMPAIGN_SIZE)? Pure. */
function isValidLevelNumber(n: unknown): n is number {
  return typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= CAMPAIGN_SIZE
}

/** Is `n` a valid endless seed (a non-negative uint32 integer)? Pure. */
function isValidSeed(n: unknown): n is number {
  return typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= 0xffffffff
}

/** Serialize a pending race to a storage-ready string. Pure. */
export function serializePendingRace(pending: PendingRace): string {
  return JSON.stringify(pending)
}

/**
 * Parse a pending race back from a stored string. Tolerates a missing value,
 * invalid JSON, an unknown/missing `mode`, or a value with the wrong shape /
 * out-of-range fields — all resolve to `null` (meaning: "no pending race, show
 * the level-select grid"). Pure.
 */
export function parsePendingRace(raw: string | null): PendingRace | null {
  if (raw === null) return null

  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return null

    const candidate = parsed as { mode?: unknown; number?: unknown; seed?: unknown }

    if (candidate.mode === 'level') {
      return isValidLevelNumber(candidate.number)
        ? { mode: 'level', number: candidate.number }
        : null
    }
    if (candidate.mode === 'endless') {
      return isValidSeed(candidate.seed) ? { mode: 'endless', seed: candidate.seed } : null
    }
    return null
  } catch {
    return null
  }
}
