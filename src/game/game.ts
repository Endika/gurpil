/**
 * Game orchestrator — wires all subsystems into a playable end-to-end loop.
 *
 * Flow (Stage C — procedural levels UI):
 *   boot → [pending race from a reload?]
 *     ├─ yes → build & run that race directly (skips the select screen)
 *     └─ no  → show the DIFFICULTY SELECT screen (src/ui/difficultySelect.ts)
 *              → player picks a difficulty → generate a fresh random seed
 *              → build & run the race
 *   race → build course (generateCourse) → physics world → vehicle → scene
 *        → HUD → "first drawn shape starts the race" (unchanged) → race
 *        → on finish: grade the medal, persist the best record, show the
 *          finish overlay with "Play again" / "Change difficulty".
 *
 * Responsibilities:
 *   - Boot: see flow above.
 *   - Time: `performance.now()` lives HERE (not in core/run.ts which is pure).
 *   - Randomness: `randomSeed()` lives HERE — core/course.ts is pure and takes
 *     a seed as input; only the app layer may call Math.random()/Date.now().
 *   - Input: draw-box `onShape` → `vehicle.swapShape(id)`.
 *            "First drawn shape starts the race" — the run stays idle until the
 *            player lifts their finger for the first time; that first shape
 *            classification both equips the vehicle AND calls `startRun`.
 *   - Loop: rAF + fixed-step physics accumulator (via loop.ts).
 *            While racing: full auto-throttle forward (setThrottle(1) + applyDrive()).
 *            On finish: throttle cut to 0, timer frozen, medal graded once,
 *            best record persisted once, finish overlay shown every frame after.
 *   - HUD: timer/target readout + start/finish overlays, built by `createHud`
 *          (src/ui/hud.ts). All copy comes from i18n (src/ui/i18n.ts) — see
 *          also main.ts for the styles.css import.
 *
 * Restart strategy: "Play again" and "Change difficulty" both do a full page
 * reload (`location.reload()`) — see `src/game/pendingRace.ts` for why (the
 * renderer/physics world have no teardown path today) and how the intended
 * next state (a specific race, or the select screen) survives the reload.
 */

import { generateCourse, type Difficulty } from '../core/course'
import { pickTheme, THEMES } from '../core/theme'
import { parTimeMs, medalFor, type Medal } from '../core/medal'
import { saveResult, type Record as BestRecord } from '../core/records'
import { createWorld, PHYSICS_TIMESTEP } from '../physics/world'
import { createVehicle } from '../physics/vehicle'
import { createScene } from '../render/scene'
import { createDrawBox } from '../ui/drawBox'
import { createHud, speedFraction } from '../ui/hud'
import { createDifficultySelect } from '../ui/difficultySelect'
import { createLocalStorageStore } from '../ui/localStorageStore'
import { createAudio, type Audio } from '../audio/audio'
import { createRun, startRun, tickRun } from '../core/run'
import { advanceAccumulator, MAX_STEPS_PER_FRAME } from './loop'
import {
  parsePendingRace,
  serializePendingRace,
  PENDING_RACE_STORAGE_KEY,
  type PendingRace,
} from './pendingRace'
import type { RunState } from '../core/run'
import type { KeyValueStore } from '../core/records'

// ─── Constants ────────────────────────────────────────────────────────────────

/** Fixed physics step in milliseconds (derived from PHYSICS_TIMESTEP). */
const STEP_MS = PHYSICS_TIMESTEP * 1000

/**
 * Frames to run without applying throttle at boot to let the vehicle settle
 * on the terrain before the player can start the race.
 */
const SETTLE_STEPS = 90

/** Upper bound (exclusive) for a generated seed — fits in an unsigned 32-bit int. */
const SEED_SPACE = 2 ** 32

// ─── Randomness (app layer only — core stays pure) ─────────────────────────────

/** A fresh random seed for `generateCourse`. Impure — never called from core. */
function randomSeed(): number {
  return (Date.now() ^ Math.floor(Math.random() * SEED_SPACE)) >>> 0
}

// ─── Pending-race handoff (sessionStorage-backed; see pendingRace.ts) ──────────

function readPendingRace(): PendingRace | null {
  try {
    return parsePendingRace(sessionStorage.getItem(PENDING_RACE_STORAGE_KEY))
  } catch {
    // Storage unavailable (e.g. private mode edge cases) — fall back to select.
    return null
  }
}

