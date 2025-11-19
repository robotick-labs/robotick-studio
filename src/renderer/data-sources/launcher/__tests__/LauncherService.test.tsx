import React, { useLayoutEffect } from "react";
import { describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import {
  Launcher,
  LauncherServiceProvider,
  Project,
} from "..";
import type { LauncherService } from "..";
import { createMockLauncherService } from "../internal/__mocks__/LauncherService";

function renderWithLauncherService(
  service: LauncherService,
  node: React.ReactElement
) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      <LauncherServiceProvider service={service}>{node}</LauncherServiceProvider>
    );
  });

  return {
    unmount() {
      act(() => root.unmount());
      container.remove();
    },
  };
}

function ProjectConsumer({
  onValue,
}: {
  onValue: (value: ReturnType<typeof Project.Context.use>) => void;
}) {
  const ctx = Project.Context.use();
  useLayoutEffect(() => {
    onValue(ctx);
  }, [ctx, onValue]);
  return null;
}

function LauncherConsumer({
  onValue,
}: {
  onValue: (value: ReturnType<typeof Launcher.Context.use>) => void;
}) {
  const ctx = Launcher.Context.use();
  useLayoutEffect(() => {
    onValue(ctx);
  }, [ctx, onValue]);
  return null;
}

async function flushPromises() {
  await act(async () => {
    await Promise.resolve();
  });
}

describe("Launcher service integration", () => {
  it("injects the launcher service into the Project provider", () => {
    const setProjectPath = vi.fn();
    const service = createMockLauncherService({
      getProjectPath: () => "/mock/path",
      setProjectPath,
    });
    const capture = vi.fn();

    const { unmount } = renderWithLauncherService(
      service,
      <Project.Context.Provider>
        <ProjectConsumer onValue={capture} />
      </Project.Context.Provider>
    );

    expect(capture).toHaveBeenCalled();
    const ctx = capture.mock.calls.at(-1)?.[0];
    expect(ctx?.projectPath).toBe("/mock/path");

    act(() => {
      ctx?.setProjectPath("/new/path");
    });
    expect(setProjectPath).toHaveBeenCalledWith("/new/path");
    unmount();
  });

  it("routes launcher run requests and surfaces errors from the service", async () => {
    const runError = new Error("boom");
    const requestLauncherRun = vi.fn().mockRejectedValue(runError);
    const fetchLauncherStatus = vi
      .fn()
      .mockResolvedValue({ status: "stopped" });
    const service = createMockLauncherService({
      getProjectPath: () => "/proj",
      getLauncherProfile: () => "custom-profile",
      requestLauncherRun,
      fetchLauncherStatus,
    });

    const capture = vi.fn();
    const { unmount } = renderWithLauncherService(
      service,
      <Project.Context.Provider>
        <Launcher.Context.Provider>
          <LauncherConsumer onValue={capture} />
        </Launcher.Context.Provider>
      </Project.Context.Provider>
    );

    await flushPromises();
    const ctx = capture.mock.calls.at(-1)?.[0];
    expect(ctx).toBeDefined();

    let thrown: unknown;
    await act(async () => {
      try {
        await ctx.run();
      } catch (err) {
        thrown = err;
      }
    });

    expect(thrown).toBe(runError);
    expect(requestLauncherRun).toHaveBeenCalledWith("/proj", "custom-profile");

    await flushPromises();
    const latestCtx = capture.mock.calls.at(-1)?.[0];
    expect(latestCtx?.lastError).toBe("boom");
    unmount();
  });
});
