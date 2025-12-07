# Robotick Unified Studio + VS Code Architecture

## Overview

Robotick Studio’s pitch is simple: one installation unlocks the entire robotics workflow.

- **A single Launcher backend** powers both Studio and the VS Code extension, keeping operations and development in sync.
- **Two purpose-built frontends** let builders switch seamlessly between creative controls (Studio) and deep code work (VS Code).
- **Repo-pinned project files** guarantee that every clone rehydrates the exact engine + workload stack, across desktop and embedded targets.

Clone the repo, run `npm install`, and the full stack—visual cockpit, editor, launcher, and pinned deps—is ready to fly.

---

## Core Concepts

### 1. Launcher (Python)

Launcher stays the shared backend, now with a repo-aware workflow:

- **Lives with Studio.** The Python package lives in this repo so `npm install` can create `.studio/.venv`, install Launcher locally (no global footprint), and expose `robotick-launcher`. The VS Code installer can reuse the same hook.
- **CLI + service stay.** `robotick-launcher` still drives `generate → build → deploy → run`, plus `run-profile` and the FastAPI listener (`/query`, `/launcher`, `/launcher/ws/log`). These paths now read from the shared deps layout.
- **New `install-deps` stage.** Before `generate`, we can call `robotick-launcher install-deps` to hydrate `.launcher/<project_safe>/.venv-python` using every `python_root`, install the referenced `requirements.txt` files, and emit a lock describing the resulting PYTHONPATH entries. The launcher keeps that venv under the project’s `.launcher` tree by default (`--workspace-dir` overrides when we purposely want a different sandbox), clones the pinned git deps in the same pass, and prints copy/paste `sudo apt-get ...` commands whenever host packages are missing.
- **Deterministic deps.** Studio/VS Code installers only hydrate our tooling; a separate stage (`robotick-launcher install-deps`) syncs the pinned engine/workload/shared repos into `.launcher/<project>/deps/<target>`, while each model keeps `.launcher/<project>/<model>/<target>/deps` for target-only bits.
- System-wide installs are intentionally avoided: Studio/VS Code always run against the linked `.studio/.venv` so the workspace stays self-contained.
- **Lifecycle commands.** First-class commands for `install-deps`, `clean-generated`, `clean-deps`, and `clean-all` replace the current “generate does everything” magic so automation can call exactly what it needs.
- **Workspace-aware.** Studio and Launcher resolve `.studio/.venv`, project discovery, and repo paths relative to whatever directory you start them from, so the tooling can run from any workspace folder (CI, terminals, VS Code, etc.).
- **Workload-aware discovery.** Only repos flagged `workload_repos` are mined for `*Workload.cpp`; auxiliary repos stay silent unless a workload YAML points at them.
- **Contract polish.** Step one is “install Studio → Launcher + deps are ready.” Next we add versioned `/launcher/v1/*` + `/query/v1/*` endpoints, optional auth/CSRF tokens, and richer per-model telemetry payloads for Studio and VS Code.

---

### 2. Project File (<robot-name>.project.yaml)

Defines the environment by pinning repos instead of raw paths:

- `engine`: repo URL + ref. Launcher mirrors it into `.launcher/<project>/deps/<target>/engine/<slug>` and feeds headers/libs into the build graph.
- `workload_repos`: explicit repo list for workloads. Only these feed the auto-generated registry.
- `shared_repos`: optional extras (assets, helper libs). Launcher fetches them but skips workload discovery unless they also appear in `workload_repos`.
- `local_workload_roots`: fallback glob(s) inside the project for experimental workloads before they move into a pinned repo.
- `local_python_roots`: explicit per-project Python entry points (`id`, `path`, optional `requirements`). Launcher resolves them relative to the project file and `install-deps` installs every declared requirements file into `.launcher/<project_safe>/.venv-python`. At runtime we combine that venv’s site-packages with each root path on `PYTHONPATH` so all Python workloads see the same hydrated environment.
- Each repo entry can target specific platforms so ESP32-only bits never land on desktop machines.
- Target platform + Studio/Launcher prefs stay, but every build resolves from the pinned deps tree. Workload YAML keeps referencing relative paths within those repos.

Result: clone the robot repo, run `npm install`, and the pinned world appears deterministically.

---

### 3. Studio (TS/React)

Robotick’s visual cockpit:

- Splitter-based multi-panel layout (Blender-like)
- Telemetry visualisation
- RC controls
- Face/emotion views
- Model graph views
- Simulator integration (e.g., MuJoCoWorkload)
- Automatically starts Launcher from the embedded venv when a project opens

Studio is the “robot operator / creative workspace.”

---

### 4. VS Code Extension

