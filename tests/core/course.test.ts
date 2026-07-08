/**
 * Tests for the course model — the SEEDED, difficulty-based generator plus the
 * canonical reference course.
 *
 * All assertions target real behavior — no mocks, no passthrough tests.
 * Determinism: `generateCourse` uses only a seeded PRNG, so equal
 * `{ difficulty, seed }` always yields an identical track. The completability
 * suite drives generated tracks on the REAL Rapier engine (no mocks) to prove
 * every zone is clearable with the right sequence of shapes.
 */

import { describe, it, expect, beforeAll } from 'vitest'
import RAPIER from '@dimforge/rapier2d-compat'
import {
  buildCourse,
  buildCanonicalCourse,
  generateCourse,
  zoneAt,
  type Course,
  type Difficulty,
  type TerrainKind,
} from '../../src/core/course'
import { createWorld } from '../../src/physics/world'
import { createVehicle } from '../../src/physics/vehicle'
import type { ShapeId } from '../../src/core/shapes'

const DIFFICULTIES: Difficulty[] = ['easy', 'medium', 'hard']

// Known friction tiers the generator may emit (base / mud / ice / uphill).
const VALID_FRICTIONS = new Set([0.6, 1.2, 0.15, 0.1])

// ─── Structural invariants (generator) ────────────────────────────────────────

describe('generateCourse — structural invariants', () => {
  const samples: { difficulty: Difficulty; seed: number }[] = []
  for (const difficulty of DIFFICULTIES) {
    for (const seed of [1, 2, 7, 99]) samples.push({ difficulty, seed })
  }

  for (const opts of samples) {
    describe(`${opts.difficulty} seed=${opts.seed}`, () => {
      const course = generateCourse(opts)

      it('finishX > startX', () => {
        expect(course.finishX).toBeGreaterThan(course.startX)
      })

      it('ground spans startX to finishX', () => {
        expect(course.ground[0].x).toBe(course.startX)
        expect(course.ground[course.ground.length - 1].x).toBe(course.finishX)
      })

      it('ground x values are strictly increasing', () => {
        for (let i = 1; i < course.ground.length; i++) {
          expect(course.ground[i].x).toBeGreaterThan(course.ground[i - 1].x)
        }
      })

      it('starts and ends with a flat zone (safe spawn + run-out)', () => {
        expect(course.zones[0].kind).toBe('flat')
        expect(course.zones[course.zones.length - 1].kind).toBe('flat')
      })

      it('zones tile [startX, finishX] contiguously', () => {
        expect(course.zones[0].xStart).toBe(course.startX)
        expect(course.zones[course.zones.length - 1].xEnd).toBe(course.finishX)
        for (let i = 1; i < course.zones.length; i++) {
          expect(course.zones[i].xStart).toBe(course.zones[i - 1].xEnd)
        }
      })

      it('surfaceFriction returns a known tier everywhere in bounds', () => {
        for (let x = course.startX; x < course.finishX; x += 1) {
          expect(VALID_FRICTIONS.has(course.surfaceFriction(x))).toBe(true)
        }
      })

      it('surfaceFriction out-of-bounds is finite base friction (no throw)', () => {
        expect(() => course.surfaceFriction(-1000)).not.toThrow()
        expect(course.surfaceFriction(-1000)).toBe(0.6)
        expect(course.surfaceFriction(course.finishX + 1000)).toBe(0.6)
      })

      it('every obstacle is a finite egg sitting inside an eggs zone', () => {
        for (const obs of course.obstacles) {
          expect(obs.kind).toBe('egg')
          expect(Number.isFinite(obs.x)).toBe(true)
          expect(Number.isFinite(obs.y)).toBe(true)
          expect(zoneAt(course, obs.x)?.kind).toBe('eggs')
        }
      })

      it('every obstacle has a log or rock visual variant', () => {
        for (const obs of course.obstacles) {
          expect(['log', 'rock']).toContain(obs.variant)
        }
      })
    })
  }
})

// ─── Determinism ──────────────────────────────────────────────────────────────

