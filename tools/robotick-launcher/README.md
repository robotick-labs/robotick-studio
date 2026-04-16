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

1. `install-deps`
2. `generate`
3. `build`
4. `deploy`
5. `run` (with `stop` used for lifecycle control during run/restart)

`run` and `run-profile` follow the same stage flow unless explicitly bypassed.

## Stage Ownership Model

- Launcher-owned:
  - profile selection
  - dependency install and generated launcher folder management
  - stage orchestration and process lifecycle
- Model-owned (`*.model.yaml`):
  - runtime-specific commands and environment details
  - optional stage overrides for runtime variants

This keeps launcher generic while each model defines bespoke behavior.

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

See [docs/stage-contracts.md](docs/stage-contracts.md) for exact stage mapping and behavior.

## License

Apache 2.0
