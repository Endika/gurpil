import { describe, it, expect } from 'vitest'
import { formatTime } from '../../src/ui/hud'

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
