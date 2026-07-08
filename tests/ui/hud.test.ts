import { describe, it, expect } from 'vitest'
import { formatTime, speedFraction } from '../../src/ui/hud'

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
