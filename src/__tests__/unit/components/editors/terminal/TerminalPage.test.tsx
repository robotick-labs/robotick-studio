import React from "react";
import { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createRoot } from "react-dom/client";

const terminalLogServiceMock = vi.hoisted(() => {
  const subscribers = new Set<() => void>();
  const service = {
    subscribe: vi.fn((listener: () => void) => {
      subscribers.add(listener);
      listener();
      return () => {
        subscribers.delete(listener);
      };
    }),
    getMessages: vi.fn(() => [
      {
        kind: "text",
        target: "runtime",
        source: "plain-text",
        text: "alpha log",
      },
      {
        kind: "text",
        target: "runtime",
        source: "plain-text",
        text: "beta log",
      },
    ]),
    getStats: vi.fn(() => ({
      totalReceived: 2,
      bufferedCount: 2,
      droppedCount: 0,
      flushIntervalMs: 32,
    })),
    clearMessages: vi.fn(),
    getClearOnRun: vi.fn(() => true),
    setClearOnRun: vi.fn(),
  };
  return { service, subscribers };
});

vi.mock("../../../../../renderer/data-sources/launcher", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("../../../../../renderer/data-sources/launcher")
  >();
  return {
    ...actual,
    terminalLogService: terminalLogServiceMock.service,
  };
});

import TerminalPage, {
  formatTerminalDisplayTime,
} from "../../../../../renderer/components/editors/terminal/TerminalPage";
import { PanelInstanceProvider } from "../../../../../renderer/components/workbenches/PanelInstanceContext";

function PanelHost({
  panelId,
  workbenchId,
  children,
}: {
  panelId: string;
  workbenchId: string;
  children: React.ReactNode;
}) {
  const [settings, setSettings] = React.useState<Record<string, unknown>>({});

  return (
    <>
      <PanelInstanceProvider
        panelId={panelId}
        workbenchId={workbenchId}
        settings={settings}
        setSettings={setSettings}
        updateSettings={(partial) =>
          setSettings((current) => ({ ...current, ...partial }))
        }
      >
        {children}
      </PanelInstanceProvider>
      <div data-testid={`settings-${panelId}`}>{JSON.stringify(settings)}</div>
    </>
  );
}

function setInputValue(input: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(
    input,
    value
  );
  input.dispatchEvent(
    new Event("input", {
      bubbles: true,
      cancelable: true,
    })
  );
}

