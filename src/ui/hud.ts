/**
 * HUD — timer readout + start/finish overlays.
 *
 * A self-contained DOM component: no physics knowledge (it does know the
 * `Medal` / best-`Record` domain types from src/core so it can render them).
 * The game loop drives it via `setTime` (every frame) and `showStart` /
 * `showFinish` / `hide` on phase transitions (idle / racing / finished — see
 * core/run.ts), plus `setTarget` once at boot with the course's par time.
 *
 * "Retry" / "Next level" / "Levels" on the finish overlay are wired to the
 * `HudCallbacks` passed to `createHud` — game.ts decides what each does (see
 * src/game/pendingRace.ts for why that's a page reload under the hood). The
 * "Next level" button is only shown when the finished run reports a next level
 * exists (`FinishResult.hasNextLevel`).
 *
 * All user-facing text comes from `t()` (src/ui/i18n.ts) — no hardcoded copy.
 * Visual styling lives in `src/ui/styles.css` (class names below), imported
 * once from main.ts.
 */

import type { Medal } from '../core/medal'
import type { Record as BestRecord } from '../core/records'
import { t } from './i18n'
import { medalColorVar, medalMessageKey } from './medalDisplay'

// ─── Constants ──────────────────────────────────────────────────────────────

/** Number of decimal digits shown in the elapsed-time readout. */
const TIME_DECIMALS = 3

/**
 * Forward speed (m/s) mapped to a full speed gauge. Roughly the circle's top
 * speed on flat ground (MAX_MOTOR_SPEED × wheel radius); the gauge saturates
 * there so a struggling wheel (e.g. circle slipping uphill) reads visibly low.
 */
const MAX_DISPLAY_SPEED = 8

/**
 * Gauge fill fraction (0..1) for a forward speed in m/s. Pure — exported for
 * unit tests. Negative speed (sliding backwards) clamps to 0.
 */
export function speedFraction(speedMps: number): number {
  const f = speedMps / MAX_DISPLAY_SPEED
  if (f < 0) return 0
  if (f > 1) return 1
  return f
}

/** The earned result of a finished run, plus the (possibly just-improved)
 *  best record for its level — everything the finish overlay shows. */
export interface FinishResult {
  elapsedMs: number
  medal: Medal
  best: BestRecord
  /** Whether a next campaign level exists (and is now unlocked). Controls the
   *  "Next level" button's visibility. */
  hasNextLevel: boolean
}

/** Callbacks for the finish overlay's three actions, plus the mute toggle. */
export interface HudCallbacks {
  /** Replay the SAME campaign level from the start. */
  onRetry(): void
  /** Advance to the next campaign level (only reachable when it exists). */
  onNextLevel(): void
  /** Return to the level-select grid. */
  onLevels(): void
  /** The always-visible mute button was tapped. */
  onToggleMute(): void
}

/** Icon glyphs for the mute button (visual only — the accessible label comes
 *  from i18n via `hud.mute` / `hud.unmute`). */
const MUTE_ICON_MUTED = '🔇'
const MUTE_ICON_UNMUTED = '🔊'

// ─── Public API ─────────────────────────────────────────────────────────────

export interface Hud {
  /** Update the always-visible top timer readout. */
  setTime(ms: number): void
  /** Update the speed gauge from the car's forward speed (m/s). */
  setSpeed(speedMps: number): void
  /** Set the subtle "target" (par time) readout shown next to the timer. */
  setTarget(ms: number): void
  /** Show the idle "draw to start" overlay (hides the finish overlay). */
  showStart(): void
  /** Show the finish overlay with the run's result + best record. */
  showFinish(result: FinishResult): void
  /** Hide both overlays (used while racing). */
  hide(): void
  /** Reflect the current mute state on the always-visible mute button. */
  setMuted(muted: boolean): void
}

/**
 * Format an elapsed-time value in milliseconds as "S.SSS s".
 * Pure — exported for unit tests.
 */
export function formatTime(ms: number): string {
  return (ms / 1000).toFixed(TIME_DECIMALS) + ' s'
}

/**
 * Build the HUD DOM and attach it to `root`.
 */
