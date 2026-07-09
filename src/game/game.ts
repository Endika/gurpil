/**
 * Game orchestrator — wires all subsystems into a playable end-to-end loop.
 *
 * Flow (Stage 2b — campaign):
 *   boot → [pending level from a reload?]
 *     ├─ yes → build & run that campaign level directly (skips the grid)
 *     └─ no  → show the LEVEL-SELECT grid (src/ui/levelSelect.ts)
 *              → player taps an unlocked level N
 *              → build & run that level
 *   level → look up `levelByNumber(N)` (fixed difficulty + seed + theme)
 *         → generateCourse({difficulty, seed}) → physics world → vehicle
 *         → scene (THEMES[level.themeId]) → HUD → "first drawn shape starts the
 *           race" (unchanged) → race
 *         → on finish: grade the medal, persist the per-level best (which
 *           unlocks N+1), show the finish overlay with Retry / Next level /
 *           Levels.
 *
 * Responsibilities:
 *   - Boot: see flow above.
 *   - Time: `performance.now()` lives HERE (not in core/run.ts which is pure).
 *   - Determinism: every level's course seed and theme come from the campaign
 *     (core/campaign.ts) — pure data. The app layer no longer rolls a random
 *     seed for gameplay; a given level number always yields the same track+look.
 *   - Input: draw-box `onShape` → `vehicle.swapShape(id)`.
 *            "First drawn shape starts the race" — the run stays idle until the
 *            player lifts their finger for the first time; that first shape
 *            classification both equips the vehicle AND calls `startRun`.
 *   - Loop: rAF + fixed-step physics accumulator (via loop.ts).
 *   - HUD: timer/target readout + start/finish overlays, built by `createHud`
 *          (src/ui/hud.ts). All copy comes from i18n (src/ui/i18n.ts).
 *
 * Restart strategy: Retry / Next level do a full page reload
 * (`location.reload()`) — see `src/game/pendingRace.ts` for why (the
 * renderer/physics world have no teardown path today) and how the intended
 * next level survives the reload. "Levels" clears the pending level and
 * reloads to the grid.
 */

import { generateCourse, generateEndlessCourse } from '../core/course'
import { THEMES, pickTheme } from '../core/theme'
import { parTimeMs, medalFor, type Medal } from '../core/medal'
import { saveLevelResult, saveEndlessDistance, type Record as BestRecord } from '../core/records'
import { levelByNumber, CAMPAIGN_SIZE, type Level } from '../core/campaign'
import { createWorld, PHYSICS_TIMESTEP } from '../physics/world'
import { createVehicle } from '../physics/vehicle'
import { createScene } from '../render/scene'
import { createDrawBox } from '../ui/drawBox'
import { createHud, speedFraction } from '../ui/hud'
import { createLevelSelect } from '../ui/levelSelect'
import { createLocalStorageStore } from '../ui/localStorageStore'
import { createAudio, type Audio } from '../audio/audio'
import { createRun, startRun, tickRun } from '../core/run'
import { createEndless, startEndless, tickEndless } from '../core/endless'
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

/** Medal whose short "no medal" jingle doubles as the endless time-up cue. */
const ENDLESS_OVER_SOUND: Medal = 'none'

// ─── Post-finish "off-the-edge" gag (campaign only) ────────────────────────
//
// The medal/time are locked in the instant the run reaches 'finished' (see
// core/run.ts's tickRun) — everything below is a purely presentational coda
// layered on top: the car keeps rolling past the finish line, drives off the
// end of the track (there is no ground beyond `course.finishX` — see the flat
// run-out in core/course.ts) and tumbles off, and only once that fall lands
// (or a short timeout elapses) does the finish overlay appear.

/** How long (ms) after the finish-line crossing we keep the throttle applied
 *  before cutting it — long enough for the car to visibly drive off the end
 *  of the track instead of stopping right at the line. */
const POST_FINISH_ROLL_MS = 900

/** Chassis y below which the vehicle is considered to have fallen off the end
 *  of the track — well under the flat run-out's ground level (`BASE_Y = 0` in
 *  core/course.ts), so ordinary driving never crosses it; only actually going
 *  over the edge does. */
const FALL_THROUGH_Y = -6

/** Safety cap (ms), counted from the finish-line crossing, on how long we
 *  wait for the off-the-edge fall before revealing the finish overlay
 *  unconditionally — guarantees the results screen always appears even if
 *  the car somehow never goes over the edge. */
const POST_FINISH_FALL_TIMEOUT_MS = 4000

/**
 * True once the chassis has dropped below `thresholdY` — i.e. it has gone
 * over the edge of the track with no ground beneath it. Pure — exported for
 * unit tests (no AudioContext/physics-world needed).
 */
export function hasFallenOffEdge(chassisY: number, thresholdY: number): boolean {
  return chassisY < thresholdY
}

/** A fresh, random seed for an endless run (a uint32). Non-deterministic on
 *  purpose — each endless run rolls a new track + theme. */
function randomEndlessSeed(): number {
  return Math.floor(Math.random() * 0x1_0000_0000) >>> 0
}

