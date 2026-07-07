/**
 * Shape catalog — single source of truth for wheel shapes.
 * No magic values; all tuning, friction, restitution, colors, and labels here.
 * Pure module: no Three.js, no Rapier imports (used by physics, render, i18n layers).
 *
 * STABLE HYBRID wheel model
 * -------------------------
 * Real polygon-wheel physics failed playtest (wheels wedged / the car flipped
 * over a corner and tumbled). The product-owner's final architecture: the wheel
 * PHYSICS COLLIDER is ALWAYS a stable ball — never a square/triangle/segment —
 * so the car can never flip over a wheel corner and can never get wedged. The
 * drawn shape instead drives:
 *   1. The visual wheel MESH (still square/triangle/line/circle, still spins).
 *   2. Per-shape TUNING params (below) that create real, felt differentiation
 *      while the collider stays a stable ball.
 *
 * Tuning params (per shape):
 *   - wheelRadiusMul: multiplies the base ball radius. A bigger effective radius
 *     rolls over eggs / rough / bumps more easily; a smaller one catches more.
 *   - friction: grip (matters most on the slope / mud / ice).
 *   - speedMul: multiplies the motor target speed (top speed / accel on flat).
 *
 * Target feel:
 *   - circle:   fast & smooth on flat (biggest speedMul, moderate grip, base radius).
 *   - square:   grippy but slower / heavier feel (high grip, low speedMul).
 *   - triangle: grippy / aggressive, good on the slope (highest grip, mid speed).
 *   - line:     LARGE effective radius → best over the eggs / rough, decent
 *               elsewhere (biggest radius, mid grip, mid speed).
 */

export type ShapeId = 'circle' | 'line' | 'square' | 'triangle'

export interface ShapeDef {
  id: ShapeId
  /** Multiplier on the base wheel ball radius (WHEEL_RADIUS). > 0. */
  wheelRadiusMul: number
  /** Multiplier on the motor target speed (top speed / accel). > 0. */
  speedMul: number
  /** Rapier collider friction (grip). >= 0. */
  friction: number
  /** Rapier collider restitution (bounciness). 0..1. */
  restitution: number
  /** Render tint. */
  colorHex: number
  /** i18n key. */
  labelKey: string
}

/**
 * Fixed wheel mass (same across all shapes to prevent pop/instability on swap).
 * The collider is always a ball, so its inertia only varies with radius; pinning
 * mass keeps swap velocity re-assertion trivial and pop-free.
 */
export const WHEEL_MASS = 1.0

/**
 * Shape definitions with tuned starting values (stable-hybrid model).
 *
 * All four use a ball collider; the numbers below are what actually makes them
 * feel different. Values were tuned against the real-engine physics tests so
 * that: every shape drives from a dead stop and reaches the finish; NONE gets
 * stuck; circle is clearly the fastest on flat; line clears the eggs the best.
 */
export const SHAPES: Record<ShapeId, ShapeDef> = {
  circle: {
    id: 'circle',
    wheelRadiusMul: 1.0, // baseline radius (reference)
    speedMul: 1.0, // fastest on flat (reference)
    friction: 0.55, // moderate grip: clears the eggs but slower than the line
    restitution: 0.2,
    colorHex: 0xff6b9d, // coral
    labelKey: 'shape.circle',
  },
  line: {
    id: 'line',
    wheelRadiusMul: 1.25, // largest effective radius → rolls over the eggs the best.
    // Kept ≤ ~1.28 so a live swap FROM the circle changes the ball radius by < the
    // anti-pop position tolerance (see swap.test.ts), keeping the swap contact-neutral.
    speedMul: 0.85, // decent flat speed; combined with the big radius it carries
    // enough momentum to clear the eggs where the smaller shapes struggle
    friction: 0.8, // grip above the circle's so the big-radius line is the clear
    // eggs / rough champion (radius rolls over, grip climbs)
    restitution: 0.15,
    colorHex: 0x4ecdc4, // teal
    labelKey: 'shape.line',
  },
  square: {
    id: 'square',
    wheelRadiusMul: 0.9, // slightly smaller → heavier / catchier feel
    speedMul: 0.64, // clearly slower than the circle on flat (grippy, heavy feel)
    friction: 1.1, // high grip
    restitution: 0.1,
    colorHex: 0xffe66d, // yellow
    labelKey: 'shape.square',
  },
  triangle: {
    id: 'triangle',
    wheelRadiusMul: 1.05, // slightly larger so its grip still clears the eggs
    speedMul: 0.8, // aggressive mid speed
    friction: 1.3, // highest grip — best on the slope
    restitution: 0.1,
    colorHex: 0x95e1d3, // mint
    labelKey: 'shape.triangle',
  },
}

/**
 * Ordered list of all shape IDs for iteration (UI, physics setup, etc).
 */
export const SHAPE_IDS: readonly ShapeId[] = ['circle', 'line', 'square', 'triangle']
