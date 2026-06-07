# TODO

## 1. Studio workbench persistence technical design

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

### Test strategy

- Validate resource schemas directly.
- Test legacy-to-canonical migration with representative fixtures.
- Compare canonical and legacy inputs through the same normalized Studio domain model.
- Compare normalized domain state, not raw file text.
- Keep dual-load or migration-equivalence helpers test-only where possible.
- Avoid permanent production dual-write behavior unless a concrete operational need appears.

## 2. Implementation checklist

### Inventory and contracts

- [ ] Inventory current persisted Studio keys and classify each as project asset, session state, or out of scope.
- [ ] Define the `studio_window`, `studio_workbench`, and `studio_layout` TypeScript types or schemas, including their normalized in-memory model.
- [ ] Define project path resolution for `studio/windows/*.window.json`, `studio/workbenches/*.workbench.json`, and `studio/layouts/*.layout.json`.

### Canonical resource IO

- [ ] Add typed readers and writers for window, workbench, and layout resources, including atomic file writes.
- [ ] Add first-write materialization for missing canonical window, workbench, and layout resources.

### Legacy migration

- [ ] Add legacy storage readers for `.studio/renderer-storage.json` and the current renderer storage bridge.
- [ ] Migrate `workspace-layout-tabs:*`, `panelLayout:*`, `floating-panels:*`, and any durable panel-local or viewer-local keys found during inventory.
- [ ] Audit migrated fields so live window chrome and session-only state remain outside project `studio/`.

### Renderer integration

- [ ] Update layout persistence to load canonical resources first and legacy fallbacks second.
- [ ] Update layout persistence to write only canonical resources after migration.
- [ ] Update floating-panel persistence so panel instances remain embedded in the owning layout resource.

### Tests and fixtures

- [ ] Add representative legacy renderer storage fixtures and equivalent canonical `windows/`, `workbenches/`, and `layouts/` fixtures.
- [ ] Add temporary test-only equivalence helpers that compare legacy and canonical loads through the normalized model.
- [ ] Add tests for schema validation, legacy migration, canonical-first loading, load equivalence, first-write materialization, and no-data-loss behavior.

### Documentation and follow-up

- [ ] Update project documentation to describe the new `studio/` resource folders.
- [ ] Prepare the follow-up `workspace -> workbench` shipped-surface cleanup after the persistence migration is reviewable.
