/**
 * Shape catalog — single source of truth for wheel shapes.
 * No magic values; all friction, restitution, colors, and labels defined here.
 * Pure module: no Three.js, no Rapier imports (used by physics, render, i18n layers).
 */

export type ShapeId = 'circle' | 'line' | 'square' | 'triangle'
export type DriveMode = 'roll' | 'slide'

export interface ShapeDef {
  id: ShapeId
  driveMode: DriveMode // roll = motorized revolute; slide = ski/runner
  friction: number // Rapier collider friction
  restitution: number
  colorHex: number // render tint
  labelKey: string // i18n key
}

/**
 * Fixed wheel mass (same across all shapes to prevent pop/instability on swap).
 * Anti-pop mitigation for Task 8.
 */
export const WHEEL_MASS = 1.0

/**
 * Shape definitions with tuned starting values.
 * - circle: baseline roll with moderate friction
 * - line: ski/runner with low friction (slide mode)
 * - square/triangle: roll with higher friction (grip)
 */
export const SHAPES: Record<ShapeId, ShapeDef> = {
  circle: {
    id: 'circle',
    driveMode: 'roll',
    friction: 0.5,
    restitution: 0.6,
    colorHex: 0xff6b9d, // coral
    labelKey: 'shape.circle',
  },
  line: {
    id: 'line',
    driveMode: 'slide',
    friction: 0.2, // low friction for ski/runner
    restitution: 0.4,
    colorHex: 0x4ecdc4, // teal
    labelKey: 'shape.line',
  },
  square: {
    id: 'square',
    driveMode: 'roll',
    friction: 0.8, // higher friction, grips
    restitution: 0.5,
    colorHex: 0xffe66d, // yellow
    labelKey: 'shape.square',
  },
  triangle: {
    id: 'triangle',
    driveMode: 'roll',
    friction: 0.9, // highest friction, grips most
    restitution: 0.45,
    colorHex: 0x95e1d3, // mint
    labelKey: 'shape.triangle',
  },
}

/**
 * Ordered list of all shape IDs for iteration (UI, physics setup, etc).
 */
export const SHAPE_IDS: readonly ShapeId[] = ['circle', 'line', 'square', 'triangle']
