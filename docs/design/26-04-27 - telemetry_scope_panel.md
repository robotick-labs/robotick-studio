# **Ticket: Telemetry Scope Panel**

**Type:** UI / Telemetry Tooling  
**Priority:** High  
**Goal:** Provide a compact Studio-side scope panel for comparing live scalar telemetry signals across models and workloads.

The panel is intentionally narrow in scope. It is not a generic plotting system; it is a practical debugging tool for inspecting a small number of live scalar fields together.

---

## **Objective**

Add a Studio panel that:

1. plots live scalar telemetry history
2. allows multiple fields to be overlaid as independent traces
3. keeps field configuration, plot area, and scope settings clearly separated
4. persists panel configuration per panel instance between sessions

The intended layout is:

- field settings at the top
- scope plot in the middle
- scope settings at the bottom

---

## **V1 Scope**

Version 1 accepts only compatible scalar telemetry fields:

- numeric scalars
- boolean scalars, rendered as `0` / `1`

Version 1 explicitly excludes:

- arrays
- structs
- images
- binary blobs
- other non-scalar telemetry types

History is built inside Studio rather than being fetched from the runtime:

- sample at panel refresh cadence
- maintain a ring buffer per trace
- render over a configurable time window

---

## **Panel Decisions**

### **Field Settings**

- Field settings live in a top expandable section.
- The section is shown by default.
- The top toggle reads `Show Field Settings` / `Hide Field Settings`.
- All field rows, including the default row, live inside that section.
- All field rows are presented consistently.

Each row provides:

- delete button
- `Model`
- `Workload`
- `Section`
- `Field`
- `Color`
- `Scale`
- `Offset`
- `Visible`

`Label Override` was removed.

### **Scope Settings**

- Scope settings live in a separate bottom expandable section.
- The plot remains visible between the two expandable sections.

Current settings are:

- `Window`
- read-only `Sample Rate`
- `Freeze`
- `Clear`
- `Y Mode`
- `Y Min`
- `Y Max`
- `Show Grid`
- `Show Legend`
- `Show Latest Values`

`Sample Rate` is read-only in v1 and reflects the effective incoming telemetry rate used by the selected traces.

When `Y Mode` is `Auto`, `Y Min` and `Y Max` are read-only. When `Y Mode` is `Manual`, they are editable.

---

## **Persistence**

- Persist all panel configuration per panel instance.
- Do not persist sampled history across sessions.
- Persist only panel settings, not buffered telemetry data.

Current assumption:

- sampled history should remain transient unless there is a later explicit requirement to persist it

---

## **Delivery Status**

### **Stage 1**

Stage 1 focused on layout and interaction validation:

- add `Telemetry Scope` as a panel option
- build the control layout
- persist per-panel-instance settings
- render mock traces to validate real estate and UX

**Status:** Implemented

### **Stage 2**

Stage 2 replaced the mock path with real telemetry:

- derive `Model`, `Workload`, and `Section` options from live project models and telemetry schema
- replace the mock field catalogue with schema-driven options
- enforce scalar compatibility filtering
- resolve field choices from the selected row context
- preserve persisted selections when still valid
- fall back cleanly when a model, workload, or field disappears
- replace mock traces with real sampled telemetry
- maintain a per-trace ring buffer in Studio
- drive the read-only `Sample Rate` display from live effective input rate
- render boolean traces consistently as `0` / `1`
- handle empty states and reconnect/schema refresh behaviour cleanly
- preserve panel configuration across reconnects where possible

**Status:** Implemented

---

## **Current Verification**

- `npm run build` passes in `robotick/robotick-studio`

Current typecheck status:

- `npm run typecheck` is blocked by existing unrelated `Uint8Array<ArrayBufferLike>` errors in telemetry image and streaming-image code

---

## **Remaining Follow-Up**

The main remaining work is test coverage for the new panel:

- per-panel-instance settings persistence
- scalar compatibility filtering
- selector fallback when schema changes
- ring-buffer and history behaviour
- boolean rendering

This panel is already proving useful as a debugging surface, so the next step is to harden it with focused renderer tests rather than expanding the feature scope further.
