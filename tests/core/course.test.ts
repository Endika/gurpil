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
  DIFFICULTY_TIERS,
  type Course,
  type Difficulty,
  type DifficultyTier,
  type TerrainKind,
} from '../../src/core/course'
import { createWorld } from '../../src/physics/world'
import { createVehicle } from '../../src/physics/vehicle'
import type { ShapeId } from '../../src/core/shapes'

const DIFFICULTIES: Difficulty[] = ['easy', 'medium', 'hard']

/** All five difficulty tiers, easiest → hardest (beginner … expert). */
const ALL_TIERS: readonly DifficultyTier[] = DIFFICULTY_TIERS

// Known friction tiers the generator may emit (base / mud / ice / uphill /
// water). ramp + bridge reuse base grip (0.6); water adds its own slippery 0.3.
const VALID_FRICTIONS = new Set([0.6, 1.2, 0.15, 0.1, 0.3])

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

function avgOver(difficulty: DifficultyTier, seeds: number, fn: (c: Course) => number): number {
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

  // ── Extended tiers: beginner is gentler than easy; expert harder than hard ──

  it('beginner is shorter than easy (on average length)', () => {
    expect(avgOver('beginner', SEEDS, totalLen)).toBeLessThan(avgOver('easy', SEEDS, totalLen))
  })

  it('expert is longer than hard (on average length)', () => {
    expect(avgOver('expert', SEEDS, totalLen)).toBeGreaterThan(avgOver('hard', SEEDS, totalLen))
  })

  it('length is non-decreasing across all five tiers (beginner→expert)', () => {
    const lens = ALL_TIERS.map((t) => avgOver(t, SEEDS, totalLen))
    for (let i = 1; i < lens.length; i++) {
      expect(lens[i]).toBeGreaterThan(lens[i - 1])
    }
  })

  it('beginner has fewer eggs than easy; expert more than hard (on average)', () => {
    expect(avgOver('beginner', SEEDS, eggCount)).toBeLessThan(avgOver('easy', SEEDS, eggCount))
    expect(avgOver('expert', SEEDS, eggCount)).toBeGreaterThan(avgOver('hard', SEEDS, eggCount))
  })

  it('expert has taller hills than hard; beginner flatter than easy (avg max height)', () => {
    expect(avgOver('expert', SEEDS, maxY)).toBeGreaterThan(avgOver('hard', SEEDS, maxY))
    expect(avgOver('beginner', SEEDS, maxY)).toBeLessThan(avgOver('easy', SEEDS, maxY))
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
    // The Stage-3 features are all traversable ground; the fast circle handles
    // them well (grippy ramp it climbs and launches off, flat water/bridge it
    // rolls straight across).
    case 'ramp':
    case 'water':
    case 'bridge':
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

  // All FIVE tiers (beginner … expert) must be clearable with the right shape
  // sequence — the extended tiers stay within the tuned completability ceilings.
  for (const difficulty of ALL_TIERS) {
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

// ─── Stage-3 feature completability (real engine) ─────────────────────────────
//
// Directly proves the NEW features are clearable: for every tier that can place a
// feature we find the first seed whose track actually CONTAINS it, then drive that
// track start→finish on the real Rapier engine. A ramp launches and lands; a water
// ford and a bridge are crossed — none is ever a dead-end or a pit.

describe('generateCourse — Stage-3 feature completability (real engine)', () => {
  beforeAll(async () => {
    await RAPIER.init()
  })

  const rampTiers: DifficultyTier[] = ['easy', 'medium', 'hard', 'expert']

  for (const kind of ['ramp', 'water', 'bridge'] as const) {
    const tiers = kind === 'ramp' ? rampTiers : ALL_TIERS
    for (const difficulty of tiers) {
      it(`${difficulty}: a track containing a ${kind} is driven to the finish`, async () => {
        let seed = -1
        for (let s = 0; s < 200; s++) {
          if (generateCourse({ difficulty, seed: s }).zones.some((z) => z.kind === kind)) {
            seed = s
            break
          }
        }
        expect(seed, `no ${kind} found for ${difficulty}`).toBeGreaterThanOrEqual(0)
        const course = generateCourse({ difficulty, seed })
        const { maxX, finishX } = await driveToFinish(course)
        expect(
          maxX,
          `${difficulty} seed=${seed} (with ${kind}) did not finish (maxX=${maxX.toFixed(1)}/${finishX})`,
        ).toBeGreaterThanOrEqual(finishX - 3)
      }, 60000)
    }
  }
})

// ─── Stage-3 terrain-variety features (ramp / water / bridge) ──────────────────
//
// New traversable-ground features added for variety. Every one begins AND ends at
// the BASE_Y baseline (0) so it composes in any random order, and none is ever a
// pit — proven structurally here and driven to the finish (real engine) below.

const BASE_Y = 0

/** Ground points strictly inside [zone.xStart, zone.xEnd]. */
function pointsInZone(course: Course, zone: { xStart: number; xEnd: number }) {
  return course.ground.filter((p) => p.x >= zone.xStart && p.x <= zone.xEnd)
}

/** First seed (0..limit) whose generated course contains a zone of `kind`. */
function firstSeedWith(difficulty: DifficultyTier, kind: TerrainKind, limit = 200): number {
  for (let seed = 0; seed < limit; seed++) {
    if (generateCourse({ difficulty, seed }).zones.some((z) => z.kind === kind)) return seed
  }
  return -1
}

describe('generateCourse — Stage-3 features appear (difficulty-scaled)', () => {
  it('water and bridge appear at every tier; ramps only from easy upward', () => {
    for (const tier of ALL_TIERS) {
      expect(firstSeedWith(tier, 'water'), `${tier} should place water`).toBeGreaterThanOrEqual(0)
      expect(firstSeedWith(tier, 'bridge'), `${tier} should place bridges`).toBeGreaterThanOrEqual(0)
    }
    // Ramps are deliberately absent at beginner (keeps beginner the flattest tier).
    expect(firstSeedWith('beginner', 'ramp')).toBe(-1)
    for (const tier of ['easy', 'medium', 'hard', 'expert'] as const) {
      expect(firstSeedWith(tier, 'ramp'), `${tier} should place ramps`).toBeGreaterThanOrEqual(0)
    }
  })

  it('taller ramps on harder tiers (expert ramps peak higher than easy, on average)', () => {
    const avgRampPeak = (tier: DifficultyTier): number => {
      let sum = 0
      let n = 0
      for (let seed = 0; seed < 120; seed++) {
        const c = generateCourse({ difficulty: tier, seed })
        for (const z of c.zones) {
          if (z.kind !== 'ramp') continue
          const ys = pointsInZone(c, z).map((p) => p.y)
          sum += Math.max(...ys)
          n++
        }
      }
      return n === 0 ? 0 : sum / n
    }
    expect(avgRampPeak('expert')).toBeGreaterThan(avgRampPeak('easy'))
  })
})

describe('generateCourse — Stage-3 feature structural invariants', () => {
  it('ramps rise above base, never dip below it, and land back flat at base', () => {
    const seed = firstSeedWith('expert', 'ramp')
    const course = generateCourse({ difficulty: 'expert', seed })
    for (const zone of course.zones.filter((z) => z.kind === 'ramp')) {
      const pts = pointsInZone(course, zone)
      const ys = pts.map((p) => p.y)
      // Never a pit: the ramp is entirely at or above the baseline.
      expect(Math.min(...ys)).toBeGreaterThanOrEqual(BASE_Y - 1e-9)
      // It actually rises (there IS a jump to launch off).
      expect(Math.max(...ys)).toBeGreaterThan(BASE_Y + 0.5)
      // Starts and ends flat on the baseline (composes with neighbours; lands flat).
      expect(pts[0].y).toBeCloseTo(BASE_Y, 6)
      expect(pts[pts.length - 1].y).toBeCloseTo(BASE_Y, 6)
    }
  })

  it('water and bridge are flat, solid ground at the baseline (never a pit)', () => {
    for (const kind of ['water', 'bridge'] as const) {
      const seed = firstSeedWith('hard', kind)
      const course = generateCourse({ difficulty: 'hard', seed })
      for (const zone of course.zones.filter((z) => z.kind === kind)) {
        for (const p of pointsInZone(course, zone)) {
          expect(p.y).toBeCloseTo(BASE_Y, 6)
        }
      }
    }
  })

  it('water surface is slippery/slow; bridge and ramp keep base grip', () => {
    const water = generateCourse({ difficulty: 'hard', seed: firstSeedWith('hard', 'water') })
    const waterZone = water.zones.find((z) => z.kind === 'water')!
    expect(water.surfaceFriction((waterZone.xStart + waterZone.xEnd) / 2)).toBe(0.3)

    const bridge = generateCourse({ difficulty: 'hard', seed: firstSeedWith('hard', 'bridge') })
    const bridgeZone = bridge.zones.find((z) => z.kind === 'bridge')!
    expect(bridge.surfaceFriction((bridgeZone.xStart + bridgeZone.xEnd) / 2)).toBe(0.6)

    const ramp = generateCourse({ difficulty: 'hard', seed: firstSeedWith('hard', 'ramp') })
    const rampZone = ramp.zones.find((z) => z.kind === 'ramp')!
    // Take-off face grip (near the start of the ramp) is grippy base, not the
    // slippery uphill grip — so every shape can climb and launch off it.
    expect(ramp.surfaceFriction(rampZone.xStart + 1)).toBe(0.6)
  })
})

// ─── Extended-tier determinism (beginner / expert) ────────────────────────────

describe('generateCourse — extended-tier determinism', () => {
  it('same {tier, seed} → byte-identical track for beginner and expert', () => {
    for (const difficulty of ['beginner', 'expert'] as const) {
      const a = generateCourse({ difficulty, seed: 12345 })
      const b = generateCourse({ difficulty, seed: 12345 })
      expect(a.finishX).toBe(b.finishX)
      expect(a.ground).toEqual(b.ground)
      expect(a.obstacles).toEqual(b.obstacles)
      expect(a.zones).toEqual(b.zones)
    }
  })
})
