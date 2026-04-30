Models View UX Refresh Roadmap

Goal:

- Improve readability and orientation for wide/dense graphs while preserving current layout behavior.
- Ensure node selection and Properties behavior are production-clear (not just mock-up visible).

Completed so far:

- ✅ Added cursor-centered mouse-wheel zoom for the Models SVG viewport.
- ✅ Switched panning to middle-mouse drag (`MMB`) and disabled scroll-container panning.
- ✅ Made the graph container non-scrolling and kept navigation inside the SVG viewport.
- ✅ Persisted viewport position/zoom per workspace/panel/project and restored it on load.
- ✅ Set the default first-load viewport to fit SVG content width.
- ✅ Fixed controller lifecycle cleanup by adding `detach()` paths for selection and drag controllers.
- ✅ Switched node dragging to delegated SVG event handling so newly added nodes were draggable without rebinds.

Phase 0: Visual Clarity + Structural Visibility (read-only wins first)

- ✅ Made selection state unambiguous:
  - ✅ Added a stronger selected-node outline (thicker stroke + high-contrast accent).
  - ✅ Added a subtle selected-node glow.
  - ✅ Kept selected state readable while focus-dimming unrelated elements.
- ✅ Added edge visibility modes in a viewport overlay (top-left, similar to RC viewport controls):
  - ✅ `None | Selected Node | Selected Model | All`
  - ✅ Defaulted to `Selected Model`
- ✅ Added strong focus dimming on selection:
  - ✅ Faded unrelated nodes/edges to low opacity.
- ✅ Increased semantic contrast between connection classes:
  - ✅ Used line style + brightness, not only hue.
  - ✅ Current default:
    - ✅ intra-model/local: thinner + dashed + lower contrast
    - ✅ inter-model/REC: thicker + solid + brighter
- ✅ Made structure more legible in the graph UI:
  - ✅ Added a per-model structure summary strip (root type, thread count, sequence on/off).
  - ✅ Made structural group containers visually distinct from regular workloads.
  - ✅ Labeled row semantics with thread + sequence-chain context (`Thread N · Step chain` where applicable).

Phase 1A: Navigation + Scale (read-only wins first)

- ✅ Added model collapse/expand (similar to telemetry view patterns):
  - ✅ Collapsed models now appear as compact "black box" row headers.
  - ✅ Incoming/outgoing REC edges now terminate at box-boundary stubs while collapsed.
  - ✅ Expanding a model restores full lane/node rendering.
- ✅ Preserved collapse state per panel/workspace/project in storage.

Phase 2A: Properties + Data Surfacing (read-only wins first)

- Launcher scope (contract + schema source of truth):
  - ✅ Kept model YAML loading on-demand from launcher model endpoints.
  - ✅ Loaded workload structure metadata via launcher workload-registry endpoint (read-only).
  - Treat cpp/.h-derived workload registration metadata as the authoritative schema (field set, types, grouping/defaults).
  - Treat model YAML as values-only input mapped onto that schema (not a shape/schema provider).
  - Optional later extension: lightweight fingerprint/mtime signal for schema staleness checks.
- Studio scope (read-only Properties integration):
  - ✅ Cached workload metadata in Studio to avoid repeating expensive discovery on every selection.
  - ✅ Added an explicit `Refresh metadata` action as a small button at the top-right of the Properties panel, to re-read schema after cpp/.h changes.
  - ✅ Treated schema metadata as stale-until-refresh for now (manual refresh after source edits).
  - ✅ Populated values from model YAML content, constrained by the authoritative schema.
  - ✅ Used launcher-provided workload structure metadata for:
    - ✅ `config`
    - ✅ `inputs`
    - ✅ `outputs`
  - Reflect type information, defaults, and field grouping where available.
  - ✅ Validated YAML values against schema and surfaced validation failures in-panel.
  - ✅ Added a Properties-panel error viewer/log area for issues such as unknown YAML fields and wrong field types.
