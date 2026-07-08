/**
 * Visual themes (biomes) — the SINGLE SOURCE OF TRUTH for every environment
 * color in Gurpil's render layer.
 *
 * Purely visual: a theme only recolors the world (sky, fog, lights, terrain
 * zones, hills, scenery, obstacles). It NEVER touches physics, colliders,
 * course geometry, the camera or gameplay — swapping the theme swaps how a
 * track LOOKS, not how it plays.
 *
 * Pure data module: NO Three.js, NO DOM. Colors are plain hex `number`s
 * (0xRRGGBB); the render layer converts them to THREE.Color / CSS as needed.
 *
 * Determinism: `pickTheme(seed)` uses the same tiny seeded PRNG family as
 * `core/course.ts` (mulberry32) so a given run seed always yields the same
 * theme — no `Math.random`, no `Date`. The game picks the theme from the same
 * seed as the course, so seed → (track + theme) is fully reproducible.
 */

// ─── Public identifiers ─────────────────────────────────────────────────────

export type ThemeId = 'grassland' | 'desert' | 'snow' | 'night' | 'lava'

/** All theme ids, in a stable order (used for deterministic selection). */
export const THEME_IDS: readonly ThemeId[] = ['grassland', 'desert', 'snow', 'night', 'lava']

// ─── Theme shape ────────────────────────────────────────────────────────────

/** Per-zone terrain surface colors, aligned 1:1 with the course terrain zones
 *  (see `terrainColorAt` in render/terrain.ts). */
export interface TerrainColors {
  flat: number
  rocky: number
  uphill: number
  mud: number
  ice: number
  eggs: number
  runOut: number
  // ── Stage-3 terrain-variety features ──
  /** Jump-ramp take-off surface. */
  ramp: number
  /** Water crossing (ford) surface — blue/ice/lava-variant per theme. */
  water: number
  /** Wooden bridge deck. */
  bridge: number
  // ── Stage-4 terrain geometry accents (real geometry over the flat zones) ──
  /** Lighter tint for the water surface's second, subtly-offset ripple layer. */
  waterHighlight: number
  /** Bridge railing (posts + rail bar) — distinct from the deck plank color. */
  bridgeRail: number
  /** Ramp kicker lip / support-strut accent color. */
  rampAccent: number
}

/**
 * A full environment palette. Every color the render layer needs lives here so
 * the render files hold NO hardcoded environment colors of their own — they
 * read a `Theme`. Player-object colors (scooter, rider, sparks) are
 * deliberately NOT themed: the mascot stays the same character across worlds.
 */
export interface Theme {
  id: ThemeId

  // ── Sky ──────────────────────────────────────────────────────────────────
  /** Renderer clear-color fallback (behind the gradient sky). */
  clearColor: number
  /** Vertical gradient sky: color at the top of the dome. */
  skyTop: number
  /** Vertical gradient sky: middle band — a third gradient stop so the sky
   *  reads with more depth than a flat two-color blend (still one cheap
   *  canvas texture, no extra draw calls). */
  skyMid: number
  /** Vertical gradient sky: color at the horizon band. */
  skyHorizon: number

  // ── Atmosphere ─────────────────────────────────────────────────────────────
  /** Linear fog tint (usually matches skyHorizon so distance fades into sky). */
  fog: number
  /**
   * Linear fog's far distance (metres) — how quickly distant scenery fully
   * fades out. Lower = denser/hazier (lava/desert haze); higher = clearer air
   * (snow). The near distance stays a single global constant in scene.ts
   * (tied to the camera's max follow distance, not biome mood) so no theme
   * can accidentally fog the track itself.
   */
  fogFar: number

  // ── Lighting ───────────────────────────────────────────────────────────────
  /** Directional "sun"/"moon" light tint. */
  sunColor: number
  /** Directional light intensity. */
  sunIntensity: number
  /** Hemisphere light sky (upper) color. */
  hemiSky: number
  /** Hemisphere light ground-bounce (lower) color. */
  hemiGround: number
  /** Hemisphere light intensity. */
  hemiIntensity: number

  // ── Ground / terrain ─────────────────────────────────────────────────────
  /** Large continuous ground backdrop plane behind + below the road. */
  groundBackdrop: number
  /** Per-zone terrain surface colors. */
  terrain: TerrainColors
  /**
   * Terrain strip + decorative-feature surface roughness (0..1, PBR). Varies
   * per biome so ground catches light differently — smoother/cooler snow,
   * sandy-matte desert, glow-dulled cooled lava rock — instead of every
   * biome sharing one flat matte finish.
   */
  terrainRoughness: number

