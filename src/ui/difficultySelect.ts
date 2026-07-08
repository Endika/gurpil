/**
 * Difficulty select screen — shown before a race starts (first boot, and
 * after "Change difficulty" from the finish screen).
 *
 * Presents one card per `Difficulty` (src/core/course.ts), each showing the
 * stored best time + best medal for that difficulty (via `loadRecord` /
 * `KeyValueStore`, src/core/records.ts). Picking a card calls `onSelect` —
 * the caller (game.ts) generates a fresh random seed and starts a new race.
 *
 * All copy comes from `t()` (src/ui/i18n.ts) — no hardcoded UI text. Visual
 * styling lives in src/ui/styles.css (`.select-*` rules).
 */

import type { Difficulty } from '../core/course'
import { loadRecord, type KeyValueStore } from '../core/records'
import { t } from './i18n'
import type { MessageKey } from './i18n'
import { formatTime } from './hud'
import { medalColorVar, medalMessageKey } from './medalDisplay'

// ─── Pure helpers (exported for unit tests) ────────────────────────────────

/** Difficulties in the order their cards are shown, easiest first. Pure. */
export const DIFFICULTY_ORDER: readonly Difficulty[] = ['easy', 'medium', 'hard']

const DIFFICULTY_MESSAGE_KEYS: Record<Difficulty, MessageKey> = {
  easy: 'difficulty.easy',
  medium: 'difficulty.medium',
  hard: 'difficulty.hard',
}

/** The i18n key for a difficulty's display name. Pure. */
export function difficultyMessageKey(difficulty: Difficulty): MessageKey {
  return DIFFICULTY_MESSAGE_KEYS[difficulty]
}

// ─── Public API ─────────────────────────────────────────────────────────────

export interface DifficultySelect {
  el: HTMLElement
  /** Remove the screen from the DOM (called once a difficulty is picked). */
  destroy(): void
}

export interface DifficultySelectOptions {
  store: KeyValueStore
  onSelect: (difficulty: Difficulty) => void
}

/** Build the difficulty-select screen and attach it to `root`. */
export function createDifficultySelect(
  root: HTMLElement,
  opts: DifficultySelectOptions,
): DifficultySelect {
  const overlay = document.createElement('div')
  overlay.className = 'select-overlay'
  overlay.dataset['screen'] = 'difficulty-select'

  const title = document.createElement('h1')
  title.className = 'select-title'
  title.textContent = t('select.title')
  overlay.appendChild(title)

  const list = document.createElement('div')
  list.className = 'select-list'

  for (const difficulty of DIFFICULTY_ORDER) {
    list.appendChild(buildCard(difficulty, opts))
  }

  overlay.appendChild(list)
  root.appendChild(overlay)

  return {
    el: overlay,
    destroy(): void {
      overlay.remove()
    },
  }
}

function buildCard(difficulty: Difficulty, opts: DifficultySelectOptions): HTMLElement {
  const record = loadRecord(opts.store, difficulty)

  const card = document.createElement('button')
  card.type = 'button'
  card.className = `select-card select-card--${difficulty}`
  card.dataset['difficulty'] = difficulty

  const name = document.createElement('span')
  name.className = 'select-card-name'
  name.textContent = t(difficultyMessageKey(difficulty))
  card.appendChild(name)

  const best = document.createElement('span')
  best.className = 'select-card-best'
  best.textContent =
    record.bestMs === null ? t('select.noBest') : `${t('label.best')}: ${formatTime(record.bestMs)}`
  card.appendChild(best)

  if (record.bestMs !== null) {
    const medal = document.createElement('span')
    medal.className = 'select-card-medal'
    medal.style.color = medalColorVar(record.bestMedal)
    medal.textContent = t(medalMessageKey(record.bestMedal))
    card.appendChild(medal)
  }

  card.addEventListener('click', () => {
    opts.onSelect(difficulty)
  })

  return card
}
