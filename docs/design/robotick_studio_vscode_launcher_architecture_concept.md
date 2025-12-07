# Robotick Unified Studio + VS Code Architecture

## Overview

Robotick Studio’s pitch is simple: each robot repo unlocks the entire robotics workflow—no separate Studio installer, no global tooling.

- **A single Launcher backend** powers both Studio and the VS Code extension, keeping operations and development in sync.
- **Two purpose-built frontends** let builders switch seamlessly between creative controls (Studio) and deep code work (VS Code).
- **Repo-pinned project files** (including tooling pins) guarantee that every clone rehydrates the exact Studio/Launcher, engine, and workload stack across desktop and embedded targets.
- **Per-project bootstrap scripts** live alongside each `<robot>.project.yaml` (e.g., `MyRobot.setup.sh`), with optional repo-root wrappers for convenience, so onboarding is always “clone that repo → run the project’s `*.setup.sh` script → `./studio.sh`,” regardless of which versions the project pinned.

Clone the robot’s repo, run its bootstrap script, and the full stack—visual cockpit, editor, launcher, and pinned deps—is ready to fly. No global system install is required; every robot carries the toolchain it expects so demos, field robots, and CI runners remain deterministic.

---

## Core Concepts

### 1. Launcher (Python)

Launcher stays the shared backend, now with a repo-aware workflow that travels with each robot repository:

- **Lives with Studio, pinned per robot.** Each robot repo declares which `robotick-studio` repo/ref (“tooling”) it needs; its bootstrapper clones that ref into `.launcher/<project>/deps/tooling/<version>`, runs `npm install`, and exposes helper shims (`./studio.sh`, `./launcher.sh`). Multiple robots can sit side-by-side, each running the version they pinned without touching global state.
- **CLI + service stay.** `robotick-launcher` still drives `generate → build → deploy → run`, plus `run-profile` and the FastAPI listener (`/query`, `/launcher`, `/launcher/ws/log`). These paths now read from the shared deps layout.
- **New `install-deps` stage.** Before `generate`, we can call `robotick-launcher install-deps` to hydrate `.launcher/<project_safe>/.venv-python` using every `python_root`, install the referenced `requirements.txt` files, and emit a lock describing the resulting PYTHONPATH entries. The launcher keeps that venv under the project’s `.launcher` tree by default (`--workspace-dir` overrides when we purposely want a different sandbox), clones the pinned git deps in the same pass, and prints copy/paste `sudo apt-get ...` commands whenever host packages are missing.
- **Deterministic deps.** Studio/VS Code installers only hydrate our tooling; a separate stage (`robotick-launcher install-deps`) syncs the pinned engine/workload/shared repos into `.launcher/<project>/deps/runtime/<target>`, while each model keeps `.launcher/<project>/<model>/<target>/deps` for target-only bits. Today we hydrate a fresh checkout per target; future work will layer in smarter per-project sharing (e.g., engine/workload repos reused across `linux` + `esp32` builds).
- System-wide installs are intentionally avoided: Studio/VS Code always run against the linked `.studio/.venv` so the workspace stays self-contained.
- **Lifecycle commands.** First-class commands for `install-deps`, `clean-generated`, `clean-deps`, and `clean-all` replace the current “generate does everything” magic so automation can call exactly what it needs.
- **Workspace-aware.** Studio and Launcher resolve `.studio/.venv`, project discovery, and repo paths relative to whatever directory you start them from, so the tooling can run from any workspace folder (CI, terminals, VS Code, etc.).
- **Workload-aware discovery.** Only repos flagged `workload_repos` are mined for `*Workload.cpp`; auxiliary repos stay silent unless a workload YAML points at them.
- **Contract polish.** Step one is “install Studio → Launcher + deps are ready.” Next we add versioned `/launcher/v1/*` + `/query/v1/*` endpoints, optional auth/CSRF tokens, and richer per-model telemetry payloads for Studio and VS Code.

---

### 2. Project File (<robot-name>.project.yaml)

Defines the environment by pinning repos instead of raw paths. The schema groups runtime bits together so everything the launcher needs to hydrate sits under one section:

