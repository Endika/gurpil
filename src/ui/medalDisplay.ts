/**
 * Medal display mapping — pure helpers turning a `Medal` (src/core/medal.ts)
 * into UI-facing values: the i18n key for its label, and the CSS color
 * variable used to render it. No DOM here — kept pure so both the
 * difficulty-select screen and the finish overlay share one source of truth,
 * and so the mapping itself is unit-testable without a browser.
 *
 * The color variables themselves are defined once in src/ui/styles.css.
 */

import type { Medal } from '../core/medal'
import type { MessageKey } from './i18n'

const MEDAL_MESSAGE_KEYS: Record<Medal, MessageKey> = {
  gold: 'medal.gold',
  silver: 'medal.silver',
  bronze: 'medal.bronze',
  none: 'medal.none',
}

/** The i18n key for a medal's display name. Pure. */
export function medalMessageKey(medal: Medal): MessageKey {
  return MEDAL_MESSAGE_KEYS[medal]
}

const MEDAL_COLOR_VARS: Record<Medal, string> = {
  gold: 'var(--gurpil-medal-gold)',
  silver: 'var(--gurpil-medal-silver)',
  bronze: 'var(--gurpil-medal-bronze)',
  none: 'var(--gurpil-medal-none)',
}

/** The CSS color (custom-property reference) used to render a medal. Pure. */
export function medalColorVar(medal: Medal): string {
  return MEDAL_COLOR_VARS[medal]
}