  // ── Parallax background hills (near → far, 3 layers) ───────────────────────
  hills: readonly [number, number, number]

  // ── Scenery ────────────────────────────────────────────────────────────────
  /** Distant hazy forest band hues (any length; picked per-instance). */
  forest: readonly number[]
  /** Roadside tree trunk color. */
  trunk: number
  /** Roadside tree foliage hues (any length; picked per-instance). */
  foliage: readonly number[]
  /** Roadside bush hues. */
  bush: readonly number[]
  /** Sky cloud hues. */
  cloud: readonly number[]
  /** Foreground grass tuft color. */
  grass: number
  /** Tiny flower-dot hues scattered in the grass. */
  flower: readonly number[]

  // ── Obstacles (log / rock reskin — cosmetic only) ──────────────────────────
  /** Fallen-log bark color. */
  logBark: number
  /** Fallen-log cut-end color. */
  logEndCap: number
  /** Boulder color. */
  rock: number
}

// ─── The themes ─────────────────────────────────────────────────────────────
//
// grassland is the CURRENT look — every value below matches the constant it
// replaced in scene.ts / terrain.ts / scenery.ts, so grassland renders
// IDENTICALLY to before the theme refactor. The other four are new palettes.

const GRASSLAND: Theme = {
  id: 'grassland',
  clearColor: 0x87ceeb,
  skyTop: 0x5ba8e6,
  skyMid: 0x8cc7ec,
  skyHorizon: 0xd6ecf7,
  fog: 0xd6ecf7,
  fogFar: 320, // fresh, clear air
  sunColor: 0xfff7e0,
  sunIntensity: 1.3,
  hemiSky: 0x87cefa,
  hemiGround: 0x8b6914,
  hemiIntensity: 0.85,
  groundBackdrop: 0x6ba368,
  terrainRoughness: 0.82,
  terrain: {
    flat: 0x5cb85c,
    rocky: 0x8b7355,
    uphill: 0xe67e22,
    mud: 0x795548,
    ice: 0x87ceeb,
    eggs: 0xf39c12,
    runOut: 0x4caf50,
    ramp: 0xc0632a, // warm launch-ramp clay
    water: 0x3a8ec4, // river blue
    bridge: 0x8a5a32, // wooden planks
    waterHighlight: 0x9fe0f2, // pale foam-blue ripple highlight
    bridgeRail: 0x5a3a1e, // darker timber rail/post
    rampAccent: 0xffb347, // hazard-orange kicker lip
  },
  hills: [0x7fb4d8, 0xa6cce0, 0xc4dcec],
  forest: [0x5c7d68, 0x4a6b58, 0x6f8f78, 0x7a9384],
  trunk: 0x6b4226,
  foliage: [0x3f7d3f, 0x2f6b34, 0x4a8f4a],
  bush: [0x5a9a4c, 0x6bab5a, 0x4a8a3e],
  cloud: [0xffffff, 0xf3f6fa],
  grass: 0x6fae4a,
  flower: [0xffd166, 0xff6b81, 0xffffff],
  logBark: 0x6b4226,
  logEndCap: 0x4a2e1a,
  rock: 0x8d8d8d,
}

const DESERT: Theme = {
  id: 'desert',
  clearColor: 0xf4d9a6,
  skyTop: 0xe9b96e,
  skyMid: 0xf3cf93,
  skyHorizon: 0xfbe8c4,
  fog: 0xf5dcae, // slightly warmer/denser than the pale sky horizon — reads as heat haze
  fogFar: 260, // haze pulls the horizon in
  sunColor: 0xfff0cf,
  sunIntensity: 1.45,
  hemiSky: 0xf6d9a0,
  hemiGround: 0xb07a3a,
  hemiIntensity: 0.9,
  groundBackdrop: 0xd9b676,
  terrainRoughness: 0.95, // dry, matte sand — no sheen
  terrain: {
    flat: 0xe0c084,
    rocky: 0xb8905a,
    uphill: 0xd98b45,
    mud: 0x9c6b3a,
    ice: 0xcfe0d0, // salt-flat pale — the "ice" zone reads as cracked salt here
    eggs: 0xe8a84a,
    runOut: 0xd8c48a,
    ramp: 0xc98a4a, // packed-sand kicker
    water: 0x4aa9c4, // desert oasis / waterhole
    bridge: 0x9c6b3c, // sun-bleached timber
    waterHighlight: 0xa8e6f0, // pale turquoise oasis foam
    bridgeRail: 0x6b4322, // weathered dark-wood rail/post
    rampAccent: 0xffd27a, // sun-bleached tan-yellow kicker lip
  },
  hills: [0xcaa46a, 0xdcbe8c, 0xecd6b0],
  forest: [0x9a8552, 0x87754a, 0xa89a66, 0xb0a074], // dry scrub / cacti-green tinge
  trunk: 0x8a5a34,
  foliage: [0x7d8f4a, 0x6b8040, 0x94a256], // dusty sage/cactus green
  bush: [0x9aa35a, 0xa8b06a, 0x8a924c], // dry scrub bushes
  cloud: [0xfff6e6, 0xf3e6cc],
  grass: 0xc2b268,
  flower: [0xff9f5a, 0xffd166, 0xe86a5a],
  logBark: 0x7a4a28,
  logEndCap: 0x5a3418,
  rock: 0xbfa074,
}

