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

// ─── Public API ─────────────────────────────────────────────────────────────

export interface Hud {
  /** Update the always-visible top timer readout. */
  setTime(ms: number): void
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
