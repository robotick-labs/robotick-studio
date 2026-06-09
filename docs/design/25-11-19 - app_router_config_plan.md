# App Router Config Plan

## Goals
- Historical note:
  this plan originally proposed a dedicated renderer-owned workbench YAML. The current implementation instead drives top-level workbenches and navigation menus from the active `studio_document`, seeded from `studio.template.yaml`, so bootstrap, routing, and header/menu presentation share one source.
- Maintain the existing `navMenuDev`/`navMenuTest` groups plus new `project-select` and `help` groups.
- Keep the header “project selector” combo as a special case for now (not data-driven).
- Prepare for future feature gating by centralizing config loading/exposure via an `AppConfigService`.

## Requirements
1. **Config files**: YAML under `studio.template.yaml` and `src/renderer/config/app-editors.yaml` (canonical locations). Each seeded workbench entry in `studio.template.yaml` defines:
   - `id`: unique string.
   - `path`: route path (`/telemetry`).
   - `label`: menu label
   - `group`: one of `project-select`, `dev`, `test`, `help`.
   - `defaultEditorId`: default editor for the workbench.
   - Optional `defaultLayoutId`, `layouts`, etc. for future use.
2. **AppConfigService**:
   - Loads editor config plus the active Studio document at startup.
   - Exposes immutable `workbenches`/`windows` arrays and a `useAppConfig` hook.
   - Future-friendly for feature flags/overrides.
3. **Router/Header updates**:
   - Router consumes `workbenches` to generate `<Route>` entries.
   - Header nav reads the same active Studio document to render menu buttons grouped by `group`.
   - Maintain Project selector combo as hardcoded but positioned in `project-select` group.
   - Add Help menu group (currently only the help link).
4. **Testing**:
   - Unit test `AppConfigService` seed/document handling and error handling.
   - Simple integration test that Router renders a seeded workbench route.

## Deliverables
- `studio.template.yaml`
- `src/renderer/config/app-editors.yaml`
- `src/renderer/services/AppConfigService.ts` (name TBD)
- Updated `Router.tsx` and header to consume config
- Tests covering config load + router wiring
