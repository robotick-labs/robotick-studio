import { defineConfig } from "vite";
import { resolve, relative } from "node:path";
import { readdirSync, statSync, existsSync } from "node:fs";
import cesium from "vite-plugin-cesium";

function getAllEntryPoints(dir: string, baseDir = dir): Record<string, string> {
  const entries: Record<string, string> = {};

  if (!existsSync(dir)) {
    console.warn(`[vite.config] Skipping missing directory: ${dir}`);
    return entries;
  }

  let dirEntries: string[] = [];
  try {
    dirEntries = readdirSync(dir);
  } catch (err) {
    console.warn(`[vite.config] Failed to read directory: ${dir}`, err);
    return entries;
  }

  for (const entry of dirEntries) {
    const fullPath = resolve(dir, entry);
    const relPath = relative(baseDir, fullPath);

    let stats;
    try {
      stats = statSync(fullPath);
    } catch (err) {
      console.warn(`[vite.config] Failed to stat: ${fullPath}`, err);
      continue;
    }

    if (stats.isDirectory()) {
      Object.assign(entries, getAllEntryPoints(fullPath, baseDir));
    } else if (/\.(js|ts|tsx)$/.test(entry)) {
      const key = relPath.replace(/\.(js|ts|tsx)$/, "");
      entries[key] = fullPath;
    }
  }

  return entries;
}

const jsEntryDir = resolve(__dirname, "src/js");
const entryPoints = getAllEntryPoints(jsEntryDir);

export default defineConfig({
  plugins: [cesium()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: true,
    chunkSizeWarningLimit: 512,
    rollupOptions: {
      input: {
        ...entryPoints,
        main: resolve(__dirname, "index.html"),
      },
      preserveEntrySignatures: "exports-only",
      output: {
        entryFileNames: "js/[name].js",
        chunkFileNames: "js/chunks/[name].js",
        assetFileNames: "js/assets/[name][extname]",
      },
    },
  },
});
