/**
 * Scene3D — Three.js visual layer for Gurpil.
 *
 * Camera choice: OrthographicCamera.
 * Rationale: the game is a pure side-scroller (physics on the x-y plane).
 * An orthographic camera gives a clean 2D-game-like read without perspective
 * distortion; depth (z) is used only for layering meshes, not for perspective
 * foreshortening. The frustum half-height is fixed in "game metres" so the
 * car and terrain always appear at the same pixel size regardless of window
 * width, and the camera follows chassis x via smooth lerp.
 *
 * Coordinate mapping:
 *   physics x  → scene x  (1:1)
 *   physics y  → scene y  (1:1, +y up in both)
 *   rotation   → mesh.rotation.z (Rapier angle is CCW in 2D = Three.js CCW from +z)
 *
 * Terrain z layering (z=0 plane is the physics plane):
 *   terrain strip:  z = -0.5 (behind vehicle)
 *   wheel meshes:   z =  0.4 (in front of chassis)
 *   chassis mesh:   z =  0.0
 *   monigote:       z =  0.1
 */

import * as THREE from 'three'
import type { Course } from '../core/course'
import type { Vehicle } from '../physics/vehicle'
import { SHAPES } from '../core/shapes'
import { buildTerrainMesh, buildObstacleMeshes } from './terrain'

// ─── Constants ────────────────────────────────────────────────────────────────

/** Half-height of the orthographic frustum in game metres. Controls zoom level. */
const CAM_HALF_HEIGHT = 12

/** z distance of the camera from the x-y plane (orthographic depth budget). */
const CAM_Z = 50

/**
 * How far the camera leads/lags the vehicle in x (lerp factor per frame).
 * 1.0 = instant snap; lower = smoother follow.
 */
const CAM_LERP = 0.1

/** Camera y offset: keeps the car slightly below centre for sky headroom. */
const CAM_Y_OFFSET = 2

/** z position of the chassis mesh. */
const CHASSIS_Z = 0

/** z position of each wheel (in front of chassis for visibility). */
const WHEEL_Z = 0.4

/** z position of the monigote body+head meshes. */
const MONIGOTE_Z = 0.1

/** Chassis box half-extents in metres (matches physics: CHASSIS_HALF_W=1, CHASSIS_HALF_H=0.3). */
const CHASSIS_HALF_W = 1.0
const CHASSIS_HALF_H = 0.3

/** Visual wheel radius (matches physics). */
const WHEEL_RADIUS = 0.35

/** Monigote body half-extents (metres). */
const BODY_HALF_W = 0.22
const BODY_HALF_H = 0.35

/** Monigote head radius (metres). */
const HEAD_RADIUS = 0.2

/** Pixel ratio cap to limit GPU load on high-DPI mobile. */
const MAX_PIXEL_RATIO = 2

// ─── Sky / lighting colors ────────────────────────────────────────────────────

const SKY_COLOR = 0x87ceeb // cornflower blue
const SUN_COLOR = 0xfff7e0 // warm sunlight
const AMBIENT_SKY = 0x87cefa // sky ambient
const AMBIENT_GROUND = 0x8b6914 // ground ambient

// ─── Public types ─────────────────────────────────────────────────────────────

export interface Scene3D {
  sync(vehicle: Vehicle): void
  render(): void
}

// ─── Internal types ───────────────────────────────────────────────────────────

