import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  base: "/review/",
  server: {
    port: 5174,
    proxy: {
      "/api": {
        target: "http://localhost:7672",
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
  resolve: {
    alias: {
      // pr-provider uses node:child_process — stub it out for the browser
      "node:child_process": new URL("./src/stubs/child_process.ts", import.meta.url).pathname,
    },
  },
});
