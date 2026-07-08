/**
 * Pending-race handoff — pure (de)serialization for the state carried across
 * a `location.reload()`.
 *
 * Why a reload at all: `game.ts` boots a Rapier `World` and a Three.js
 * `WebGLRenderer` that appends its own `<canvas>` directly to `document.body`
 * (see `src/render/scene.ts`). Neither owns a teardown path today, so calling
 * the boot sequence a second time in the same page would leak a physics
 * world and stack a second WebGL canvas. Rather than build first-class
 * teardown for both subsystems just for this, "Play again" / "Change
 * difficulty" do a full page reload — the simplest reset already used by the
 * MVP restart flow — but first stash WHERE the next boot should land (start a
 * race directly with a given difficulty+seed, or fall back to the difficulty
 * select screen) in `sessionStorage`. `game.ts` reads and clears that on boot.
 *
 * This module holds only the PURE parse/serialize logic so it is unit
 * testable without touching `sessionStorage`; `game.ts` wraps it with the
 * actual storage read/write (impure, browser-only).
 */

import type { Difficulty } from '../core/course'

export const PENDING_RACE_STORAGE_KEY = 'gurpil.pendingRace'

export interface PendingRace {
  difficulty: Difficulty
  seed: number
}

const VALID_DIFFICULTIES: readonly Difficulty[] = ['easy', 'medium', 'hard']

function isDifficulty(value: unknown): value is Difficulty {
  return typeof value === 'string' && (VALID_DIFFICULTIES as readonly string[]).includes(value)
}

/** Serialize a pending race to a storage-ready string. Pure. */
export function serializePendingRace(pending: PendingRace): string {
  return JSON.stringify(pending)
}

/**
 * Parse a pending race back from a stored string. Tolerates a missing value,
 * invalid JSON, or a value with the wrong shape — all resolve to `null`
 * (meaning: "no pending race, show the difficulty select screen"). Pure.
 */
export function parsePendingRace(raw: string | null): PendingRace | null {
  if (raw === null) return null

  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return null

    const candidate = parsed as { difficulty?: unknown; seed?: unknown }
    if (!isDifficulty(candidate.difficulty)) return null
    if (typeof candidate.seed !== 'number' || !Number.isFinite(candidate.seed)) return null

    return { difficulty: candidate.difficulty, seed: candidate.seed }
  } catch {
    return null
  }
}
