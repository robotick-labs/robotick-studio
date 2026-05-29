import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import cesium from "vite-plugin-cesium";
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
  envPrefix: ["VITE_", "CESIUM_"],

  publicDir: "../../public/renderer",
  plugins: [react(), cesium()],

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
    alias: [
      {
        find: /^react\/jsx-dev-runtime$/,
        replacement: resolve(__dirname, "node_modules/react/jsx-dev-runtime.js"),
      },
      {
        find: /^react\/jsx-runtime$/,
        replacement: resolve(__dirname, "node_modules/react/jsx-runtime.js"),
      },
      {
        find: /^react-dom$/,
        replacement: resolve(__dirname, "node_modules/react-dom/index.js"),
      },
      {
        find: /^react$/,
        replacement: resolve(__dirname, "node_modules/react/index.js"),
      },
      {
        find: /^@robotick\/studio-host$/,
        replacement: resolve(
          __dirname,
          "src/renderer/services/plugins/animation-studio-host.ts"
        ),
      },
      {
        find: /^@\//,
        replacement: `${resolve(__dirname, "src/renderer")}/`,
      },
    ],
  },

  server: {
    fs: {
      allow: [
        resolve(__dirname),
        resolve(__dirname, "../robotick-animation"),
      ],
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
