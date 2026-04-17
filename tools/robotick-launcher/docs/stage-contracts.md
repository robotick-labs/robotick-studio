# Launcher Stage Contracts

This doc defines the discrete launcher stages, their default sequential
dependencies, and the ownership boundary between Python orchestration and shell
execution.

## Canonical Pipeline

Launcher stages are:

1. `prepare-project-docker`
2. `prepare-project-workspace`
3. `generate`
4. `build`
5. `deploy`
6. `run`

`stop` is lifecycle control used by run/restart flows.

Default forward dependency order:

- `prepare-project-docker` → `prepare-project-workspace` → `generate` → `build` → `deploy` → `run`

Launcher knows this ordering explicitly in code, rather than inferring it from
shell scripts or model YAML. The CLI/profile commands then choose how far
through that pipeline to walk:

- `generate` prepares the two upstream stages first unless explicitly skipped
- `build` depends on `generate`
- `deploy` depends on `build`
- `run` depends on `deploy`
- `build-profile` stops after `build`
- `run-profile` walks forward through the pipeline and only advances if the
  previous stage succeeded

## Ownership Boundary

- Launcher is responsible for:
  - selecting profile/model/target
  - orchestrating stage order
  - preparing the immutable project-target Docker image
  - hydrating mutable workspace state under `.launcher/.../deps/...`
  - generating `do_launcher_*.sh` scripts
  - process lifecycle/status reporting
- Model YAML is responsible for:
  - runtime-specific command details
  - runtime environment behavior (native/docker/etc.)
  - optional per-stage override commands

## Python vs Shell Pattern

The launcher intentionally follows this split:

- Python orchestrates:
  - target/profile resolution
  - stage dependency ordering
  - Docker/workspace preparation
  - strategy selection
  - wrapper-script generation
  - process/status management
- shell scripts execute the environment-specific work:
  - standard generated scripts like `do_launcher_build.sh`
  - target helpers such as ESP32 container/setup scripts
  - model-owned custom scripts declared in `runtime.custom_stages`

That split keeps launcher generic while leaving concrete toolchain/runtime
commands close to the environment that actually needs them.

## Custom Stage Overrides

Supported stage override keys under `runtime.custom_stages`:

- `build_command`
- `deploy_command`
- `run_command`
- `stop_command`

These keys are fixed string keys (not an enum type, and not arbitrary user-defined stage names).

Each key is optional:

- if provided, launcher generates/uses a stage wrapper script for that key
- if omitted, launcher uses its existing default stage behavior
- launcher still owns dependency ordering between stages; model YAML replaces
  the command for a stage, not the existence or ordering of the surrounding
  pipeline

## Generated Wrapper Scripts

When custom stage overrides are present, launcher writes:

- `do_launcher_build.sh` for `build_command`
- `do_launcher_deploy.sh` for `deploy_command`
- `do_launcher_run.sh` for `run_command`
- `do_launcher_stop.sh` for `stop_command`

The wrappers are intentionally thin:

1. `cd` into `${PROJECT_DIR}`
2. `exec bash -lc "<declared command>"`

The command itself handles runtime details (for example `docker exec`, `colcon build`, or `ros2 launch`).
Use project-root-relative command paths (for example `./scripts/launcher/do_ros2_run.sh`) when scripts live under a subfolder.

This is the same Python→shell pattern as the standard launcher flow:

- launcher Python decides _which_ stage should execute and _when_
- the generated wrapper script or model-owned shell script decides _how_ that
  environment-specific work actually runs

## Practical Containerized Pattern

Recommended split for containerized models (for example, ROS2 simulators):

- `prepare-project-docker`
  - define or derive the immutable image/toolchain contract
- `prepare-project-workspace`
  - hydrate persistent mutable state under `.launcher/.../deps/...`
- `build` stage script
  - do idempotent build work only
- `run` stage script
  - start long-running runtime workload only
- `stop` stage script
  - stop only runtime processes

Avoid re-running heavy setup on every launch. Keep setup standalone; run/build should be fast and repeatable.
