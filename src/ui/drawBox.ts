/**
 * DrawBox — finger/mouse draw-box UI component.
 *
 * A self-contained DOM component: a container <div> holding a <canvas>.
 * The player draws a wheel shape on the canvas; on stroke-end the stroke is
 * classified via classifyStroke and the resulting ShapeId is forwarded to the
 * provided callback.
 *
 * Design choices:
 * - Pointer Events API (pointerdown/pointermove/pointerup/pointercancel) covers
 *   both touch and mouse in one code path.
 * - Pure helper `strokeToShape` is extracted for unit-testability in node env.
 * - No Three.js / physics imports — only classifyStroke + shapes types + DOM.
 */

import { classifyStroke } from '../core/classifyStroke'
import type { Point } from '../core/classifyStroke'
import { SHAPES } from '../core/shapes'
import type { ShapeId } from '../core/shapes'

// ─── Tunable constants ────────────────────────────────────────────────────────

/** Minimum number of points required to attempt classification. */
const MIN_POINTS = 2

/** Live stroke line width in CSS pixels (scaled by DPR internally). */
const STROKE_WIDTH_PX = 3

/** Feedback flash duration in milliseconds. */
const FEEDBACK_DURATION_MS = 600

/** Recognized-shape label font size as a fraction of the canvas height. */
const FEEDBACK_FONT_SIZE_RATIO = 0.22

/** Default canvas size (square) expressed as a CSS value string. */
const DEFAULT_SIZE_CSS = 'clamp(120px, 30vw, 220px)'

/** Alpha of the background fill on the draw surface (0 = fully transparent). */
const CANVAS_ALPHA = 0.18

/** Stroke colour while drawing. */
const LIVE_STROKE_COLOR = 'rgba(255,255,255,0.9)'

// ─── Public API ───────────────────────────────────────────────────────────────

export interface DrawBox {
  el: HTMLElement
}

/**
 * Create a draw-box component.
 *
 * @param onShape  Called with the classified ShapeId after each valid stroke.
 * @returns        `{ el }` — append `el` to the DOM and position it via CSS.
 */
