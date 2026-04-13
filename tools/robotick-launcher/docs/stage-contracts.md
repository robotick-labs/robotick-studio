# Launcher Stage Contracts

This doc defines stage boundaries so runtime-specific behavior is configured in model YAML, while launcher remains generic.

## Canonical Pipeline

Launcher stages are:

1. `install-deps`
2. `generate`
3. `build`
4. `deploy`
5. `run`

`stop` is lifecycle control used by run/restart flows.

## Ownership Boundary

- Launcher is responsible for:
  - selecting profile/model/target
  - orchestrating stage order
  - generating `do_launcher_*.sh` scripts
  - process lifecycle/status reporting
- Model YAML is responsible for:
  - runtime-specific command details
  - runtime environment behavior (native/docker/etc.)
  - optional per-stage override commands

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

## Practical Containerized Pattern

Recommended split for containerized models (for example, ROS2 simulators):

- setup/provisioning script:
  - one-time or infrequent host/container provisioning
- build stage script:
  - idempotent build of workspace/packages
- run stage script:
  - start long-running runtime workload
- stop stage script:
  - stop only runtime processes

Avoid re-running heavy setup on every launch. Keep setup standalone; run/build should be fast and repeatable.
