# Global State Inventory (2025-12-11)

> Purpose: document the current singletons and direct browser API usage across Robotick Studio so that we know what needs isolation/DI before the OSS launch.

## Runtime singletons

| Area | File(s) | Notes |
| --- | --- | --- |
| Launcher service | `src/renderer/data-sources/launcher/internal/LauncherService.ts` | Exports `launcherService`, `LauncherServiceProvider`, and `useLauncherService`. Non-React consumers still import `launcherService` directly. |
| ProjectData models | `src/renderer/data-sources/launcher/internal/react-api.ts` | Keeps cached project descriptors/state outside React; exposes context hooks. |
| Telemetry store | `src/renderer/data-sources/telemetry/internal/telemetry-store.ts` | Module-level maps/timers keyed by telemetry base URL. No reset helper yet. |
| Viewer modules | `src/renderer/components/viewer/{cesium,three,streaming-image}` | Each module stores viewer instances, telemetry trackers, and DOM refs in module-level variables. |
| Floating panels | `src/renderer/components/workspaces/floating-panels/floating-panel-store.ts` | In-memory map of panel records scoped by workspace. |
| Terminal log service | `src/renderer/data-sources/launcher/internal/terminal-log-service.ts` | Singleton `terminalLogService` manages websocket + preferences. |
| Workspace memory | `src/renderer/utils/workspaceMemory.ts` | Helper functions now backed by `services/storage`. |
| Models editor panel state | `src/renderer/components/editors/models/ModelsPage.tsx` | Per-panel-instance persistence via namespaced keys: viewport (`robotick-studio.models.viewport`), collapsed models (`robotick-studio.models.collapsed`), and view state (`robotick-studio.models.view-state`, including `Connections` mode + selected node). |

## Direct browser API usage

| API | File(s) | Follow-up |
| --- | --- | --- |
| `document.getElementById`, `document.body` | Viewer modules (e.g., `viewer-cesium.ts`), header components | Replace with `ViewerHost` + ref wiring and `domEnvironment` wrapper. |
| `window.addEventListener`, `window.innerWidth/innerHeight` | `PanelContextMenu.tsx`, `floating-panel-store.ts` | Wrap via `domEnvironment` helper. |
| `window.localStorage` | (now centralized) `services/storage.ts` | ✅ Already routed through preload bridge. |
| `window.matchMedia`, `window.navigator` | `src/renderer/utils/environment.ts`, header components | Should be accessed via `domEnvironment`. |
| `window.performance` | Viewer performance overlays | Consider exposing via wrapper for tests. |

## Action items

1. Introduce a `domEnvironment` service that exposes the browser primitives listed above and can be mocked in tests.
2. Add `reset()` helpers to telemetry store, floating panel store, terminal log service, and viewer managers once refactored.
3. Ensure all future singletons are documented here (update the date when rerun).