- Test boundary (keep workstreams separate):
  - Launcher tests: endpoint payload shape, schema extraction correctness, and refresh/fingerprint semantics.
  - ✅ Added Studio tests for metadata cache behavior, refresh-button behavior, rendering from schema+values, and in-panel error display.
  - Avoid cross-coupled tests that require both launcher internals and Studio UI behavior in one test path.

Phase 2A-i: Property Panel - Follow Up:

- ✅ Showed outputs as read-only defaults.
- ✅ Showed actual value for unset fields: registry default when present; otherwise `default not available`.
- ✅ Marked overridden values as visually distinct (bold) and added per-field `Revert` actions on the right-hand side.
- ✅ Kept fields in a single left-aligned column layout for a details-panel style presentation.
- ✅ Added Phase 2A-ii for live-telemetry in Models view/Property Panel and future save-back of live-edited values.
- ✅ Added Phase 2A-iii for comprehensive registry coverage of sub-structs/arrays (including types like `Vec2`).

Phase 2A-ii: Extend workloads-registry-schema generation to all referenced types

- ✅ Searched `ROBOTICK_REGISTER_*` blocks for each type referenced by each workload-struct and recursively added child field types to build full workload type-trees in schema metadata.
- ✅ Resolved each canonical type once per generation pass and reused cached results across workloads.
- ✅ Enforced collision handling for canonical final type names: equivalent registrations merged, conflicting registrations errored.
- ✅ Added precise missing-type errors with referenced type/source context and applied per-workload failure behavior (`schema_error`) without invalidating unrelated workload entries.
- ✅ Restricted registration source scanning to roots resolved from project YAML/runtime source configuration (no global workspace search).
- ✅ Added unit tests covering recursive discovery, missing-registration error handling, and conflicting-registration detection.
- ✅ Expanded workloads-discovery golden output to cover recursively discovered referenced types as a parity guard.

Phase 2A-iii (0): Launcher Contract Foundation

- Outcome:
  - ✅ Established the canonical schema contract and launcher-side validation as the baseline before broader integration.
- Launcher-side tasks:
  - ✅ Used engine-owned `workloads_layout.schema.json` as the canonical contract source.
  - ✅ Validated launcher `/query/get-workloads-registry` payloads against that schema (design-time profile).
  - ✅ Kept payload workload/type-driven and removed runtime-instance-only identity fields from design-time output.
  - ✅ Defined and versioned a concrete core project/model schema covering envelope fields (`name`, `root`, `telemetry`, `connections`, `remote_models`, `workloads[*]`).
  - ✅ Kept workload `config`/`inputs`/`outputs` schema generated from code and composed it with core schema during validation.
  - ✅ Exposed JSON endpoints for parsed project/model data, core schema, and workload registry schema metadata.
  - ✅ Implemented layered validation (core first, workload-type second) and returned one unified error list with stable field paths.

Phase 2A-iii (1): Integrate Canonical Layout Schema into Current Flow

- Outcome:
  - ✅ Aligned launcher design-time payload and engine runtime layout under the same schema contract (runtime fields omitted at design-time).
  - ✅ Removed remaining schema-shape drift between launcher, Studio, and telemetry layout.
- Engine/test tasks:
  - ✅ Validated telemetry layout endpoint payloads against the same schema in engine tests.
  - ✅ Kept schema updates contract-first when mismatches were discovered (accepting engine-compatible schema adjustments where needed).
- Studio-side tasks:
  - ✅ Updated launcher interface typing and Property Panel schema ingestion to the unified `workloads` + `types` shape.
  - ✅ Added Studio-side handling for launcher unified validation errors with clear surfaced messages and non-fatal behavior.
  - ✅ Kept workload resolution based on model workload type and treated unresolved types as non-fatal with clear errors.
  - ✅ Preserved compatibility of read-only rendering/validation while removing old registry-shape assumptions.
- Done criteria:
  - ✅ Launcher and engine tests both enforce the same schema file.
  - ✅ Studio now consumes the unified schema shape, with legacy compatibility only as transitional fallback.
  - ✅ Property Panel path no longer depends on legacy-only registry shape.

Phase 2A-iii (2): Core Model Schema + Layered Validation/Rendering (follow-on)

