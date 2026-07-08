/**
 * i18n — typed message lookup with English as the source of truth.
 *
 * The active locale is auto-detected once at module load from
 * `navigator.language` and falls back to English when the tag is unsupported
 * or `navigator` is unavailable (e.g. under test). All user-facing strings in
 * the game MUST go through `t()` — no hardcoded UI text elsewhere.
 */

import { en } from '../locales/en'
import { es } from '../locales/es'
import { eu } from '../locales/eu'
import { fr } from '../locales/fr'
import type { Messages, MessageKey } from '../locales/en'

export type { MessageKey }

// ─── Locale registry ────────────────────────────────────────────────────────

const DEFAULT_LOCALE = 'en'

const LOCALES: Record<string, Messages> = { en, es, eu, fr }

const SUPPORTED_LOCALES: readonly string[] = Object.keys(LOCALES)

// ─── Locale selection (pure) ────────────────────────────────────────────────

/**
 * Pick a supported locale code from a BCP-47 language tag (e.g. "es-ES").
 * Falls back to DEFAULT_LOCALE when the tag is missing, empty, or its primary
 * subtag isn't one of the locales we ship.
 *
 * Pure — no DOM/navigator access — so it's directly unit-testable.
 */
export function pickLocale(languageTag: string | undefined | null): string {
  if (languageTag === undefined || languageTag === null || languageTag === '') {
    return DEFAULT_LOCALE
  }
  const primary = languageTag.split('-')[0]?.toLowerCase()
  return primary !== undefined && SUPPORTED_LOCALES.includes(primary)
    ? primary
    : DEFAULT_LOCALE
}

function detectLocale(): string {
  const language =
    typeof navigator === 'object' && navigator !== null ? navigator.language : undefined
  return pickLocale(language)
}

/** Locale resolved once at module load. */
const activeLocale = detectLocale()

// ─── Message lookup (pure) ──────────────────────────────────────────────────

/**
 * Resolve a message for a given locale + key, falling back to the English
 * source when the locale is unsupported or the key is missing there.
 *
 * Pure — exported for unit tests independent of the module-level `activeLocale`.
 */
export function resolveMessage(locale: string, key: MessageKey): string {
  const messages = LOCALES[locale] ?? en
  return messages[key] ?? en[key]
}

/** Translate a message key using the auto-detected active locale. */
export function t(key: MessageKey): string {
  return resolveMessage(activeLocale, key)
}