const SNOW: Theme = {
  id: 'snow',
  clearColor: 0xdcecf5,
  skyTop: 0x9cc2de,
  skyMid: 0xc3ddec,
  skyHorizon: 0xeaf4fb,
  fog: 0xeaf4fb,
  fogFar: 340, // crisp, bright, clear cold air
  sunColor: 0xeaf2ff,
  sunIntensity: 1.2,
  hemiSky: 0xcfe3f2,
  hemiGround: 0x8fa3b3,
  hemiIntensity: 0.95,
  groundBackdrop: 0xdfeaf2,
  terrainRoughness: 0.68, // snow catches a soft sheen without reading as wet plastic
  terrain: {
    flat: 0xf2f7fb, // fresh snow
    rocky: 0xb9c3cc, // exposed cold rock
    uphill: 0xe4edf4,
    mud: 0x8d9aa6, // slush
    ice: 0xbfe4f2, // glacial blue
    eggs: 0xdbe7f0,
    runOut: 0xf4f9fc,
    ramp: 0xdfeaf2, // packed-snow kicker
    water: 0x6fb8d6, // meltwater / open water
    bridge: 0x7a6047, // dark timber against the snow
    waterHighlight: 0xd8f2fa, // icy white-blue foam ripple
    bridgeRail: 0x4a3a28, // darker timber rail/post
    rampAccent: 0xff6b5a, // warm marker-flag red kicker lip
  },
  hills: [0xb8cfe0, 0xcfe0ec, 0xe3eef6],
  forest: [0x5a6f72, 0x4c6062, 0x6d8083, 0x7c8d8f], // frosted evergreens
  trunk: 0x5a4636,
  foliage: [0x3d5c4a, 0x33503f, 0x4a6a56], // dark snow-dusted fir green
  bush: [0xaebfc8, 0xc3d2da, 0x9fb2bc], // snow-capped shrubs
  cloud: [0xffffff, 0xeef4fa],
  grass: 0xcdd9e0, // frosted sparse tufts
  flower: [0xbfe4f2, 0xffffff, 0xd6e8f2],
  logBark: 0x5a4636,
  logEndCap: 0x3e2f24,
  rock: 0xaeb8c0,
}

const NIGHT: Theme = {
  id: 'night',
  clearColor: 0x10162e,
  skyTop: 0x0a0f24,
  skyMid: 0x161c3c, // deep indigo band gives the night sky a gradient instead of a flat wash
  skyHorizon: 0x24304f,
  fog: 0x1a2340,
  fogFar: 240, // murk swallows distance sooner — moodier without ever fogging the near track
  sunColor: 0xbcd0ff, // cool moonlight
  sunIntensity: 0.7,
  hemiSky: 0x2e3a6e, // slightly richer moonlit-blue sky bounce
  hemiGround: 0x14182c,
  hemiIntensity: 0.5, // dimmer ambient fill — deeper shadows read as genuinely night
  groundBackdrop: 0x1f2a44,
  terrainRoughness: 0.88, // matte — no glare stealing the moonlit mood
  terrain: {
    flat: 0x2e4a3a, // moonlit grass
    rocky: 0x3c3a44,
    uphill: 0x4a3f30,
    mud: 0x2c2530,
    ice: 0x3a5a72, // moonlit ice
    eggs: 0x6a5630,
    runOut: 0x2b4636,
    ramp: 0x4a3f30, // dim earthen kicker
    water: 0x2a4a68, // moonlit water
    bridge: 0x3a2e22, // dark timber
    waterHighlight: 0x6a90b8, // moonlit foam highlight
    bridgeRail: 0x241a12, // near-black rail/post
    rampAccent: 0xbcd0ff, // moonlight-glow kicker lip
  },
  hills: [0x24304f, 0x2c3a5c, 0x36466c],
  forest: [0x1f3040, 0x1a2a38, 0x253848, 0x2c3e4e], // dark silhouetted tree line
  trunk: 0x2e2620,
  foliage: [0x1f3a2c, 0x18301f, 0x264534], // deep shadowed foliage
  bush: [0x223a2c, 0x2a4636, 0x1c3226],
  cloud: [0x3a4870, 0x2e3a5c], // dim night clouds
  grass: 0x2c4636,
  flower: [0xbcd0ff, 0xd0c8ff, 0xffe9a8], // moonlit / glow specks
  logBark: 0x2e2620,
  logEndCap: 0x1c1712,
  rock: 0x3a3a44,
}