function writePendingRace(pending: PendingRace | null): void {
  try {
    if (pending === null) {
      sessionStorage.removeItem(PENDING_RACE_STORAGE_KEY)
    } else {
      sessionStorage.setItem(PENDING_RACE_STORAGE_KEY, serializePendingRace(pending))
    }
  } catch {
    // Storage unavailable — the reload will just land on the select screen.
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Boot the full game and attach everything to `root`.
 * The rAF loop runs until the page is unloaded.
 */
export async function startGame(root: HTMLElement): Promise<void> {
  const store = createLocalStorageStore()
  const audio = createAudio()

  const pending = readPendingRace()
  if (pending !== null) {
    writePendingRace(null)
    await runRace(root, store, audio, pending.difficulty, pending.seed)
    return
  }

  showSelect(root, store, audio)
}

/** Show the difficulty select screen; picking a card starts a fresh race. */
function showSelect(root: HTMLElement, store: KeyValueStore, audio: Audio): void {
  const select = createDifficultySelect(root, {
    store,
    onSelect: (difficulty) => {
      select.destroy()
      runRace(root, store, audio, difficulty, randomSeed()).catch((err: unknown) => {
        console.error('[gurpil] race failed to start', err)
      })
    },
  })
}

/** Build and run a single race (one generated course) to completion. */
async function runRace(
  root: HTMLElement,
  store: KeyValueStore,
  audio: Audio,
  difficulty: Difficulty,
  seed: number,
): Promise<void> {
  // ── Build subsystems ──────────────────────────────────────────────────────
  const course = generateCourse({ difficulty, seed })
  const parMs = parTimeMs(course)
  const world = await createWorld(course)

  // Spawn vehicle slightly above start so it settles under gravity.
  const vehicle = createVehicle(world, { x: course.startX + 2, y: 2 })

  // Silent settle: let the vehicle land on the terrain before rendering.
  for (let i = 0; i < SETTLE_STEPS; i++) {
    world.step()
  }

  // Pick the visual theme (biome) from the SAME seed as the course, so a given
  // seed always yields the same track AND the same world look (reproducible).
  // Purely visual — no effect on physics/gameplay.
  const themeId = pickTheme(seed)
  const scene = createScene(course, THEMES[themeId])

  // ── HUD ───────────────────────────────────────────────────────────────────
  const hud = createHud(root, {
    onPlayAgain: () => {
      writePendingRace({ difficulty, seed: randomSeed() })
      location.reload()
    },
    onChangeDifficulty: () => {
      writePendingRace(null)
      location.reload()
    },
    onToggleMute: () => {
      const nextMuted = !audio.isMuted()
      audio.setMuted(nextMuted)
      hud.setMuted(nextMuted)
    },
  })
  hud.setTarget(parMs)
  hud.setMuted(audio.isMuted())

  // ── Run state ─────────────────────────────────────────────────────────────
  let run: RunState = createRun()

  // The medal + best record are graded/persisted exactly ONCE per race, the
  // first frame the run reaches 'finished' — not every frame afterwards.
  let finishResult: { medal: Medal; best: BestRecord } | null = null

  // ── Draw-box ──────────────────────────────────────────────────────────────
  const drawBox = createDrawBox((id) => {
    // The first draw is the first reliable user gesture in the race flow —
    // unlock the AudioContext here (browsers block audio before a gesture).
    audio.unlock()
    audio.blip()

    vehicle.swapShape(id)

    // "First draw starts the race": the run is idle until the player draws for
    // the first time. Subsequent draws only swap the shape.
    if (run.phase === 'idle') {
      run = startRun(run)
    }
  })
  root.appendChild(drawBox.el)

  // ── Fixed-step accumulator state ──────────────────────────────────────────
  let accumMs = 0
  let lastTs = performance.now()

  // ── rAF loop ──────────────────────────────────────────────────────────────
  function frame(): void {
    const now = performance.now()
    const frameMs = now - lastTs
    lastTs = now

    // Advance accumulator → get how many physics steps to run this frame.
    const acc = advanceAccumulator(accumMs, frameMs, STEP_MS, MAX_STEPS_PER_FRAME)
    accumMs = acc.accumulatorMs

    // Physics steps.
    for (let i = 0; i < acc.steps; i++) {
      if (run.phase === 'racing') {
        vehicle.setThrottle(1)
        vehicle.applyDrive()
      } else if (run.phase === 'finished') {
        // Cut throttle once finished so the car rolls to a halt.
        vehicle.setThrottle(0)
      }

      // Self-right / anti-stuck assist runs every step (all phases) so the car
      // can never stay flipped or wedged; it's a no-op unless the chassis is
      // tilted well past normal driving, so it doesn't affect the race feel.
      vehicle.stabilize()

      world.step()
    }

    // Tick run state after all physics steps this frame.
    if (acc.steps > 0) {
      const steppedMs = acc.steps * STEP_MS
      run = tickRun(run, steppedMs, vehicle.position().x, course.finishX)
    }

    // ── HUD update ───────────────────────────────────────────────────────
    const speedMps = vehicle.chassis.linvel().x
    hud.setTime(run.elapsedMs)
    hud.setSpeed(speedMps)
    if (run.phase === 'idle') {
      hud.showStart()
      audio.setEngine(0)
    } else if (run.phase === 'racing') {
      hud.hide()
      audio.setEngine(speedFraction(speedMps))
    } else {
      // finished — grade + persist once, then just keep showing the result.
      if (finishResult === null) {
        const medal = medalFor(run.elapsedMs, parMs)
        const best = saveResult(store, difficulty, run.elapsedMs, medal)
        finishResult = { medal, best }
        audio.finish(medal)
      }
      hud.showFinish({ elapsedMs: run.elapsedMs, medal: finishResult.medal, best: finishResult.best })
      audio.setEngine(0)
    }

    // ── Render ───────────────────────────────────────────────────────────
    scene.sync(vehicle)
    scene.render()

    requestAnimationFrame(frame)
  }

  requestAnimationFrame(frame)

  console.log(`[gurpil] race started — difficulty=${difficulty} seed=${seed} theme=${themeId}`)
}
