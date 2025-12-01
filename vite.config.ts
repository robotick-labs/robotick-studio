import { defineConfig } from "vite";
import path, { resolve, relative } from "node:path";
import { readdirSync, statSync, existsSync } from "node:fs";

function collectEntries(dir: string, base = dir) {
  const entries: Record<string, string> = {};
  if (!existsSync(dir)) return entries;

  for (const item of readdirSync(dir)) {
    const full = resolve(dir, item);
    const rel = relative(base, full);
    const stat = statSync(full);

    if (stat.isDirectory()) {
      Object.assign(entries, collectEntries(full, base));
      continue;
    }

    if (/\.(js|ts|tsx)$/.test(item)) {
      const key = rel.replace(/\.(js|ts|tsx)$/, "");
      entries[key] = full;
    }
  }

  return entries;
}

const isVitest = Boolean(process.env.VITEST);
const entryPoints = isVitest
  ? {}
  : collectEntries(resolve(__dirname, "src/renderer"));

export default defineConfig({
  base: "./",
  root: "src/renderer",

  publicDir: "../../public/renderer",

  build: {
    outDir: "../../dist/renderer",
    emptyOutDir: true,

    rollupOptions: isVitest
      ? undefined
      : {
          input: {
            ...entryPoints,
            index: resolve(__dirname, "src/renderer/index.html"),
          },
          output: {
            entryFileNames: "js/[name].js",
            chunkFileNames: "js/chunks/[name].js",
            assetFileNames: "assets/[name][extname]",
          },
        },
  },

  resolve: {
    alias: {
      "@": resolve(__dirname, "src/renderer"),
    },
  },

  test: {
    projects: [
      {
        root: resolve(__dirname, "src"),
        test: {
          name: "renderer",
          environment: "jsdom",
          include: ["__tests__/**/*.{test,spec}.{ts,tsx}"],
        },
      },
      {
        root: resolve(__dirname, "src/electron"),
        test: {
          name: "electron",
          environment: "node",
        },
      },
    ],
  },
});