export function createDrawBox(onShape: (id: ShapeId) => void): DrawBox {
  // ── Container ────────────────────────────────────────────────────────────────
  const container = document.createElement('div')
  container.className = 'draw-box'

  // Inline defaults so the component works without an external stylesheet.
  Object.assign(container.style, {
    width: DEFAULT_SIZE_CSS,
    height: DEFAULT_SIZE_CSS,
    position: 'fixed',
    bottom: '1rem',
    right: '1rem',
    borderRadius: '12px',
    border: '2px solid rgba(255,255,255,0.3)',
    overflow: 'hidden',
    touchAction: 'none', // prevent browser scroll hijack inside the box
    cursor: 'crosshair',
    background: `rgba(0,0,0,${CANVAS_ALPHA})`,
    backdropFilter: 'blur(4px)',
    zIndex: '100',
    boxSizing: 'border-box',
  } satisfies Partial<CSSStyleDeclaration>)

  // ── Canvas ───────────────────────────────────────────────────────────────────
  const canvas = document.createElement('canvas')
  Object.assign(canvas.style, {
    display: 'block',
    width: '100%',
    height: '100%',
  } satisfies Partial<CSSStyleDeclaration>)
  container.appendChild(canvas)

  // ── Backing store sizing (DPR-aware) ─────────────────────────────────────────
  // Read the device pixel ratio at call time (not once at construction) so the
  // canvas stays correct if the window moves to a monitor with a different DPR.
  const currentDpr = (): number => window.devicePixelRatio ?? 1

  function syncCanvasSize(): void {
    const dpr = currentDpr()
    const rect = canvas.getBoundingClientRect()
    const w = Math.round(rect.width * dpr)
    const h = Math.round(rect.height * dpr)
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w
      canvas.height = h
    }
  }

  // Resize observer keeps backing store correct if the container is resized by CSS.
  const resizeObserver = new ResizeObserver(() => {
    syncCanvasSize()
  })
  resizeObserver.observe(container)

  // ── Drawing state ─────────────────────────────────────────────────────────────
  const ctx = canvas.getContext('2d')!
  let points: Point[] = []
  let isDrawing = false
  let feedbackTimer: ReturnType<typeof setTimeout> | null = null

  // ── Coordinate helpers ────────────────────────────────────────────────────────

  /** Convert a clientX/Y to canvas-local pixel coords (DPR-scaled). */
  function clientToCanvas(clientX: number, clientY: number): { cx: number; cy: number } {
    const dpr = currentDpr()
    const rect = canvas.getBoundingClientRect()
    return {
      cx: (clientX - rect.left) * dpr,
      cy: (clientY - rect.top) * dpr,
    }
  }

  /** Convert canvas-local pixel coords to normalized 0..1 box coordinates. */
  function canvasToNorm(cx: number, cy: number): Point {
    return {
      x: cx / canvas.width,
      y: cy / canvas.height,
    }
  }

  // ── Live drawing ──────────────────────────────────────────────────────────────

  function clearCanvas(): void {
    ctx.clearRect(0, 0, canvas.width, canvas.height)
  }

  function drawLiveStroke(): void {
    if (points.length < 2) return
    clearCanvas()
    ctx.save()
    ctx.strokeStyle = LIVE_STROKE_COLOR
    ctx.lineWidth = STROKE_WIDTH_PX * currentDpr()
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.beginPath()
    // Points are normalized 0..1; scale back to canvas pixels for drawing.
    ctx.moveTo(points[0].x * canvas.width, points[0].y * canvas.height)
    for (let i = 1; i < points.length; i++) {
      ctx.lineTo(points[i].x * canvas.width, points[i].y * canvas.height)
    }
    ctx.stroke()
    ctx.restore()
  }

  // ── Feedback ──────────────────────────────────────────────────────────────────

  function showFeedback(id: ShapeId): void {
    // Cancel any in-progress feedback.
    if (feedbackTimer !== null) {
      clearTimeout(feedbackTimer)
      feedbackTimer = null
      container.style.borderColor = 'rgba(255,255,255,0.3)'
    }

    const colorHex = SHAPES[id].colorHex
    const r = (colorHex >> 16) & 0xff
    const g = (colorHex >> 8) & 0xff
    const b = colorHex & 0xff
    const cssColor = `rgb(${r},${g},${b})`

    container.style.borderColor = cssColor

    // Also draw the shape label briefly on the canvas.
    const label = id.toUpperCase()
    ctx.save()
    ctx.font = `bold ${Math.round(canvas.height * FEEDBACK_FONT_SIZE_RATIO)}px sans-serif`
    ctx.fillStyle = cssColor
    ctx.globalAlpha = 0.9
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(label, canvas.width / 2, canvas.height / 2)
    ctx.restore()

    feedbackTimer = setTimeout(() => {
      container.style.borderColor = 'rgba(255,255,255,0.3)'
      clearCanvas()
      feedbackTimer = null
    }, FEEDBACK_DURATION_MS)
  }

  // ── Pointer handlers ──────────────────────────────────────────────────────────

  canvas.addEventListener('pointerdown', (e: PointerEvent) => {
    // Cancel any pending feedback so we start fresh.
    if (feedbackTimer !== null) {
      clearTimeout(feedbackTimer)
      feedbackTimer = null
      container.style.borderColor = 'rgba(255,255,255,0.3)'
    }

    e.preventDefault()
    canvas.setPointerCapture(e.pointerId)
    syncCanvasSize()
    clearCanvas()

    isDrawing = true
    points = []

    const { cx, cy } = clientToCanvas(e.clientX, e.clientY)
    points.push(canvasToNorm(cx, cy))
  })

  canvas.addEventListener('pointermove', (e: PointerEvent) => {
    if (!isDrawing) return
    e.preventDefault()

    const { cx, cy } = clientToCanvas(e.clientX, e.clientY)
    points.push(canvasToNorm(cx, cy))
    drawLiveStroke()
  })

  function endStroke(): void {
    if (!isDrawing) return
    isDrawing = false

    const result = strokeToShape(points)
    clearCanvas()

    if (result !== null) {
      showFeedback(result)
      onShape(result)
    }

    points = []
  }

  canvas.addEventListener('pointerup', (e: PointerEvent) => {
    e.preventDefault()
    endStroke()
  })

  canvas.addEventListener('pointercancel', (e: PointerEvent) => {
    e.preventDefault()
    endStroke()
  })

  return { el: container }
}

// ─── Pure helper (exported for unit tests) ────────────────────────────────────

/**
 * Classify a stroke to a ShapeId, or return null for degenerate strokes.
 *
 * This is extracted from the pointer-handler wiring so it can be exercised in a
 * pure node test environment without any DOM / jsdom dependency.
 *
 * @param points  Normalized 0..1 box coordinates.
 * @returns       ShapeId, or null if the stroke has fewer than MIN_POINTS points.
 */
export function strokeToShape(points: Point[]): ShapeId | null {
  if (points.length < MIN_POINTS) return null
  return classifyStroke(points)
}
