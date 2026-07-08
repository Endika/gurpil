import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  base: "/gurpil/",
  plugins: [
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["icon-192.png", "icon-512.png"],
      manifest: {
        name: "Gurpil",
        short_name: "Gurpil",
        description: "Arcade 2.5D time-trial: draw your wheel shape and let real physics decide.",
        theme_color: "#1a1a2e",
        background_color: "#0d0d1a",
        display: "standalone",
        orientation: "portrait",
        start_url: "/gurpil/",
        icons: [
          {
            src: "icon-192.png",
            sizes: "192x192",
            type: "image/png",
          },
          {
            src: "icon-512.png",
            sizes: "512x512",
            type: "image/png",
          },
          {
            src: "icon-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,png,webmanifest,woff,woff2}"],
        runtimeCaching: [],
        // The single app bundle (Three.js + Rapier + game) is ~2 MB, just over
        // workbox's 2 MiB default. Raise the precache ceiling to 4 MiB so the
        // main chunk is always precached — required for the game to work fully
        // offline (an offline-first PWA) — with headroom for future growth.
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
      },
    }),
  ],
  build: {
    target: "es2022",
    sourcemap: false,
  },
});
