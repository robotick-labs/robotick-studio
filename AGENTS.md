# Robotick Studio Agent Notes

Use this file for Studio-specific agent guidance that sits below the workspace-level `AGENTS.md`.

Primary references:

- `README.md` for human onboarding and current CLI inspection surface
- `docs/agent-recipes.md` for Studio shorthand, resource naming, and repeatable agent workflows
- `docs/design/26-06-05 - robotick_cli_and_agentic_ux.md` for the durable CLI/hub/Studio control design

Canonical command surface:

```bash
./tools/robotick hub status
./tools/robotick hub ensure
./tools/robotick launcher status
./tools/robotick launcher ensure
./tools/robotick studio projects
./tools/robotick studio instances
./tools/robotick studio create
./tools/robotick studio open
./tools/robotick studio open barr-e
./tools/robotick studio open pip-e windows main workbenches terminal activate
```

Optional installed command:

```bash
./install-robotick-cli.sh
robotick
robotick hub status
robotick studio projects
robotick studio instances
robotick studio create
robotick studio open
robotick studio open barr-e
```

Agent guidance:

- CLI output is JSON-first by default for one-shot commands
- `src/electron/main/data-sources/*` owns authoritative data-source behavior: external transport, caching, orchestration, subscription sharing, and cross-window state
- `src/renderer/data-sources/*` remains the renderer-facing data access layer; in Electron-backed flows it should usually be a thin bridge client/facade over the main-process data-source, not a second owner of transport or polling
- `status` is read-only; do not expect it to start hub, launcher, Studio, or project runtimes
- use `hub ensure` and `launcher ensure` only when you explicitly want supporting services started or reused
- prefer the documented `robotick` CLI control surface over source inspection when the needed runtime truth is available there
- use `docs/agent-recipes.md` to resolve common shorthand such as workbench/view names before falling back to source or project config
- if a user explanation reveals a reusable Studio shorthand or operational default, update `docs/agent-recipes.md`
- if live Studio state conflicts with a recipe entry, prefer live Studio state and then correct the recipe
- use `./tools/robotick studio instances` to discover live Studio instances
- use `./tools/robotick studio create` to create an empty Studio instance without changing shell context
- use `./tools/robotick studio open` to create and enter empty Studio in the workspace checkout when using the immediate shell
- use `./tools/robotick studio open <project>` to launch the registered project in the workspace Studio checkout
- use `./tools/robotick studio open <project> <path...> <action>` when you already know the Studio resource command to run after launch
- use the installed `robotick` command if you want the same flow on `PATH`
- `robotick` on its own opens a simple immediate-mode shell; use `ls` to list commands, `studio` to enter the Studio context, `back` to leave it, and `clear` to clear the terminal
- `ls` separates context-forming entries from actions; `create` creates instance folders such as `studio-12345/`, with `cd studio-12345` entering that instance
- within `robotick:studio>`, `create` launches empty Studio without binding, while `open` launches and immediately binds to the new instance
- `open <project>` remains a compatibility shortcut for creating and entering a registered project directly
- once bound to an instance, use `ls` to discover child contexts, `cd` to enter them, and `status` to inspect the currently bound Studio node
- `cd` is CLI-owned navigation only; it must not be treated as Studio runtime activation
- use `activate` from a bound Studio resource to ask Studio to make that resource the active runtime branch
- use `select-project <project>` from a bound Studio instance to switch the selected project inside that Studio process
- the currently exposed Studio hierarchy is `windows/<window>/workbenches/<workbench>/layouts/<layout>/panels/<panel>`
- `back` naturally unwinds one shell level at a time
- `quit` now targets the currently bound open Studio instance rather than exiting the CLI
- once bound to a Studio instance, `open` is no longer the next advertised action; use `back` before opening another instance
- the prompt reflects the Studio instance, not the current project; project selection remains a Studio concern
- if a bound Studio instance does not expose the expected control-service behavior, quit and reopen it so the current Electron process registers a fresh `control_endpoint`
- managed CLI commands restart old or incompatible hubs automatically when protocol metadata shows they are stale

Current scope reminder:

- the current CLI surface supports project discovery, Studio instance discovery, structural navigation, `status`, project selection, and `activate`
- viewer readiness, capture, recovery, and deeper diagnosability remain follow-on work