- `runtime.engine`: repo URL + ref. Launcher mirrors it into `.launcher/<project>/deps/runtime/<target>/engine/<slug>` and feeds headers/libs into the build graph.
- `runtime.workload_repos`: explicit repo list for workloads. Only these feed the auto-generated registry.
- `runtime.shared_repos`: optional extras (assets, helper libs). Launcher fetches them but skips workload discovery unless they also appear in `workload_repos`.
- `runtime.local_workload_roots`: fallback glob(s) inside the project for experimental workloads before they move into a pinned repo.
- `runtime.local_python_roots`: explicit per-project Python entry points (`id`, `path`, optional `requirements`). Launcher resolves them relative to the project file and `install-deps` installs every declared requirements file into `.launcher/<project_safe>/.venv-python`. At runtime we combine that venv’s site-packages with each root path on `PYTHONPATH` so all Python workloads see the same hydrated environment.
- Each repo entry can target specific platforms so ESP32-only bits never land on desktop machines.
- Target platform + Studio/Launcher prefs stay, but every build resolves from the pinned deps tree. Workload YAML keeps referencing relative paths within those repos.

The launcher writes tooling into `.launcher/<project>/deps/tooling/<version>` and runtime repos into `.launcher/<project>/deps/runtime/<target>/<category>/<slug>`. Engine/workload/shared repos are cloned once per target today, but the next revision teaches `install-deps` to automatically cache obvious shared repos (engine source, workload packs, shared assets) per project—hydrating them under a `shared` directory and linking them into each target tree—so we avoid duplicate checkouts without losing determinism.

Result: clone the robot repo, run `./scripts/bootstrap.sh` (or platform equivalent), and the pinned world appears deterministically—toolchain included. A single monorepo can host multiple `<robot>.project.yaml` files, each with its own tooling pins, engine/workload graph, and bootstrap script; Studio simply loads the project file you select and hydrates the matching version set.

#### Tooling Pins

The project file now embeds a `tooling` section (e.g., `robotick.repo`, `robotick.ref`) covering both Studio + Launcher (since they share the same repository). The bootstrapper reads those pins, clones this repo at the desired commits into `.launcher/<project>/deps/tooling/<version>`, runs `npm install`, hydrates `.studio/.venv`, and exposes helper entry points (thin wrappers like `./run-studio.sh` + `./run-launcher.sh` that exec the pinned binaries from `.launcher/<project>/deps/tooling/<version>`). Contributors can override the pin temporarily via `ROBOTICK_TOOLING_OVERRIDE`, but the default experience is “use exactly the toolchain the repo committed.”

Example (abridged) `my-robot.project.yaml`:

```yaml
name: My Robot
tooling:
  robotick:
    repo: https://github.com/robotick/robotick-studio.git
    ref: v0.9.1
  bootstrap: ./robots/my-robot.setup.sh
runtime:
  engine:
    repo: https://github.com/robotick/robotick-engine.git
    ref: 1c2d3e4
  workload_repos:
    - repo: https://github.com/robotick/my-robot-workloads.git
      ref: my-robot-2024-06
  shared_repos:
    - repo: https://github.com/robotick/shared-assets.git
      ref: main
  local_python_roots:
    - id: my-robot-vision
      path: workloads/vision
      requirements: workloads/vision/requirements.txt
```

Multiple project files can live side-by-side inside the same repo, each with its own `tooling` pins and bootstrap path.

Our first in-repo pilot is `robots/pip-e/pip-e.project.yaml` inside `robotick-knitware`. We’ll refactor that project to the new schema/bootstrapping flow, validate the tooling/runtime layout end-to-end, and only then roll the pattern out to the other robots once everything feels solid.

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
Both use the same pinned Launcher as their brain, fetched from the project’s tooling bundle.

---

### 5. Tooling Bootstrap & Distribution

We intentionally skip a global Studio/Launcher installer. Instead, every robot repo ships a tiny, self-contained bootstrapper per project (e.g., `MyRobot.project.yaml` paired with `MyRobot.setup.sh`, plus optional repo-root dispatcher scripts). That script lives alongside the project file, uses only POSIX shell + git/python stdlib (no launcher imports), and carries everything needed to hydrate the tooling bundle before Launcher ever runs. It can:

