import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";
import { fileURLToPath, URL } from "node:url";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname } from "node:path";

const require = createRequire(import.meta.url);
// the package doesn't export ./package.json; resolve its entry point and look next to it
const mediapipeDir = dirname(require.resolve("@mediapipe/tasks-vision"));
const mediapipeVersion: string = JSON.parse(readFileSync(`${mediapipeDir}/package.json`, "utf8")).version;

const API = process.env.GC_API ?? "http://127.0.0.1:4321";

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "autoUpdate",
      injectRegister: false,
      includeAssets: ["icon.svg", "apple-touch-icon.png"],
      manifest: {
        name: "guitar-coach",
        short_name: "guitar-coach",
        description: "Tu instructor de guitarra: lecciones, metrónomo, afinador y corrección en tiempo real.",
        lang: "es",
        start_url: "/",
        display: "standalone",
        orientation: "portrait",
        background_color: "#161310",
        theme_color: "#161310",
        icons: [
          { src: "icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,woff2,webmanifest}"],
        globIgnores: ["mediapipe/**", "models/**"],
        navigateFallback: "/index.html",
        navigateFallbackDenylist: [/^\/api\//, /^\/ws\//],
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
        runtimeCaching: [
          {
            // MediaPipe wasm + models: large, versioned — cache on first use (or via "Preparar sin conexión")
            urlPattern: ({ url }) => url.pathname.startsWith("/mediapipe/") || url.pathname.startsWith("/models/"),
            handler: "CacheFirst",
            options: { cacheName: "gc-vision", expiration: { maxEntries: 20 }, cacheableResponse: { statuses: [0, 200] } },
          },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
  define: { __MEDIAPIPE_VERSION__: JSON.stringify(mediapipeVersion) },
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  server: {
    port: 5173,
    proxy: {
      "/api": { target: API, changeOrigin: false },
      "/ws": { target: API.replace(/^http/, "ws"), ws: true },
    },
  },
  build: { target: "es2022", chunkSizeWarningLimit: 1500 },
  worker: { format: "es" },
});