describe("TerminalPage panel settings", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.clearAllMocks();
    terminalLogServiceMock.service.getMessages.mockReturnValue([
      { kind: "text", target: "runtime", source: "plain-text", text: "alpha log" },
      { kind: "text", target: "runtime", source: "plain-text", text: "beta log" },
    ]);
    terminalLogServiceMock.service.getStats.mockReturnValue({
      totalReceived: 2,
      bufferedCount: 2,
      droppedCount: 0,
      flushIntervalMs: 32,
    });
  });

  it("lets Studio render structured launcher log events with readable timestamps", async () => {
    terminalLogServiceMock.service.getMessages.mockReturnValue([
      {
        kind: "launcher-event",
        target: "runtime",
        event: {
          project_id: "barr-e",
          model_id: "barr-e-face",
          source_kind: "launcher-worker",
          path: "/tmp/face.log",
          offset: 12,
          line: "face ready",
          timestamp: "2026-06-12T13:54:27.140Z",
        },
      },
    ]);
    const container = document.createElement("div");
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <PanelHost panelId="panel-a" workbenchId="workbench">
          <TerminalPage />
        </PanelHost>
      );
      await Promise.resolve();
    });

    expect(formatTerminalDisplayTime("2026-06-12T13:54:27.140Z")).toMatch(
      /^\d{2}:\d{2}:\d{2}\.140$/
    );
    expect(container.textContent).toContain("barr-e-face");
    expect(container.textContent).toContain("runtime");
    expect(container.textContent).toContain("launcher-worker");
    expect(container.textContent).toContain("face ready");

    act(() => {
      root.unmount();
    });
  });

  it("stores the text filter per panel instance", async () => {
    const container = document.createElement("div");
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <>
          <PanelHost panelId="panel-a" workbenchId="workbench">
            <TerminalPage />
          </PanelHost>
          <PanelHost panelId="panel-b" workbenchId="workbench">
            <TerminalPage />
          </PanelHost>
        </>
      );
      await Promise.resolve();
    });

    const filters = Array.from(
      container.querySelectorAll<HTMLInputElement>("input[type='text']")
    );
    expect(filters).toHaveLength(2);

    await act(async () => {
      setInputValue(filters[0], "alpha");
      await Promise.resolve();
    });

    expect(filters[0].value).toBe("alpha");
    expect(filters[1].value).toBe("");
    expect(
      container.querySelector("[data-testid='settings-panel-a']")?.textContent
    ).toContain('"filter":"alpha"');
    expect(
      container.querySelector("[data-testid='settings-panel-b']")?.textContent
    ).toBe("{}");
    expect(
      window.localStorage.getItem(
        "robotick-studio.terminal.panel.workbench.panel-a"
      )
    ).toBeNull();

    act(() => {
      root.unmount();
    });
  });

  it("filters runtime and studio targets independently and shows source labels", async () => {
    terminalLogServiceMock.service.getMessages.mockReturnValue([
      {
        kind: "launcher-event",
        target: "runtime",
        event: {
          project_id: "barr-e",
          model_id: "barr-e-face",
          source_kind: "launcher-worker",
          path: "/tmp/face.log",
          offset: 12,
          line: "runtime ready",
          timestamp: "2026-06-12T13:54:27.140Z",
        },
      },
      {
        kind: "studio-event",
        target: "studio",
        event: {
          target: "studio",
          source: "renderer_fetch",
          window_id: "main",
          recorded_at: "2026-06-12T13:54:28.140Z",
          level: "error",
          message: "failed to fetch",
          source_url: null,
          line: null,
          column: null,
          stack: null,
          payload: null,
        },
      },
    ]);
    const container = document.createElement("div");
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <PanelHost panelId="panel-a" workbenchId="workbench">
          <TerminalPage />
        </PanelHost>
      );
      await Promise.resolve();
    });

    expect(container.textContent).toContain("runtime");
    expect(container.textContent).toContain("studio");
    expect(container.textContent).toContain("launcher-worker");
    expect(container.textContent).toContain("renderer_fetch");

    const studioToggle =
      container.querySelector<HTMLInputElement>("input#show-studio");
    await act(async () => {
      studioToggle?.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true })
      );
      await Promise.resolve();
    });

    expect(container.textContent).toContain("runtime ready");
    expect(container.textContent).not.toContain("failed to fetch");

    act(() => {
      root.unmount();
    });
  });

  it("shows an empty state when target selection and filter exclude all messages", async () => {
    terminalLogServiceMock.service.getMessages.mockReturnValue([
      {
        kind: "studio-event",
        target: "studio",
        event: {
          target: "studio",
          source: "renderer_console",
          window_id: "main",
          recorded_at: "2026-06-12T13:54:29.140Z",
          level: "info",
          message: "only studio message",
          source_url: null,
          line: null,
          column: null,
          stack: null,
          payload: null,
        },
      },
    ]);
    const container = document.createElement("div");
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <PanelHost panelId="panel-a" workbenchId="workbench">
          <TerminalPage />
        </PanelHost>
      );
      await Promise.resolve();
    });

    const runtimeToggle =
      container.querySelector<HTMLInputElement>("input#show-runtime");
    const studioToggle =
      container.querySelector<HTMLInputElement>("input#show-studio");
    await act(async () => {
      runtimeToggle?.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true })
      );
      studioToggle?.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true })
      );
      await Promise.resolve();
    });

    expect(container.textContent).toContain(
      "No log entries match the current target selection and filter."
    );

    act(() => {
      root.unmount();
    });
  });

  it("renders only a busy-stream tail by default and can show line numbers", async () => {
    terminalLogServiceMock.service.getStats.mockReturnValue({
      totalReceived: 1200,
      bufferedCount: 1200,
      droppedCount: 0,
      flushIntervalMs: 32,
    });
    terminalLogServiceMock.service.getMessages.mockReturnValue(
      Array.from({ length: 1200 }, (_, index) => ({
        kind: "text" as const,
        target: "runtime" as const,
        source: "plain-text" as const,
        text: `line ${index + 1}`,
      }))
    );
    const container = document.createElement("div");
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <PanelHost panelId="panel-a" workbenchId="workbench">
          <TerminalPage />
        </PanelHost>
      );
      await Promise.resolve();
    });

    expect(container.textContent).toContain(
      "Rendering 600 of 1200 visible lines (601-1200)"
    );
    expect(container.textContent).toContain("line 1200");
    expect(container.textContent).not.toContain("line 500");

    const lineNumberToggle = container.querySelector<HTMLInputElement>(
      "input#show-line-numbers"
    );
    await act(async () => {
      lineNumberToggle?.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true })
      );
      await Promise.resolve();
    });

    expect(container.textContent).toContain("601");
    expect(container.textContent).toContain("1200");

    act(() => {
      root.unmount();
    });
  });

  it("keeps Studio lines visible when runtime chatter dominates the live tail", async () => {
    terminalLogServiceMock.service.getStats.mockReturnValue({
      totalReceived: 1200,
      bufferedCount: 1200,
      droppedCount: 0,
      flushIntervalMs: 32,
    });
    terminalLogServiceMock.service.getMessages.mockReturnValue([
      ...Array.from({ length: 1150 }, (_, index) => ({
        kind: "text" as const,
        target: "runtime" as const,
        source: "plain-text" as const,
        text: `runtime chatter ${index + 1}`,
      })),
      ...Array.from({ length: 50 }, (_, index) => ({
        kind: "studio-event" as const,
        target: "studio" as const,
        event: {
          target: "studio" as const,
          source: "renderer_console",
          window_id: "main",
          recorded_at: `2026-06-12T13:54:${String(index).padStart(2, "0")}.140Z`,
          level: "info" as const,
          message: `studio chatter ${index + 1}`,
          source_url: null,
          line: null,
          column: null,
          stack: null,
          payload: null,
        },
      })),
    ]);
    const container = document.createElement("div");
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <PanelHost panelId="panel-a" workbenchId="workbench">
          <TerminalPage />
        </PanelHost>
      );
      await Promise.resolve();
    });

    expect(container.textContent).toContain("runtime chatter 1150");
    expect(container.textContent).toContain("studio chatter 1");
    expect(container.textContent).toContain("studio chatter 50");
    expect(container.textContent).not.toContain("runtime chatter 500");

    act(() => {
      root.unmount();
    });
  });

  it("freezes the rendered window when auto-scroll is disabled", async () => {
    function runtimeLines(count: number) {
      return Array.from({ length: count }, (_, index) => ({
        kind: "text" as const,
        target: "runtime" as const,
        source: "plain-text" as const,
        text: `runtime line ${index + 1}`,
      }));
    }
    terminalLogServiceMock.service.getStats.mockReturnValue({
      totalReceived: 1200,
      bufferedCount: 1200,
      droppedCount: 0,
      flushIntervalMs: 32,
    });
    terminalLogServiceMock.service.getMessages.mockReturnValue(runtimeLines(1200));
    const container = document.createElement("div");
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <PanelHost panelId="panel-a" workbenchId="workbench">
          <TerminalPage />
        </PanelHost>
      );
      await Promise.resolve();
    });

    const autoScrollToggle =
      container.querySelector<HTMLInputElement>("input#auto-scroll");
    await act(async () => {
      autoScrollToggle?.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true })
      );
      await Promise.resolve();
    });

    terminalLogServiceMock.service.getStats.mockReturnValue({
      totalReceived: 1300,
      bufferedCount: 1300,
      droppedCount: 0,
      flushIntervalMs: 32,
    });
    terminalLogServiceMock.service.getMessages.mockReturnValue(runtimeLines(1300));
    await act(async () => {
      for (const subscriber of terminalLogServiceMock.subscribers) {
        subscriber();
      }
      await Promise.resolve();
    });

    expect(container.textContent).toContain(
      "Rendering 600 of 1300 visible lines (601-1200)"
    );
    expect(container.textContent).toContain("runtime line 1200");
    expect(container.textContent).not.toContain("runtime line 1300");

    act(() => {
      root.unmount();
    });
  });

  it("marks clear on run as global with a tooltip and delegates it to the shared service", async () => {
    const container = document.createElement("div");
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <PanelHost panelId="panel-a" workbenchId="workbench">
          <TerminalPage />
        </PanelHost>
      );
      await Promise.resolve();
    });

    expect(container.textContent).toContain("Clear on Run");
    expect(container.textContent).not.toContain("Clear on Run (global)");
    expect(
      container.querySelector("label[title='Affects all terminal panels']")
    ).not.toBeNull();
    const clearOnRun = container.querySelector<HTMLInputElement>(
      "input#clear-on-run"
    );
    expect(clearOnRun).not.toBeNull();

    await act(async () => {
      clearOnRun?.dispatchEvent(
        new MouseEvent("click", {
          bubbles: true,
          cancelable: true,
        })
      );
      await Promise.resolve();
    });

    expect(terminalLogServiceMock.service.setClearOnRun).toHaveBeenCalledWith(
      false
    );

    act(() => {
      root.unmount();
    });
  });
});