- Outcome:
  - ✅ Replaced remaining model/workload property handling with a schema+data-driven pipeline in the current Properties path.
- Studio-side tasks:
  - ✅ Removed model/workload-specific schema-shape assumptions and telemetry-field hard-coding in Properties rendering.
  - ✅ Rendered model envelope fields from core schema and dynamic workload sections from workload registry schema/type graph.
  - ✅ Surfaced launcher-provided per-workload `schema_error` and unified `validation_errors` clearly in Studio (Properties panel).
  - ✅ Kept renderer path reusable for other panels by using schema+data mapping helpers.
- Done criteria:
  - ✅ Properties panel rendering/validation is schema+data driven in current scope.
  - ✅ Nested/container workload fields render and validate correctly end-to-end.
  - ✅ Tests cover launcher schema contracts/validation and studio rendering/error states for the updated flow.

Phase 2B-0: General Models Architecture Review (Completed)

- Outcome:
  - ✅ Defined and adopted a stable-identity + in-memory-pointer architecture for Models editing and inspection.
  - ✅ Promoted model/workload IDs to canonical reference keys for structure and connections.
  - ✅ Made Models viewport and Properties panel explicit projections over one shared canonical in-memory document in Studio Models path.
- Canonical architecture for this phase:
  - Persist stable IDs in model YAML:
    - ✅ model: top-level `id` (e.g. `barr_e_spine_model_XXXXXXXX`)
    - ✅ workload: top-level `id` (e.g. `expressive_state_workload_XXXXXXXX`)
    - ✅ kept `meta` available for non-identity metadata
  - Stable IDs are:
    - ✅ opaque (non-semantic)
    - debug-friendly by convention:
      - ✅ model id prefix derived from initial model file stem
      - ✅ workload id prefix derived from workload `type` (not workload `name`)
      - ✅ short random suffix for uniqueness
    - ✅ generated once, then persistent
    - ✅ never recomputed from name/path
    - ✅ unchanged by rename/move/reparent operations
  - In Studio memory:
    - ✅ Built one canonical `ModelDocument` graph keyed by stable IDs in the Models editor path.
    - ✅ Represented `children`, `connections`, and selection against ID-backed refs (pointer-like object graph semantics).
    - ✅ Treated SVG node ids, collapse state, and Properties selection as view-state over canonical IDs (not over names).
  - At I/O boundaries:
    - ✅ On load: Studio Models path now parses strict ID-based refs as canonical format (no legacy name-based compatibility path).
    - ✅ `remote_models` entries were defined and exemplified as keyed by `model_id` (no `name` required).
- Engine scope in this phase:
  - ✅ ID-based refs were set as the target contract.
  - ⏳ Launcher/engine enforcement and full workspace migration continue as follow-on implementation work.
- Validation + safety rules:
  - ✅ Enforced strict ID-ref model parsing in Studio Models load path, including actionable errors for missing/invalid IDs and unresolved local references.
  - ✅ Defined hard rules: no compatibility parsing, no `id = name` fallback, and no mixed-format persistence in steady state.
- Done criteria:
  - ✅ Model/workload rename no longer risks breaking internal Studio references, selection, or cross-panel state in the Models editor path.
  - ✅ In-memory graph logic no longer depends on workload/model names for identity in the Models editor path.
  - ✅ Models viewport and Properties panel consume the same ID-backed canonical document.
  - ✅ Tests cover strict ID-model parsing acceptance/rejection and ID-based PropertyPanel behavior.
- Follow-on implementation (execution after this completed review/contract phase):
  1. ✅ Updated launcher/engine schema + typing contracts to strict ID-ref format (`id`, `root.workload_id`, `children[].workload_id`, ID-based connection endpoints, `remote_models[].model_id`).
  2. ✅ Bulk-migrated all model YAMLs in this workspace in one atomic change to canonical ID-ref format.

Phase 2B: Routing Architecture Upgrade (read-only wins first)

- Implement inter-model trunk routing (target-model merged trunks):
  - Edge exits source node using current local escape behavior (short horizontal stub, then vertical).
  - Route into a target-model trunk corridor shared by inbound edges for that target model.
  - Trunks travel in gutter space, not node lanes.
  - Split from trunk near destination model and descend to destination node.
  - Direction convention: right-travelling runs in top gutters; left-travelling runs in bottom gutters.
