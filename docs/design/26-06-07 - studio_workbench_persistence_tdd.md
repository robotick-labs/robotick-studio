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
- One file per window is a plausible future split boundary if real MVP usage shows that a single project Studio document is becoming too large or noisy.
- Keep weighing single-document vs per-window files during MVP based on inspectability, reviewability, and implementation complexity rather than committing to an early split.

Window initialization direction:

- Fresh project Studio state is bootstrapped from one builtin Studio seed document.
- Creating a child window does not clone the current main window or another existing project window by default.
- The MVP child-window behavior should create a fresh minimal window inside the existing project Studio document.
- That fresh minimal window should typically contain one workbench instance, one default layout, and one default panel.
- Future window-creation modes may include `Create Empty`, `Create Default`, and `Create Clone`, but MVP should standardize only one default path.
- MVP default should be `Create Default`, meaning a fresh minimal window initialized from the standard default window template shape.

Session and multi-window ownership direction:

- Child windows are part of one Studio session, not separate app instances.
- Child windows should share only genuinely session-wide concerns such as project selection, launcher/editor/plugin context, and other explicitly centralized session services.
- Durable UI state should remain window-owned by default.
- A child window should not implicitly share another window's layout state, panel-instance settings, floating-panel frame state, or active workbench/layout selection unless a future feature models that sharing explicitly.
- MVP should avoid the dangerous middle ground where multiple windows independently read, mutate, and rewrite one shared project document with no central coordination.
- If Studio keeps one `studio/studio.yaml` per project during MVP, writes should be coordinated through one Studio-session persistence authority rather than relying on each renderer window to own an unsynchronized whole-document snapshot.
- If that centralized document coordination is not landed soon enough, one-file-per-window remains a proportionate fallback because it reduces the write-collision domain while preserving the single-session mental model.
- Separate app launches against the same project are a different risk from child windows within one Studio session; MVP does not need to solve multi-process collaborative editing, but should avoid making it silently unsafe by design.

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

Panel-instance ownership rules:

- Durable editor/viewer state must be owned by a concrete panel instance inside its owning layout, not by editor type alone.
- Docked and floating panels must expose the same editor-facing panel settings contract.
- A floating panel is a container/placement mode for a panel instance, not a different kind of editor persistence.
- Docked panel settings belong inline on the owning dock panel node.
- Floating panel settings belong inline on the owning floating panel entry only because that is where the panel instance lives while floating.
- Moving a panel between docked and floating containers must preserve the same panel-owned editor settings where panel identity and editor type still match.
- Floating-panel frame data is container state; editor/viewer settings remain panel content state.
- Shared editor-type defaults are not part of MVP persistence; if introduced later, they must be modeled explicitly as a separate defaults layer rather than leaking from per-instance state.
- Persisted panel settings may only be reused when both panel instance identity and editor type still match.
- Reassigning a panel to a different editor must drop incompatible persisted settings rather than carrying them across editor types.
- Two panels using the same editor in the same layout must persist independently.
- Two panels using the same editor in different layouts or different windows must persist independently.
- Panel persistence behavior should be declared by the panel entry point, close to the panel component, not in project documents, global storage-key helpers, or plugin manifests.
- Plugin index files should remain generic export surfaces; panel-specific capabilities, persistence behavior, validation, defaults, and migration belong in the panel's own entry-point file.
- Builtin panels should migrate toward the same entry-point contribution pattern used by plugin panels, within MVP scope and without forcing unrelated editor-registry redesign.

Panel contribution contract:

Panel entry-point files may export either a plain React component or a richer Studio panel contribution object. Plain components remain valid for panels with no durable settings. Panels with durable state should use the contribution object so persistence behavior is declared next to the panel implementation.

Draft host types:

```ts
type PanelPersistenceDefinition<TSettings> = {
  schemaVersion: number;
  defaults: TSettings;
  sanitize?: (value: unknown) => TSettings;
  migrate?: (value: unknown, fromVersion: number) => TSettings;
  shouldPersist?: (settings: TSettings) => boolean;
};

type StudioPanelContribution<TSettings = Record<string, unknown>> = {
  component: React.ComponentType<Record<string, never>>;
  persistence?: PanelPersistenceDefinition<TSettings>;
};

type StudioPanelExport =
  | React.ComponentType<Record<string, never>>
  | StudioPanelContribution;
```

