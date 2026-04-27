# Launcher Service Contract

The Launcher service is the narrow waist between the renderer (React UI,
viewers) and the Python launcher backend (`tools/robotick-launcher`). All UI
code **must** go through the public API that lives in
`src/renderer/data-sources/launcher/index.ts`; nothing in
`.../internal/*` is considered stable.

## Public surface

```ts
import {
  launcherService,             // Non‑React consumers
  LauncherServiceProvider,     // React provider
  useLauncherService,          // React hook
  createLauncherService,       // Factory for overrides
} from "@/renderer/data-sources/launcher";
```

`LauncherService` is a plain TypeScript interface (see
`internal/LauncherService.tsx`) that covers:

- Project selection + change notifications.
- Launcher profile selection + notifications.
- REST calls for project paths, settings, RC configuration, models, and
  launcher status/logs.
- Launcher run/stop lifecycle helpers.

React components should wrap themselves in
`<LauncherServiceProvider service={...}>` when they need to override the
implementation (e.g. tests, Storybook, sandbox apps). Non-React modules can
import the singleton `launcherService`, but only from the public index module.

## Testing/mocking

To make tests and prototypes easier, use `createMockLauncherService`:

```ts
import {
  createMockLauncherService,
  LauncherServiceProvider,
} from "@/renderer/data-sources/launcher";

const mockService = createMockLauncherService({
  fetchProjectPaths: async () => ["/tmp/project"],
});

render(
  <LauncherServiceProvider service={mockService}>
    <MyComponent />
  </LauncherServiceProvider>
);
```

The mock tracks project/profile setters, emits change events, and stubs every
async method with safe defaults. Tests can override whichever methods they
care about.

## Rules of the road

- Do **not** import files from `data-sources/launcher/internal/` outside the
  launcher package.
- When adding new launcher functionality, extend the `LauncherService`
  interface and update this document.
- If a module needs launcher state but cannot use React hooks, depend on the
  `launcherService` singleton or accept a `LauncherService` parameter.