- Keep trunk lanes separated from node lanes to reduce visual invasion:
  - Use left gutter while traversing between models vertically.
  - Use thread top/bottom gutters once inside model bounds.
- Preserve existing edge visibility filters and model collapse behavior:
  - Trunk segments respect `None | Selected Node | Selected Model | All`.
  - Collapsed models keep boundary-stub semantics; trunk routing should terminate/split at collapsed boundary anchors.
- Implementation guardrails:
  - Prioritize stable, deterministic routing over shortest-path perfection.
  - Avoid introducing data-model/editor semantics in this phase (rendering-only change).
  - Ship incrementally: land base trunk routing first, then tune spacing/readability.

Phase 3A: Connection Data Surfacing (read-only wins first)

- Add read-only connection inspection surfaces:
  - Node-selected view: when a workload node is selected, show its incoming and outgoing data connections below `config`, `inputs`, and `outputs`.
  - Include both local-model and remote-model connections in those lists.
  - Connection-selected view: when an edge/connection line is selected, show the full expanded source/target list represented by that line (including merged/trunked visuals).
  - Keep this phase read-only: selection and inspection only, no connection editing/mutation yet.

Phase 3B: Live Telemetry + Editable Runtime Values (new)

- Add read-only live telemetry overlays in Models view and Property Panel (config/inputs/outputs value snapshots).
- Add clear source tags per field (`YAML`, `Registry Default`, `Live Runtime`).
- Add opt-in live-edit mode for writable runtime fields (initially `inputs` and safe `config` fields only).
- Add guarded apply flow for live edits (validation, per-field apply/revert, failure surfacing).
- Define explicit save-back semantics from runtime values to model YAML (manual, confirm-first, diff-visible).

Implementation order:

1. Phase 0 (visual clarity + structural visibility)
2. Phase 1A (navigation + scale ergonomics)
3. Phase 2A (read-only properties + metadata surfacing)
4. Phase 2B (read-only connection inspection)
5. Phase 3 (trunked inter-model routing)
6. Phase 4 (core editability + full save pipeline)

# Future Work:

## Properies as a Modular Panel

- Turn it into a generic panel, as the Models, Telemetry etc panels are. Models panel just happens to use it with a fixed data-source, but when used standalone it can reflect whatever source we point it at. Maybe. Certainly should be useful for Project panel.

## Telemetry Schema-Driven Parsing/Rendering

- Start removing telemetry parser/rendering hard-coded assumptions where schema-derived traversal can replace bespoke logic.

## Core Editing Semantics + Data Correctness (backloaded)

- Enforce model structure constraints in-editor:
  - Allow exactly one root node per model.
  - Root may be one of:
    - plain workload
    - `SyncedGroupWorkload`
    - `SequencedGroupWorkload`
  - Allow at most one `SyncedGroupWorkload` and one `SequencedGroupWorkload` per model.
  - If both are present, enforce order: `SyncedGroupWorkload` outer, `SequencedGroupWorkload` inner.
  - Disallow invalid create/drop/reparent actions at interaction time (not only post-hoc validation).
- Expand from layout/mock editing to full authoring flow:
  - Create/edit/delete/reorder workloads and structural groups.
  - Edit names, types, config, inputs, outputs with schema-aware forms.
  - Support guarded structural transforms (e.g. wrap in synced/sequenced group).
  - Improve structural editing affordances:
    - Treat group workloads as first-class structural nodes (rename/edit/remove/convert controls).
    - Ensure structure controls remain visible even when workload cards are dense.
- Persistence and source-of-truth:
  - Round-trip model YAML reliably (load -> edit -> save -> reload with no semantic drift).
  - Integrate launcher metadata and validation in write path.
  - Provide clear dirty-state, save, and conflict/error handling UX.
- Safety and validation:
  - Pre-save validation for structural constraints and field typing.
  - Actionable inline errors with source paths/fields.
  - Regression tests for representative model shapes and group combinations.
