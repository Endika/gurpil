/**
 * Start-failure screen — shown when a race or the whole game can't boot (e.g.
 * Rapier's WASM or WebGL failing to initialise), so the player gets a message
 * and a way out instead of a blank page.
 */

import { t } from './i18n'

export function showStartFailure(root: HTMLElement, onReload: () => void): void {
  const doc = root.ownerDocument

  const overlay = doc.createElement('div')
  overlay.className = 'hud-overlay'
  overlay.setAttribute('role', 'alert')

  const card = doc.createElement('div')
  card.className = 'hud-card'
  overlay.appendChild(card)

  const message = doc.createElement('p')
  message.className = 'hud-error-message'
  message.textContent = t('error.startFailed')
  card.appendChild(message)

  const reloadBtn = doc.createElement('button')
  reloadBtn.type = 'button'
  reloadBtn.className = 'hud-btn hud-btn--primary'
  reloadBtn.textContent = t('error.reload')
  reloadBtn.addEventListener('click', () => {
    onReload()
  })
  card.appendChild(reloadBtn)

  root.appendChild(overlay)
}
