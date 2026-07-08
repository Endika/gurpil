/**
 * English messages — the i18n SOURCE OF TRUTH.
 *
 * Every other locale file (see sibling files in this directory) must implement
 * exactly this key set — `Messages` (derived below) is the contract they are
 * typed against. Adding a new UI string starts here.
 */

export const en = {
  'app.title': 'Gurpil',
  'hud.start': 'Draw a wheel to go!',
  'hud.time': 'Time',
  'hud.finish': 'Finished!',
  'shape.circle': 'Circle',
  'shape.line': 'Line',
  'shape.square': 'Square',
  'shape.triangle': 'Triangle',
  'levelSelect.title': 'Choose a level',
  'levelSelect.level': 'Level',
  'levelSelect.locked': 'Locked',
  'select.noBest': 'No record yet',
  'label.best': 'Best',
  'theme.grassland': 'Grassland',
  'theme.desert': 'Desert',
  'theme.snow': 'Snow',
  'theme.night': 'Night',
  'theme.lava': 'Lava',
  'medal.gold': 'Gold',
  'medal.silver': 'Silver',
  'medal.bronze': 'Bronze',
  'medal.none': 'No medal',
  'hud.medal': 'Medal',
  'hud.retry': 'Retry',
  'hud.nextLevel': 'Next level',
  'hud.levels': 'Levels',
  'hud.target': 'Target',
  'hud.mute': 'Mute',
  'hud.unmute': 'Unmute',
} as const satisfies Record<string, string>

/** Union of every valid message key, derived from the English source. */
export type MessageKey = keyof typeof en

/** Shape every locale file (es, eu, fr, ...) must conform to. */
export type Messages = Record<MessageKey, string>
