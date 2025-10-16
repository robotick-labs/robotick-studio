import { defineConfig } from "vite";
import { resolve } from "node:path";
import cesium from "vite-plugin-cesium";

export default defineConfig({
  plugins: [cesium()],
  build: {
    outDir: "dist",
    emptyOutDir: false,
    sourcemap: true,
    chunkSizeWarningLimit: 524288,
    rollupOptions: {
      input: {
        entry: resolve(__dirname, "src/js/entry.js"),
        viewer: resolve(__dirname, "src/js/elements/viewer/viewer.ts"),
      },
      output: {
        entryFileNames: "js/[name].js",
        chunkFileNames: "js/chunks/[name].js",
        assetFileNames: "js/assets/[name][extname]",
      },
    },
  },
});
