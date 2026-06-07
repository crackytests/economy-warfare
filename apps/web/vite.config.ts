import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

/**
 * Vite config for the Economy Warfare web client.
 *
 * - `@ew/shared` / `@ew/engine` resolve to their TS source via aliases so we get
 *   live types without a separate build step (they are workspace packages whose
 *   package.json `main` already points at src, but the alias keeps HMR snappy).
 * - `base: "./"` makes the built bundle path-relative so it can be served from
 *   any sub-path (e.g. https://owner.example/play) when embedded in an iframe.
 */
export default defineConfig({
  plugins: [react()],
  base: "./",
  resolve: {
    alias: {
      "@ew/shared/ownership": fileURLToPath(
        new URL("../../packages/shared/src/ownership.ts", import.meta.url),
      ),
      "@ew/shared": fileURLToPath(
        new URL("../../packages/shared/src/index.ts", import.meta.url),
      ),
      "@ew/engine": fileURLToPath(
        new URL("../../packages/engine/src/index.ts", import.meta.url),
      ),
    },
  },
  server: {
    port: 5173,
  },
  build: {
    outDir: "dist",
    sourcemap: true,
  },
});
