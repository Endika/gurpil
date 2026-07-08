/**
 * Synth audio — every sound in Gurpil is generated at runtime from Web Audio
 * oscillators/gain nodes. There are NO audio asset files: this keeps the game
 * a small, fully offline PWA, matching the sibling apps' "no binary assets"
 * bias. Sounds are kept tasteful and subtle — low base volumes, short
 * one-shot cues, a gentle continuous engine hum — never intrusive.
 *
 * Autoplay policy: browsers block audio output until a user gesture. The
 * `AudioContext` is created lazily and (re)resumed from `unlock()`, which the
 * game calls on the player's first draw-box gesture (see src/game/game.ts) —
 * the first reliable gesture in the boot flow.
 *
 * Mute state persists across sessions via `createLocalStorageStore`
 * (src/ui/localStorageStore.ts), the same storage-agnostic pattern used by
 * `src/core/records.ts` — falls back to an in-memory flag if storage is
 * unavailable, never throws.
 *
 * Pure mapping helpers (`engineFreq`, `engineGain`, `finishNotes`) are
 * exported separately from the stateful engine so they're unit-testable
 * without an `AudioContext` (unavailable in the Node test environment).
 */

import type { Medal } from '../core/medal'
import { createLocalStorageStore } from '../ui/localStorageStore'

// ─── Persistence ────────────────────────────────────────────────────────────

const MUTE_STORAGE_KEY = 'gurpil.audio.muted'

// ─── Engine hum (continuous, speed-driven) ─────────────────────────────────

/** Oscillator waveform for the engine hum — buzzy but not harsh. */
const ENGINE_OSCILLATOR_TYPE: OscillatorType = 'sawtooth'

/** Engine pitch (Hz) at a standstill (speedFraction = 0). */
const ENGINE_BASE_FREQ_HZ = 55

/** Engine pitch (Hz) at full speed (speedFraction = 1). */
const ENGINE_MAX_FREQ_HZ = 190

/** Engine loudness at a standstill — near-silent, just a hint of idle rumble. */
const ENGINE_BASE_GAIN = 0.012

/** Engine loudness at full speed — still subtle, never a lead sound. */
const ENGINE_MAX_GAIN = 0.055

/** A second oscillator one octave below the main tone, for a fuller hum. */
const ENGINE_SUB_FREQ_RATIO = 0.5

/** The sub-oscillator is quieter than the main tone. */
const ENGINE_SUB_GAIN_RATIO = 0.6

/**
 * Time constant (seconds) used to smooth frequency/gain changes every frame.
 * Without smoothing, per-frame `setEngine` calls would produce audible
 * clicks/steps as values jump discontinuously.
 */
const ENGINE_SMOOTHING_SECONDS = 0.12

// ─── Shape-swap blip ────────────────────────────────────────────────────────

const BLIP_OSCILLATOR_TYPE: OscillatorType = 'sine'
const BLIP_FREQ_HZ = 880
const BLIP_DURATION_SECONDS = 0.09
const BLIP_GAIN = 0.09

// ─── Finish jingle ──────────────────────────────────────────────────────────

const FINISH_OSCILLATOR_TYPE: OscillatorType = 'triangle'
const FINISH_NOTE_DURATION_SECONDS = 0.12
const FINISH_NOTE_GAP_SECONDS = 0.09
const FINISH_GAIN = 0.08

// Named musical pitches (Hz, equal temperament) used to build the arpeggios.
const NOTE_A3 = 220.0
const NOTE_G3 = 196.0
const NOTE_C4 = 261.63
const NOTE_E4 = 329.63
const NOTE_G4 = 392.0
const NOTE_C5 = 523.25
const NOTE_E5 = 659.25
const NOTE_G5 = 783.99
const NOTE_C6 = 1046.5

/**
 * Per-medal arpeggio, brightest/longest for gold down to a short, low,
 * descending phrase for no medal. Pure data — exported for unit tests.
 */
const FINISH_NOTES: Record<Medal, readonly number[]> = {
  gold: [NOTE_C5, NOTE_E5, NOTE_G5, NOTE_C6],
  silver: [NOTE_C5, NOTE_E5, NOTE_G5],
  bronze: [NOTE_C4, NOTE_E4, NOTE_G4],
  none: [NOTE_A3, NOTE_G3],
}

// ─── One-shot tone envelope ─────────────────────────────────────────────────