const LAVA: Theme = {
  id: 'lava',
  clearColor: 0x2a1414,
  skyTop: 0x1c1012,
  skyMid: 0x3a1a16, // ember-red band between the smoky top and the glowing horizon
  skyHorizon: 0x5a2a1e, // smoky, ember-lit haze
  fog: 0x4a241c,
  fogFar: 200, // thick smoke/ash — the hazy, low-visibility signature of this biome
  sunColor: 0xffb066, // hot orange glow
  sunIntensity: 1.25,
  hemiSky: 0x6a2e1e,
  hemiGround: 0x2a1410,
  hemiIntensity: 0.75, // warmer ambient bounce off the glowing ground
  groundBackdrop: 0x33221e,
  terrainRoughness: 0.8, // cooled matte rock, but not chalky
  terrain: {
    flat: 0x3a2b26, // cooled dark rock
    rocky: 0x2b201d,
    uphill: 0xb5461e, // glowing molten slope
    mud: 0x241a17,
    ice: 0xe0632a, // molten flow (no ice here — reads as lava channel)
    eggs: 0xd96a24,
    runOut: 0x3a2b26,
    ramp: 0xb5461e, // glowing molten kicker
    water: 0xe0632a, // molten lava channel (no water here — reads as lava)
    bridge: 0x2e211c, // charred timber deck
    waterHighlight: 0xffb066, // brighter ember highlight (matches sunColor)
    bridgeRail: 0x1a120e, // near-black charred rail/post
    rampAccent: 0xffe066, // glowing yellow-hot kicker lip
  },
  hills: [0x3a221c, 0x4a2a20, 0x5a3226], // dark volcanic ridges
  forest: [0x2a1c18, 0x241714, 0x33201c, 0x3a2620], // charred tree line
  trunk: 0x241a15,
  foliage: [0x3a2018, 0x2e1912, 0x45261c], // scorched/dead foliage
  bush: [0x33201a, 0x3e2820, 0x2a1a14],
  cloud: [0x5a3a30, 0x4a2c24], // smoke/ash clouds
  grass: 0x4a2c20, // charred stubble
  flower: [0xff7a2a, 0xffb84a, 0xff4a2a], // ember specks
  logBark: 0x241a15,
  logEndCap: 0x140d0a,
  rock: 0x2b201d,
}

/** Every theme, keyed by id. */
export const THEMES: Record<ThemeId, Theme> = {
  grassland: GRASSLAND,
  desert: DESERT,
  snow: SNOW,
  night: NIGHT,
  lava: LAVA,
}

// ─── Deterministic selection ────────────────────────────────────────────────

/**
 * mulberry32: the same tiny deterministic 32-bit PRNG family used in
 * core/course.ts. Same seed → same stream. No Math.random / Date.
 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return function (): number {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Deterministically pick a theme id from a run seed. The same seed always
 * yields the same theme; different seeds spread across all five themes. Uses a
 * dedicated PRNG offset so the choice is independent of the course generator's
 * own PRNG stream (which consumes the same seed for track geometry).
 */
export function pickTheme(seed: number): ThemeId {
  const rng = mulberry32((seed ^ 0x9e3779b9) >>> 0)
  const i = Math.floor(rng() * THEME_IDS.length)
  return THEME_IDS[Math.min(i, THEME_IDS.length - 1)]
}
