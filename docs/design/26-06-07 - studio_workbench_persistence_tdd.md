# Studio Workbench Persistence Technical Design

Date: 2026-06-07
Status: Implemented MVP reference
Source issue: https://github.com/robotick-labs/robotick-studio/issues/39
Related docs: [Studio document reference](../studio-document.md), [CLI and Agentic UX](26-06-05%20-%20robotick_cli_and_agentic_ux.md)

## Executive Summary

Studio now persists its durable document-model state in each project at:

```text
robots/<project>/studio/studio.yaml
```

That file is seeded from the bundled `studio.template.yaml` when a project has no Studio document yet. It is the canonical source for the default workbench set, navigation, windows, layouts, docked panels, floating panels, and panel-owned settings. The old separate app workbench YAML source has been removed from the MVP path.

The Electron main process coordinates Studio document ownership for the app session. Renderers are views and controllers over that shared document, not independent owners of durable project state. This keeps child windows as subordinate renderer hosts for the main Studio session while still allowing each window to own its own durable UI subtree inside `studio.yaml`.

Runtime/session state stays out of `studio.yaml`. Examples include process lock files, launcher state, monitor placement, active robot processes, and UX-only local memories such as the last selected workbench for a project.

## Terminology

`workbench` is the Studio UI surface: a named collection of layouts and panels presented in the Studio header and window shell.

`workspace` remains valid only for the separate checkout/runtime concept: repository roots, CLI workspaces, process runtime folders, and broader host environment concerns.

The rename is intentionally not global where the code or docs are describing the checkout/runtime concept rather than the Studio workbench concept.

## Current Document Shape

Each project owns one Studio document for the MVP:

```text
robots/
  barr-e/
    project.yaml
    studio/
      studio.yaml
```

The document uses YAML because the file is project-owned, reviewable, and intended to be hand-inspectable during development.

```yaml
resourceType: studio_document
schemaVersion: 1
id: barr-e-studio
windows:
  - id: main
    label: Main Window
    windowRole: main
    defaultWorkbenchId: remote-control
    workbenches:
      - id: remote-control
        label: Remote Control
        defaultLayoutId: default
        layouts:
          - id: default
            label: Default
            dock:
              nodeType: panel
              id: remote-control-panel
              editorId: remote-control
              label: Remote Control
              settings: {}
            floatingPanels: []
```

The bundled template provides the starter document and default workbench set. Creating or opening a project copies that template into the project as a full document, not as an overlay or delta. Project-specific edits then happen against the copied document.

`app-workbenches.yaml` is deprecated and deleted from the MVP source path. Workbench navigation is populated from the active project document, which itself is created from `studio.template.yaml`.

## Ownership Model

The Studio document owns durable UI identity and structure.

The window owns its workbench list, selected/default workbench, and the durable state for the layouts that belong to that window.

The workbench owns its layout list and selected/default layout.

The layout owns docked panel structure, floating panel instances, and the durable settings for each panel instance.

The floating panel frame owns container state such as position, size, z-order, collapsed state, and titlebar presentation.

The concrete panel/editor owns its own durable settings shape. The layout stores those settings with the panel instance, but it does not interpret editor-specific details beyond generic compatibility checks.

This containment-first model is deliberately pragmatic. It avoids a fully normalized graph until there is a real reuse or merge requirement that justifies the extra complexity.

## Runtime Boundaries

`studio.yaml` stores durable, project-owned UI state:

| State | Stored in `studio.yaml` |
| --- | --- |
| Window IDs and roles | Yes |
| Workbench IDs, labels, and default layout selection | Yes |
| Layout IDs, labels, dock tree, and floating panels | Yes |
| Panel instance IDs, labels, editor IDs, and panel settings | Yes |
| Floating panel frame state | Yes |
| Monitor placement, maximized/fullscreen state, and OS window bounds | No |
| Active launcher process, telemetry process, and hub runtime state | No |
| Studio process lock files | No |
| Per-user "last workbench visited for this project" memory | No |

