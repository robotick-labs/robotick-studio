# Robotick Unified Studio + VS Code Architecture

## Overview

Robotick Studio’s pitch is simple: each robot repo unlocks the entire robotics workflow—no separate Studio installer, no global tooling.

- **A single Launcher backend** powers both Studio and the VS Code extension, keeping operations and development in sync.
- **Two purpose-built frontends** let builders switch seamlessly between creative controls (Studio) and deep code work (VS Code).
- **Repo-pinned project files** (including tooling pins) guarantee that every clone rehydrates the exact Studio/Launcher, engine, and workload stack across desktop and embedded targets.
- **Per-project bootstrap scripts** live alongside each `<robot>.project.yaml` (e.g., `MyRobot.setup.sh`), with optional repo-root wrappers for convenience, so onboarding is always “clone that repo → run the project’s `*.setup.sh` script → `./run-studio.sh`,” regardless of which versions the project pinned.

Clone the robot’s repo, run its bootstrap script, and the full stack—visual cockpit, editor, launcher, and pinned deps—is ready to fly. No global system install is required; every robot carries the toolchain it expects so demos, field robots, and CI runners remain deterministic.

---

## Core Concepts

### 1. Launcher (Python)

Launcher stays the shared backend, now with a repo-aware workflow that travels with each robot repository:

- **Lives with Studio, pinned per robot.** Each project’s setup script is responsible for cloning the exact `robotick-studio` repo/ref it needs (typically into `.launcher/<project_safe>/deps/tooling/robotick-studio`), running `npm install`, and dropping the shims (`./run-studio.sh`, `./run-launcher.sh`). Multiple robots can sit side-by-side, each running the version they pinned in their bootstrapper without touching global state; the project YAML no longer carries this pin, though the schema still recognizes `tooling.tooling_sources` for advanced tooling repos.
- **CLI + service stay.** `robotick-launcher` still drives `generate → build → deploy → run`, plus `run-profile` and the FastAPI listener (`/query`, `/launcher`, `/launcher/ws/log`). These paths now read from the shared deps layout.
- **New `install-deps` stage.** Before `generate`, we can call `robotick-launcher install-deps` to hydrate `.launcher/<project_safe>/deps/python/.venv-python` using every `python_root`, install the referenced `requirements.txt` files, and emit a lock describing the resulting PYTHONPATH entries. The launcher keeps that venv under the project’s `.launcher/<project_safe>` tree by default (`--workspace-dir` overrides when we purposely want a different sandbox), clones the pinned git deps in the same pass, and prints copy/paste `sudo apt-get ...` commands whenever host packages are missing.
- **Deterministic deps.** Studio/VS Code installers only hydrate our tooling; a separate stage (`robotick-launcher install-deps`) syncs the pinned engine/workload/shared repos into `.launcher/<project_safe>/deps/runtime/<target>`, while each model keeps `.launcher/<project_safe>/generated/<model_safe>/<target_safe>/deps` for target-only bits. Today we hydrate a fresh checkout per target; future work will layer in smarter per-project sharing (e.g., engine/workload repos reused across `linux` + `esp32` builds).
- System-wide installs are intentionally avoided: Studio/VS Code always run against the linked `.studio/.venv` so the workspace stays self-contained.
- **Lifecycle commands.** First-class commands for `install-deps`, `clean-generated`, `clean-deps`, and `clean-all` replace the current “generate does everything” magic so automation can call exactly what it needs.
- **Workspace-aware.** Studio and Launcher resolve `.studio/.venv`, project discovery, and repo paths relative to whatever directory you start them from, so the tooling can run from any workspace folder (CI, terminals, VS Code, etc.).
- **Workload-aware discovery.** Only workload entries flagged under `runtime.workload_sources` are mined for `*Workload.cpp`; auxiliary repos stay silent unless a workload YAML points at them.
- **Contract polish.** Step one is “install Studio → Launcher + deps are ready.” Next we add versioned `/launcher/v1/*` + `/query/v1/*` endpoints, optional auth/CSRF tokens, and richer per-model telemetry payloads for Studio and VS Code.

---

### 2. Project File (<robot-name>.project.yaml)

Defines the environment by pinning repos instead of raw paths. Every project file must declare its schema version (`schema_version: 1` for this rollout) so Launcher + Studio know which layout to expect. The schema groups runtime bits together so everything the launcher needs to hydrate sits under one section:

- `runtime.engine`: repo URL + ref _or_ a `local_path`. Launcher mirrors pinned repos into `.launcher/<project_safe>/deps/runtime/<target>/engine/<slug>` and feeds headers/libs into the build graph; local paths are resolved relative to `${PROJECT_DIR}` and used directly.
- `runtime.workload_sources`: explicit list of workload sources. Each entry picks either a repo/ref to hydrate under `.launcher/<project_safe>/deps/runtime/<target>/workloads/<slug>` or a `local_path` for in-repo experiments (and should declare an `id` for clarity). Entries can also list `root_paths` (subfolders inside the checkout) when multiple workload trees live under the same repo. Only the expanded paths feed the auto-generated registry until repo hydration lands.
- `runtime.shared`: optional extras (assets, helper libs) that follow the same repo/ref vs. `local_path` contract.
- `runtime.python_roots`: explicit per-project Python entry points (`id`, `local_path`, optional `requirements`). Launcher resolves them relative to the project file and `install-deps` installs every declared requirements file into `.launcher/<project_safe>/deps/python/.venv-python`. At runtime we combine that venv’s site-packages with each root path on `PYTHONPATH` so all Python workloads see the same hydrated environment.
- Each repo entry can target specific platforms so ESP32-only bits never land on desktop machines.
- Target platform + Studio/Launcher prefs stay, but every build resolves from the pinned deps tree. Workload YAML keeps referencing relative paths within those repos.

