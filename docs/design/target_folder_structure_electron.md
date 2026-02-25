# **Ticket: Canonical Electron Folder Structure + Full Test Suite Layout**

**Type:** Architecture / Refactor  
**Priority:** High  
**Goal:** Restructure Robotick Studio into a scalable, editor-grade Electron IDE with full TDD support across all layers.

This layout keeps the `robotick-hub` renderer under `renderer/` so it can be hosted both in the browser and inside Robotick Studio.

---

## **🎯 Objective**

Adopt a clean three-layer Electron structure with matching test suites:

1. **System Layer** — Electron main (OS access, engine orchestration)
2. **Preload Layer** — sandbox bridge (typed, safe IPC surface)
3. **Renderer Layer** — Vite + React UI (Document Model, telemetry, views)

Add unit tests, integration tests, and E2E tests for each part.

---

## **📁 Target Folder Structure**

```
robotick-studio/
│
├── electron/
│   ├── main/
│   │   ├── main.ts
│   │   ├── windows/
│   │   ├── engine/
│   │   ├── filesystem/
│   │   ├── processes/
│   │   ├── ipc/
│   │   └── __tests__/
│   │       ├── engine.test.ts
│   │       ├── ipc.test.ts
│   │       ├── windows.test.ts
│   │       └── filesystem.test.ts
│   │
│   ├── preload/
│   │   ├── preload.ts
│   │   └── api/
│   │       ├── engine.ts
│   │       ├── filesystem.ts
│   │       ├── settings.ts
│   │       ├── telemetry.ts
│   │       └── __tests__/
│   │           ├── api-engine.test.ts
│   │           ├── api-fs.test.ts
│   │           ├── api-settings.test.ts
│   │           └── api-telemetry.test.ts
│   │
│   └── common/
│       ├── channels.ts
│       ├── messages.ts
│       └── ipc-types.ts
│       └── __tests__/
│           ├── channels.test.ts
│           ├── messages.test.ts
│           └── types.test.ts
│
├── renderer/
│   ├── index.html
│   ├── main.tsx
│   ├── components/
│   ├── pages/
│   ├── state/
│   ├── models/
│   │   └── __tests__/
│   │       ├── telemetry-model.test.ts
│   │       ├── layout-parser.test.ts
│   │       ├── selection-state.test.ts
│   │       └── document-model.test.ts
│   │
│   ├── services/
│   │   └── __tests__/
│   │       ├── telemetry-client.test.ts
│   │       ├── decoder-primitives.test.ts
│   │       ├── decoder-fixedstrings.test.ts
│   │       └── decoder-arrays.test.ts
│   │
│   ├── hooks/
│   ├── styles/
│   └── __tests__/
│       ├── components.test.tsx
│       ├── telemetry-fields.test.tsx
│       └── pinned-panels.test.tsx
│
├── test/
│   ├── e2e/
│   │   ├── startup.test.ts
│   │   ├── telemetry-flow.test.ts
│   │   ├── pinned-view.test.ts
│   │   └── model-edit.test.ts
│   │
│   ├── integration/
│   │   ├── main-preload-ipc.test.ts
│   │   ├── engine-launch.test.ts
│   │   ├── engine-telemetry-endpoint.test.ts
│   │   └── renderer-integration.test.ts
│   │
│   └── helpers/
│       ├── electron-launcher.ts
│       ├── mock-engine.ts
│       ├── fake-telemetry-stream.ts
│       └── fixtures/
│
├── scripts/
├── dist/
├── tsconfig.json
├── vite.config.ts
└── package.json
```

---

## **🧪 Test Suite Overview**

### **System Layer Tests**

- window creation
- engine launch / shutdown
- filesystem ops
- ipcMain handlers
- process supervision

### **Preload Layer Tests**

- safe API exposure
- type correctness
- ipcRenderer.invoke correctness
- access restrictions

### **Renderer Layer Tests**

**Models**

- layout parsing
- buffer decoding
- fixed-string handling
- document model integrity

**Services**

- websocket telemetry
- raw → decoded struct validation

**React Views**

- component rendering
- stability under rapid updates
- pinned widgets
- multi-line struct views

### **Integration Tests**

- renderer ↔ preload ↔ main ↔ mock engine round-trips
- session ID change handling
- layout refresh behaviour

### **E2E Tests (Playwright)**

- full app boot
- maximise behaviour
- telemetry UI updating
- model editor loading
- pinned views persistence

---

## **🎬 Migration Steps**

1. Create new folder structure.
2. Move `electron-main.js` → `electron/main/main.ts`.
3. Move `electron-preload.js` → `electron/preload/preload.ts`.
4. Add `electron/common` and migrate channel/types.
5. Move Vite/React code into `renderer/`.
6. Add test folders per layer.
7. Implement Vitest config for Electron + Renderer.
8. Implement Playwright config for E2E.
9. Update dev scripts for running each suite.
10. Add CI matrix for:

- unit
- integration
- e2e