The explicit split keeps `studio.yaml` suitable for source control and project collaboration while allowing the runtime layer to remain local and ephemeral.

## Panel Persistence Contract

Each durable panel instance has stable identity and stores its own settings:

```ts
type PersistedPanelInstance = {
  id: string
  editorId: string
  label?: string
  settings?: Record<string, unknown>
}
```

The same editor can appear in multiple docked or floating panel instances. Each instance persists independently, even when the editor type is identical.

Panels that need durable settings declare persistence through the editor registration layer. The registration provides defaults, optional versioning, and optional validation/migration for that editor's settings.

```ts
defineStudioPanel({
  id: 'remote-control',
  title: 'Remote Control',
  component: RemoteControlPanel,
  persistence: definePanelPersistence({
    version: 1,
    getDefaultSettings: () => ({
      selectedRobot: null,
      controlMode: 'manual',
    }),
  }),
})
```

Renderers read and update the current panel instance through `usePanelSettings<T>()`. The hook resolves defaults from the editor registration and writes updates back to the Studio document through the persistence service.

Reassigning a panel to a different editor drops incompatible editor-specific settings and replaces them with the new editor defaults. Compatibility shims are avoided unless they are needed for real MVP data.

## Multi-Window Ownership

Child windows are part of the same Studio session. They are not separate Studio app owners, and they do not independently own the project document.

The Electron main process is the shared session authority for `studio.yaml` writes. It serializes document updates so renderers do not race by writing unsynchronized whole-document snapshots.

Creating a child window appends a fresh seeded `windows[]` entry. It does not clone the main window unless an explicit clone feature is added later.

Each renderer receives only the window slice it is hosting plus the shared services exposed through IPC. The renderer can request document changes, but the main process remains the coordinator.

The architectural direction is:

```text
Electron main process = modular Studio document/session authority
Renderer windows = views onto that shared document and shared services
```

## Project Switching And Locks

Studio can be pointed at different projects during a session. Locking is owned by Studio, not by the hub or CLI.

When Studio points at a project, the Electron main process acquires that project's Studio lock. Switching projects releases the old project lock and acquires the new one atomically from the user's perspective. A separate Studio process trying to open or switch to a locked project receives an informative failure instead of corrupting the shared project document.

The UI exposes locked projects in project selection surfaces such as the header picker and Home project grid. Selecting a locked project presents a clear prompt instead of silently failing.

Multiple Studio instances can exist at the same time when they point at different projects. The lock is project-scoped, not global.

## Navigation Source

The main header and Home workbench navigation are sourced from the active `studio.yaml`.

The default set of workbenches is therefore created from `studio.template.yaml` during project bootstrap. There is no separate MVP workbench registry YAML for the app shell.

Project selection and workbench selection are kept distinct:

| Concern | Source |
| --- | --- |
| Which projects exist | Workspace/project registration |
| Which project this Studio window points at | Studio runtime selection plus project lock |
| Which workbenches a project exposes | Active project's `studio.yaml` |
| Which workbench/layout was last visited | Runtime UX memory keyed by project/window |

When switching projects, Studio restores the last visited workbench/layout for that project where available. Falling back to Home is acceptable only when the target project has no matching or remembered workbench/layout.

## Legacy Sources Superseded

The implementation intentionally removed the old split persistence sources from the canonical durable path.

| Legacy source | Current role |
| --- | --- |
| `.studio/renderer-storage.json` | Legacy/runtime-only storage, not canonical project state |
| `workbench-layout-tabs:*` | Superseded by `workbenches[].layouts[]` and `defaultLayoutId` |
| `panelLayout:*` | Superseded by inline layout `dock` state |
| `floating-panels:*` | Superseded by layout-owned `floatingPanels[]` |
| `generic-panel:*` | Superseded by panel instance `settings` |
| `app-workbenches.yaml` | Deleted from the MVP source path |
| Split `studio_window`, `studio_workbench`, and `studio_layout` resources | Superseded by one project `studio_document` |

