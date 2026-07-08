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
 */

import { CAMPAIGN_SIZE } from '../core/campaign'

export const PENDING_RACE_STORAGE_KEY = 'gurpil.pendingRace'

/** The campaign level a reload should boot directly into (skipping the grid). */
export interface PendingRace {
  levelNumber: number
}

/** Is `n` a valid 1-based campaign level number (1 … CAMPAIGN_SIZE)? Pure. */
function isValidLevelNumber(n: unknown): n is number {
  return typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= CAMPAIGN_SIZE
}

/** Serialize a pending race to a storage-ready string. Pure. */
export function serializePendingRace(pending: PendingRace): string {
  return JSON.stringify(pending)
}

/**
 * Parse a pending race back from a stored string. Tolerates a missing value,
 * invalid JSON, or a value with the wrong shape / an out-of-range level number
 * — all resolve to `null` (meaning: "no pending race, show the level-select
 * grid"). Pure.
 */
export function parsePendingRace(raw: string | null): PendingRace | null {
  if (raw === null) return null

  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return null

    const candidate = parsed as { levelNumber?: unknown }
    if (!isValidLevelNumber(candidate.levelNumber)) return null

    return { levelNumber: candidate.levelNumber }
  } catch {
    return null
  }
}