Draft panel entry-point pattern:

```tsx
type TelemetryTreeSettings = {
  telemetryBaseUrl?: string;
  modelId?: string;
  modelPath?: string;
  modelName?: string;
  workloadId?: string;
  workloadName?: string;
  fieldPath?: string;
  dataKind?: "inputs" | "outputs" | "config" | "stats" | "all";
  expandedPaths?: { paths: string[] };
};

const persistence = definePanelPersistence<TelemetryTreeSettings>({
  schemaVersion: 1,
  defaults: {
    dataKind: "outputs",
    fieldPath: "",
    expandedPaths: { paths: [] },
  },
  sanitize(value) {
    const input =
      value && typeof value === "object"
        ? (value as Partial<TelemetryTreeSettings>)
        : {};
    return {
      telemetryBaseUrl:
        typeof input.telemetryBaseUrl === "string"
          ? input.telemetryBaseUrl
          : undefined,
      modelId: typeof input.modelId === "string" ? input.modelId : undefined,
      modelPath:
        typeof input.modelPath === "string" ? input.modelPath : undefined,
      modelName:
        typeof input.modelName === "string" ? input.modelName : undefined,
      workloadId:
        typeof input.workloadId === "string" ? input.workloadId : undefined,
      workloadName:
        typeof input.workloadName === "string"
          ? input.workloadName
          : undefined,
      fieldPath:
        typeof input.fieldPath === "string" ? input.fieldPath : "",
      dataKind:
        input.dataKind === "inputs" ||
        input.dataKind === "outputs" ||
        input.dataKind === "config" ||
        input.dataKind === "stats" ||
        input.dataKind === "all"
          ? input.dataKind
          : "outputs",
      expandedPaths: Array.isArray(input.expandedPaths?.paths)
        ? {
            paths: input.expandedPaths.paths.filter(
              (path): path is string => typeof path === "string"
            ),
          }
        : { paths: [] },
    };
  },
});

function TelemetryTreeViewer() {
  const [settings, updateSettings] =
    usePanelSettings<TelemetryTreeSettings>();

  // Ordinary React state remains transient.
  const [treeContextMenu, setTreeContextMenu] = React.useState(null);

  return null;
}

export const contribution = defineStudioPanel({
  component: TelemetryTreeViewer,
  persistence,
});

export default contribution;
```

Draft plugin index pattern:

```ts
export { contribution as AnimEditorPanel } from "./panels/AnimEditorPanel";
export { contribution as TimelineInspectorPanel } from "./panels/TimelineInspectorPanel";
export { command as BakeAnimationCommand } from "./commands/BakeAnimationCommand";
```

Draft manifest relationship:

```json
{
  "contributes": {
    "editors": [
      {
        "id": "anim-editor",
        "label": "Animation",
        "componentExport": "AnimEditorPanel"
      }
    ]
  }
}
```

The manifest discovers the export and supplies stable editor metadata. The panel entry-point export owns runtime behavior such as persistence defaults, validation, migration, and future panel capabilities.

Host resolution rules:

- If `componentExport` resolves to a plain React component, register it as a panel with no durable settings.
- If `componentExport` resolves to a `StudioPanelContribution`, register `contribution.component` and its optional `contribution.persistence`.
- Before rendering a panel, the host reads the raw settings stored on that concrete panel instance and resolves them through the registered persistence definition.
- If the editor id changed, old settings are discarded.
- If the schema version changed, `migrate` is used when available.
- If settings are malformed, `sanitize` and `defaults` produce a valid settings object.
- `usePanelSettings<T>()` exposes only the resolved settings and update function; panel authors do not construct storage keys or handle docked/floating differences.

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
- Child-window creation should append a new fresh window entry to the existing project Studio document rather than cloning an existing window unless a future explicit clone mode is introduced.
- Runtime/checkout `workspace` terminology still remains where it means the separate repository/runtime root rather than a Studio workbench.

Known legacy sources:

- Generic renderer storage bridge backed by `.studio/renderer-storage.json`
- `workbench-layout-tabs:*`
- `panelLayout:*`
- `floating-panels:*`
- Panel-local or viewer-local storage keys that represent durable Studio layout state rather than transient session state

### Persisted-state inventory

#### Legacy/local persisted state inventory

