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
      },
    }),
  ],
  build: {
    target: "es2022",
    sourcemap: false,
  },
});
