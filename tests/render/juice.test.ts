/**
 * Juice/particle-effect helpers — pure logic tests.
 *
 * The particle systems themselves (pooled Three.js meshes) need a WebGL
 * context and aren't unit-testable headlessly, so this file covers only the
 * two PURE predicates extracted out of scene.ts's per-frame juice logic:
 *   - detectLanding(): the landing-dust trigger (a sharp arrest in the
 *     chassis's downward vertical velocity).
 *   - confettiCountForMedal(): how many confetti pieces a medal celebration
 *     spawns (0 for 'none', increasing bronze → silver → gold).
 *
 * No THREE constructors, no DOM — safe in Node/Vitest.
 */

import { describe, it, expect } from 'vitest'
import {
  detectLanding,
  confettiCountForMedal,
  LANDING_FALL_SPEED_MIN,
  LANDING_ARREST_THRESHOLD,
} from '../../src/render/scene'
import type { Medal } from '../../src/core/medal'

describe('detectLanding', () => {
  it('detects a hard landing: falling fast, then arrested', () => {
    expect(detectLanding(-LANDING_FALL_SPEED_MIN - 1, LANDING_ARREST_THRESHOLD)).toBe(true)
    expect(detectLanding(-6, 0)).toBe(true)
    expect(detectLanding(-6, 3)).toBe(true) // bounced back upward — still a landing
  })

  it('does not fire when the previous frame was not falling fast enough', () => {
    // A small bump/bounce — never fell faster than the threshold.
    expect(detectLanding(-1, 0)).toBe(false)
    expect(detectLanding(-LANDING_FALL_SPEED_MIN + 0.01, 0)).toBe(false)
  })

  it('does not fire while still falling (fall not yet arrested)', () => {
    expect(detectLanding(-6, -6)).toBe(false)
    expect(detectLanding(-6, LANDING_ARREST_THRESHOLD - 0.01)).toBe(false)
  })

  it('is exact at the boundary values (inclusive thresholds)', () => {
    expect(detectLanding(-LANDING_FALL_SPEED_MIN, LANDING_ARREST_THRESHOLD)).toBe(true)
  })
})

describe('confettiCountForMedal', () => {
  it('fires nothing for no medal', () => {
    expect(confettiCountForMedal('none')).toBe(0)
  })

  it('increases strictly with medal rank: bronze < silver < gold', () => {
    const bronze = confettiCountForMedal('bronze')
    const silver = confettiCountForMedal('silver')
    const gold = confettiCountForMedal('gold')
    expect(bronze).toBeGreaterThan(0)
    expect(silver).toBeGreaterThan(bronze)
    expect(gold).toBeGreaterThan(silver)
  })

  it('is a pure function of the medal (deterministic)', () => {
    const medals: Medal[] = ['none', 'bronze', 'silver', 'gold']
    for (const medal of medals) {
      expect(confettiCountForMedal(medal)).toBe(confettiCountForMedal(medal))
    }
  })
})