| Current key/file | Owning code | Value shape |
| --- | --- | --- |
| `.studio/renderer-storage.json` | `src/electron/main/bootstrap.ts`, `src/electron/main/renderer-storage.ts` | JSON object mapping string keys to string values |
| `workbench-layout-tabs:{windowScope}:{workbenchId}` | `src/renderer/components/workbenches/PanelLayout.tsx` | JSON object: `{ tabs: Array<{ id, name }>, activeTabId }` |
| `panelLayout:{windowScope}:{workbenchId}:{layoutTabId}` | `src/renderer/components/workbenches/PanelLayout.tsx` | Recursive JSON panel tree with `leaf` and `split` nodes |
| `floating-panels:{windowScope}:{workbenchId}:{layoutTabId}` | `src/renderer/components/workbenches/floating-panels/floating-panel-store.ts` | JSON array of `{ id, editorId, title?, settings, initialPosition?, initialSize?, minSize? }` |
| `generic-panel:{storageKey}` for floating panel bounds | `src/renderer/components/dialog/GenericPanel.tsx` | JSON object: `{ position, size }` |
| `studio.child-window-presets.v1` | `src/renderer/components/header/AppHeader.tsx` | JSON array of `{ id, name, seedUrl, scope, createdAt, updatedAt, lastUsedAt? }` |
| `robotick:last-workbench:*` | `src/renderer/utils/workbenchMemory.ts` | String workbench route/path |
| `robotick-studio.terminal.panel.{workbenchId}.{panelId}` plus legacy `robotick-studio.terminal.filter`, `.wrapText`, `.autoScroll` | `src/renderer/components/editors/terminal/TerminalPage.tsx` | JSON object: `{ filter, wrapText, autoScroll }` or legacy scalar keys |
| `robotick-studio.telemetry-scope.panel.{workbenchId}.{panelId}` | `src/renderer/components/editors/telemetry-scope/TelemetryScopePage.tsx` | JSON object for scope panel settings and trace configuration |
| `robotick-studio.telemetry.image.*` namespaced by `{workbenchId}.{panelId}` | `src/renderer/components/editors/telemetry/image-viewer/TelemetryImageViewer.tsx` | Scalar string selections for model/workload/field |
| `robotick-studio.telemetry.tree.*` namespaced by `{workbenchId}.{panelId}` | `src/renderer/components/editors/telemetry/tree-viewer/TelemetryTreeViewer.tsx` | Scalar string selections plus JSON expanded-paths preference |
| `robotick-studio.models.viewport`, `.view-state`, `.sort`, `.collapsed` namespaced by `{workbenchId}.{panelId}.{projectPath}` | `src/renderer/components/editors/models/ModelsPage.tsx` | JSON viewport/view-state payloads, JSON string arrays, and scalar sort key |
| `robotick.streaming-image.selected-stream.{projectPath}.{workbenchId}.{panelId}.{sourceSignature}` with legacy project-scoped fallback | `src/renderer/components/viewer/streaming-image/viewer-streaming-image.ts` | Scalar selected stream id |
| `robotick.remote-controls.selected-modes.{projectPath}.{workbenchId}.{panelId}.{configSignature}` with legacy project-scoped fallback | `plugins/remote-control/src/components/remote-controls/RemoteControlsPanel.tsx` | JSON object keyed by stick/trigger control name to selected mode id |
| `robotick-studio.rc.subtitles.position.*` and `.collapsed.*` | `plugins/remote-control/src/components/RcSubtitlesOverlay.tsx` | JSON normalized position payload and collapsed boolean |
| `telemetry-model-sort`, `telemetry-expanded-*`, and other standalone editor `localStorage` keys | `src/renderer/components/editors/telemetry/TelemetryPage.tsx`, `TelemetryModel.tsx` | Scalar strings and booleans |

#### Legacy-source classification