// ─── Pending-level handoff (sessionStorage-backed; see pendingRace.ts) ─────────

function readPendingRace(): PendingRace | null {
  try {
    return parsePendingRace(sessionStorage.getItem(PENDING_RACE_STORAGE_KEY))
  } catch {
    // Storage unavailable (e.g. private mode edge cases) — fall back to grid.
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
    // Storage unavailable — the reload will just land on the level-select grid.
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
    if (pending.mode === 'endless') {
      await runEndless(root, store, audio, pending.seed)
      return
    }
    const level = levelByNumber(pending.number)
    if (level !== undefined) {
      await runLevel(root, store, audio, level)
      return
    }
    // Out-of-range level (shouldn't happen — parse validates) → fall to grid.
  }

  showLevelSelect(root, store, audio)
}

/** Show the level-select grid; tapping an unlocked level (or endless) starts it. */
function showLevelSelect(root: HTMLElement, store: KeyValueStore, audio: Audio): void {
  const select = createLevelSelect(root, {
    store,
    onSelect: (levelNumber) => {
      const level = levelByNumber(levelNumber)
      if (level === undefined) return
      select.destroy()
      runLevel(root, store, audio, level).catch((err: unknown) => {
        console.error('[gurpil] level failed to start', err)
      })
    },
    onEndless: () => {
      select.destroy()
      runEndless(root, store, audio, randomEndlessSeed()).catch((err: unknown) => {
        console.error('[gurpil] endless failed to start', err)
      })
    },
  })
}

