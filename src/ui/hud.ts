/**
 * HUD — timer readout + start/finish overlays.
 *
 * A self-contained DOM component: no game/physics knowledge. The game loop
 * drives it via `setTime` (every frame) and `showStart` / `showFinish` /
 * `hide` on phase transitions (idle / racing / finished — see core/run.ts).
 *
 * Restart is wired here (full page reload — see game.ts header for the
 * rationale) so the loop only needs to react to phase, not plumb a callback.
 *
 * All user-facing text comes from `t()` (src/ui/i18n.ts) — no hardcoded copy.
 * Visual styling lives in `src/ui/styles.css` (class names below), imported
 * once from main.ts.
 */

import { t } from './i18n'

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

// ─── Public API ─────────────────────────────────────────────────────────────

export interface Hud {
  /** Update the always-visible top timer readout. */
  setTime(ms: number): void
  /** Update the speed gauge from the car's forward speed (m/s). */
  setSpeed(speedMps: number): void
  /** Show the idle "draw to start" overlay (hides the finish overlay). */
  showStart(): void
  /** Show the finish overlay with the final elapsed time + restart button. */
  showFinish(ms: number): void
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
export function createHud(root: HTMLElement): Hud {
  // ── Timer (always visible) ────────────────────────────────────────────────
  const timer = document.createElement('div')
  timer.className = 'hud-timer'
  timer.dataset['hud'] = 'timer'
  timer.textContent = formatTime(0)
  root.appendChild(timer)

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

  const restartBtn = document.createElement('button')
  restartBtn.type = 'button'
  restartBtn.className = 'hud-restart-btn'
  restartBtn.dataset['hud'] = 'restart'
  restartBtn.textContent = t('hud.restart')
  restartBtn.addEventListener('click', () => {
    location.reload()
  })
  finishOverlay.appendChild(restartBtn)

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
    showStart(): void {
      startOverlay.hidden = false
      finishOverlay.hidden = true
    },
    showFinish(ms: number): void {
      startOverlay.hidden = true
      finishOverlay.hidden = false
      finishTime.textContent = `${t('hud.time')}: ${formatTime(ms)}`
    },
    hide(): void {
      startOverlay.hidden = true
      finishOverlay.hidden = true
    },
  }
}