Local storage can still be used for genuinely local UX details that are not project assets. It must not become the canonical source for durable Studio layout or panel state.

## Implemented Surface

The current implementation is intentionally direct and reviewable.

Key implementation areas:

| Area | Purpose |
| --- | --- |
| `src/electron/main/studio-persistence.ts` | Main-process Studio document load/save/update coordination |
| `src/electron/main/project-locks.ts` | Project-scoped Studio lock acquisition and release |
| `src/renderer/services/studio-persistence/` | Renderer persistence client and document helpers |
| `src/renderer/components/workbenches/PanelLayout.tsx` | Docked/floating panel rendering and persistence integration |
| `src/renderer/components/workbenches/panel-layout-persistence.ts` | Layout serialization helpers |
| `src/renderer/services/EditorRegistry.tsx` | Editor metadata and persistence registration |
| `src/renderer/components/workbenches/PanelInstanceContext.tsx` | Current panel instance settings context |
| `src/renderer/components/header/ProjectPicker.tsx` | Project picker, lock presentation, and project switch flow |
| `src/renderer/components/editors/home/HomePage.tsx` | Home project grid and project switch flow |
| `plugins/remote-control/` | Real persisted panel settings integration |
| `tests/e2e/project-selection.spec.ts` | Electron Playwright coverage for switching and restoration flows |

The implementation favors one coherent MVP path over compatibility layers. Compatibility should be added only when it protects real existing user data that the MVP must preserve.

## Verification

The current verification stack covers the persistence and navigation behavior from both unit and app-shell levels.

Targeted verification includes:

| Check | Coverage |
| --- | --- |
| `npm run typecheck` | Type-level integration across renderer/electron code |
| Persistence unit tests | Studio document loading, saving, seeding, and update behavior |
| Panel layout tests | Docked and floating panel serialization behavior |
| Editor/panel settings tests | Default settings, isolated instances, and editor reassignment behavior |
| Project lock tests | Project-scoped locking and blocked switch handling |
| Playwright Electron e2e | Header picker, Home project grid, workbench switching, lock UX, and last-workbench/layout restore |
| CI e2e job | Runs the Playwright Electron coverage in CI alongside the existing test suite |

The Playwright suite is especially useful for flows that are hard to validate by unit tests alone, such as project switching from a non-Home workbench and verifying that the renderer does not revert to the previous project after Electron applies the new document.

## Current Limitations

Workbench instance CRUD is intentionally future work. For the MVP, projects use the default set of workbenches seeded from `studio.template.yaml`.

Window CRUD is similarly minimal. Child windows can receive seeded window state, but richer clone/empty/default creation modes are future product decisions.

The current document is a single YAML file. That is acceptable while the file remains readable and update coordination is simple. Splitting into per-window resources should be considered only if real reviewability or merge pain appears.

The stop-on-switch robot launcher dialog is no longer a persistence requirement. It should be retained or removed based on current launcher/runtime semantics, not because Studio document switching requires it.

## Future Work

Make shared services explicit in Electron main so renderers remain thin hosts over the shared Studio document/session bundle. Telemetry, launcher integration, robot runtime status, and similar services should be audited against that architecture.

Add workbench CRUD only after the default seeded workbench set proves insufficient. The expected path is create, rename, duplicate, reorder, and delete workbench instances in the active project document.

Add richer multi-window product behavior when needed, including window clone, fresh default window, remembered child window placement, and explicit close semantics.

Introduce schema migration policy when there is real persisted user data across schema versions. Until then, keep schema changes direct, visible, and covered by tests.

Revisit document splitting only with evidence. The preferred future split, if needed, is deterministic and project-owned, for example one root `studio.yaml` plus stable per-window or per-workbench documents.
