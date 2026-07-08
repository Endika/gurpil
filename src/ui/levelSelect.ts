/**
 * Level-select screen — the campaign entry point, shown on first boot and when
 * the player taps "Levels" on the finish overlay.
 *
 * Presents a scrollable GRID of the fixed campaign (see `core/campaign.ts`),
 * one card per numbered level. Each UNLOCKED card shows: the level number, its
 * visual theme (icon + name + tint), and — once finished — the earned medal
 * (`core/medal.ts`) with the best time from per-level records
 * (`core/records.ts`). LOCKED cards show a padlock and aren't clickable. Level 1
 * is always unlocked; every later level unlocks once its predecessor is beaten
 * (`isLevelUnlocked`). Picking an unlocked card calls `onSelect(levelNumber)` —
 * the caller (game.ts) boots that level.
 *
 * All copy comes from `t()` (src/ui/i18n.ts) — no hardcoded UI text. The theme
 * icons are decorative glyphs (not translatable prose). Visual styling lives in
 * src/ui/styles.css (`.level-*` rules).
 */

import { CAMPAIGN, type Level } from '../core/campaign'
import type { Medal } from '../core/medal'
import { isLevelUnlocked, loadLevelRecord, type KeyValueStore } from '../core/records'
import { THEMES, type ThemeId } from '../core/theme'
import { t } from './i18n'
import type { MessageKey } from './i18n'
import { formatTime } from './hud'
import { medalColorVar, medalMessageKey } from './medalDisplay'

// ─── Pure helpers (exported for unit tests) ────────────────────────────────

/** Everything a single level card needs to render, derived from the store. */
export interface LevelCardView {
  number: number
  /** Locked levels are not playable and hide their record. */
  locked: boolean
  /** Best medal earned so far (`'none'` if unlocked-but-unfinished / locked). */
  medal: Medal
  /** Best time in ms, or `null` if never finished (or locked). */
  bestMs: number | null
}

/**
 * Build the view-model for one campaign level from the record store. Pure
 * (given a store): a locked level reports no medal / no best time; an unlocked
 * one reflects its stored per-level record. Exported for unit tests.
 */
export function levelCardView(store: KeyValueStore, level: Level): LevelCardView {
  if (!isLevelUnlocked(store, level.number)) {
    return { number: level.number, locked: true, medal: 'none', bestMs: null }
  }
  const record = loadLevelRecord(store, level.number)
  return { number: level.number, locked: false, medal: record.bestMedal, bestMs: record.bestMs }
}

/** View-models for the whole campaign, in level order. Pure. */
export function campaignCardViews(store: KeyValueStore): LevelCardView[] {
  return CAMPAIGN.map((level) => levelCardView(store, level))
}

const THEME_MESSAGE_KEYS: Record<ThemeId, MessageKey> = {
  grassland: 'theme.grassland',
  desert: 'theme.desert',
  snow: 'theme.snow',
  night: 'theme.night',
  lava: 'theme.lava',
}

/** The i18n key for a theme's display name. Pure. */
export function themeMessageKey(themeId: ThemeId): MessageKey {
  return THEME_MESSAGE_KEYS[themeId]
}

/** Decorative icon glyph per theme (visual only — not translatable prose). */
const THEME_ICONS: Record<ThemeId, string> = {
  grassland: '🌱',
  desert: '🏜️',
  snow: '❄️',
  night: '🌙',
  lava: '🌋',
}

/** Padlock glyph shown on locked cards (visual only). */
const LOCK_ICON = '🔒'

/** Convert a theme's 0xRRGGBB hex `number` to a CSS `#rrggbb` string. Pure. */
function hexColor(color: number): string {
  return `#${(color >>> 0).toString(16).padStart(6, '0').slice(-6)}`
}

// ─── Public API ─────────────────────────────────────────────────────────────

export interface LevelSelect {
  el: HTMLElement
  /** Remove the screen from the DOM (called once a level is picked). */
  destroy(): void
}

export interface LevelSelectOptions {
  store: KeyValueStore
  /** Called with the 1-based level number when an UNLOCKED card is tapped. */
  onSelect: (levelNumber: number) => void
}

/** Build the level-select grid and attach it to `root`. */
export function createLevelSelect(root: HTMLElement, opts: LevelSelectOptions): LevelSelect {
  const overlay = document.createElement('div')
  overlay.className = 'select-overlay level-select-overlay'
  overlay.dataset['screen'] = 'level-select'

  const title = document.createElement('h1')
  title.className = 'select-title'
  title.textContent = t('levelSelect.title')
  overlay.appendChild(title)

  const grid = document.createElement('div')
  grid.className = 'level-grid'

  for (const level of CAMPAIGN) {
    grid.appendChild(buildCard(level, opts))
  }

  overlay.appendChild(grid)
  root.appendChild(overlay)

  return {
    el: overlay,
    destroy(): void {
      overlay.remove()
    },
  }
}

function buildCard(level: Level, opts: LevelSelectOptions): HTMLElement {
  const view = levelCardView(opts.store, level)
  const theme = THEMES[level.themeId]

  const card = document.createElement('button')
  card.type = 'button'
  card.className = `level-card${view.locked ? ' level-card--locked' : ''}`
  card.dataset['level'] = String(level.number)
  card.style.setProperty('--level-tint', hexColor(theme.skyHorizon))

  const number = document.createElement('span')
  number.className = 'level-card-number'
  number.textContent = String(level.number)
  card.appendChild(number)

  if (view.locked) {
    const lock = document.createElement('span')
    lock.className = 'level-card-lock'
    lock.textContent = LOCK_ICON
    lock.setAttribute('aria-label', t('levelSelect.locked'))
    card.appendChild(lock)
    card.disabled = true
    card.setAttribute('aria-label', `${t('levelSelect.level')} ${level.number} — ${t('levelSelect.locked')}`)
    return card
  }

  const themeLabel = document.createElement('span')
  themeLabel.className = 'level-card-theme'
  themeLabel.textContent = `${THEME_ICONS[level.themeId]} ${t(themeMessageKey(level.themeId))}`
  card.appendChild(themeLabel)

  const medal = document.createElement('span')
  medal.className = 'level-card-medal'
  medal.style.color = medalColorVar(view.medal)
  medal.textContent = t(medalMessageKey(view.medal))
  card.appendChild(medal)

  const best = document.createElement('span')
  best.className = 'level-card-best'
  best.textContent =
    view.bestMs === null ? t('select.noBest') : `${t('label.best')}: ${formatTime(view.bestMs)}`
  card.appendChild(best)

  card.setAttribute('aria-label', `${t('levelSelect.level')} ${level.number}`)
  card.addEventListener('click', () => {
    opts.onSelect(level.number)
  })

  return card
}
