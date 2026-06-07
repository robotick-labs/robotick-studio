# Studio Workbench Persistence Technical Design and Plan

## 1. Technical design

Source issue: [robotick-labs/robotick-studio#39](https://github.com/robotick-labs/robotick-studio/issues/39)

Objective:
Promote durable Studio window, workbench, and layout state out of generic renderer storage and into explicit per-project Studio assets that are easy to inspect, migrate, and evolve.

### Project asset location

Durable Studio project assets live under each project's `studio/` folder, alongside project-owned assets such as `models/`.

```text
robots/barr-e/
  models/
  studio/
    windows/
      main.window.json
      telemetry-child.window.json
    workbenches/
      remote-control.workbench.json
      telemetry.workbench.json
    layouts/
      remote-control.default.layout.json
      remote-control.debug.layout.json
      telemetry.default.layout.json
```

The project `studio/` folder is for durable project resources, not Electron cache state. Live window geometry, monitor placement, maximized/fullscreen state, instance ids, locks, and other session-only state remain in runtime or instance storage.

### Resource model

Core persisted resource types:

- `studio_window`
- `studio_workbench`
- `studio_layout`

Resource folders:

- `studio/windows/` contains durable Studio window definitions.
- `studio/workbenches/` contains durable Studio workbench definitions.
- `studio/layouts/` contains durable layout assets.

Resource boundaries:

- One window file per durable Studio window definition.
- One workbench file per Studio workbench.
- One layout file per saved layout asset.
- No per-panel files in MVP.
- Window files own durable host-surface definitions and their relationship to hosted workbenches and layouts.
- Workbench files own the ordered set of layout ids plus default or active layout references.
- Layout files own the layout label, dock tree, panel instances, floating panels, and layout-local defaults.
- Panel instances, floating panels, and layout-local viewer state live inside the owning layout file.

Saving categories:

- `First-class resource file`
  a named, addressable JSON file under `studio/windows/`, `studio/workbenches/`, or `studio/layouts/`
- `First-class resource file contents`
  saved project state inside one of those files, used for concrete panel instances, floating panels, and layout-local viewer/editor settings
- `Not project state`
  runtime/session memory or migration-only storage that should not be written into project `studio/` resources

Relationship model:

- A window is the durable host surface.
- A workbench is the durable Studio activity or domain surface.
- A layout is the durable arrangement/content asset presented within a Studio surface.
- Windows may reference one or more hosted workbenches.
- Workbenches reference one or more layouts.
- Layouts belong to a workbench but are not constrained to tabs; future child-window and floating-window hosting should fit the same layout resource model.

### Identity and naming

- Schema version lives in-file, not in the filename.
- Filenames use readable slugs based on stable window, workbench, and layout names.
- Each resource file contains a stable canonical id.
- Cross-resource references use ids.
- UI presentation uses labels.
- Opaque ids appear in filenames only when no stable readable slug exists.

### Format and ownership

- JSON is the canonical format for Studio-written durable state.
- YAML remains appropriate for hand-authored project config inputs.
- `robotick.yaml` remains static workspace registration and does not absorb Studio runtime state.
- Existing `*.rc.yaml` files remain human-authored panel template or panel class definitions for now, not saved panel-instance state.
- Promoting `*.rc.yaml` into first-class Studio resources is out of scope for this issue.

### Migration contract

- New canonical resources use `workbench` terminology from day one.
- Migration reads existing legacy renderer storage and legacy `workspace`-named keys.
- Migration also tolerates transitional `workbench` aliases during rollout.
- Canonical writes go only to the new project `studio/` JSON resources.
- Legacy readers stay in place long enough for existing user state to survive normal use.
- Broad shipped-surface `workspace -> workbench` cleanup belongs in a follow-up pass unless needed by the persistence migration.

Known legacy sources:

- Generic renderer storage bridge backed by `.studio/renderer-storage.json`
- `workspace-layout-tabs:*`
- `panelLayout:*`
- `floating-panels:*`
- Panel-local or viewer-local storage keys that represent durable Studio layout state rather than transient session state

### Persisted-state inventory

#### Current persisted state

| Current key/file | Owning code | Value shape |
| --- | --- | --- |
| `.studio/renderer-storage.json` | `src/electron/main/bootstrap.ts`, `src/electron/main/renderer-storage.ts` | JSON object mapping string keys to string values |
| `workspace-layout-tabs:{windowScope}:{workspaceId}` | `src/renderer/components/workspaces/PanelLayout.tsx` | JSON object: `{ tabs: Array<{ id, name }>, activeTabId }` |
| `panelLayout:{windowScope}:{workspaceId}:{layoutTabId}` | `src/renderer/components/workspaces/PanelLayout.tsx` | Recursive JSON panel tree with `leaf` and `split` nodes |
| `floating-panels:{windowScope}:{workspaceId}:{layoutTabId}` | `src/renderer/components/workspaces/floating-panels/floating-panel-store.ts` | JSON array of `{ id, editorId, title?, settings, initialPosition?, initialSize?, minSize? }` |
| `generic-panel:{storageKey}` for floating panel bounds | `src/renderer/components/dialog/GenericPanel.tsx` | JSON object: `{ position, size }` |
| `studio.child-window-presets.v1` | `src/renderer/components/header/AppHeader.tsx` | JSON array of `{ id, name, seedUrl, scope, createdAt, updatedAt, lastUsedAt? }` |
| `robotick:last-workspace:*` | `src/renderer/utils/workspaceMemory.ts` | String workspace route/path |
| `robotick-studio.terminal.panel.{workspaceId}.{panelId}` plus legacy `robotick-studio.terminal.filter`, `.wrapText`, `.autoScroll` | `src/renderer/components/editors/terminal/TerminalPage.tsx` | JSON object: `{ filter, wrapText, autoScroll }` or legacy scalar keys |
| `robotick-studio.telemetry-scope.panel.{workspaceId}.{panelId}` | `src/renderer/components/editors/telemetry-scope/TelemetryScopePage.tsx` | JSON object for scope panel settings and trace configuration |
| `robotick-studio.telemetry.image.*` namespaced by `{workspaceId}.{panelId}` | `src/renderer/components/editors/telemetry/image-viewer/TelemetryImageViewer.tsx` | Scalar string selections for model/workload/field |
| `robotick-studio.telemetry.tree.*` namespaced by `{workspaceId}.{panelId}` | `src/renderer/components/editors/telemetry/tree-viewer/TelemetryTreeViewer.tsx` | Scalar string selections plus JSON expanded-paths preference |
| `robotick-studio.models.viewport`, `.view-state`, `.sort`, `.collapsed` namespaced by `{workspaceId}.{panelId}.{projectPath}` | `src/renderer/components/editors/models/ModelsPage.tsx` | JSON viewport/view-state payloads, JSON string arrays, and scalar sort key |
| `robotick.streaming-image.selected-stream.{projectPath}.{workspaceId}.{panelId}.{sourceSignature}` with legacy project-scoped fallback | `src/renderer/components/viewer/streaming-image/viewer-streaming-image.ts` | Scalar selected stream id |
| `telemetry-model-sort`, `telemetry-expanded-*`, and other standalone editor `localStorage` keys | `src/renderer/components/editors/telemetry/TelemetryPage.tsx`, `TelemetryModel.tsx` | Scalar strings and booleans |

#### Migration classification

| Current key/file | Persistence decision | Notes |
| --- | --- | --- |
| `.studio/renderer-storage.json` | Not saved as project state | Source for migration reads only; not itself a project asset. |
| `workspace-layout-tabs:{windowScope}:{workspaceId}` | Defines first-class resource files | Materializes/updates `studio_workbench` files and one `studio_layout` file per saved layout. |
| `panelLayout:{windowScope}:{workspaceId}:{layoutTabId}` | Defines first-class resource files | Provides the core dock tree for canonical `studio_layout` files. |
| `floating-panels:{windowScope}:{workspaceId}:{layoutTabId}` | Saved as first-class resource file contents | Floating panel instances are saved inside the owning `studio_layout` file; they do not get separate files in MVP. |
| `generic-panel:{storageKey}` for floating panel bounds | Saved as first-class resource file contents when tied to a floating panel | Floating panel geometry is saved inside the owning `studio_layout` file; non-layout generic-panel usage is not migrated into project resources. |
| `studio.child-window-presets.v1` | Defines first-class resource files | Materializes/updates canonical `studio_window` files rather than remaining an opaque preset list. |
| `robotick:last-workspace:*` | Not saved as project state | Useful UX memory, but not a shared project asset. |
| `robotick-studio.terminal.panel.{workspaceId}.{panelId}` plus legacy terminal scalar keys | Saved as first-class resource file contents | Saved panel-instance state lives inside the owning `studio_layout` file, not as a top-level file. |
| `robotick-studio.telemetry-scope.panel.{workspaceId}.{panelId}` | Saved as first-class resource file contents | Saved panel-instance state lives inside the owning `studio_layout` file. |
| `robotick-studio.telemetry.image.*` namespaced by `{workspaceId}.{panelId}` | Saved as first-class resource file contents | Viewer selections live inside the owning `studio_layout` file. |
| `robotick-studio.telemetry.tree.*` namespaced by `{workspaceId}.{panelId}` | Saved as first-class resource file contents | Tree selections and expanded paths live inside the owning `studio_layout` file. |
| `robotick-studio.models.viewport`, `.view-state`, `.sort`, `.collapsed` namespaced by `{workspaceId}.{panelId}.{projectPath}` | Saved as first-class resource file contents | Saved editor view state lives inside the owning `studio_layout` file. |
| `robotick.streaming-image.selected-stream.{projectPath}.{workspaceId}.{panelId}.{sourceSignature}` with legacy project-scoped fallback | Saved as first-class resource file contents | Layout-owned viewer state in MVP, not a top-level resource. |
| `telemetry-model-sort`, `telemetry-expanded-*`, and other standalone editor `localStorage` keys | Saved as first-class resource file contents after normalization | In-scope, but migration must attach them to explicit panel/layout ownership instead of preserving their current global key shape. |

Classification legend:

- `Defines first-class resource files`
  creates or updates canonical top-level files such as `studio_window`, `studio_workbench`, or `studio_layout`
- `Saved as first-class resource file contents`
  is still saved project state, but stored inside an owning resource file rather than promoted to its own file
- `Not saved as project state`
  stays out of project `studio/` resources and is either runtime/session memory or only a migration source

#### Canonical mapping

| Current key/file | Canonical target | Notes |
| --- | --- | --- |
| `workspace-layout-tabs:{windowScope}:{workspaceId}` | `studio_workbench.layoutIds`, `studio_workbench.defaultLayoutId`, `studio_layout.label` | Tab ids stay layout ids; tab names become layout labels. |
| `panelLayout:{windowScope}:{workspaceId}:{layoutTabId}` | `studio_layout.dockTree`, `studio_layout.panelInstances` | Panel tree stays layout-owned. |
| `floating-panels:{windowScope}:{workspaceId}:{layoutTabId}` | `studio_layout.floatingPanels` | Floating panel records remain layout-owned. |
| `generic-panel:{storageKey}` for floating panel bounds | `studio_layout.floatingPanels[].frame` | Merge panel frame geometry into the owning floating panel record. |
| `studio.child-window-presets.v1` | `studio_window` resources | Preset rows should materialize as explicit window resources. |
| `robotick-studio.terminal.panel.{workspaceId}.{panelId}` plus legacy terminal scalar keys | `studio_layout.panelInstances[].settings` | Per-panel terminal settings remain attached to the panel instance. |
| `robotick-studio.telemetry-scope.panel.{workspaceId}.{panelId}` | `studio_layout.panelInstances[].settings` | Scope-panel traces/settings remain attached to the panel instance. |
| `robotick-studio.telemetry.image.*` namespaced by `{workspaceId}.{panelId}` | `studio_layout.panelInstances[].settings` | Viewer selection remains panel-instance state. |
| `robotick-studio.telemetry.tree.*` namespaced by `{workspaceId}.{panelId}` | `studio_layout.panelInstances[].settings` | Tree selections and expanded paths remain panel-instance state. |
| `robotick-studio.models.viewport`, `.view-state`, `.sort`, `.collapsed` namespaced by `{workspaceId}.{panelId}.{projectPath}` | `studio_layout.panelInstances[].settings` | Models editor viewport/view state remains panel-instance state. |
| `robotick.streaming-image.selected-stream.{projectPath}.{workspaceId}.{panelId}.{sourceSignature}` with legacy project-scoped fallback | `studio_layout.panelInstances[].settings` | Keep selected-stream state attached to the concrete viewer/panel instance in MVP. |
| `telemetry-model-sort`, `telemetry-expanded-*`, and other standalone editor `localStorage` keys | `studio_layout.panelInstances[].settings` | Migration should normalize these under explicit panel/layout ownership rather than preserving the current global key shape. |

### Draft canonical JSON examples

Draft `studio_window` example:

```json
{
  "resourceType": "studio_window",
  "schemaVersion": 1,
  "id": "window-main",
  "slug": "main",
  "label": "Main Window",
  "windowRole": "main",
  "hostedWorkbenchIds": [
    "remote-control",
    "telemetry",
    "models",
    "project",
    "terminal"
  ],
  "defaultWorkbenchId": "remote-control"
}
```

Draft `studio_workbench` example:

```json
{
  "resourceType": "studio_workbench",
  "schemaVersion": 1,
  "id": "remote-control",
  "slug": "remote-control",
  "label": "Remote Control",
  "source": "builtin",
  "layoutIds": [
    "layout-remote-control-default",
    "layout-remote-control-debug"
  ],
  "defaultLayoutId": "layout-remote-control-default",
  "windowIds": [
    "window-main"
  ]
}
```

Draft `studio_layout` example:

```json
{
  "resourceType": "studio_layout",
  "schemaVersion": 1,
  "id": "layout-remote-control-default",
  "slug": "remote-control.default",
  "label": "Default",
  "workbenchId": "remote-control",
  "dockTree": {
    "nodeType": "split",
    "direction": "horizontal",
    "ratio": 0.72,
    "children": [
      {
        "nodeType": "panel",
        "panelInstanceId": "panel-main-camera"
      },
      {
        "nodeType": "panel",
        "panelInstanceId": "panel-telemetry-tree"
      }
    ]
  },
  "panelInstances": [
    {
      "panelInstanceId": "panel-main-camera",
      "editorId": "telemetry-image-viewer",
      "label": "Main Camera",
      "settings": {
        "modelId": "face-camera",
        "workloadId": "main-stream",
        "fieldPath": "image"
      }
    },
    {
      "panelInstanceId": "panel-telemetry-tree",
      "editorId": "telemetry-tree-viewer",
      "label": "Telemetry Tree",
      "settings": {
        "modelId": "face-camera",
        "workloadId": "main-stream",
        "dataKind": "outputs",
        "expandedPaths": {
          "paths": [
            "outputs.vision"
          ]
        }
      }
    }
  ],
  "floatingPanels": [
    {
      "panelInstanceId": "panel-terminal-floating",
      "editorId": "terminal",
      "label": "Launcher Logs",
      "frame": {
        "x": 1180,
        "y": 140,
        "width": 640,
        "height": 400,
        "minWidth": 260,
        "minHeight": 180
      },
      "settings": {
        "filter": "",
        "wrapText": true,
        "autoScroll": true
      }
    }
  ]
}
```

### Test strategy

- Validate resource schemas directly.
- Test legacy-to-canonical migration with representative fixtures.
- Compare canonical and legacy inputs through the same normalized Studio domain model.
- Compare normalized domain state, not raw file text.
- Keep dual-load or migration-equivalence helpers test-only where possible.
- Avoid permanent production dual-write behavior unless a concrete operational need appears.

## 2. Implementation checklist

### Inventory and contracts

- [x] Produce an in-doc persisted-state inventory table covering current keys/files, owning code, value shape, durability classification, migration target, and notes.
- [x] Produce in-doc draft canonical JSON examples for `studio_window`, `studio_workbench`, and `studio_layout`.
- [ ] Produce implementation contracts for `studio_window`, `studio_workbench`, `studio_layout`, the normalized in-memory model, and project path resolution.

Result:
The TDD doc contains the inventory and draft resource examples; the codebase contains the first TypeScript contracts/path helpers needed by later implementation steps.

### Canonical resource IO

- [ ] Produce typed canonical resource readers and writers for window, workbench, and layout resources.
- [ ] Produce atomic write behavior for canonical resource updates.
- [ ] Produce first-write materialization for missing canonical window, workbench, and layout resources.

Result:
Studio can read, write, and create canonical project `studio/` resources without using legacy renderer storage.

### Legacy migration

- [ ] Produce legacy storage readers for `.studio/renderer-storage.json` and the current renderer storage bridge.
- [ ] Produce migration mapping for `workspace-layout-tabs:*`, `panelLayout:*`, `floating-panels:*`, and any durable panel-local or viewer-local keys found during inventory.
- [ ] Produce a migrated normalized model that excludes live window chrome and session-only state.

Result:
Legacy persisted state can be loaded and normalized into the same model as canonical resources, ready to materialize as project `studio/` assets.

### Renderer integration

- [ ] Produce canonical-first layout persistence in the renderer, with legacy fallback loading.
- [ ] Produce canonical-only writes after migration materializes resources.
- [ ] Produce floating-panel persistence that embeds panel instances in the owning layout resource.

Result:
The renderer no longer owns durable workbench/layout state through ad hoc storage keys during normal operation.

### Tests and fixtures

- [ ] Produce representative legacy renderer storage fixtures and equivalent canonical `windows/`, `workbenches/`, and `layouts/` fixtures.
- [ ] Produce temporary test-only equivalence helpers that compare legacy and canonical loads through the normalized model.
- [ ] Produce tests for schema validation, legacy migration, canonical-first loading, load equivalence, first-write materialization, and no-data-loss behavior.

Result:
Reviewers can validate that old and new persistence paths produce equivalent Studio state and that migration does not drop existing user state.

### Documentation and follow-up

- [ ] Produce project documentation describing the new `studio/` resource folders and their ownership boundaries.
- [ ] Produce a follow-up issue or PR plan for the broader `workspace -> workbench` shipped-surface cleanup after the persistence migration is reviewable.

Result:
The resource model is documented for users/reviewers, and the rename cleanup remains scoped separately from the persistence migration.
