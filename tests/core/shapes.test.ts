import { describe, it, expect } from 'vitest'
import {
  SHAPES,
  SHAPE_IDS,
  WHEEL_MASS,
  type ShapeId,
} from '../../src/core/shapes'

describe('Shape catalog', () => {
  describe('Catalog completeness', () => {
    it('every ShapeId in SHAPE_IDS has a SHAPES entry', () => {
      SHAPE_IDS.forEach((shapeId) => {
        expect(SHAPES[shapeId]).toBeDefined()
      })
    })

    it('SHAPE_IDS length matches the number of shapes', () => {
      expect(SHAPE_IDS.length).toBe(Object.keys(SHAPES).length)
    })

    it('SHAPES keys match SHAPE_IDS (no gaps or extras)', () => {
      const shapesKeys = new Set(Object.keys(SHAPES)) as Set<ShapeId>
      const shapeIdSet = new Set(SHAPE_IDS)
      expect(shapesKeys).toEqual(shapeIdSet)
    })
  })

  describe('Tuning fields (stable-hybrid model)', () => {
    it('every shape has a finite, positive wheelRadiusMul', () => {
      SHAPE_IDS.forEach((shapeId) => {
        const mul = SHAPES[shapeId].wheelRadiusMul
        expect(Number.isFinite(mul)).toBe(true)
        expect(mul).toBeGreaterThan(0)
      })
    })

    it('every shape has a finite, positive speedMul', () => {
      SHAPE_IDS.forEach((shapeId) => {
        const mul = SHAPES[shapeId].speedMul
        expect(Number.isFinite(mul)).toBe(true)
        expect(mul).toBeGreaterThan(0)
      })
    })

    it('circle is the flat-speed reference (fastest speedMul)', () => {
      const max = Math.max(...SHAPE_IDS.map((id) => SHAPES[id].speedMul))
      expect(SHAPES.circle.speedMul).toBe(max)
    })

    it('line has the largest effective radius (best over the eggs / rough)', () => {
      const max = Math.max(...SHAPE_IDS.map((id) => SHAPES[id].wheelRadiusMul))
      expect(SHAPES.line.wheelRadiusMul).toBe(max)
    })

    it('circle is faster than square on flat (speedMul)', () => {
      expect(SHAPES.circle.speedMul).toBeGreaterThan(SHAPES.square.speedMul)
    })
  })

  describe('Friction and restitution', () => {
    it('all friction values are finite and >= 0', () => {
      SHAPE_IDS.forEach((shapeId) => {
        const friction = SHAPES[shapeId].friction
        expect(Number.isFinite(friction)).toBe(true)
        expect(friction).toBeGreaterThanOrEqual(0)
      })
    })

    it('all restitution values are within 0..1', () => {
      SHAPE_IDS.forEach((shapeId) => {
        const restitution = SHAPES[shapeId].restitution
        expect(Number.isFinite(restitution)).toBe(true)
        expect(restitution).toBeGreaterThanOrEqual(0)
        expect(restitution).toBeLessThanOrEqual(1)
      })
    })

    it('square and triangle grip harder than the circle (higher friction)', () => {
      expect(SHAPES.square.friction).toBeGreaterThan(SHAPES.circle.friction)
      expect(SHAPES.triangle.friction).toBeGreaterThan(SHAPES.circle.friction)
    })

    it('triangle is the grippiest shape (best on the slope)', () => {
      const max = Math.max(...SHAPE_IDS.map((id) => SHAPES[id].friction))
      expect(SHAPES.triangle.friction).toBe(max)
    })
  })

  describe('WHEEL_MASS', () => {
    it('WHEEL_MASS is positive', () => {
      expect(WHEEL_MASS).toBeGreaterThan(0)
    })

    it('WHEEL_MASS is finite', () => {
      expect(Number.isFinite(WHEEL_MASS)).toBe(true)
    })
  })

  describe('Integrity', () => {
    it('each shape id matches its entry in SHAPES', () => {
      SHAPE_IDS.forEach((shapeId) => {
        expect(SHAPES[shapeId].id).toBe(shapeId)
      })
    })

    it('all labelKey values are defined', () => {
      SHAPE_IDS.forEach((shapeId) => {
        expect(SHAPES[shapeId].labelKey).toBeDefined()
        expect(SHAPES[shapeId].labelKey.length).toBeGreaterThan(0)
      })
    })

    it('all colorHex values are valid (non-negative integers)', () => {
      SHAPE_IDS.forEach((shapeId) => {
        const colorHex = SHAPES[shapeId].colorHex
        expect(Number.isInteger(colorHex)).toBe(true)
        expect(colorHex).toBeGreaterThanOrEqual(0)
      })
    })
  })
})