/** Build and run a single campaign level to completion. */
async function runLevel(
  root: HTMLElement,
  store: KeyValueStore,
  audio: Audio,
  level: Level,
): Promise<void> {
  // ── Build subsystems ──────────────────────────────────────────────────────
  const course = generateCourse({ difficulty: level.difficulty, seed: level.seed })
  const parMs = parTimeMs(course)
  const world = await createWorld(course)

  // Spawn vehicle slightly above start so it settles under gravity.
  const vehicle = createVehicle(world, { x: course.startX + 2, y: 2 })

  // Silent settle: let the vehicle land on the terrain before rendering.
  for (let i = 0; i < SETTLE_STEPS; i++) {
    world.step()
  }

  // Theme is the level's fixed biome (campaign data) — purely visual, no effect
  // on physics/gameplay.
  const theme = THEMES[level.themeId]
  const scene = createScene(course, theme)

  // Whether there is a further level to advance to after beating this one.
  const hasNextLevel = level.number < CAMPAIGN_SIZE

  // ── HUD ───────────────────────────────────────────────────────────────────
  const hud = createHud(root, {
    onRetry: () => {
      writePendingRace({ mode: 'level', number: level.number })
      location.reload()
    },
    onNextLevel: () => {
      writePendingRace({ mode: 'level', number: level.number + 1 })
      location.reload()
    },
    onLevels: () => {
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

  // Post-finish "off-the-edge" coda bookkeeping (see constants above): time
  // since the finish-line crossing, whether the fall scream has fired, and
  // whether the finish overlay has been revealed yet.
  let msSinceFinish = 0
  let fallScreamPlayed = false
  let revealOverlay = false

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
        // Post-finish coda: keep driving for a moment so the car visibly
        // rolls off the end of the track (see POST_FINISH_ROLL_MS) instead
        // of hard-stopping right at the line, then cut power.
        if (msSinceFinish < POST_FINISH_ROLL_MS) {
          vehicle.setThrottle(1)
          vehicle.applyDrive()
        } else {
          vehicle.setThrottle(0)
        }
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

    // Post-finish coda: track time since the finish, detect the off-the-edge
    // fall, and gate the overlay reveal so the scream lands before the
    // results screen. Purely cosmetic — run.elapsedMs/finishResult (below)
    // are already locked in by tickRun's finish transition above.
    if (run.phase === 'finished') {
      msSinceFinish += frameMs

      if (!fallScreamPlayed && hasFallenOffEdge(vehicle.position().y, FALL_THROUGH_Y)) {
        fallScreamPlayed = true
        audio.fallScream()
      }

      if (!revealOverlay && (fallScreamPlayed || msSinceFinish >= POST_FINISH_FALL_TIMEOUT_MS)) {
        revealOverlay = true
      }
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
        const best = saveLevelResult(store, level.number, run.elapsedMs, medal)
        finishResult = { medal, best }
        audio.finish(medal)
        if (medal !== 'none') {
          const pos = vehicle.position()
          scene.medalCelebration(medal, pos.x, pos.y)
        }
      }
      if (revealOverlay) {
        hud.showFinish({
          elapsedMs: run.elapsedMs,
          medal: finishResult.medal,
          best: finishResult.best,
          hasNextLevel,
        })
        audio.setEngine(0)
      } else {
        // Post-finish coda: keep the gameplay view (and engine sound) up
        // while the car rolls off the end of the track toward its comedic
        // fall — see the coda bookkeeping above.
        hud.hide()
        audio.setEngine(speedFraction(speedMps))
      }
    }

    // ── Render ───────────────────────────────────────────────────────────
    scene.sync(vehicle)
    scene.render()

    requestAnimationFrame(frame)
  }

  requestAnimationFrame(frame)

  console.log(
    `[gurpil] level ${level.number} started — difficulty=${level.difficulty} ` +
      `seed=${level.seed} theme=${level.themeId}`,
  )
}

/**
 * Build and run a single ENDLESS run.
 *
 * Mirrors `runLevel`'s subsystem wiring (world / vehicle / scene / draw-box /
 * fixed-step loop / audio) but swaps the finite `RunState` for `EndlessState`:
 * the timer — not a finish line — ends the run. Distance travelled is the score.
 * On game-over the best distance is persisted and the endless game-over overlay
 * is shown (Retry → fresh endless run with a new seed; Levels → back to grid).
 */
async function runEndless(
  root: HTMLElement,
  store: KeyValueStore,
  audio: Audio,
  seed: number,
): Promise<void> {
  // ── Build subsystems ──────────────────────────────────────────────────────
  const course = generateEndlessCourse({ seed })
  const world = await createWorld(course)

  // Spawn vehicle slightly above start so it settles under gravity.
  const vehicle = createVehicle(world, { x: course.startX + 2, y: 2 })

  // Silent settle: let the vehicle land on the terrain before rendering.
  for (let i = 0; i < SETTLE_STEPS; i++) {
    world.step()
  }

  // One theme per run, chosen deterministically from the same seed as the track.
  const theme = THEMES[pickTheme(seed)]
  const scene = createScene(course, theme)

  // ── HUD ───────────────────────────────────────────────────────────────────
  const hud = createHud(root, {
    // Retry = a brand-new endless run (fresh random seed).
    onRetry: () => {
      writePendingRace({ mode: 'endless', seed: randomEndlessSeed() })
      location.reload()
    },
    // Endless has no "next level" — the endless overlay never shows that button.
    onNextLevel: () => {
      /* not used in endless mode */
    },
    onLevels: () => {
      writePendingRace(null)
      location.reload()
    },
    onToggleMute: () => {
      const nextMuted = !audio.isMuted()
      audio.setMuted(nextMuted)
      hud.setMuted(nextMuted)
    },
  })
  hud.setMuted(audio.isMuted())

  // ── Endless state ─────────────────────────────────────────────────────────
  let endless = createEndless()

  // The best distance is persisted + the game-over overlay shown exactly ONCE,
  // the first frame the run reaches 'over'.
  let overResult: { distance: number; best: number } | null = null

  // ── Draw-box ──────────────────────────────────────────────────────────────
  const drawBox = createDrawBox((id) => {
    audio.unlock()
    audio.blip()
    vehicle.swapShape(id)
    // First draw starts the run; subsequent draws only swap the shape.
    if (endless.phase === 'idle') {
      endless = startEndless(endless)
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

    const acc = advanceAccumulator(accumMs, frameMs, STEP_MS, MAX_STEPS_PER_FRAME)
    accumMs = acc.accumulatorMs

    // Physics steps: auto-throttle forward while running; cut it once over.
    for (let i = 0; i < acc.steps; i++) {
      if (endless.phase === 'running') {
        vehicle.setThrottle(1)
        vehicle.applyDrive()
      } else {
        vehicle.setThrottle(0)
      }
      vehicle.stabilize()
      world.step()
    }

    // Tick endless state after all physics steps this frame (no finish-line
    // logic — the timer is the only end condition).
    if (acc.steps > 0) {
      const steppedMs = acc.steps * STEP_MS
      const checkpointsHitBefore = endless.checkpointsHit
      endless = tickEndless(endless, steppedMs, vehicle.position().x, course.startX)
      if (endless.checkpointsHit > checkpointsHitBefore) {
        const pos = vehicle.position()
        scene.checkpointBurst(pos.x, pos.y)
      }
    }

    // ── HUD update ───────────────────────────────────────────────────────
    const speedMps = vehicle.chassis.linvel().x
    hud.setEndless(endless.timeLeftMs, endless.distance)
    hud.setSpeed(speedMps)
    if (endless.phase === 'idle') {
      hud.showStart()
      audio.setEngine(0)
    } else if (endless.phase === 'running') {
      hud.hide()
      audio.setEngine(speedFraction(speedMps))
    } else {
      // over — persist the best distance + play the cue once, then keep showing.
      if (overResult === null) {
        const best = saveEndlessDistance(store, endless.distance)
        overResult = { distance: endless.distance, best }
        audio.finish(ENDLESS_OVER_SOUND)
      }
      hud.showEndlessOver(overResult)
      audio.setEngine(0)
    }

    // ── Render ───────────────────────────────────────────────────────────
    scene.sync(vehicle)
    scene.render()

    requestAnimationFrame(frame)
  }

  requestAnimationFrame(frame)

  console.log(`[gurpil] endless started — seed=${seed} theme=${theme.id}`)
}
