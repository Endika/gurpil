# Gurpil

Offline 3D arcade time-trial: draw your wheel shape mid-race and let real physics decide.

**[Try it now →](https://endika.github.io/gurpil/)**

Gurpil ("wheel" in Basque) is a tiny arcade racer with a twist: your car's wheel isn't
fixed. Sketch a shape on screen — a circle, a square, a triangle, or a line — and a real
2D physics engine turns that stroke into the actual collider your car rolls on. Terrain
changes mid-run (flat, rocky, uphill, mud, ice, and egg patches that jam the wrong shape),
so the fastest players swap their wheel on the fly to survive each stretch and beat the
clock.

## How to play

1. Watch the terrain ahead and draw a shape with your finger or mouse: a circle rolls
   fastest on flat ground, a square grips rocky terrain, a triangle claws up hills, and a
   line slides across ice.
2. Your stroke is classified into one of the four fixed shapes and swapped onto the car
   live — no reset, no stopping.
3. Cross the finish line as fast as you can. Picking the wrong shape for the terrain (or
   hitting an egg patch with a mismatched wheel) costs you time.

Fully offline once loaded — installable as a PWA, no network required to play. Available
in English, Spanish, Basque, and French.

## Development

```bash
npm install
npm run dev        # local dev server
npm run build      # production build (dist/)
npm run preview    # serve the production build
npm run lint       # ESLint (0 warnings allowed)
npm run typecheck  # TypeScript strict check (no emit)
npm run test       # Vitest unit + integration tests
```

## Tech stack

- TypeScript (strict), vanilla — no UI framework
- [Three.js](https://threejs.org/) for 3D rendering
- [Rapier](https://rapier.rs/) (`@dimforge/rapier2d-compat`) for 2D physics — the wheel
  shape you draw becomes a real collider
- Vite + `vite-plugin-pwa` (offline service worker, installable manifest)
- Vitest for tests

## Architecture

```
src/
├── core/     pure game logic — shape classification, course/terrain data, run state
├── physics/  Rapier world setup and stepping
├── render/   Three.js scene, camera, meshes
├── game/     glue: game loop wiring core + physics + render
├── ui/       HUD, overlays, input capture
└── locales/  en/es/eu/fr message tables
```

## License

MIT
