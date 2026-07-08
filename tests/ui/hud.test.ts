import { describe, it, expect } from 'vitest'
import { formatTime, formatCountdown, formatDistance, speedFraction } from '../../src/ui/hud'

describe('formatTime', () => {
  it('formats zero milliseconds', () => {
    expect(formatTime(0)).toBe('0.000 s')
  })

  it('formats sub-second values', () => {
    expect(formatTime(345)).toBe('0.345 s')
  })

  it('formats multi-second values', () => {
    expect(formatTime(12345)).toBe('12.345 s')
  })

  it('rounds to 3 decimal places', () => {
    expect(formatTime(1000.4)).toBe('1.000 s')
    expect(formatTime(1000.6)).toBe('1.001 s')
  })

  it('never returns a negative-looking string for 0', () => {
    expect(formatTime(0)).not.toContain('-')
  })
})

describe('formatCountdown', () => {
  it('formats a whole-second budget to one decimal', () => {
    expect(formatCountdown(20000)).toBe('20.0 s')
  })

  it('formats sub-second remaining time', () => {
    expect(formatCountdown(1500)).toBe('1.5 s')
  })

  it('clamps an exhausted (0) clock', () => {
    expect(formatCountdown(0)).toBe('0.0 s')
  })

  it('clamps a negative clock to 0', () => {
    expect(formatCountdown(-500)).toBe('0.0 s')
  })

  it('rounds to one decimal place', () => {
    expect(formatCountdown(1249)).toBe('1.2 s')
    expect(formatCountdown(1250)).toBe('1.3 s')
  })
})

describe('formatDistance', () => {
  it('formats whole metres', () => {
    expect(formatDistance(123)).toBe('123 m')
  })

  it('floors fractional metres', () => {
    expect(formatDistance(456.9)).toBe('456 m')
  })

  it('formats zero', () => {
    expect(formatDistance(0)).toBe('0 m')
  })

  it('clamps a negative distance to 0', () => {
    expect(formatDistance(-10)).toBe('0 m')
  })
})

describe('speedFraction', () => {
  it('is 0 at a standstill', () => {
    expect(speedFraction(0)).toBe(0)
  })

  it('clamps negative (sliding backwards) speed to 0', () => {
    expect(speedFraction(-5)).toBe(0)
  })

  it('saturates at 1 for speeds at or above the display max', () => {
    expect(speedFraction(8)).toBe(1)
    expect(speedFraction(20)).toBe(1)
  })

  it('scales linearly in between', () => {
    expect(speedFraction(4)).toBeCloseTo(0.5, 5)
    expect(speedFraction(2)).toBeCloseTo(0.25, 5)
  })
})