Each project owns its own `.launcher` directory that sits next to its `<project>.project.yaml` (e.g., `robots/pip-e/.launcher`). Inside that folder we namespace the project (`.launcher/<project_safe>`), keeping `deps/tooling/<tooling_id>`, `deps/runtime/<target>/<category>/<slug>`, the shared Python venv under `deps/python`, and per-model build artefacts under `.launcher/<project_safe>/generated/<model_safe>/<target_safe>`. Engine/workload/shared repos are cloned once per target today, but the next revision teaches `install-deps` to automatically cache obvious shared repos (engine source, workload packs, shared assets) per project—hydrating them under a `shared` directory and linking them into each target tree—so we avoid duplicate checkouts without losing determinism.

Result: clone the robot repo, run `./scripts/bootstrap.sh` (or platform equivalent), and the pinned world appears deterministically—toolchain included. A single monorepo can host multiple `<robot>.project.yaml` files, each with its own tooling pins, engine/workload graph, and bootstrap script; Studio simply loads the project file you select and hydrates the matching version set.

#### Tooling Pins

The project file can optionally embed a `tooling` section for extra repos that Launcher should hydrate (custom dashboards, profiling tools, etc.). `tooling.tooling_sources` mirrors `runtime.workload_sources`: each entry carries a unique `id` plus either a `repo/ref` pair or a `local_path` (never both), and the bootstrapper can clone or reuse them under `.launcher/<project_safe>/deps/tooling/<tooling_id>`. Studio/Launcher themselves are now fetched by the project’s setup script (outside the YAML) so robots can control that pin with simple shell logic or a future bootstrap CLI. Paths can interpolate `${PROJECT_DIR}` (the folder containing `<robot>.project.yaml`) so complex relative paths stay readable. Every project implicitly owns a co-located `<project>.setup.sh` (same basename as the project file), so we no longer configure a bootstrap path explicitly—the launcher/UI can always say “run `<project>.setup.sh` next to this project file.”

Example (abridged) `my-robot.project.yaml`:

```yaml
name: My Robot
schema_version: 1
tooling:
  tooling_sources:
    - id: robotick-studio
      repo: https://github.com/robotick-labs/robotick-studio.git
      ref: v0.9.1 # Alternatively: set `local_path: ${PROJECT_DIR}/../../..` if tooling lives in the workspace
runtime:
  engine:
    repo: https://github.com/robotick-labs/robotick-engine.git
    ref: 1c2d3e4 # Alternatively: set `local_path: ${PROJECT_DIR}/../../../../robotick-engine` to reuse a sibling checkout
  workload_sources:
    - id: my-robot-workloads
      repo: https://github.com/robotick-labs/my-robot-workloads.git
      ref: my-robot-2024-06
    - id: prototyping-cpp
      local_path: workloads/prototyping/cpp # Treat in-repo experiments like any other workload root
      root_paths:
        - include
        - src
  shared:
    - repo: https://github.com/robotick-labs/shared-assets.git
      ref: main
  python_roots:
    - id: my-robot-vision
      local_path: workloads/vision
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

- **Run an existing robot.** `git clone robot-repo && cd robot-repo && ./robots/MyRobot.setup.sh` reads that project file’s `tooling` section, clones the pinned Studio/Launcher refs into `.launcher/<project_safe>/deps/tooling/<tooling_id>`, runs `npm install`, installs the VS Code extension locally, and calls `robotick-launcher install-deps`. The generated `./run-studio.sh` script launches the bundled Studio which auto-attaches to the project-scoped launcher service.
- **Create a new robot.** A template (or `create-robotick-project`) scaffolds `<robot>.project.yaml`, writes default tooling pins, and hydrates the tooling folder under `.launcher/<project_safe>/deps/tooling`. Developers tweak repo lists, rerun the bootstrap to hydrate runtime deps, and commit the updated project file alongside their code.
- **Host cloud demos.** The AWS-deployed Hub clones a curated robot repo, runs the same bootstrapper for the relevant project, and serves the Studio renderer in a browser while keeping the pinned launcher service alive in the same deployment. Each hosted robot keeps its own tooling pins and `.launcher/<project_safe>/deps/tooling` tree, so multiple demos can coexist without version conflicts.

Because tooling lives next to each project, CI can cache `.launcher/<project_safe>/deps/tooling/<tooling_id>` directories keyed by the project file’s tooling hash, and developers hopping between robots can optionally point `ROBOTICK_TOOLING_CACHE` at a shared directory to reduce downloads.

We explicitly prefer the sibling layout for `.launcher`: everything that defines a robot (project file, bootstrap script, hydrated tooling/runtime state) travels together, mirroring the long-standing test fixtures and avoiding repo-level coupling. Repo-root caches can still be layered on later, but the default mental model is “open the project folder and its `.launcher` lives right there.”

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

- **Cleaning story**
  - Implement `clean-generated` (delete `.launcher/<project>/generated/<model>/<target>` build artefacts)—add CLI tests.
  - Implement `clean-deps` (delete `.launcher/<project>/deps/runtime/<target>` + optionally cascade to builds)—cover with tests and run suite.
  - Implement `clean-all` (call both, plus any temporary lockfiles), and surface them via CLI + Studio buttons—ensure tests verify cascading deletes and ☐ run the launcher test suite prior to merge.
