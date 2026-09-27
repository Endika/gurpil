/**
 * Gurpil — entry point.
 *
 * Delegates all boot + game logic to `startGame` (src/game/game.ts).
 */

import './ui/styles.css'
import { startGame } from './game/game'
import { showStartFailure } from './ui/startFailure'

startGame(document.body).catch((err: unknown) => {
  console.error('[gurpil] boot failed', err)
  showStartFailure(document.body, () => location.reload())
})
