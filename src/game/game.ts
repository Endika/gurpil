/**
 * Game orchestrator — wires all subsystems into a playable end-to-end loop.
 *
 * Responsibilities:
 *   - Boot: build course → create physics world → spawn vehicle → create scene
 *           → create draw-box.
 *   - Time: `performance.now()` lives HERE (not in core/run.ts which is pure).
 *   - Input: draw-box `onShape` → `vehicle.swapShape(id)`.
 *            "First drawn shape starts the race" — the run stays idle until the
 *            player lifts their finger for the first time; that first shape
 *            classification both equips the vehicle AND calls `startRun`.
 *   - Loop: rAF + fixed-step physics accumulator (via loop.ts).
 *            While racing: full auto-throttle forward (setThrottle(1) + applyDrive()).
 *            On finish: throttle cut to 0, timer frozen, restart prompt shown.
 *   - HUD: timer readout + start/finish overlays, built by `createHud`
 *          (src/ui/hud.ts). Restart is wired inside the HUD (page reload).
 *          All copy comes from i18n (src/ui/i18n.ts) — see also main.ts for
 *          the styles.css import.
 *
 * Restart strategy: page reload (`location.reload()`). Simplest possible reset
 * — rebuilds the full Rapier world and Three.js scene from scratch. Avoids any
 * incremental teardown / leaking colliders. Acceptable for an MVP.
 */

import { buildCourse } from '../core/course'
import { createWorld, PHYSICS_TIMESTEP } from '../physics/world'
import { createVehicle } from '../physics/vehicle'
import { createScene } from '../render/scene'
import { createDrawBox } from '../ui/drawBox'
import { createHud } from '../ui/hud'
import { createRun, startRun, tickRun } from '../core/run'
import { advanceAccumulator, MAX_STEPS_PER_FRAME } from './loop'
import type { RunState } from '../core/run'

// ─── Constants ────────────────────────────────────────────────────────────────

/** Fixed physics step in milliseconds (derived from PHYSICS_TIMESTEP). */
const STEP_MS = PHYSICS_TIMESTEP * 1000

/**
 * Frames to run without applying throttle at boot to let the vehicle settle
 * on the terrain before the player can start the race.
 */
const SETTLE_STEPS = 90

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Boot the full game and attach everything to `root`.
 * The rAF loop runs until the page is unloaded.
 */
export async function startGame(root: HTMLElement): Promise<void> {
  // ── Build subsystems ──────────────────────────────────────────────────────
  const course = buildCourse()
  const world = await createWorld(course)

  // Spawn vehicle slightly above start so it settles under gravity.
  const vehicle = createVehicle(world, { x: course.startX + 2, y: 2 })

  // Silent settle: let the vehicle land on the terrain before rendering.
  for (let i = 0; i < SETTLE_STEPS; i++) {
    world.step()
  }

  const scene = createScene(course)

  // ── HUD ───────────────────────────────────────────────────────────────────
  const hud = createHud(root)

  // ── Run state ─────────────────────────────────────────────────────────────
  let run: RunState = createRun()

  // ── Draw-box ──────────────────────────────────────────────────────────────
  const drawBox = createDrawBox((id) => {
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
    hud.setTime(run.elapsedMs)
    hud.setSpeed(vehicle.chassis.linvel().x)
    if (run.phase === 'idle') {
      hud.showStart()
    } else if (run.phase === 'racing') {
      hud.hide()
    } else {
      // finished
      hud.showFinish(run.elapsedMs)
    }

    // ── Render ───────────────────────────────────────────────────────────
    scene.sync(vehicle)
    scene.render()

    requestAnimationFrame(frame)
  }

  requestAnimationFrame(frame)

  console.log('[gurpil] game started — draw a shape to begin the race')
}