| Current key/file | Persistence decision | Notes |
| --- | --- | --- |
| `.studio/renderer-storage.json` | Not saved as project state | Legacy source only; no forward migration. |
| `workbench-layout-tabs:{windowScope}:{workbenchId}` | Not saved as project state | Legacy source only; replaced by the new Studio document layout model. |
| `panelLayout:{windowScope}:{workbenchId}:{layoutTabId}` | Not saved as project state | Legacy source only; replaced by inline `dock` in the new Studio document. |
| `floating-panels:{windowScope}:{workbenchId}:{layoutTabId}` | Not saved as project state | Legacy source only; replaced by inline `floatingPanels` in the new Studio document. |
| `generic-panel:{storageKey}` for floating panel bounds | Not saved as project state | Legacy source only; replaced by inline floating-panel `frame` data in the new Studio document. |
| `studio.child-window-presets.v1` | Not saved as project state | Legacy source only; replaced by explicit `windows[]` entries in the new Studio document. |
| `robotick:last-workbench:*` | Not saved as project state | Useful UX memory, but not a shared project asset. |
| `robotick-studio.terminal.panel.{workbenchId}.{panelId}` plus legacy terminal scalar keys | Not saved as project state | Legacy source only; terminal state should be re-established through the new Studio document model. |
| `robotick-studio.telemetry-scope.panel.{workbenchId}.{panelId}` | Not saved as project state | Legacy source only; telemetry-scope state should be re-established through the new Studio document model. |
| `robotick-studio.telemetry.image.*` namespaced by `{workbenchId}.{panelId}` | Not saved as project state | Legacy source only; viewer selections should be re-established through the new Studio document model. |
| `robotick-studio.telemetry.tree.*` namespaced by `{workbenchId}.{panelId}` | Not saved as project state | Legacy source only; tree selections should be re-established through the new Studio document model. |
| `robotick-studio.models.viewport`, `.view-state`, `.sort`, `.collapsed` namespaced by `{workbenchId}.{panelId}.{projectPath}` | Not saved as project state | Legacy source only; models editor state should be re-established through the new Studio document model. |
| `robotick.streaming-image.selected-stream.{projectPath}.{workbenchId}.{panelId}.{sourceSignature}` with legacy project-scoped fallback | Not saved as project state | Legacy source only; selected-stream state should be re-established through the new Studio document model. |
| `robotick.remote-controls.selected-modes.{projectPath}.{workbenchId}.{panelId}.{configSignature}` with legacy project-scoped fallback | Not saved as project state | Legacy source only; remote-control mode selection should be re-established through the new Studio document model. |
| `robotick-studio.rc.subtitles.position.*` and `.collapsed.*` | Not saved as project state | Legacy source only; subtitle overlay placement/collapse state should be re-established through the new Studio document model. |
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
| `workbench-layout-tabs:{windowScope}:{workbenchId}` | `studio_document.windows[].workbenches[].layouts[]` ordering, `defaultLayoutId`, and layout `label` | Tab ids stay layout ids within the owning workbench instance; tab names become layout labels. |
| `panelLayout:{windowScope}:{workbenchId}:{layoutTabId}` | `studio_document.windows[].workbenches[].layouts[].dock` | Docked panel tree stays layout-owned, but docked panel definitions are inline rather than separated behind panel-instance ids. |
| `floating-panels:{windowScope}:{workbenchId}:{layoutTabId}` | `studio_document.windows[].workbenches[].layouts[].floatingPanels` | Floating panel records remain layout-owned inline instance definitions. |
| `generic-panel:{storageKey}` for floating panel bounds | `studio_document.windows[].workbenches[].layouts[].floatingPanels[].frame` | Merge panel frame geometry into the owning floating panel record. |
| `studio.child-window-presets.v1` | `studio_document.windows[]` | Preset rows should materialize as explicit window entries in the document. |
| `robotick-studio.terminal.panel.{workbenchId}.{panelId}` plus legacy terminal scalar keys | `studio_document.windows[].workbenches[].layouts[].dock.settings` or `floatingPanels[].settings` | Per-panel terminal settings remain attached to the owning inline panel instance. |
| `robotick-studio.telemetry-scope.panel.{workbenchId}.{panelId}` | `studio_document.windows[].workbenches[].layouts[].dock.settings` or `floatingPanels[].settings` | Scope-panel traces/settings remain attached to the owning inline panel instance. |
| `robotick-studio.telemetry.image.*` namespaced by `{workbenchId}.{panelId}` | `studio_document.windows[].workbenches[].layouts[].dock.settings` or `floatingPanels[].settings` | Viewer selection remains panel-instance state. |
| `robotick-studio.telemetry.tree.*` namespaced by `{workbenchId}.{panelId}` | `studio_document.windows[].workbenches[].layouts[].dock.settings` or `floatingPanels[].settings` | Tree selections and expanded paths remain panel-instance state. |
| `robotick-studio.models.viewport`, `.view-state`, `.sort`, `.collapsed` namespaced by `{workbenchId}.{panelId}.{projectPath}` | `studio_document.windows[].workbenches[].layouts[].dock.settings` or `floatingPanels[].settings` | Models editor viewport/view state remains panel-instance state. |
| `robotick.streaming-image.selected-stream.{projectPath}.{workbenchId}.{panelId}.{sourceSignature}` with legacy project-scoped fallback | `studio_document.windows[].workbenches[].layouts[].dock.settings` or `floatingPanels[].settings` | Keep selected-stream state attached to the concrete viewer/panel instance in MVP. |
| `robotick.remote-controls.selected-modes.{projectPath}.{workbenchId}.{panelId}.{configSignature}` with legacy project-scoped fallback | `studio_document.windows[].workbenches[].layouts[].dock.settings` or `floatingPanels[].settings` | Remote-control mode selections belong to the owning remote-control panel instance. |
| `robotick-studio.rc.subtitles.position.*` and `.collapsed.*` | `studio_document.windows[].workbenches[].layouts[].dock.settings` or `floatingPanels[].settings` | Subtitle overlay position/collapse state belongs to the owning remote-control panel instance. |
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
- For every editor/viewer migrated into document-backed persistence, add isolation tests proving that per-panel-instance state does not leak across sibling panels, layouts, or windows.
- For every editor/viewer migrated into document-backed persistence, add reassignment tests proving that editor-specific settings are discarded when a panel changes to a different editor type.

