/**
 * HUD — timer readout + start/finish overlays.
 *
 * A self-contained DOM component: no physics knowledge (it does know the
 * `Medal` / best-`Record` domain types from src/core so it can render them).
 * The game loop drives it via `setTime` (every frame) and `showStart` /
 * `showFinish` / `hide` on phase transitions (idle / racing / finished — see
 * core/run.ts), plus `setTarget` once at boot with the course's par time.
 *
 * "Play again" / "Change difficulty" on the finish overlay are wired to the
 * `HudCallbacks` passed to `createHud` — game.ts decides what each does (see
 * src/game/pendingRace.ts for why that's a page reload under the hood).
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
 *  best record for its difficulty — everything the finish overlay shows. */
export interface FinishResult {
  elapsedMs: number
  medal: Medal
  best: BestRecord
}

/** Callbacks for the finish overlay's two actions. */
export interface HudCallbacks {
  /** Start a brand-new race at the SAME difficulty (fresh random seed). */
  onPlayAgain(): void
  /** Return to the difficulty select screen. */
  onChangeDifficulty(): void
}

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

  const playAgainBtn = document.createElement('button')
  playAgainBtn.type = 'button'
  playAgainBtn.className = 'hud-btn hud-btn--primary'
  playAgainBtn.dataset['hud'] = 'play-again'
  playAgainBtn.textContent = t('hud.playAgain')
  playAgainBtn.addEventListener('click', () => {
    callbacks.onPlayAgain()
  })
  buttonRow.appendChild(playAgainBtn)

  const changeDifficultyBtn = document.createElement('button')
  changeDifficultyBtn.type = 'button'
  changeDifficultyBtn.className = 'hud-btn hud-btn--secondary'
  changeDifficultyBtn.dataset['hud'] = 'change-difficulty'
  changeDifficultyBtn.textContent = t('hud.changeDifficulty')
  changeDifficultyBtn.addEventListener('click', () => {
    callbacks.onChangeDifficulty()
  })
  buttonRow.appendChild(changeDifficultyBtn)

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
  }
}
