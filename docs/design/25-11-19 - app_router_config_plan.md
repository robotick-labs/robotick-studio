# App Router Config Plan

## Goals
- Drive top-level workspaces and navigation menus from a single YAML config to enable per-project or per-user customization.
- Maintain the existing `navMenuDev`/`navMenuTest` groups plus new `project-select` and `help` groups.
- Keep the header “project selector” combo as a special case for now (not data-driven).
- Prepare for future feature gating by centralizing config loading/exposure via an `AppConfigService`.

## Requirements
1. **Config files**: YAML under `src/renderer/config/app-workspaces.yaml` and `src/renderer/config/app-editors.yaml` (canonical locations). Each workspace entry in `app-workspaces.yaml` defines:
   - `id`: unique string.
   - `path`: route path (`/telemetry`).
   - `label`: menu label
   - `group`: one of `project-select`, `dev`, `test`, `help`.
   - `module`: import path for the page component.
   - Optional `exact`, `icon`, etc. for future use.
2. **AppConfigService**:
   - Loads the YAML at startup (throw if missing/invalid).
   - Exposes immutable `workspaces` array and a `useAppConfig` hook.
   - Future-friendly for feature flags/overrides.
3. **Router/Header updates**:
   - Router consumes `workspaces` to generate `<Route>` entries.
   - Header nav reads the same config to render menu buttons grouped by `group`.
   - Maintain Project selector combo as hardcoded but positioned in `project-select` group.
   - Add Help menu group (currently only the help link).
4. **Testing**:
   - Unit test `AppConfigService` parsing and error handling.
   - Simple integration test that Router renders a workspace defined in YAML.

## Deliverables
- `src/renderer/config/app-workspaces.yaml`
- `src/renderer/config/app-editors.yaml`
- `src/renderer/services/AppConfigService.ts` (name TBD)
- Updated `Router.tsx` and header to consume config
- Tests covering config load + router wiring
