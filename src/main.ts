/**
 * Gurpil — entry point.
 *
 * Boot sequence:
 *   1. Init Rapier WASM.
 *   2. Build the MVP course (pure, deterministic).
 *   3. Create the physics world (static terrain + egg colliders).
 *   4. Spawn the vehicle slightly above the start.
 *   5. Create the Three.js scene.
 *   6. Run a minimal rAF loop: no physics stepping yet (Task 12 owns the real
 *      game loop), but calls scene.sync(vehicle) + scene.render() so the car
 *      is visible on the terrain from the first frame.
 */

import RAPIER from '@dimforge/rapier2d-compat'
import { buildCourse } from './core/course'
import { createWorld } from './physics/world'
import { createVehicle } from './physics/vehicle'
import { createScene } from './render/scene'

async function boot(): Promise<void> {
  await RAPIER.init()

  const course = buildCourse()
  const world = await createWorld(course)

  // Spawn vehicle slightly above the start so it settles under gravity
  const vehicle = createVehicle(world, { x: course.startX + 2, y: 2 })

  // Let it settle for a few physics ticks before showing
  for (let i = 0; i < 10; i++) {
    vehicle.applyDrive()
    world.step()
  }

  const scene = createScene(course)

  // Minimal rAF loop — no physics stepping; Task 12 will replace this.
  function frame(): void {
    scene.sync(vehicle)
    scene.render()
    requestAnimationFrame(frame)
  }

  requestAnimationFrame(frame)

  console.log('[gurpil] boot OK — Three.js + Rapier2d loaded')
}

boot().catch((err: unknown) => {
  console.error('[gurpil] boot failed', err)
})