interface VehicleMeshes {
  group: THREE.Group
  chassis: THREE.Mesh
  wheels: THREE.Mesh[]
  monigoteBody: THREE.Mesh
  monigoteHead: THREE.Mesh
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Create and return a Scene3D that renders the given course in side view.
 *
 * The renderer is appended to document.body. The scene is ready immediately;
 * call `sync(vehicle)` each frame before `render()`.
 */
export function createScene(course: Course): Scene3D {
  // ── Renderer ────────────────────────────────────────────────────────────────
  const renderer = new THREE.WebGLRenderer({ antialias: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO))
  renderer.setSize(window.innerWidth, window.innerHeight)
  renderer.setClearColor(SKY_COLOR)
  document.body.appendChild(renderer.domElement)

  // ── Scene ───────────────────────────────────────────────────────────────────
  const scene = new THREE.Scene()
  scene.background = new THREE.Color(SKY_COLOR)

  // Hemisphere light (sky from above, ground bounce from below)
  const hemi = new THREE.HemisphereLight(AMBIENT_SKY, AMBIENT_GROUND, 0.8)
  hemi.position.set(0, 1, 0)
  scene.add(hemi)

  // Directional sun light
  const sun = new THREE.DirectionalLight(SUN_COLOR, 1.2)
  sun.position.set(10, 20, 15)
  scene.add(sun)

  // ── Camera ──────────────────────────────────────────────────────────────────
  const aspect = window.innerWidth / window.innerHeight
  const halfH = CAM_HALF_HEIGHT
  const halfW = halfH * aspect
  const camera = new THREE.OrthographicCamera(-halfW, halfW, halfH, -halfH, 0.1, 200)
  camera.position.set(0, CAM_Y_OFFSET, CAM_Z)
  camera.lookAt(0, CAM_Y_OFFSET, 0)

  // ── Terrain ──────────────────────────────────────────────────────────────────
  const terrainMesh = buildTerrainMesh(course)
  terrainMesh.position.z = -0.5
  scene.add(terrainMesh)

  const obstacleMeshes = buildObstacleMeshes(course.obstacles)
  scene.add(obstacleMeshes)

  // ── Vehicle meshes ───────────────────────────────────────────────────────────
  const vehicleMeshes = buildVehicleMeshes()
  scene.add(vehicleMeshes.group)

  // ── Resize handler ───────────────────────────────────────────────────────────
  window.addEventListener('resize', () => {
    const w = window.innerWidth
    const h = window.innerHeight
    const asp = w / h
    const hw = CAM_HALF_HEIGHT * asp
    camera.left = -hw
    camera.right = hw
    camera.top = CAM_HALF_HEIGHT
    camera.bottom = -CAM_HALF_HEIGHT
    camera.updateProjectionMatrix()
    renderer.setSize(w, h)
  })

  // ── Camera x state (lerp target) ─────────────────────────────────────────────
  let camX = course.startX

  return {
    sync(vehicle: Vehicle): void {
      // ── Chassis ────────────────────────────────────────────────────────────
      const ct = vehicle.chassis.translation()
      const cr = vehicle.chassis.rotation()
      vehicleMeshes.chassis.position.set(ct.x, ct.y, CHASSIS_Z)
      vehicleMeshes.chassis.rotation.z = cr

      // Keep group at chassis position so all children move together
      vehicleMeshes.group.position.set(ct.x, ct.y, 0)

      // Chassis mesh is in group-local space → reset its world offset
      vehicleMeshes.chassis.position.set(0, 0, CHASSIS_Z)
      vehicleMeshes.chassis.rotation.z = cr

      // ── Wheels ────────────────────────────────────────────────────────────
      for (let i = 0; i < 2; i++) {
        const wt = vehicle.wheels[i].translation()
        const wr = vehicle.wheels[i].rotation()
        const wm = vehicleMeshes.wheels[i]
        // Wheels are world-positioned: subtract group (chassis) position
        wm.position.set(wt.x - ct.x, wt.y - ct.y, WHEEL_Z)
        wm.rotation.z = wr
      }

      // Update wheel tint from current shape
      const shape = vehicle.currentShape()
      const color = new THREE.Color(SHAPES[shape].colorHex)
      for (const wm of vehicleMeshes.wheels) {
        ;(wm.material as THREE.MeshLambertMaterial).color.set(color)
      }

      // ── Monigote stays fixed relative to chassis ───────────────────────────
      // Body and head are in group-local space; their local positions are set at
      // creation time and don't change (they ride the chassis group).

      // ── Camera follow ─────────────────────────────────────────────────────
      camX += (ct.x - camX) * CAM_LERP
      camera.position.x = camX
      camera.lookAt(camX, CAM_Y_OFFSET, 0)
    },

    render(): void {
      renderer.render(scene, camera)
    },
  }
}

// ─── Internal builders ────────────────────────────────────────────────────────

/**
 * Build the vehicle mesh group: chassis box, two wheels, and a simple low-poly
 * "monigote" (body box + head sphere) seated on top of the chassis.
 *
 * All meshes are in group-local space (group is repositioned each sync to
 * match the chassis rigid body position). Wheels are also in group-local space
 * to keep the position math straightforward.
 */
function buildVehicleMeshes(): VehicleMeshes {
  const group = new THREE.Group()

  // ── Chassis ──────────────────────────────────────────────────────────────
  const chassisGeo = new THREE.BoxGeometry(CHASSIS_HALF_W * 2, CHASSIS_HALF_H * 2, 1.2)
  const chassisMat = new THREE.MeshLambertMaterial({ color: 0xe74c3c }) // red
  const chassis = new THREE.Mesh(chassisGeo, chassisMat)
  chassis.position.set(0, 0, CHASSIS_Z)
  group.add(chassis)

  // ── Wheels ───────────────────────────────────────────────────────────────
  // Initially circle wheels; tint updated in sync() per current shape.
  const wheelGeo = new THREE.CylinderGeometry(WHEEL_RADIUS, WHEEL_RADIUS, 1.0, 12)
  // Rotate so the cylinder axis aligns with z (side-view disc)
  wheelGeo.rotateX(Math.PI / 2)

  const wheels: THREE.Mesh[] = []
  for (let i = 0; i < 2; i++) {
    const mat = new THREE.MeshLambertMaterial({ color: SHAPES.circle.colorHex })
    const mesh = new THREE.Mesh(wheelGeo, mat)
    mesh.position.set(0, 0, WHEEL_Z)
    group.add(mesh)
    wheels.push(mesh)
  }

  // ── Monigote body ─────────────────────────────────────────────────────────
  const bodyGeo = new THREE.BoxGeometry(BODY_HALF_W * 2, BODY_HALF_H * 2, 0.5)
  const bodyMat = new THREE.MeshLambertMaterial({ color: 0x3498db }) // blue shirt
  const monigoteBody = new THREE.Mesh(bodyGeo, bodyMat)
  // Seat on top of chassis (chassis top edge = CHASSIS_HALF_H)
  monigoteBody.position.set(0, CHASSIS_HALF_H + BODY_HALF_H, MONIGOTE_Z)
  group.add(monigoteBody)

  // ── Monigote head ─────────────────────────────────────────────────────────
  const headGeo = new THREE.SphereGeometry(HEAD_RADIUS, 8, 6)
  const headMat = new THREE.MeshLambertMaterial({ color: 0xf5cba7 }) // skin
  const monigoteHead = new THREE.Mesh(headGeo, headMat)
  // Sits on top of the body
  monigoteHead.position.set(0, CHASSIS_HALF_H + BODY_HALF_H * 2 + HEAD_RADIUS, MONIGOTE_Z)
  group.add(monigoteHead)

  return { group, chassis, wheels, monigoteBody, monigoteHead }
}
