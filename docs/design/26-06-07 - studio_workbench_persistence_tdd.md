# Studio Workbench Persistence Technical Design and Plan

## 1. Technical design

Source issue: [robotick-labs/robotick-studio#39](https://github.com/robotick-labs/robotick-studio/issues/39)

Objective:
Promote durable Studio state out of generic renderer storage and into explicit per-project Studio assets that are easy to inspect and evolve.

### Project asset location

Durable Studio project assets live under each project's `studio/` folder, alongside project-owned assets such as `models/`.

```text
robots/barr-e/
  models/
  studio/
    studio.yaml
```

The project `studio/` folder is for durable project resources, not Electron cache state. Live window geometry, monitor placement, maximized/fullscreen state, instance ids, locks, and other session-only state remain in runtime or instance storage.

Current direction:

- Use one coherent project Studio document for now.
- Split into multiple documents later only if readability or ownership boundaries clearly justify it.
- If splitting is introduced later, it must be a deterministic serializer policy, not an ad hoc runtime side effect.

### Resource model

Core persisted resource type:

- `studio_document`

Top-level document ownership:

- A Studio document owns one or more durable window definitions.
- A window owns its hosted workbench instances directly.
- A workbench instance owns one or more layouts directly.
- A layout owns its docked panels and floating panels directly.

Resource boundaries:

- One project Studio document file per project for now.
- No separate top-level workbench or layout files in the preferred direction.
- No per-panel files in MVP.
- The document should read like a declarative Studio UI description, not a normalized persistence graph.
- Containment should replace cross-file bookkeeping wherever there is no real sharing.
- Docked panels are owned inline by the layout's dock structure rather than split into `dockTree` plus `panelInstances`.
- Floating panels remain layout-local inline instance definitions, not shared references.

Saving categories:

- `First-class resource file`
  a named, addressable Studio document file under the project's `studio/` folder
- `First-class resource file contents`
  saved project state inside that document, used for windows, workbench instances, layouts, docked panels, floating panels, and layout-local viewer/editor settings
- `Not project state`
  runtime/session memory or migration-only storage that should not be written into project `studio/` resources

Relationship model:

- A window is the durable host surface.
- A workbench is a durable Studio activity or domain surface, but in the preferred direction it is a window-local instance rather than a separately persisted top-level resource.
- A layout is the durable arrangement/content asset presented within a workbench instance.
- Layouts belong to a workbench instance but are not constrained to tabs; future child-window and floating-window hosting should fit the same layout resource model.

### Identity and naming

- Schema version lives in-file, not in the filename.
- Each persisted object carries a stable `id` where identity is required.
- UI presentation uses labels.
- Separate `slug` fields are not preferred in the single-document direction unless a concrete storage or routing need reappears.
- Nested containment should provide scope so ids can stay local where appropriate, for example `layout.id: default` within a workbench instance.

### Format and ownership

- YAML is the preferred canonical format for the Studio document because the file is intended to become inspectable, diffable, and plausibly hand-editable.
- The same Studio document format should be usable both for builtin/default Studio definitions and for project-owned Studio documents.
- `robotick.yaml` remains static workspace registration and does not absorb Studio runtime state.
- Existing `*.rc.yaml` files remain human-authored panel template or panel class definitions for now, not saved panel-instance state.
- Promoting `*.rc.yaml` into first-class Studio resources is out of scope for this issue.
- Project Studio documents should be full copied documents initialized from a builtin Studio document, not overlays or deltas on top of hidden builtin state.

### Clean-break contract

- New canonical resources use `workbench` terminology from day one.
- Runtime Studio does not read or write legacy persistence paths.
- Canonical writes should converge on the new project `studio/studio.yaml` document.
- Existing split `studio/` JSON resources are superseded rather than migrated.
- Existing legacy renderer/local-storage Studio state is superseded rather than migrated.
- Fresh project Studio state should be bootstrapped from the builtin Studio document.
- Broad shipped-surface `workspace -> workbench` cleanup belongs in a follow-up pass unless needed by the new Studio document rollout.

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

#### Legacy-source classification

| Current key/file | Persistence decision | Notes |
| --- | --- | --- |
| `.studio/renderer-storage.json` | Not saved as project state | Legacy source only; no forward migration. |
| `workspace-layout-tabs:{windowScope}:{workspaceId}` | Not saved as project state | Legacy source only; replaced by the new Studio document layout model. |
| `panelLayout:{windowScope}:{workspaceId}:{layoutTabId}` | Not saved as project state | Legacy source only; replaced by inline `dock` in the new Studio document. |
| `floating-panels:{windowScope}:{workspaceId}:{layoutTabId}` | Not saved as project state | Legacy source only; replaced by inline `floatingPanels` in the new Studio document. |
| `generic-panel:{storageKey}` for floating panel bounds | Not saved as project state | Legacy source only; replaced by inline floating-panel `frame` data in the new Studio document. |
| `studio.child-window-presets.v1` | Not saved as project state | Legacy source only; replaced by explicit `windows[]` entries in the new Studio document. |
| `robotick:last-workspace:*` | Not saved as project state | Useful UX memory, but not a shared project asset. |
| `robotick-studio.terminal.panel.{workspaceId}.{panelId}` plus legacy terminal scalar keys | Not saved as project state | Legacy source only; terminal state should be re-established through the new Studio document model. |
| `robotick-studio.telemetry-scope.panel.{workspaceId}.{panelId}` | Not saved as project state | Legacy source only; telemetry-scope state should be re-established through the new Studio document model. |
| `robotick-studio.telemetry.image.*` namespaced by `{workspaceId}.{panelId}` | Not saved as project state | Legacy source only; viewer selections should be re-established through the new Studio document model. |
| `robotick-studio.telemetry.tree.*` namespaced by `{workspaceId}.{panelId}` | Not saved as project state | Legacy source only; tree selections should be re-established through the new Studio document model. |
| `robotick-studio.models.viewport`, `.view-state`, `.sort`, `.collapsed` namespaced by `{workspaceId}.{panelId}.{projectPath}` | Not saved as project state | Legacy source only; models editor state should be re-established through the new Studio document model. |
| `robotick.streaming-image.selected-stream.{projectPath}.{workspaceId}.{panelId}.{sourceSignature}` with legacy project-scoped fallback | Not saved as project state | Legacy source only; selected-stream state should be re-established through the new Studio document model. |
| `telemetry-model-sort`, `telemetry-expanded-*`, and other standalone editor `localStorage` keys | Not saved as project state | Legacy source only; superseded by the new Studio document direction. |

Classification legend:

- `Defines first-class resource files`
  creates or updates canonical top-level files such as `studio_window`, `studio_workbench`, or `studio_layout`
- `Saved as first-class resource file contents`
  is still saved project state, but stored inside an owning resource file rather than promoted to its own file
- `Not saved as project state`
  stays out of project `studio/` resources and is either runtime/session memory or only a superseded legacy source

#### Canonical mapping

| Current key/file | Canonical target | Notes |
| --- | --- | --- |
| `workspace-layout-tabs:{windowScope}:{workspaceId}` | `studio_document.windows[].workbenches[].layouts[]` ordering, `defaultLayoutId`, and layout `label` | Tab ids stay layout ids within the owning workbench instance; tab names become layout labels. |
| `panelLayout:{windowScope}:{workspaceId}:{layoutTabId}` | `studio_document.windows[].workbenches[].layouts[].dock` | Docked panel tree stays layout-owned, but docked panel definitions are inline rather than separated behind panel-instance ids. |
| `floating-panels:{windowScope}:{workspaceId}:{layoutTabId}` | `studio_document.windows[].workbenches[].layouts[].floatingPanels` | Floating panel records remain layout-owned inline instance definitions. |
| `generic-panel:{storageKey}` for floating panel bounds | `studio_document.windows[].workbenches[].layouts[].floatingPanels[].frame` | Merge panel frame geometry into the owning floating panel record. |
| `studio.child-window-presets.v1` | `studio_document.windows[]` | Preset rows should materialize as explicit window entries in the document. |
| `robotick-studio.terminal.panel.{workspaceId}.{panelId}` plus legacy terminal scalar keys | `studio_document.windows[].workbenches[].layouts[].dock.settings` or `floatingPanels[].settings` | Per-panel terminal settings remain attached to the owning inline panel instance. |
| `robotick-studio.telemetry-scope.panel.{workspaceId}.{panelId}` | `studio_document.windows[].workbenches[].layouts[].dock.settings` or `floatingPanels[].settings` | Scope-panel traces/settings remain attached to the owning inline panel instance. |
| `robotick-studio.telemetry.image.*` namespaced by `{workspaceId}.{panelId}` | `studio_document.windows[].workbenches[].layouts[].dock.settings` or `floatingPanels[].settings` | Viewer selection remains panel-instance state. |
| `robotick-studio.telemetry.tree.*` namespaced by `{workspaceId}.{panelId}` | `studio_document.windows[].workbenches[].layouts[].dock.settings` or `floatingPanels[].settings` | Tree selections and expanded paths remain panel-instance state. |
| `robotick-studio.models.viewport`, `.view-state`, `.sort`, `.collapsed` namespaced by `{workspaceId}.{panelId}.{projectPath}` | `studio_document.windows[].workbenches[].layouts[].dock.settings` or `floatingPanels[].settings` | Models editor viewport/view state remains panel-instance state. |
| `robotick.streaming-image.selected-stream.{projectPath}.{workspaceId}.{panelId}.{sourceSignature}` with legacy project-scoped fallback | `studio_document.windows[].workbenches[].layouts[].dock.settings` or `floatingPanels[].settings` | Keep selected-stream state attached to the concrete viewer/panel instance in MVP. |
| `telemetry-model-sort`, `telemetry-expanded-*`, and other standalone editor `localStorage` keys | `studio_document.windows[].workbenches[].layouts[].dock.settings` or `floatingPanels[].settings` | If these settings are kept at all, they should be normalized under explicit panel/layout ownership rather than preserved in their current global key shape. |

### Draft canonical YAML example

Draft `studio_document` example:

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
              nodeType: split
              direction: horizontal
              ratio: 0.72
              children:
                - nodeType: panel
                  editorId: telemetry-image-viewer
                  label: Main Camera
                  settings:
                    modelId: face-camera
                    workloadId: main-stream
                    fieldPath: image
                - nodeType: panel
                  editorId: telemetry-tree-viewer
                  label: Telemetry Tree
                  settings:
                    modelId: face-camera
                    workloadId: main-stream
                    dataKind: outputs
                    expandedPaths:
                      paths:
                        - outputs.vision
            floatingPanels:
              - editorId: terminal
                label: Launcher Logs
                frame:
                  x: 1180
                  y: 140
                  width: 640
                  height: 400
                  minWidth: 260
                  minHeight: 180
                settings:
                  filter: ""
                  wrapText: true
                  autoScroll: true
```

### Test strategy

- Validate resource schemas directly.
- Test canonical resource loading and writeback with representative fixtures.
- Compare normalized domain state, not raw file text.
- Avoid reintroducing legacy read/write behavior unless a concrete operational need appears.

## 2. Implementation checklist

### Inventory and contracts

- [x] Produce an in-doc persisted-state inventory table covering current keys/files, owning code, value shape, durability classification, migration target, and notes.
- [x] Produce in-doc draft canonical JSON examples for `studio_window`, `studio_workbench`, and `studio_layout`.
- [x] Produce implementation contracts for `studio_window`, `studio_workbench`, `studio_layout`, the normalized in-memory model, and project path resolution.

Result:
The TDD doc contains the inventory and draft resource examples; the codebase contains the first TypeScript contracts/path helpers needed by later implementation steps.

Implemented in:

- `src/renderer/services/studio-persistence/`
- `src/__tests__/unit/services/studioPersistence.test.ts`

### Persistence loading and writeback

- [x] Produce typed resource-file readers and writers for window, workbench, and layout resources.
- [x] Produce atomic write behavior for resource-file updates and first-write materialization for missing window, workbench, and layout resources.
- [x] Produce one normalized persistence model for resource files, excluding live window chrome and session-only state.
- [x] Produce canonical-only loading and canonical-only writeback.

Result:
Studio loads project resource files into one normalized model and writes back only through the project resource file path.

Implemented in:

- `src/renderer/services/studio-persistence/resources.ts`
- `src/renderer/services/studio-persistence/load.ts`
- `src/renderer/services/studio-persistence/store.ts`
- `src/electron/main/studio-persistence.ts`
- `src/electron/preload/preload.ts`
- `src/__tests__/unit/services/studioPersistence.test.ts`

### Renderer integration

- [x] Produce floating-panel persistence that embeds panel instances in the owning layout resource.

Result:
The renderer no longer owns durable workbench/layout state through ad hoc storage keys during normal operation.

Implemented in:

- `src/renderer/components/workspaces/PanelLayout.tsx`
- `src/renderer/components/workspaces/panel-layout-persistence.ts`
- `src/renderer/components/workspaces/floating-panels/floating-panel-store.ts`

### Tests and fixtures

- [x] Produce tests for schema validation, canonical loading, first-write materialization, and no-data-loss behavior.

Result:
The broader persistence test suite covers the finished canonical-resource behavior.

Implemented in:

- `src/__tests__/unit/services/studioPersistence.test.ts`
- `src/__tests__/unit/components/workspaces/PanelLayout.test.tsx`

### Document-model migration

- [ ] Produce a `studio_document` schema and TypeScript contracts that replace the current split `studio_window` / `studio_workbench` / `studio_layout` top-level resource model.
- [ ] Produce a builtin Studio seed document in the same schema that can replace `src/renderer/config/app-workspaces.yaml` as the primary declarative Studio definition.
- [ ] Produce project bootstrap behavior that copies the builtin Studio document into `robots/<project>/studio/studio.yaml` for fresh projects.
- [ ] Produce loader/hydrator logic that reads the single Studio document and hydrates the in-memory Studio model without reconstructing hidden default workbench/layout resources.
- [ ] Produce serializer/writeback logic that writes the single Studio document deterministically in YAML.
- [ ] Produce clean-break startup behavior that ignores superseded split `studio/` JSON resources and superseded legacy renderer/local-storage Studio state.
- [ ] Produce cleanup/removal work for superseded split-resource readers, legacy Studio persistence readers, and compatibility-only code paths that are no longer needed.

Result:
The persistence model converges on one coherent Studio document that is also the declarative Studio UI format used by builtin defaults and project-owned Studio state.

Implemented in:

- `src/renderer/services/studio-persistence/`
- `src/renderer/components/workspaces/`
- `src/renderer/config/`

### User testing and iteration (UX, robustness)

- [ ] Review generated `studio/` assets from real project sessions and prune noisy default-only resources where appropriate.
- [ ] Tighten canonical save/load robustness around project switching, child windows, and unexpected editor availability changes.
- [ ] Refine what is persisted versus omitted so saved Studio assets feel intentional and inspectable rather than cache-like.

Result:
Real project usage feeds back into the canonical resource model so the saved `studio/` assets become cleaner, more robust, and more predictable.

### Documentation and follow-up

- [ ] Produce project documentation describing the new `studio/studio.yaml` document and its ownership boundaries.
- [ ] Produce a follow-up issue or PR plan for the broader `workspace -> workbench` shipped-surface cleanup after the new Studio document model is reviewable.

Result:
The resource model is documented for users/reviewers, and the rename cleanup remains scoped separately from the Studio document rewrite.
