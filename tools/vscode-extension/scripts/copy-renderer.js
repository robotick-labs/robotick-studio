#!/usr/bin/env node
const fs = require("fs");
const path = require("path");

const projectRoot = path.resolve(__dirname, "../../..");
const rendererDist = path.join(projectRoot, "dist", "renderer");
const targetDir = path.resolve(__dirname, "../media/renderer");

if (!fs.existsSync(rendererDist)) {
  console.warn(
    `[robotick-extension] dist/renderer not found at ${rendererDist}. ` +
      "Run `npm run build` from the repo root before packaging the VS Code extension."
  );
  process.exit(0);
}

fs.rmSync(targetDir, { recursive: true, force: true });
fs.mkdirSync(targetDir, { recursive: true });

fs.cpSync(rendererDist, targetDir, { recursive: true });
console.log(
  `[robotick-extension] Copied renderer bundle from ${rendererDist} → ${targetDir}`
);
