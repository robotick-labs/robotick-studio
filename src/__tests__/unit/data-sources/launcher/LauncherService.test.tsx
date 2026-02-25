import React, { useLayoutEffect } from "react";
import { act } from "react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { createRoot } from "react-dom/client";

import {
  LauncherServiceProvider,
  useLauncherService,
  launcherService,
  createMockLauncherService,
} from "../../../../renderer/data-sources/launcher";
import type { LauncherService } from "../../../../renderer/data-sources/launcher";

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

function renderInsideProvider(
  node: React.ReactElement,
  service?: LauncherService
) {
  const container = document.createElement("div");
  const root = createRoot(container);

  act(() => {
    root.render(
      <LauncherServiceProvider service={service}>{node}</LauncherServiceProvider>
    );
  });

  return () => {
    act(() => root.unmount());
    container.remove();
  };
}

function HookProbe({ onValue }: { onValue: (svc: LauncherService) => void }) {
  const service = useLauncherService();
  useLayoutEffect(() => {
    onValue(service);
  }, [service, onValue]);
  return null;
}

describe("LauncherServiceProvider", () => {
  it("logs an error when the hook is used without a provider", () => {
    function NakedHook() {
      useLauncherService();
      return null;
    }
    const container = document.createElement("div");
    const root = createRoot(container);
    let thrown: unknown;
    try {
      act(() => {
        root.render(<NakedHook />);
      });
    } catch (error) {
      thrown = error;
    } finally {
      act(() => root.unmount());
      container.remove();
    }
    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toContain(
      "useLauncherService must be used within LauncherServiceProvider"
    );
  });

  it("exposes the shared launcherService when no override is provided", () => {
    const capture = vi.fn();
    const unmount = renderInsideProvider(<HookProbe onValue={capture} />);
    expect(capture).toHaveBeenCalledWith(launcherService);
    unmount();
  });

  it("allows injecting a mock service", () => {
    const capture = vi.fn();
    const mockService = createMockLauncherService({
      projectPath: "/tmp/project",
      getModelHostName: () => "mock-host",
    });

    const unmount = renderInsideProvider(
      <HookProbe onValue={capture} />,
      mockService
    );

    expect(capture).toHaveBeenCalledWith(mockService);
    expect(capture.mock.calls.at(-1)?.[0].getModelHostName()).toBe("mock-host");
    unmount();
  });
});