function sampleFriction(c: Course): number[] {
  const out: number[] = []
  for (let x = c.startX; x <= c.finishX; x += 2) out.push(c.surfaceFriction(x))
  return out
}

describe('generateCourse — determinism', () => {
  it('same {difficulty, seed} → byte-identical track', () => {
    for (const difficulty of DIFFICULTIES) {
      const a = generateCourse({ difficulty, seed: 12345 })
      const b = generateCourse({ difficulty, seed: 12345 })
      expect(a.startX).toBe(b.startX)
      expect(a.finishX).toBe(b.finishX)
      expect(a.ground).toEqual(b.ground)
      expect(a.obstacles).toEqual(b.obstacles)
      expect(a.zones).toEqual(b.zones)
      expect(sampleFriction(a)).toEqual(sampleFriction(b))
    }
  })

  it('different seed → different track (same difficulty)', () => {
    const a = generateCourse({ difficulty: 'medium', seed: 1 })
    const b = generateCourse({ difficulty: 'medium', seed: 2 })
    // Overwhelmingly likely to differ in length and/or geometry.
    const differs =
      a.finishX !== b.finishX ||
      JSON.stringify(a.ground) !== JSON.stringify(b.ground) ||
      JSON.stringify(a.obstacles) !== JSON.stringify(b.obstacles)
    expect(differs).toBe(true)
  })

  it('different difficulty → different track (same seed)', () => {
    const easy = generateCourse({ difficulty: 'easy', seed: 42 })
    const hard = generateCourse({ difficulty: 'hard', seed: 42 })
    expect(easy.finishX).not.toBe(hard.finishX)
  })
})

// ─── Obstacle visual variant (log / rock) ─────────────────────────────────────

describe('generateCourse — obstacle variant', () => {
  it('same {difficulty, seed} → identical variants (deterministic)', () => {
    for (const difficulty of DIFFICULTIES) {
      const a = generateCourse({ difficulty, seed: 55 })
      const b = generateCourse({ difficulty, seed: 55 })
      expect(a.obstacles.map((o) => o.variant)).toEqual(b.obstacles.map((o) => o.variant))
    }
  })

  it('both log and rock variants occur across many seeds (real mix, not all-one)', () => {
    const seen = new Set<string>()
    for (let seed = 0; seed < 30; seed++) {
      const course = generateCourse({ difficulty: 'hard', seed })
      for (const obs of course.obstacles) seen.add(obs.variant)
    }
    expect(seen.has('log')).toBe(true)
    expect(seen.has('rock')).toBe(true)
  })
})

describe('buildCanonicalCourse — obstacle variant', () => {
  it('is deterministic across calls', () => {
    const a = buildCanonicalCourse()
    const b = buildCanonicalCourse()
    expect(a.obstacles.map((o) => o.variant)).toEqual(b.obstacles.map((o) => o.variant))
  })

  it('has at least one obstacle', () => {
    expect(buildCanonicalCourse().obstacles.length).toBeGreaterThan(0)
  })
})

// ─── Difficulty monotonicity (averaged over many seeds) ───────────────────────

function avgOver(difficulty: Difficulty, seeds: number, fn: (c: Course) => number): number {
  let sum = 0
  for (let seed = 0; seed < seeds; seed++) sum += fn(generateCourse({ difficulty, seed }))
  return sum / seeds
}

describe('generateCourse — difficulty monotonicity', () => {
  const SEEDS = 40
  const totalLen = (c: Course) => c.finishX - c.startX
  const hazardCount = (c: Course) => c.zones.length - 2 // minus start + end flats
  const eggCount = (c: Course) => c.obstacles.length
  const maxY = (c: Course) => Math.max(...c.ground.map((p) => p.y))

  it('hard is longer than medium, which is longer than easy (on average)', () => {
    const e = avgOver('easy', SEEDS, totalLen)
    const m = avgOver('medium', SEEDS, totalLen)
    const h = avgOver('hard', SEEDS, totalLen)
    expect(m).toBeGreaterThan(e)
    expect(h).toBeGreaterThan(m)
  })

  it('hard has more hazard zones than easy (on average)', () => {
    expect(avgOver('hard', SEEDS, hazardCount)).toBeGreaterThan(avgOver('easy', SEEDS, hazardCount))
  })

  it('hard has more eggs than easy (on average)', () => {
    expect(avgOver('hard', SEEDS, eggCount)).toBeGreaterThan(avgOver('easy', SEEDS, eggCount))
  })

  it('hard has steeper/taller hills than easy (on average max height)', () => {
    expect(avgOver('hard', SEEDS, maxY)).toBeGreaterThan(avgOver('easy', SEEDS, maxY))
  })
})