/** Fade-in time for one-shot tones (blip/jingle notes) — avoids a click. */
const TONE_ATTACK_SECONDS = 0.01

/** Extra tail after the requested duration before the oscillator is stopped,
 *  giving the exponential release ramp room to reach silence. */
const TONE_RELEASE_TAIL_SECONDS = 0.05

/** Floor gain for exponential ramps (`exponentialRampToValueAtTime` cannot
 *  target exactly 0). */
const TONE_RELEASE_FLOOR = 0.0001

// ─── Pure mapping helpers (exported for unit tests) ────────────────────────

/** Clamp a fraction to the 0..1 range. Pure. */
function clamp01(fraction: number): number {
  if (fraction < 0) return 0
  if (fraction > 1) return 1
  return fraction
}

/**
 * Engine hum pitch (Hz) for a normalized speed fraction (0..1, see
 * `src/ui/hud.ts`'s `speedFraction`). Monotonic, bounded, clamps
 * out-of-range input. Pure — no AudioContext needed.
 */
export function engineFreq(speedFraction: number): number {
  const f = clamp01(speedFraction)
  return ENGINE_BASE_FREQ_HZ + f * (ENGINE_MAX_FREQ_HZ - ENGINE_BASE_FREQ_HZ)
}

/**
 * Engine hum loudness (linear gain) for a normalized speed fraction (0..1).
 * Monotonic, bounded, clamps out-of-range input. Pure — no AudioContext needed.
 */
export function engineGain(speedFraction: number): number {
  const f = clamp01(speedFraction)
  return ENGINE_BASE_GAIN + f * (ENGINE_MAX_GAIN - ENGINE_BASE_GAIN)
}

/** The arpeggio (note frequencies, Hz) played for a given medal. Pure. */
export function finishNotes(medal: Medal): readonly number[] {
  return FINISH_NOTES[medal]
}

// ─── Mute persistence (storage-agnostic, never throws) ─────────────────────

