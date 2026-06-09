# Studio Document Ownership

`robots/<project>/studio/studio.yaml` is the canonical durable Studio document for a project.

## What belongs in `studio.yaml`

`studio.yaml` is for durable, inspectable Studio state that a reviewer should be able to read as intentional UI structure, not cache residue.

It currently owns:

- durable window definitions
- workbench definitions presented inside those windows
- layout tabs and their ordering
- docked panel structure
- floating panel records and frame geometry
- panel-owned editor/viewer settings that are intentionally part of the saved Studio surface

## What does not belong in `studio.yaml`

The following remain runtime or session state, not project document state:

- live Electron window geometry/chrome state such as monitor placement, maximized state, and instance ids
- locks, process-local coordination, and app-lifecycle bookkeeping
- live telemetry streams, websocket transport state, and in-memory caches
- launcher process state and other ephemeral service runtime state
- generic renderer cache/storage that exists only to support current runtime behavior

## Ownership boundary

The current direction is:

- Electron main owns the canonical Studio document and shared session coordination.
- Renderer windows read and write that document through typed bridges.
- Renderer UI should increasingly behave as a view/controller over shared state rather than as an independent app runtime.

## `workspace` vs `workbench`

These terms are intentionally different:

- `workspace` still refers to the separate checkout/runtime/root concept, including `ROBOTICK_WORKSPACE_ROOT`, project checkout paths, and CLI/workspace plumbing.
- `workbench` refers to the Studio UI surface or activity area, such as `remote-control`, `telemetry`, `models`, or `terminal`.

Do not collapse those two meanings back together in new code or docs.
