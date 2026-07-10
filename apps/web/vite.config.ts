import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue()],
  build: {
    outDir: "dist",
  },
  server: {
    // Dev-only: proxy API + redirect-canary calls to the Fastify backend so
    // the Vue dev server and the API share an effective origin (D-01 keeps
    // production single-origin via @fastify/static; this proxy mirrors that
    // for local dev where Vite and Fastify run on separate ports).
    proxy: {
      "/api": {
        target: "http://localhost:3000",
        changeOrigin: true,
      },
      "/health": {
        target: "http://localhost:3000",
        changeOrigin: true,
      },
    },
  },
});