function readMuted(): boolean {
  try {
    return createLocalStorageStore().get(MUTE_STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

function writeMuted(muted: boolean): void {
  try {
    createLocalStorageStore().set(MUTE_STORAGE_KEY, muted ? '1' : '0')
  } catch {
    // Storage unavailable — mute choice just won't survive a reload.
  }
}

// ─── AudioContext resolution (guards environments without Web Audio) ──────

interface WindowWithWebkitAudio {
  AudioContext?: typeof AudioContext
  webkitAudioContext?: typeof AudioContext
}

function resolveAudioContextCtor(): typeof AudioContext | undefined {
  if (typeof window !== 'object' || window === null) return undefined
  const w = window as unknown as WindowWithWebkitAudio
  return w.AudioContext ?? w.webkitAudioContext
}

// ─── Public API ─────────────────────────────────────────────────────────────

export interface Audio {
  /** Lazily create/resume the AudioContext. MUST be called from a user
   *  gesture — browsers block audio output before that. Safe to call
   *  repeatedly (no-ops once unlocked). */
  unlock(): void
  /** Update the continuous engine hum from a normalized speed fraction (0..1,
   *  see `speedFraction` in src/ui/hud.ts). Call every frame; smoothed
   *  internally so per-frame updates never click. */
  setEngine(speedFraction: number): void
  /** Play a short pleasant blip for a shape swap. */
  blip(): void
  /** Play a short arpeggio jingle graded by the earned medal. */
  finish(medal: Medal): void
  /** Mute/unmute all output; persists the choice. */
  setMuted(muted: boolean): void
  /** Whether audio is currently muted. */
  isMuted(): boolean
}

interface EngineNodes {
  osc: OscillatorNode
  sub: OscillatorNode
  gain: GainNode
  subGain: GainNode
}

/**
 * Play a single enveloped tone (attack → sustain → exponential release) on
 * `context`, starting `startOffsetSeconds` from now. Self-contained — creates
 * and tears down its own oscillator/gain nodes.
 */
function playTone(
  context: AudioContext,
  freqHz: number,
  durationSeconds: number,
  peakGain: number,
  type: OscillatorType,
  startOffsetSeconds: number,
): void {
  const startAt = context.currentTime + startOffsetSeconds
  const osc = context.createOscillator()
  osc.type = type
  osc.frequency.value = freqHz

  const gain = context.createGain()
  gain.gain.setValueAtTime(0, startAt)
  gain.gain.linearRampToValueAtTime(peakGain, startAt + TONE_ATTACK_SECONDS)
  gain.gain.exponentialRampToValueAtTime(TONE_RELEASE_FLOOR, startAt + durationSeconds)

  osc.connect(gain)
  gain.connect(context.destination)
  osc.start(startAt)
  osc.stop(startAt + durationSeconds + TONE_RELEASE_TAIL_SECONDS)
}

/**
 * Create the game's audio engine. Safe to construct even where Web Audio is
 * unavailable (SSR, unsupported browser, headless tests) — every method
 * becomes a graceful no-op in that case.
 */
export function createAudio(): Audio {
  let muted = readMuted()
  let ctx: AudioContext | null = null
  let engineNodes: EngineNodes | null = null
  let lastSpeedFraction = 0

  function ensureContext(): AudioContext | null {
    if (ctx !== null) return ctx
    const Ctor = resolveAudioContextCtor()
    if (Ctor === undefined) return null
    ctx = new Ctor()
    return ctx
  }

  function ensureEngineNodes(context: AudioContext): EngineNodes {
    if (engineNodes !== null) return engineNodes

    const osc = context.createOscillator()
    osc.type = ENGINE_OSCILLATOR_TYPE
    osc.frequency.value = ENGINE_BASE_FREQ_HZ
    const gain = context.createGain()
    gain.gain.value = 0
    osc.connect(gain)
    gain.connect(context.destination)
    osc.start()

    const sub = context.createOscillator()
    sub.type = ENGINE_OSCILLATOR_TYPE
    sub.frequency.value = ENGINE_BASE_FREQ_HZ * ENGINE_SUB_FREQ_RATIO
    const subGain = context.createGain()
    subGain.gain.value = 0
    sub.connect(subGain)
    subGain.connect(context.destination)
    sub.start()

    engineNodes = { osc, sub, gain, subGain }
    return engineNodes
  }

  /** Apply the current mute + last-known speed to the (already running)
   *  engine hum, without waiting for the next `setEngine` frame call. */
  function applyEngineGain(): void {
    if (ctx === null || engineNodes === null) return
    const now = ctx.currentTime
    const targetGain = muted ? 0 : engineGain(lastSpeedFraction)
    engineNodes.gain.gain.setTargetAtTime(targetGain, now, ENGINE_SMOOTHING_SECONDS)
    engineNodes.subGain.gain.setTargetAtTime(
      targetGain * ENGINE_SUB_GAIN_RATIO,
      now,
      ENGINE_SMOOTHING_SECONDS,
    )
  }

  return {
    unlock(): void {
      const context = ensureContext()
      if (context === null) return
      if (context.state === 'suspended') {
        context.resume().catch(() => {
          // Resume can reject (e.g. no gesture yet) — next unlock() retries.
        })
      }
      ensureEngineNodes(context)
      applyEngineGain()
    },
    setEngine(speedFraction: number): void {
      lastSpeedFraction = speedFraction
      if (ctx === null || engineNodes === null) return
      const now = ctx.currentTime
      const freq = engineFreq(speedFraction)
      engineNodes.osc.frequency.setTargetAtTime(freq, now, ENGINE_SMOOTHING_SECONDS)
      engineNodes.sub.frequency.setTargetAtTime(
        freq * ENGINE_SUB_FREQ_RATIO,
        now,
        ENGINE_SMOOTHING_SECONDS,
      )
      applyEngineGain()
    },
    blip(): void {
      if (muted || ctx === null) return
      playTone(ctx, BLIP_FREQ_HZ, BLIP_DURATION_SECONDS, BLIP_GAIN, BLIP_OSCILLATOR_TYPE, 0)
    },
    finish(medal: Medal): void {
      if (muted || ctx === null) return
      const context = ctx
      finishNotes(medal).forEach((freqHz, i) => {
        const startOffset = i * (FINISH_NOTE_DURATION_SECONDS + FINISH_NOTE_GAP_SECONDS)
        playTone(
          context,
          freqHz,
          FINISH_NOTE_DURATION_SECONDS,
          FINISH_GAIN,
          FINISH_OSCILLATOR_TYPE,
          startOffset,
        )
      })
    },
    setMuted(nextMuted: boolean): void {
      muted = nextMuted
      writeMuted(muted)
      applyEngineGain()
    },
    isMuted(): boolean {
      return muted
    },
  }
}
