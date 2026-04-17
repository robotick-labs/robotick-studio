# Robotick Launcher

Two entry points:

- `robotick-launcher` — CLI wrapper for build/run/deploy tasks
- `robotick-conductor` — REST API daemon on **http://localhost:7081**

## Quickstart

```bash
python -m venv .venv && source .venv/bin/activate
pip install -e .

robotick-conductor
curl http://localhost:7081/health
robotick-launcher --help
```

## Lifecycle Stages

Launcher pipeline (default):

1. `prepare-project-docker`
2. `prepare-project-workspace`
3. `generate`
4. `build`
5. `deploy`
6. `run` (with `stop` used for lifecycle control during run/restart)

`run` and `run-profile` follow the same stage flow unless explicitly bypassed.

Launcher knows the stage dependencies from an explicit ordered pipeline in code:

- `prepare-project-docker` → `prepare-project-workspace` → `generate` → `build` → `deploy` → `run`
- `stop` is separate runtime control, used when restarting or shutting down an already-running model

So, for example:

- `build` depends on the two preparation stages plus `generate`
- `build-profile` stops after `build`
- `run-profile` walks forward through the pipeline and only reaches later stages if earlier ones succeeded

## Stage Ownership Model

- Launcher-owned:
  - profile selection
  - project Docker preparation and workspace hydration
  - generated launcher folder management
  - stage orchestration and process lifecycle
- Model-owned (`*.model.yaml`):
  - runtime-specific commands and environment details
  - optional stage overrides for runtime variants

This keeps launcher generic while each model defines bespoke behavior.

## Python vs Shell Pattern

The launcher has an intentionally split shape:

- Python owns orchestration:
  - resolve project/model/target/profile
  - decide stage order and dependencies
  - resolve the target strategy
  - prepare Docker/workspace state
  - generate wrapper scripts and status events
- shell scripts own execution details:
  - `do_launcher_build.sh`, `do_launcher_deploy.sh`, `do_launcher_run.sh`, `do_launcher_stop.sh`
  - target-specific helper scripts such as ESP32 setup helpers
  - model-owned runtime scripts declared via `runtime.custom_stages`

This lets launcher stay generic while the actual toolchain/runtime commands stay close to the environment that needs them.

## Custom Stage Overrides

Models can declare optional custom stage commands:

```yaml
runtime:
  custom_stages:
    build_command: ./scripts/launcher/do_ros2_build.sh
    deploy_command: ./scripts/launcher/do_ros2_deploy.sh
    run_command: ./scripts/launcher/do_ros2_run.sh
    stop_command: ./scripts/launcher/do_ros2_stop.sh
```

Important details:

- stage keys are fixed string keys, not a free-form map
- each override is optional
- omitted override keys fall back to launcher defaults for that stage
- launcher-generated stage scripts are thin wrappers that execute model-declared commands
- launcher still owns stage ordering; a custom `run_command` does not imply `build`, `deploy`, or `stop`

See [docs/stage-contracts.md](docs/stage-contracts.md) for exact stage mapping and behavior.

## License

Apache 2.0
