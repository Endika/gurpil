/**
 * Campaign — a fixed, deterministic ordered list of numbered levels.
 *
 * Pure data module: NO Three.js, NO Rapier, NO DOM, NO `Math.random`, NO `Date`.
 * Every level is fully determined by named constants below, so the campaign is
 * byte-identical on every load and a given level number always maps to the SAME
 * track (same difficulty + seed) and the SAME look (same themeId) — replayable
 * for medals and reproducible across devices.
 *
 * Layout (single source of truth = the constants):
 *   - Difficulty RAMPS beginner → expert: `LEVELS_PER_TIER` consecutive levels
 *     of each tier in `DIFFICULTY_TIERS` order, so difficulty is non-decreasing
 *     across the campaign.
 *   - `themeId` ROTATES through the five themes (`THEME_IDS`) for visual variety,
 *     so adjacent levels look different.
 *   - Each level's `seed` is DERIVED deterministically from its number and is
 *     distinct from every other level's, fixing that level's exact track.
 *
 * Stage 2a is CORE ONLY: this module is not yet wired into the UI or game loop
 * (that is 2b). It just describes the campaign as testable pure data.
 */

import type { DifficultyTier } from './course'
import { DIFFICULTY_TIERS } from './course'
import type { ThemeId } from './theme'
import { THEME_IDS } from './theme'

// ─── Public types ─────────────────────────────────────────────────────────────

/** One numbered campaign level: a fixed track (difficulty + seed) and look. */
export interface Level {
  /** 1-based position in the campaign (1 … CAMPAIGN_SIZE). */
  number: number
  /** Which difficulty tier this level is generated at. */
  difficulty: DifficultyTier
  /** Deterministic visual theme (biome) for this level. */
  themeId: ThemeId
  /** Fixed seed passed to `generateCourse` — makes this level's track stable. */
  seed: number
}

// ─── Layout constants (single source of truth — no magic numbers) ─────────────

/**
 * How many consecutive levels each difficulty tier contributes. With five tiers
 * (`DIFFICULTY_TIERS`), this yields `5 × LEVELS_PER_TIER` levels total.
 */
export const LEVELS_PER_TIER = 3

/** Total number of levels in the campaign. */
export const CAMPAIGN_SIZE = DIFFICULTY_TIERS.length * LEVELS_PER_TIER

/**
 * Seed derivation: `seed(number) = number × SEED_STRIDE + SEED_OFFSET`. Linear
 * with a stride > 1, so every level gets a DISTINCT, fixed seed and consecutive
 * levels get well-separated seeds (different tracks). Deterministic — no random.
 */
const SEED_STRIDE = 1013
const SEED_OFFSET = 7

/** The fixed seed for a given 1-based level number. Pure + deterministic. */
function seedForLevel(levelNumber: number): number {
  return (levelNumber * SEED_STRIDE + SEED_OFFSET) >>> 0
}

// ─── The campaign (built once, deterministically) ─────────────────────────────

function buildCampaign(): Level[] {
  const levels: Level[] = []
  let number = 1
  for (const difficulty of DIFFICULTY_TIERS) {
    for (let i = 0; i < LEVELS_PER_TIER; i++) {
      levels.push({
        number,
        difficulty,
        // Rotate through the themes by 0-based index so adjacent levels differ
        // and every theme recurs evenly across the campaign.
        themeId: THEME_IDS[(number - 1) % THEME_IDS.length],
        seed: seedForLevel(number),
      })
      number++
    }
  }
  return levels
}

/**
 * The deterministic, ordered campaign. Numbers are 1 … CAMPAIGN_SIZE contiguous,
 * difficulty is non-decreasing, themes rotate, and every seed is distinct.
 */
export const CAMPAIGN: readonly Level[] = buildCampaign()

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** The level with the given 1-based number, or `undefined` if out of range. */
export function levelByNumber(n: number): Level | undefined {
  if (!Number.isInteger(n) || n < 1 || n > CAMPAIGN_SIZE) return undefined
  return CAMPAIGN[n - 1]
}