## 2. Implementation checklist

### Inventory and contracts

- [x] Produce an in-doc persisted-state inventory table covering current keys/files, owning code, value shape, durability classification, migration target, and notes.
- [x] Produce in-doc draft canonical resource examples for the current split-resource model and the preferred single-document `studio_document` direction.
- [x] Produce implementation contracts for `studio_window`, `studio_workbench`, `studio_layout`, the normalized in-memory model, and project path resolution.

Result:
The TDD doc contains the inventory and target-shape examples; the codebase contains the first TypeScript contracts/path helpers for the currently implemented split-resource phase.

Implemented in:

- `src/renderer/services/studio-persistence/`
- `src/__tests__/unit/services/studioPersistence.test.ts`

### Persistence loading and writeback

- [x] Produce typed resource-file readers and writers for window, workbench, and layout resources.
- [x] Produce atomic write behavior for resource-file updates and first-write materialization for missing window, workbench, and layout resources.
- [x] Produce one normalized persistence model for resource files, excluding live window chrome and session-only state.
- [x] Produce canonical-only loading and canonical-only writeback.

Result:
Studio loads project split resource files into one normalized model and writes back only through project-owned `studio/` files.

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
`PanelLayout` durable workbench/layout structure now persists through the split project resource files during normal operation rather than through ad hoc layout storage keys.

Implemented in:

- `src/renderer/components/workbenches/PanelLayout.tsx`
- `src/renderer/components/workbenches/panel-layout-persistence.ts`
- `src/renderer/components/workbenches/floating-panels/floating-panel-store.ts`

### Tests and fixtures

- [x] Produce tests for split-resource schema validation, loading, first-write materialization, and no-data-loss behavior.

Result:
The persistence test suite covers the implemented split-resource behavior and the no-legacy-read contract for layout persistence.

Implemented in:

- `src/__tests__/unit/services/studioPersistence.test.ts`
- `src/__tests__/unit/components/workbenches/PanelLayout.test.tsx`

### Document-model migration

#### 1. Canonical document foundation

- [x] Produce a `studio_document` schema, TypeScript contracts, and fixture examples that replace the current split `studio_window` / `studio_workbench` / `studio_layout` top-level resource model.
- [x] Produce a deterministic YAML loader/serializer for `studio_document`, with round-trip tests against representative fixtures and stable ordering.
- [x] Produce loader/hydrator logic that reads `studio/studio.yaml` and hydrates the in-memory Studio model without reconstructing hidden default workbench/layout resources.
- [x] Switch renderer persistence writeback from split JSON resources to `studio/studio.yaml`, preserving existing behavior coverage with updated tests.
- [x] Remove split-resource readers/writers and other superseded compatibility-only persistence code once the single-document path is fully covered by tests.

#### 2. Panel persistence rollout

- Clean-break rule for MVP:
  once a panel/viewer is moved onto panel-owned Studio document settings, Studio should not keep legacy `localStorage` read/write shims for that state.

