/**
 * Gurpil — entry point.
 *
 * Delegates all boot + game logic to `startGame` (src/game/game.ts).
 */

import './ui/styles.css'
import { startGame } from './game/game'

startGame(document.body).catch((err: unknown) => {
  console.error('[gurpil] boot failed', err)
})