- **Run an existing robot.** `git clone robot-repo && cd robot-repo && ./robots/MyRobot.setup.sh` reads that project file’s `tooling` section, clones the pinned Studio/Launcher refs into `.launcher/<project>/deps/tooling/<version>`, runs `npm install`, installs the VS Code extension locally, and calls `robotick-launcher install-deps`. The generated `./run-studio.sh` script launches the bundled Studio which auto-attaches to the project-scoped launcher service.
- **Create a new robot.** A template (or `create-robotick-project`) scaffolds `<robot>.project.yaml`, writes default tooling pins, and hydrates the tooling folder under `.launcher/<project>/deps/tooling`. Developers tweak repo lists, rerun the bootstrap to hydrate runtime deps, and commit the updated project file alongside their code.
- **Host cloud demos.** The AWS-deployed Hub clones a curated robot repo, runs the same bootstrapper for the relevant project, and serves the Studio renderer in a browser while keeping the pinned launcher service alive in the same deployment. Each hosted robot keeps its own tooling pins and `.launcher/<project>/deps/tooling` tree, so multiple demos can coexist without version conflicts.

Because tooling lives next to each project, CI can cache `.launcher/<project>/deps/tooling/<version>` directories keyed by the project file’s tooling hash, and developers hopping between robots can optionally point `ROBOTICK_TOOLING_CACHE` at a shared directory to reduce downloads.

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
- **Pip-E pilot (robotick-knitware/robots/pip-e/pip-e.project.yaml)** _(goal: make the new schema/bootstrapping real in the first robot repo before touching anything else)._
  - ☐ Draft and validate the new project schema sections (`tooling`, `runtime.engine/workload/shared`, etc.), expose them in launcher config objects, and add parser/validation tests.
  - ☐ Teach the per-project bootstrap scripts to read the `tooling` section, hydrate the pinned repo into `.launcher/<project>/deps/tooling/<version>`, run `npm install`, and emit helper shims (`run-studio.sh`, `run-launcher.sh`) before `install-deps` ever runs—cover with bootstrap tests.
  - ☐ Extend runtime repo pinning so pip-e’s `runtime.engine/workload/shared` entries hydrate via `.launcher/<project>/deps/runtime/<target>` (no git submodules); confirm the CLI understands the new layout—add installer tests + run suite.
  - ☐ Port `robotick-knitware/robots/pip-e/pip-e.project.yaml` to the new schema, add its `pip-e.setup.sh`, and verify `./robots/pip-e/pip-e.setup.sh && ./run-studio.sh` works end-to-end—capture with integration tests.
  - ☐ Remove the legacy git submodules under `robotick-knitware/robotick` once the project file pins those repos, so the repo relies entirely on `install-deps`—add regression tests ensuring submodules aren’t required.
  - ☐ Add/extend unit + integration tests covering the new schema/bootstrap behavior and run the launcher + renderer test suites before landing (final verification gate for the pilot).
  - ☐ Document the pip-e migration (what changed, how to roll forward/back) so other robots can follow once the pilot is stable—include any doc lint/tests.
- **Project Tooling + Deps flows**
  - ✅ Extend the project schema to support `local_python_roots` (id/path/requirements) and surface that data in the launcher config objects.
  - ✅ Added the `robotick-launcher install-deps` Typer command that hydrates `.launcher/<project_safe>/.venv-python`, installs each `python_root`’s requirements, and emits `python-roots-lock.json` describing the resulting PYTHONPATH segments.
  - ✅ `generate` (and the build/deploy/run cascade) now auto-runs `install-deps` whenever a project defines `local_python_roots`, and the run stage reads `python-roots-lock.json` to set `PYTHONPATH` before launching the model; pytest covers the CLI command plus the implicit trigger/lockfile behavior.
  - ✅ Repo pinning/apt discovery moved entirely into `install-deps`; we reuse the YAML-driven dependency graph there, write clones under `.launcher/<project_safe>/<model>/<target>` as before, and surface any missing apt packages with `sudo apt-get` instructions instead of silently shelling out inside `generate`.
- **Project schema**
  - ☐ Add schema-level unit tests and run the launcher test suite whenever the schema changes (standing reminder, even after the pilot).