Robotick’s developer shell (basically a cut-down Studio::renderer (React, ts using vite) instance running in VSCode's left side-panel):

MVP:

- Connects to Launcher for project state
- Access to pinned engine/workload paths
- One-click “Run Engine” (reuse LauncherControl (React) from studio "renderer" layer)
- Can embed Studio panels as VS Code webviews (start off with a single panel, showing the studio's "Home" view (for now), with the above as its header)
- One-click “Attach Debugger” (no launch.json)

Beyond MVP:

- Code intelligence and diagnostics
- Allow the VS Code extension to start/stop Launcher independently: add `/launcher/attach|detach` so Studio + VS Code can coordinate ownership, keep Launcher alive while either client is connected, and only stop once all clients have detached.

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

- **Embed Launcher + Studio runtime** _(goal: be able to run the launcher tests inside this repo, auto-start the backend with Studio, and shut it down when Studio exits)._
  - ✅ Move the `robotick-launcher` source tree into this repo (e.g., `tools/launcher/`), copying tests + templates intact.
  - ✅ Update its `pyproject` to use relative paths and keep `pip install -e` working from the Studio workspace.
  - ✅ Wire CLI/dev scripts (and VS Code test discovery) so `pytest tools/robotick-launcher/tests` runs inside the Studio repo and gates changes.
  - ✅ Add thin wrappers (npm scripts, VS Code installer hooks) that call the embedded `robotick-launcher` binary from `.studio/.venv`.
  - ✅ Add an Electron main-process bootstrap that checks for `.studio/.venv`, runs the Launcher service (`robotick-launcher listen`) if not already live, and waits for `/launcher/status`.
  - ✅ Provide a quit hook that stops the Launcher process (unless another UI is still attached).
- **Project Deps Install flows**
  - ✅ Prompt A1: Extend the project schema to support `local_python_roots` (id/path/requirements) and surface that data in the launcher config objects.
  - ✅ Prompt A2: Added the `robotick-launcher install-deps` Typer command that hydrates `.launcher/<project_safe>/.venv-python`, installs each `python_root`’s requirements, and emits `python-roots-lock.json` describing the resulting PYTHONPATH segments.
  - ✅ Prompt A3: `generate` (and the build/deploy/run cascade) now auto-runs `install-deps` whenever a project defines `local_python_roots`, and the run stage reads `python-roots-lock.json` to set `PYTHONPATH` before launching the model; pytest covers the CLI command plus the implicit trigger/lockfile behavior.
  - ✅ Prompt B: Repo pinning/apt discovery moved entirely into `install-deps`; we reuse the YAML-driven dependency graph there, write clones under `.launcher/<project_safe>/<model>/<target>` as before, and surface any missing apt packages with `sudo apt-get` instructions instead of silently shelling out inside `generate`.
- **VS Code Extension MVP**
  - ✅ Baseline extension shell + packaging: `tools/vscode-extension` now builds, packages (`reinstall-vscode-robotick.sh`), registers the activity bar icon, and renders a simple panel; next step is to hydrate it with launcher data.
  - ✅ Panel scaffolding + renderer embed: the extension’s webview now copies `dist/renderer` into the package and loads the Studio renderer’s built bundle so we see the real UI (still using offline data until Launcher hooks arrive).
  - (Removed: VS Code view now runs the same renderer bundle used by Studio/Hub; the webview can consume existing launcher context and panels without bespoke wiring.)
  - ☐ Provide “Attach Debugger” command: register a VS Code command that shells out to `robotick-launcher run-profile … --attach` (or similar) so we can attach without a launch.json.
- **Project schema**
  - Prompt A: Draft a concrete YAML schema for `engine.repo`, `workload_repos`, `shared_repos`, `local_workload_roots`, and `local_python_roots` (types, required fields, platform filters).
  - Prompt B: Add schema validation + helpful error messages inside Launcher when parsing `<robot>.project.yaml`.
  - Prompt C: Update docs/sample projects to the new schema and provide a migration guide.
- **Repo pinning + cache**
  - Prompt A: Implement `robotick-launcher install-deps` repo pinning—resolve repo list, clone/update into `.launcher/<project>/deps/<target>/<category>/<slug>`, record commit SHAs in a lockfile.
  - Prompt B: Teach `install-deps/generate/build/deploy/run` to error out if deps are missing/out-of-date, and optionally auto-run `install-deps`.
  - Prompt C: Keep per-model `.launcher/<project>/<model>/<target>/deps` for target-specific toolchains; document how they relate to the shared cache.
- **Workload metadata**
  - Prompt A: Update workload discovery to scan only `workload_repos` + `local_workload_roots` (both optional).
  - Prompt B: Regenerate the workload registry templates and ensure CLI/listener endpoints return the revised metadata shape.
  - Prompt C: Add tests covering repo-scoped + local-path discovery so regressions are caught.
- **Cleaning story**
  - Prompt A: Implement `clean-generated` (delete `.launcher/<project>/<model>/<target>` build artefacts).
  - Prompt B: Implement `clean-deps` (delete `.launcher/<project>/deps/<target>` + optionally cascade to builds).
  - Prompt C: Implement `clean-all` (call both, plus any temporary lockfiles), and surface them via CLI + Studio buttons.
- **CI Integration**
  - Prompt: Add GitHub Actions integration for both Studio + Launcher (launcher pytest + renderer/electron Vitest suites).
- **Launcher service polish**
  - Prompt A: Version the REST/WebSocket routes (`/launcher/v1/*`, `/query/v1/*`) and include API version headers.
  - Prompt B: Add optional auth (shared secret/token + CSRF cookies) so Studio/VS Code can connect safely.
  - Prompt C: Expand telemetry payloads: structured per-model status, build/run phases, log stream metadata, etc.
  - Prompt D: Confirm `/launcher/run|stop|status` understand the new deps layout and multi-target runs (e.g., `local:ALL` with mixed targets).
- **Docs/UX**
  - Prompt A: Update the concept + summary docs plus README quickstarts to describe the embedded Launcher + install-deps flow.
  - Prompt B: Provide a “clone → npm install → robotick-studio” walkthrough with troubleshooting tips.
  - Prompt C: Document how VS Code discovers the local Launcher, and outline future plans for headless/CI usage.
