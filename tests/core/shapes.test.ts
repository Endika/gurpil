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

  describe('Drive modes', () => {
    it('line has driveMode: slide', () => {
      expect(SHAPES.line.driveMode).toBe('slide')
    })

    it('circle, square, triangle have driveMode: roll', () => {
      expect(SHAPES.circle.driveMode).toBe('roll')
      expect(SHAPES.square.driveMode).toBe('roll')
      expect(SHAPES.triangle.driveMode).toBe('roll')
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

    it('line friction is lower than circle friction', () => {
      expect(SHAPES.line.friction).toBeLessThan(SHAPES.circle.friction)
    })

    it('square and triangle friction are >= circle friction', () => {
      expect(SHAPES.square.friction).toBeGreaterThanOrEqual(SHAPES.circle.friction)
      expect(SHAPES.triangle.friction).toBeGreaterThanOrEqual(SHAPES.circle.friction)
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