- [x] Produce one editor-facing panel settings API for both docked and floating panels, and export that API for plugin authors.
- [x] Replace floating-only settings access with the shared panel settings API so floating is only a container/placement concern.
- [x] Migrate the remaining durable editor/viewer state that still used legacy `localStorage` keys into panel-owned `settings` within `studio/studio.yaml`, including the streaming-image selected-stream path and the remote-control panel's selected-mode/subtitles overlay state.
- [x] Remove legacy `localStorage` reads/writes for editor/viewer state that is now represented by panel-owned `settings` in the Studio document.
- [x] Produce a small `defineStudioPanel` or equivalent contribution helper so a panel entry-point file can declare its component, persistence defaults, validation/sanitization, and future capabilities in one place.
- [x] Update plugin editor loading so a manifest `componentExport` may resolve either to a plain React component or to a panel contribution object, while keeping plugin index files as generic export surfaces.
- [x] Migrate builtin panels with durable state to the same panel entry-point contribution pattern where practical for MVP, using telemetry tree as the reference implementation and applying the same pattern across the current migrated builtin/plugin panels.
- [x] Add per-editor persistence isolation tests proving that same-editor panels do not share state across panel instances or layout tabs.
- [x] Add editor-reassignment tests proving that incompatible persisted settings are dropped when a panel changes editor type.
- [x] Migrate floating-panel frame persistence out of `GenericPanel` `localStorage` and into `studio_document.windows[].workbenches[].layouts[].floatingPanels[].frame`, so floating container state follows the same durable project model as the rest of Studio persistence.
- [x] Add floating-panel frame round-trip tests proving that panel-owned settings and floating-container frame data serialize independently through the Studio document model.

#### 2.1. Comprehensive `workspace` -> `workbench` rename

- Rename the shipped Studio surface from `workspace` / `workspaces` to `workbench` / `workbenches` in one clean pass rather than introducing mixed terminology.
- Treat this as a clean-break refactor for MVP:
  do not preserve compatibility aliases purely to support old internal naming.
- Scope the rename across:
  renderer component names, prop names, helper names, route/view names, config names, storage/memory helper names, tests, docs, and comments.
- Include the route/config layer currently built around `WorkbenchView`, `app-workbenches.yaml`, and `AppConfigService`, so the user-facing navigation model matches the persisted `studio_document.windows[].workbenches[]` terminology.
- Include panel/runtime identifiers such as `workbenchId` / `workbenchLabel` where they are really referring to the current workbench instance.
- Include any Robotick CLI references that still expose or imply the old `workspace` terminology, so Studio and CLI vocabulary do not diverge.
- Preserve the current persisted Studio document resource shape where it already uses `workbench` terminology; the point of this pass is to remove the renderer/runtime naming mismatch before further persistence behavior accretes around it.
- [x] Produce a complete rename map covering renderer, config, tests, docs, runtime helpers, and CLI touchpoints before editing files, so the pass can be executed comprehensively rather than piecemeal.
- [x] Rename the renderer/config/runtime surface from `workspace` to `workbench`, including component names, prop names, helper names, storage key names that are still renderer-owned, and route/config terminology.
- [x] Rename or relocate files/directories whose ownership is really `workbench`-scoped rather than `workspace`-scoped, where that improves clarity without gratuitous churn.
- [x] Update Robotick CLI and related docs/config references if they still expose Studio `workspace` terminology that should now be `workbench`.
- [x] Update tests, fixtures, and docs in the same pass so the new term is the only supported term in active Studio development.
- [x] Run a focused regression sweep covering routing/navigation, remembered last-opened workbench behavior, Studio document persistence, panel persistence, and plugin loading after the rename.

#### 2.2. Multi-window persistence ownership

- MVP decision:
  child windows belong to one Studio session, but each window owns its own durable UI subtree by default.
- MVP decision:
  do not treat child windows as fully separate app instances.
- MVP decision:
  do not rely on independent renderer windows issuing unsynchronized whole-document writes to the same project Studio file as the long-term model.
