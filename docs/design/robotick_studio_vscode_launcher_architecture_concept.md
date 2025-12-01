# Robotick Unified Studio + VS Code Architecture

## Overview

Robotick is converging on a clean, modern architecture:  
**one Launcher backend**, **two frontends (Studio + VS Code)**, and a **project-file that pins engine and workload versions**.  
This gives Robotick a reproducible, deterministic, developer‑friendly workflow across embedded and desktop platforms.

---

## Core Concepts

### 1. Launcher (Python)

Launcher stays the shared backend, but it needs a repo-aware flow:

- **Lives with Studio.** We embed the Python package inside the robotick-studio repo so `npm install` can set up the React bits plus a local Launcher (pip install + entrypoint wiring). Later the VS Code extension installer can reuse the same hook.
- **CLI + service remain.** `robotick-launcher` still runs `generate → build → deploy → run`, plus `run-profile` and the FastAPI listener (`/query`, `/launcher`, `/launcher/ws/log`). Those stages now resolve repos from the new deps layout.
- **Deterministic deps.** `npm install` (and the VS Code installer) hydrate `.launcher/<project>/deps` for shared repos and keep each model’s `.launcher/<project>/<model>/<target>/deps` for target-only tools.
- **Workload discovery knows repo type.** Only repos tagged `workload_repos` are scanned for `*Workload.cpp`, while aux repos stay quiet unless a workload YAML references them.
- **Contract polish.** MVP goal is “install Studio → get Launcher + pinned deps automatically.” Later we add auth, multi-target telemetry, and richer payloads.

---

### 2. Project File (<robot-name>.project.yaml)

Defines the environment by pinning repos, not raw paths:

- `engine`: repo URL + ref. Launcher syncs it into `.launcher/<project>/deps/engine/<slug>` and exposes headers/libs to builds.
- `workload_repos`: dedicated list for repos that contain workload code. Only these are scanned for metadata and registry generation.
- `shared_repos`: optional extras (assets, helper libs). Launcher fetches them but never parses workloads unless they also appear above.
- Each repo entry can gate platforms so ESP32-only bits stay off desktop machines.
- Target platform + Studio/Launcher prefs remain, but all builds read from the pinned deps tree. Workload YAML keeps pointing to relative paths that resolve within those repos.

Result: clone the robot project, run `npm install`, and everything pins itself deterministically.

---

### 3. Studio (TS/React)

Robotick’s visual cockpit:

- Splitter-based multi-panel layout (Blender-like)
- Telemetry visualisation
- RC controls
- Face/emotion views
- Model graph views
- Simulator integration (e.g., MuJoCoWorkload)
- Automatically starts Launcher when a project opens

Studio is the “robot operator / creative workspace.”

---

### 4. VS Code Extension

Robotick’s developer shell:

- Connects to Launcher for project state
- Access to pinned engine/workload paths
- One-click “Run Engine”
- One-click “Attach Debugger” (no launch.json)
- Code intelligence and diagnostics
- Can embed Studio panels as VS Code webviews

VS Code = coding, debugging, editing.  
Studio = visualisation, control, dashboards.  
Both use the same Launcher as their brain.

---

## Vision

Robotick becomes:

- a unified engine-like robotics environment
- a reproducible project-based workflow
- a dual-interface system (Studio + VS Code)
- powered by a single Launcher backend
- suitable for embedded, desktop, expressive, and research-grade robots

A cohesive ecosystem with clean boundaries and modern developer ergonomics.

---

## TODO (broad strokes)

- **Embed Launcher:** move the Python package into this repo, keep `pip install -e` working, and teach `npm install` to bootstrap a venv + install Launcher deps + expose `robotick-launcher`.
- **Project schema:** reshape `<robot>.project.yaml` to include `engine`, `workload_repos`, and `shared_repos` entries with repo URL/ref/platform filters; migrate generate/build/query paths to the new schema.
- **Repo pinning + cache:** extend the generate step to clone/fetch repos into `.launcher/<project>/deps/<category>/<slug>` with lock metadata and keep per-model `.launcher/<project>/<model>/<target>/deps` for target-only toolchains.
- **Workload metadata:** limit automated scans to `workload_repos`, keep aux repos opt-in, refresh registry generation and ensure CLI + listener endpoints emit the updated metadata.
- **Install flows:** make `npm install` hydrate Python deps, repo cache, and shared tooling; plan the same bootstrap hook for the VS Code extension installer.
- **Launcher service polish:** tighten `/launcher` and `/query` contracts (versioning/auth placeholders), ensure runs respect the new deps layout + multi-target builds, and outline richer telemetry payloads.
- **Docs/UX:** refresh concept + summary docs with the repo schema, deps layout, and installer expectations; add a quickstart (“clone → npm install → robotick-studio”) and capture the future VS Code path.