export function createHud(root: HTMLElement, callbacks: HudCallbacks): Hud {
  // ── Timer (always visible) ────────────────────────────────────────────────
  const timer = document.createElement('div')
  timer.className = 'hud-timer'
  timer.dataset['hud'] = 'timer'
  timer.textContent = formatTime(0)
  root.appendChild(timer)

  // ── Target / par-time readout (subtle, always visible once set) ──────────
  const target = document.createElement('div')
  target.className = 'hud-target'
  target.dataset['hud'] = 'target'
  target.hidden = true
  root.appendChild(target)

  // ── Speed gauge (vertical thermometer) ────────────────────────────────────
  // Always visible; fill height + color track the car's forward speed, so a
  // wheel that's the wrong shape for the terrain (slipping, slow) reads low.
  const gauge = document.createElement('div')
  gauge.className = 'hud-gauge'
  gauge.dataset['hud'] = 'gauge'
  const gaugeFill = document.createElement('div')
  gaugeFill.className = 'hud-gauge-fill'
  gauge.appendChild(gaugeFill)
  root.appendChild(gauge)

  // ── Mute button (always visible, top-right, safe-area aware) ─────────────
  const muteBtn = document.createElement('button')
  muteBtn.type = 'button'
  muteBtn.className = 'hud-mute-btn'
  muteBtn.dataset['hud'] = 'mute'
  muteBtn.textContent = MUTE_ICON_UNMUTED
  muteBtn.setAttribute('aria-label', t('hud.mute'))
  muteBtn.addEventListener('click', () => {
    callbacks.onToggleMute()
  })
  root.appendChild(muteBtn)

  // ── Start overlay ─────────────────────────────────────────────────────────
  const startOverlay = document.createElement('div')
  startOverlay.className = 'hud-overlay hud-overlay--start'
  startOverlay.dataset['hud'] = 'start'

  const title = document.createElement('h1')
  title.className = 'hud-title'
  title.textContent = t('app.title')
  startOverlay.appendChild(title)

  const prompt = document.createElement('p')
  prompt.className = 'hud-prompt'
  prompt.textContent = t('hud.start')
  startOverlay.appendChild(prompt)

  root.appendChild(startOverlay)

  // ── Finish overlay ────────────────────────────────────────────────────────
  const finishOverlay = document.createElement('div')
  finishOverlay.className = 'hud-overlay hud-overlay--finish'
  finishOverlay.dataset['hud'] = 'finish'
  finishOverlay.hidden = true

  const finishMessage = document.createElement('p')
  finishMessage.className = 'hud-finish-message'
  finishMessage.textContent = t('hud.finish')
  finishOverlay.appendChild(finishMessage)

  const finishTime = document.createElement('p')
  finishTime.className = 'hud-finish-time'
  finishOverlay.appendChild(finishTime)

  const finishMedal = document.createElement('p')
  finishMedal.className = 'hud-finish-medal'
  finishOverlay.appendChild(finishMedal)

  const finishBest = document.createElement('p')
  finishBest.className = 'hud-finish-best'
  finishOverlay.appendChild(finishBest)

  const buttonRow = document.createElement('div')
  buttonRow.className = 'hud-btn-row'

  // "Next level" is primary (the natural progression) but only shown when a
  // next level exists; visibility is set per-result in `showFinish`.
  const nextLevelBtn = document.createElement('button')
  nextLevelBtn.type = 'button'
  nextLevelBtn.className = 'hud-btn hud-btn--primary'
  nextLevelBtn.dataset['hud'] = 'next-level'
  nextLevelBtn.textContent = t('hud.nextLevel')
  nextLevelBtn.hidden = true
  nextLevelBtn.addEventListener('click', () => {
    callbacks.onNextLevel()
  })
  buttonRow.appendChild(nextLevelBtn)

  const retryBtn = document.createElement('button')
  retryBtn.type = 'button'
  retryBtn.className = 'hud-btn hud-btn--secondary'
  retryBtn.dataset['hud'] = 'retry'
  retryBtn.textContent = t('hud.retry')
  retryBtn.addEventListener('click', () => {
    callbacks.onRetry()
  })
  buttonRow.appendChild(retryBtn)

  const levelsBtn = document.createElement('button')
  levelsBtn.type = 'button'
  levelsBtn.className = 'hud-btn hud-btn--secondary'
  levelsBtn.dataset['hud'] = 'levels'
  levelsBtn.textContent = t('hud.levels')
  levelsBtn.addEventListener('click', () => {
    callbacks.onLevels()
  })
  buttonRow.appendChild(levelsBtn)

  finishOverlay.appendChild(buttonRow)

  root.appendChild(finishOverlay)

  return {
    setTime(ms: number): void {
      timer.textContent = formatTime(ms)
    },
    setSpeed(speedMps: number): void {
      const f = speedFraction(speedMps)
      gaugeFill.style.height = `${(f * 100).toFixed(1)}%`
      // Red (slow) → green (fast): hue 0..120.
      gaugeFill.style.background = `hsl(${(f * 120).toFixed(0)}, 85%, 50%)`
    },
    setTarget(ms: number): void {
      target.hidden = false
      target.textContent = `${t('hud.target')}: ${formatTime(ms)}`
    },
    showStart(): void {
      startOverlay.hidden = false
      finishOverlay.hidden = true
    },
    showFinish(result: FinishResult): void {
      startOverlay.hidden = true
      finishOverlay.hidden = false
      nextLevelBtn.hidden = !result.hasNextLevel
      finishTime.textContent = `${t('hud.time')}: ${formatTime(result.elapsedMs)}`

      finishMedal.textContent = `${t('hud.medal')}: ${t(medalMessageKey(result.medal))}`
      finishMedal.style.color = medalColorVar(result.medal)

      const bestMs = result.best.bestMs
      finishBest.textContent =
        bestMs === null
          ? t('select.noBest')
          : `${t('label.best')}: ${formatTime(bestMs)} — ${t(medalMessageKey(result.best.bestMedal))}`
      finishBest.style.color = medalColorVar(result.best.bestMedal)
    },
    hide(): void {
      startOverlay.hidden = true
      finishOverlay.hidden = true
    },
    setMuted(muted: boolean): void {
      muteBtn.textContent = muted ? MUTE_ICON_MUTED : MUTE_ICON_UNMUTED
      muteBtn.setAttribute('aria-label', t(muted ? 'hud.unmute' : 'hud.mute'))
    },
  }
}