- **Repo pinning + cache**
  - Implement `robotick-launcher install-deps` repo pinning—resolve repo list, clone/update into `.launcher/<project>/deps/runtime/<target>/<category>/<slug>`, record commit SHAs in a lockfile—add installer tests for lockwrite/reads.
  - Teach `install-deps/generate/build/deploy/run` to error out if deps are missing/out-of-date, and optionally auto-run `install-deps`—add regression tests that assert failures/success paths.
  - Document how `.launcher/<project>/deps/runtime/*` (shared cache) relates to `.launcher/<project>/<model>/<target>/deps` build artefacts so users know where each stage writes—include doc tests/examples.
  - ☐ Add tooling cache management (shared `.tooling-cache/<version>` dirs, pruning policies) so multiple robots reuse hydrated Studio/Launcher builds across workspaces and CI—write cache tests + run pytest.
  - ☐ Introduce a per-project runtime cache (e.g., `.launcher/<project>/deps/runtime/shared`) so target-agnostic repos (engine, workload packs, shared assets) clone once and link into each target folder, starting with engine/workload/shared repos in the upcoming release—cover with integration tests.
  - ☐ Cover the caching + pinning flows with unit/integration tests and run the full `pytest` suite before shipping (final reminder).
- **Workload metadata**
  - Update workload discovery to scan only `workload_repos` + `local_workload_roots` (both optional)—add discovery tests for both cases.
  - Regenerate the workload registry templates and ensure CLI/listener endpoints return the revised metadata shape—add API tests validating the payload.
  - Add tests covering repo-scoped + local-path discovery so regressions are caught, and ☐ run the launcher test suite (including the new workload metadata tests) before landing.
- **Cleaning story**
  - Implement `clean-generated` (delete `.launcher/<project>/<model>/<target>` build artefacts)—add CLI tests.
  - Implement `clean-deps` (delete `.launcher/<project>/deps/runtime/<target>` + optionally cascade to builds)—cover with tests and run suite.
  - Implement `clean-all` (call both, plus any temporary lockfiles), and surface them via CLI + Studio buttons—ensure tests verify cascading deletes and ☐ run the launcher test suite prior to merge.
- **CI Integration**
  - Prompt: Add GitHub Actions integration for both Studio + Launcher (launcher pytest + renderer/electron Vitest suites)—include pipeline smoke tests.
  - ☐ Ensure CI changes include appropriate automated test runs (pytest, renderer/Vitest) and validate the pipeline end-to-end (final reminder).
- **VS Code Extension MVP**
  - ✅ Baseline extension shell + packaging: `tools/vscode-extension` now builds, packages (`reinstall-vscode-robotick.sh`), registers the activity bar icon, and renders a simple panel; next step is to hydrate it with launcher data (run Vitest each time).
  - ✅ Panel scaffolding + renderer embed: the extension’s webview now copies `dist/renderer` into the package and loads the Studio renderer’s built bundle so we see the real UI (still using offline data until Launcher hooks arrive)—kept under renderer test coverage.
  - ☐ Ensure default presentation of UI is useful: appropriate responsive header; and default panel—add webview tests + Vitest snapshots.
  - ☐ Provide “Attach Debugger” command: register a VS Code command that shells out to `robotick-launcher run-profile … --attach` (or similar) so we can attach without a launch.json—cover with extension command tests.
  - ☐ Add/update Vitest/E2E coverage for new extension features and run the suite before releasing (umbrella reminder).
- **Docs/UX**
  - Update the concept + summary docs plus README quickstarts to describe the bootstrap + tooling-pin workflow—ensure accompanying doc tests/screenshots are refreshed.
  - Provide a “clone → bootstrap.sh → studio.sh” walkthrough with troubleshooting tips (Linux/macOS/Windows)—validate the walkthrough manually/tests before publishing.
  - Document how VS Code discovers the per-project Launcher, how to override tooling pins locally, and how AWS-hosted Hub deployments use the same mechanism—include verification steps in docs.
  - ☐ Treat doc updates like code: run doc linting/checks (where applicable) and include verification snippets/smoke tests before publishing (global reminder).