- [ ] Produce a small design note and implementation contract for a Studio-session persistence authority that owns read/modify/write coordination for `studio/studio.yaml` across all windows in one app session.
- [ ] Decide explicitly whether MVP will land that centralized session persistence authority now, or instead temporarily split persistence to one file per durable window while keeping one Studio session model.
- [ ] If centralized session coordination is the chosen MVP path, route child-window persistence writes through that single owner and stop treating each renderer window as the authoritative owner of a whole-document snapshot.
- [ ] If one-file-per-window is the chosen MVP path, define the deterministic file layout, ownership boundaries, and bootstrap/update rules so windows cannot overwrite each other's durable state.
- [ ] Add focused regression tests covering two windows in one Studio session mutating different window-owned state without losing each other's changes.
- [ ] Once that coordination model is chosen and implemented, add focused multi-workbench / child-window persistence isolation tests for panel settings, active workbench/layout selection, and window-owned floating-panel frame state.
- [ ] Add a follow-up MVP/near-term decision note for separate app processes opening the same project, even if the first shipped behavior is only a warning or unsupported-state guard.

#### 3. Bootstrap and completion

- [ ] Produce a builtin Studio seed document in the same schema and load it as the declarative default Studio definition.
- [ ] Produce project bootstrap behavior that materializes `robots/<project>/studio/studio.yaml` from the builtin seed on first save or first project initialization.
- [ ] Produce child-window creation behavior that appends a fresh minimal default window to `studio/studio.yaml` without implicitly cloning an existing window, covered by focused fixture and renderer tests.

Result:
The current codebase now persists one coherent `studio/studio.yaml` document and no longer uses the temporary split-resource bridge. Panel persistence has also moved materially forward: docked and floating panels share one editor-facing `usePanelSettings` contract, builtin and plugin panels can declare persistence through `defineStudioPanel` next to their entry-point component, the migrated panels now follow a clean-break rule with no legacy `localStorage` compatibility shim for that state, the remote-control plugin now keeps its selected stream/control-mode/subtitles overlay state inside the owning panel settings, floating-panel frame data now round-trips through `floatingPanels[].frame`, the shipped Studio surface now consistently uses `workbench` terminology, and regression tests cover document-backed panel settings, layout-tab isolation, plugin discovery, editor reassignment clearing, remote-control panel persistence, and floating-panel frame serialization. Remaining MVP work is now narrower and more concrete: harden/write-test multi-workbench or child-window persistence coordination, and land builtin seed/default-definition plus explicit child-window creation behavior.

Implemented in:

- `src/renderer/services/studio-persistence/`
- `src/renderer/components/workbenches/`
- `src/renderer/components/editors/telemetry/tree-viewer/TelemetryTreeViewer.tsx`
- `src/renderer/components/viewer/streaming-image/viewer-streaming-image.ts`
- `src/renderer/services/plugins/animation-studio-host.ts`
- `plugins/remote-control/src/RemoteControlPage.tsx`
- `plugins/remote-control/src/components/remote-controls/RemoteControlsPanel.tsx`
- `plugins/remote-control/src/components/RcSubtitlesOverlay.tsx`
- `src/electron/main/studio-persistence.ts`
- `src/electron/preload/preload.ts`
- `src/__tests__/unit/services/studioPersistence.test.ts`
- `src/__tests__/unit/components/workbenches/PanelLayout.test.tsx`
- `src/__tests__/unit/components/workbenches/floating-panel-store.test.ts`
- `src/__tests__/unit/components/editors/telemetry/TelemetryTreeViewer.test.tsx`

### User testing and iteration (UX, robustness)

- [ ] Review generated `studio/studio.yaml` assets from real project sessions and prune noisy default-only state where it makes the saved document feel cache-like.
- [ ] Tighten save/load robustness around project switching, child windows, and unexpected editor availability changes, with focused regression tests for each case.
- [ ] Refine persisted panel/viewer settings so the saved Studio document stays intentional and inspectable rather than becoming a dump of transient UI state.
- [ ] Keep reassessing whether MVP usage still justifies one `studio/studio.yaml` per project or whether a per-window file split has become the more proportionate storage boundary.

Result:
Real project usage feeds back into the canonical resource model so the saved `studio/` assets become cleaner, more robust, and more predictable.

### Documentation and follow-up

- [ ] Produce project documentation describing `studio/studio.yaml`, its ownership boundaries, and what deliberately remains runtime/session-only state.
- [ ] Keep documenting the boundary where `workspace` still means the separate checkout/runtime root or workspace CLI surface, distinct from Studio workbenches.

Result:
The resource model is documented for users/reviewers, and the rename cleanup remains scoped separately from the Studio document rewrite.