// ─── Canonical reference course ───────────────────────────────────────────────

describe('buildCourse / buildCanonicalCourse — the tuned reference', () => {
  it('buildCourse returns the canonical course', () => {
    const a = buildCourse()
    const b = buildCanonicalCourse()
    expect(a.ground).toEqual(b.ground)
    expect(a.obstacles).toEqual(b.obstacles)
    expect(a.finishX).toBe(b.finishX)
  })

  it('is deterministic across calls', () => {
    const a = buildCourse()
    const b = buildCourse()
    expect(a.ground).toEqual(b.ground)
    expect(a.obstacles).toEqual(b.obstacles)
  })

  it('has the tuned zone sequence with an uphill and eggs', () => {
    const c = buildCourse()
    expect(c.zones.map((z) => z.kind)).toEqual([
      'flat',
      'rocky',
      'uphill',
      'mud',
      'ice',
      'eggs',
      'flat',
    ])
    expect(c.obstacles.length).toBeGreaterThanOrEqual(1)
  })
})

// ─── Completability on the REAL engine ────────────────────────────────────────
//
// Proof that every generated track is clearable with the right sequence of
// shapes (no impossible zone). We drive the whole course start→finish on the
// real Rapier engine, swapping to the ideal shape for the zone just ahead:
//   uphill → triangle (grips the slippery ramp), eggs → line (rolls over eggs),
//   flat/rocky → circle (fast), mud/ice → triangle (safe grip).

const LOOKAHEAD = 8
const SETTLE_STEPS = 90
const MAX_DRIVE_STEPS = 30000

function idealShape(kind: TerrainKind): ShapeId {
  switch (kind) {
    case 'uphill':
      return 'triangle'
    case 'eggs':
      return 'line'
    case 'mud':
    case 'ice':
      return 'triangle'
    case 'rocky':
    case 'flat':
    default:
      return 'circle'
  }
}

async function driveToFinish(course: Course): Promise<{ maxX: number; finishX: number }> {
  const world = await createWorld(course)
  const vehicle = createVehicle(world, { x: course.startX + 2, y: 2 })
  for (let i = 0; i < SETTLE_STEPS; i++) world.step()

  vehicle.setThrottle(1)
  let maxX = -Infinity
  const target = course.finishX - 3 // reaching the run-out means all hazards cleared
  for (let i = 0; i < MAX_DRIVE_STEPS; i++) {
    const x = vehicle.position().x
    // Pre-equip the ideal shape for the zone just ahead (lookahead), falling back
    // to the current zone near the finish.
    const zone = zoneAt(course, x + LOOKAHEAD) ?? zoneAt(course, x)
    if (zone) {
      const want = idealShape(zone.kind)
      if (vehicle.currentShape() !== want) vehicle.swapShape(want)
    }
    vehicle.applyDrive()
    vehicle.stabilize()
    world.step()
    maxX = Math.max(maxX, vehicle.position().x)
    if (maxX >= target) break
  }
  return { maxX, finishX: course.finishX }
}

describe('generateCourse — completability (real engine)', () => {
  beforeAll(async () => {
    await RAPIER.init()
  })

  for (const difficulty of DIFFICULTIES) {
    for (const seed of [1, 2]) {
      it(`${difficulty} seed=${seed} is completable with the right shape sequence`, async () => {
        const course = generateCourse({ difficulty, seed })
        const { maxX, finishX } = await driveToFinish(course)
        expect(maxX, `did not reach the finish (maxX=${maxX.toFixed(1)}, finishX=${finishX})`).toBeGreaterThanOrEqual(
          finishX - 3,
        )
      }, 60000)
    }
  }
})
