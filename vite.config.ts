import { defineConfig } from "vite";
import { resolve, relative, dirname } from "node:path";
import { readdirSync, statSync } from "node:fs";
import cesium from "vite-plugin-cesium";

function getAllEntryPoints(dir: string, baseDir = dir): Record<string, string> {
  const entries: Record<string, string> = {};

  for (const entry of readdirSync(dir)) {
    const fullPath = resolve(dir, entry);
    const relPath = relative(baseDir, fullPath);
    const stats = statSync(fullPath);

    if (stats.isDirectory()) {
      Object.assign(entries, getAllEntryPoints(fullPath, baseDir));
    } else if (/\.(js|ts|tsx)$/.test(entry)) {
      // Remove extension from output path key
      const key = relPath.replace(/\.(js|ts|tsx)$/, "");
      entries[key] = fullPath;
    }
  }

  return entries;
}

const entryPoints = getAllEntryPoints(resolve(__dirname, "src/js"));

export default defineConfig({
  plugins: [cesium()],
  build: {
    outDir: "dist",
    emptyOutDir: false,
    sourcemap: true,
    chunkSizeWarningLimit: 524288,
    rollupOptions: {
      input: {
        ...entryPoints,
        main: resolve(__dirname, "index.html"),
      },
      output: {
        entryFileNames: "js/[name].js",
        chunkFileNames: "js/chunks/[name].js",
        assetFileNames: "js/assets/[name][extname]",
      },
    },
  },
});
