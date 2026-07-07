/**
 * Gurpil — arcade 2.5D time-trial PWA
 * Entry point: initialises Rapier2d physics and a Three.js canvas with a clear
 * color to prove both libraries load. No game logic yet.
 */

import * as THREE from "three";
import RAPIER from "@dimforge/rapier2d-compat";

async function boot(): Promise<void> {
  // Initialise Rapier2d (WASM embedded in the compat bundle — no separate asset)
  await RAPIER.init();

  const canvas = document.getElementById("canvas") as HTMLCanvasElement | null;
  if (!canvas) {
    console.error("[gurpil] #canvas element not found");
    return;
  }

  // Minimal Three.js renderer — clear color only, no scene objects yet
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setClearColor(0x1a1a2e);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(
    60,
    window.innerWidth / window.innerHeight,
    0.1,
    1000,
  );
  camera.position.set(0, 0, 10);

  window.addEventListener("resize", () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  // Render a single frame — no game loop yet
  renderer.render(scene, camera);

  console.log("[gurpil] boot OK — Three.js + Rapier2d loaded");
}

boot();
