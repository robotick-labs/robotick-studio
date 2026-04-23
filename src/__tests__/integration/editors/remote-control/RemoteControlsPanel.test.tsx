import React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import RemoteControlsPanel from "../../../../renderer/components/editors/remote-control/components/remote-controls/RemoteControlsPanel";
import { TelemetryServiceProvider } from "../../../../renderer/data-sources/telemetry";
import {
  resetLauncherDataTestState,
  resetTelemetryTestState,
} from "../../../helpers/renderWithProviders";
import { TestLauncherProviders } from "../../../helpers/mocks";

function makeTelemetryModel() {
  return {
    schemaSessionId: "sid-1",
    workloads: [],
    raw: null,
    workloads_buffer_size_used: 0,
    process_memory_used: 0,
    writable_inputs_by_path: new Map([
      [
        "spine_interface.inputs.angular_speed_norm",
        {
          field_handle: 1,
          incoming_connection_handle: 101,
        },
      ],
      [
        "spine_interface.inputs.linear_speed_norm",
        {
          field_handle: 2,
          incoming_connection_handle: 102,
        },
      ],
    ]),
  };
}

async function settle() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function waitForTimers(ms: number) {
  await act(async () => {
    await new Promise((resolve) => window.setTimeout(resolve, ms));
  });
}

function createPointerEvent(
  type: string,
  init: MouseEventInit & {
    pointerId?: number;
    pointerType?: string;
  } = {}
) {
  const event = new MouseEvent(type, init);
  Object.defineProperty(event, "pointerId", {
    configurable: true,
    value: init.pointerId ?? 1,
  });
  Object.defineProperty(event, "pointerType", {
    configurable: true,
    value: init.pointerType ?? "mouse",
  });
  return event;
}

describe("RemoteControlsPanel", () => {
  afterEach(() => {
    resetTelemetryTestState();
    resetLauncherDataTestState();
    window.localStorage.clear();
    vi.clearAllMocks();
  });

  it("renders stick mode controls from Studio config and resolves their target telemetry layouts", async () => {
    const originalGetGamepads = Object.getOwnPropertyDescriptor(
      Navigator.prototype,
      "getGamepads"
    );
    Object.defineProperty(Navigator.prototype, "getGamepads", {
      configurable: true,
      writable: true,
      value: () => [],
    });

    const telemetryModel = makeTelemetryModel();
    const telemetryService = {
      subscribeTelemetry: vi.fn((_baseUrl, _samplingRateHz, subscriber) => {
        subscriber.callback(telemetryModel as any);
        return () => {};
      }),
      ensureLayout: vi.fn(async () => telemetryModel as any),
      refreshLayout: vi.fn(async () => telemetryModel as any),
      setWorkloadInputConnectionState: vi.fn(async () => ({
        ok: true,
        status: 200,
        body: {},
      })),
      setWorkloadInputFieldsData: vi.fn(async () => ({
        ok: true,
        status: 200,
        body: {},
      })),
      getLatestModel: vi.fn(() => telemetryModel as any),
    };

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const projectModels = [
      {
        modelPath: "models/demo-robot-spine.model.yaml",
        modelShortName: "demo-robot-spine",
        modelName: "DemoBot Spine",
        telemetryPort: 7095,
        telemetryBaseUrl: "http://example-spine",
        data: {},
      },
    ];

    try {
      act(() => {
        root.render(
          <TelemetryServiceProvider service={telemetryService as any}>
            <TestLauncherProviders
              serviceOverrides={{
                getProjectModels: vi.fn(async () => projectModels as any),
                refreshProjectModels: vi.fn(async () => projectModels as any),
              }}
            >
              <RemoteControlsPanel
                config={{
                  sticks: {
                    left: {
                      selectedMode: "drive_wheels",
                      modes: {
                        none: {},
                        drive_wheels: {
                          shapeTransform: "CircleToSquare",
                          deadZone: {
                            x: 0.1,
                            y: 0.1,
                          },
                          outputs: {
                            x: "demo-robot-spine.spine_interface.inputs.angular_speed_norm",
                            y: "demo-robot-spine.spine_interface.inputs.linear_speed_norm",
                          },
                        },
                      },
                    },
                  },
                }}
              />
            </TestLauncherProviders>
          </TelemetryServiceProvider>
        );
      });

      await settle();
      await settle();
      await settle();

      expect(document.body.textContent).not.toContain("TAKEOVER");
      expect(document.body.textContent).toContain("Left Stick");
      expect(document.body.textContent).toContain("Drive Wheels");
      expect(telemetryService.ensureLayout).toHaveBeenCalledWith(
        "http://example-spine"
      );
      const suppressionUpdates =
        telemetryService.setWorkloadInputConnectionState.mock.calls.flatMap(
          ([, request]) => request.updates ?? []
        );
      expect(suppressionUpdates).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            field_path: "spine_interface.inputs.angular_speed_norm",
            enabled: false,
          }),
          expect.objectContaining({
            field_path: "spine_interface.inputs.linear_speed_norm",
            enabled: false,
          }),
        ])
      );

      const select = document.body.querySelector("select");
      expect(select).not.toBeNull();
      act(() => {
        select!.value = "none";
        select!.dispatchEvent(new Event("change", { bubbles: true }));
      });
      await settle();
      await settle();

      const releaseUpdates =
        telemetryService.setWorkloadInputConnectionState.mock.calls.flatMap(
          ([, request]) => request.updates ?? []
        );
      expect(releaseUpdates).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            field_path: "spine_interface.inputs.angular_speed_norm",
            enabled: true,
          }),
          expect.objectContaining({
            field_path: "spine_interface.inputs.linear_speed_norm",
            enabled: true,
          }),
        ])
      );
    } finally {
      act(() => {
        root.unmount();
      });
      container.remove();
      if (originalGetGamepads) {
        Object.defineProperty(
          Navigator.prototype,
          "getGamepads",
          originalGetGamepads
        );
      } else {
        delete (Navigator.prototype as Navigator & { getGamepads?: unknown })
          .getGamepads;
      }
    }
  });

  it("restores selected stick modes after remount", async () => {
    const originalGetGamepads = Object.getOwnPropertyDescriptor(
      Navigator.prototype,
      "getGamepads"
    );
    Object.defineProperty(Navigator.prototype, "getGamepads", {
      configurable: true,
      writable: true,
      value: () => [],
    });

    const telemetryModel = makeTelemetryModel();
    const telemetryService = {
      subscribeTelemetry: vi.fn((_baseUrl, _samplingRateHz, subscriber) => {
        subscriber.callback(telemetryModel as any);
        return () => {};
      }),
      ensureLayout: vi.fn(async () => telemetryModel as any),
      refreshLayout: vi.fn(async () => telemetryModel as any),
      setWorkloadInputConnectionState: vi.fn(async () => ({
        ok: true,
        status: 200,
        body: {},
      })),
      setWorkloadInputFieldsData: vi.fn(async () => ({
        ok: true,
        status: 200,
        body: {},
      })),
      getLatestModel: vi.fn(() => telemetryModel as any),
    };
    const projectModels = [
      {
        modelPath: "models/demo-robot-spine.model.yaml",
        modelShortName: "demo-robot-spine",
        modelName: "DemoBot Spine",
        telemetryPort: 7095,
        telemetryBaseUrl: "http://example-spine",
        data: {},
      },
    ];
    const config = {
      sticks: {
        left: {
          selectedMode: "drive_wheels",
          modes: {
            none: {},
            drive_wheels: {
              shapeTransform: "CircleToSquare",
              deadZone: {
                x: 0.1,
                y: 0.1,
              },
              outputs: {
                x: "demo-robot-spine.spine_interface.inputs.angular_speed_norm",
                y: "demo-robot-spine.spine_interface.inputs.linear_speed_norm",
              },
            },
          },
        },
      },
    };
    const renderPanel = (root: ReturnType<typeof createRoot>) => {
      act(() => {
        root.render(
          <TelemetryServiceProvider service={telemetryService as any}>
            <TestLauncherProviders
              projectPath="/robots/demo-robot"
              serviceOverrides={{
                getProjectModels: vi.fn(async () => projectModels as any),
                refreshProjectModels: vi.fn(async () => projectModels as any),
              }}
            >
              <RemoteControlsPanel config={config} />
            </TestLauncherProviders>
          </TelemetryServiceProvider>
        );
      });
    };

    const firstContainer = document.createElement("div");
    document.body.appendChild(firstContainer);
    const firstRoot = createRoot(firstContainer);
    const secondContainer = document.createElement("div");
    document.body.appendChild(secondContainer);
    const secondRoot = createRoot(secondContainer);
    let firstRootMounted = false;
    let secondRootMounted = false;

    try {
      renderPanel(firstRoot);
      firstRootMounted = true;
      await settle();
      await settle();

      const firstSelect = firstContainer.querySelector("select");
      expect(firstSelect).not.toBeNull();
      expect(firstSelect!.value).toBe("drive_wheels");

      act(() => {
        firstSelect!.value = "none";
        firstSelect!.dispatchEvent(new Event("change", { bubbles: true }));
      });
      await settle();
      expect(firstSelect!.value).toBe("none");

      act(() => {
        firstRoot.unmount();
      });
      firstRootMounted = false;

      renderPanel(secondRoot);
      secondRootMounted = true;
      await settle();
      await settle();

      const secondSelect = secondContainer.querySelector("select");
      expect(secondSelect).not.toBeNull();
      expect(secondSelect!.value).toBe("none");
    } finally {
      act(() => {
        if (firstRootMounted) {
          firstRoot.unmount();
        }
        if (secondRootMounted) {
          secondRoot.unmount();
        }
      });
      firstContainer.remove();
      secondContainer.remove();
      if (originalGetGamepads) {
        Object.defineProperty(
          Navigator.prototype,
          "getGamepads",
          originalGetGamepads
        );
      } else {
        delete (Navigator.prototype as Navigator & { getGamepads?: unknown })
          .getGamepads;
      }
    }
  });

  it("reasserts stick-mode suppression before writing moved stick values", async () => {
    const originalGetGamepads = Object.getOwnPropertyDescriptor(
      Navigator.prototype,
      "getGamepads"
    );
    const originalClientWidth = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      "clientWidth"
    );
    Object.defineProperty(Navigator.prototype, "getGamepads", {
      configurable: true,
      writable: true,
      value: () => [],
    });
    Object.defineProperty(HTMLElement.prototype, "clientWidth", {
      configurable: true,
      get: () => 150,
    });
    const originalSetPointerCapture = HTMLElement.prototype.setPointerCapture;
    const originalReleasePointerCapture =
      HTMLElement.prototype.releasePointerCapture;
    const originalHasPointerCapture = HTMLElement.prototype.hasPointerCapture;
    const capturedPointers = new WeakMap<HTMLElement, Set<number>>();
    HTMLElement.prototype.setPointerCapture = function (pointerId: number) {
      const captured = capturedPointers.get(this) ?? new Set<number>();
      captured.add(pointerId);
      capturedPointers.set(this, captured);
    };
    HTMLElement.prototype.releasePointerCapture = function (pointerId: number) {
      capturedPointers.get(this)?.delete(pointerId);
    };
    HTMLElement.prototype.hasPointerCapture = function (pointerId: number) {
      return capturedPointers.get(this)?.has(pointerId) ?? false;
    };

    const telemetryModel = makeTelemetryModel();
    const telemetryService = {
      subscribeTelemetry: vi.fn((_baseUrl, _samplingRateHz, subscriber) => {
        subscriber.callback(telemetryModel as any);
        return () => {};
      }),
      ensureLayout: vi.fn(async () => telemetryModel as any),
      refreshLayout: vi.fn(async () => telemetryModel as any),
      setWorkloadInputConnectionState: vi.fn(async () => ({
        ok: true,
        status: 200,
        body: {},
      })),
      setWorkloadInputFieldsData: vi.fn(async () => ({
        ok: true,
        status: 200,
        body: {},
      })),
      getLatestModel: vi.fn(() => telemetryModel as any),
    };

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const projectModels = [
      {
        modelPath: "models/demo-robot-spine.model.yaml",
        modelShortName: "demo-robot-spine",
        modelName: "DemoBot Spine",
        telemetryPort: 7095,
        telemetryBaseUrl: "http://example-spine",
        data: {},
      },
    ];

    try {
      act(() => {
        root.render(
          <TelemetryServiceProvider service={telemetryService as any}>
            <TestLauncherProviders
              serviceOverrides={{
                getProjectModels: vi.fn(async () => projectModels as any),
                refreshProjectModels: vi.fn(async () => projectModels as any),
              }}
            >
              <RemoteControlsPanel
                config={{
                  sticks: {
                    left: {
                      selectedMode: "drive_wheels",
                      modes: {
                        drive_wheels: {
                          shapeTransform: "CircleToSquare",
                          deadZone: {
                            x: 0.1,
                            y: 0.1,
                          },
                          outputs: {
                            x: "demo-robot-spine.spine_interface.inputs.angular_speed_norm",
                            y: "demo-robot-spine.spine_interface.inputs.linear_speed_norm",
                          },
                        },
                      },
                    },
                  },
                }}
              />
            </TestLauncherProviders>
          </TelemetryServiceProvider>
        );
      });

      await settle();
      await settle();
      await settle();
      telemetryService.setWorkloadInputConnectionState.mockClear();
      telemetryService.setWorkloadInputFieldsData.mockClear();

      const leftStick = document.querySelector(
        '[data-testid="left-stick-area"]'
      );
      expect(leftStick).not.toBeNull();

      act(() => {
        leftStick!.dispatchEvent(
          createPointerEvent("pointerdown", {
            bubbles: true,
            clientX: 75,
            clientY: 75,
            button: 0,
            pointerId: 1,
          })
        );
        leftStick!.dispatchEvent(
          createPointerEvent("pointermove", {
            bubbles: true,
            clientX: 105,
            clientY: 60,
            button: 0,
            pointerId: 1,
          })
        );
      });
      await settle();
      await settle();

      const suppressionUpdates =
        telemetryService.setWorkloadInputConnectionState.mock.calls.flatMap(
          ([, request]) => request.updates ?? []
        );
      expect(suppressionUpdates).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            field_path: "spine_interface.inputs.angular_speed_norm",
            enabled: false,
          }),
          expect.objectContaining({
            field_path: "spine_interface.inputs.linear_speed_norm",
            enabled: false,
          }),
        ])
      );
      expect(telemetryService.setWorkloadInputFieldsData).toHaveBeenCalled();
      expect(
        telemetryService.setWorkloadInputConnectionState.mock.invocationCallOrder[0]
      ).toBeLessThan(
        telemetryService.setWorkloadInputFieldsData.mock.invocationCallOrder[0]
      );
    } finally {
      act(() => {
        root.unmount();
      });
      container.remove();
      if (originalGetGamepads) {
        Object.defineProperty(
          Navigator.prototype,
          "getGamepads",
          originalGetGamepads
        );
      } else {
        delete (Navigator.prototype as Navigator & { getGamepads?: unknown })
          .getGamepads;
      }
      if (originalClientWidth) {
        Object.defineProperty(
          HTMLElement.prototype,
          "clientWidth",
          originalClientWidth
        );
      } else {
        delete (HTMLElement.prototype as HTMLElement & { clientWidth?: unknown })
          .clientWidth;
      }
      if (originalSetPointerCapture) {
        HTMLElement.prototype.setPointerCapture = originalSetPointerCapture;
      } else {
        delete (
          HTMLElement.prototype as HTMLElement & {
            setPointerCapture?: unknown;
          }
        ).setPointerCapture;
      }
      if (originalReleasePointerCapture) {
        HTMLElement.prototype.releasePointerCapture =
          originalReleasePointerCapture;
      } else {
        delete (
          HTMLElement.prototype as HTMLElement & {
            releasePointerCapture?: unknown;
          }
        ).releasePointerCapture;
      }
      if (originalHasPointerCapture) {
        HTMLElement.prototype.hasPointerCapture = originalHasPointerCapture;
      } else {
        delete (
          HTMLElement.prototype as HTMLElement & {
            hasPointerCapture?: unknown;
          }
        ).hasPointerCapture;
      }
    }
  });

  it("recenters a dragged stick when the window loses focus before pointerup", async () => {
    const originalGetGamepads = Object.getOwnPropertyDescriptor(
      Navigator.prototype,
      "getGamepads"
    );
    const originalClientWidth = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      "clientWidth"
    );
    Object.defineProperty(Navigator.prototype, "getGamepads", {
      configurable: true,
      writable: true,
      value: () => [],
    });
    Object.defineProperty(HTMLElement.prototype, "clientWidth", {
      configurable: true,
      get: () => 150,
    });

    const telemetryModel = makeTelemetryModel();
    const telemetryService = {
      subscribeTelemetry: vi.fn((_baseUrl, _samplingRateHz, subscriber) => {
        subscriber.callback(telemetryModel as any);
        return () => {};
      }),
      ensureLayout: vi.fn(async () => telemetryModel as any),
      refreshLayout: vi.fn(async () => telemetryModel as any),
      setWorkloadInputConnectionState: vi.fn(async () => ({
        ok: true,
        status: 200,
        body: {},
      })),
      setWorkloadInputFieldsData: vi.fn(async () => ({
        ok: true,
        status: 200,
        body: {},
      })),
      getLatestModel: vi.fn(() => telemetryModel as any),
    };
    const originalSetPointerCapture = HTMLElement.prototype.setPointerCapture;
    const originalReleasePointerCapture =
      HTMLElement.prototype.releasePointerCapture;
    const originalHasPointerCapture = HTMLElement.prototype.hasPointerCapture;
    const capturedPointers = new WeakMap<HTMLElement, Set<number>>();
    HTMLElement.prototype.setPointerCapture = function (pointerId: number) {
      const captured = capturedPointers.get(this) ?? new Set<number>();
      captured.add(pointerId);
      capturedPointers.set(this, captured);
    };
    HTMLElement.prototype.releasePointerCapture = function (pointerId: number) {
      capturedPointers.get(this)?.delete(pointerId);
    };
    HTMLElement.prototype.hasPointerCapture = function (pointerId: number) {
      return capturedPointers.get(this)?.has(pointerId) ?? false;
    };

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const projectModels = [
      {
        modelPath: "models/demo-robot-spine.model.yaml",
        modelShortName: "demo-robot-spine",
        modelName: "DemoBot Spine",
        telemetryPort: 7095,
        telemetryBaseUrl: "http://example-spine",
        data: {},
      },
    ];

    try {
      act(() => {
        root.render(
          <TelemetryServiceProvider service={telemetryService as any}>
            <TestLauncherProviders
              serviceOverrides={{
                getProjectModels: vi.fn(async () => projectModels as any),
                refreshProjectModels: vi.fn(async () => projectModels as any),
              }}
            >
              <RemoteControlsPanel
                config={{
                  sticks: {
                    left: {
                      selectedMode: "drive_wheels",
                      modes: {
                        drive_wheels: {
                          outputs: {
                            x: "demo-robot-spine.spine_interface.inputs.angular_speed_norm",
                            y: "demo-robot-spine.spine_interface.inputs.linear_speed_norm",
                          },
                        },
                      },
                    },
                  },
                }}
              />
            </TestLauncherProviders>
          </TelemetryServiceProvider>
        );
      });

      await settle();
      await settle();
      telemetryService.setWorkloadInputFieldsData.mockClear();

      const leftStick = document.querySelector(
        '[data-testid="left-stick-area"]'
      ) as HTMLElement | null;
      expect(leftStick).not.toBeNull();

      act(() => {
        leftStick!.dispatchEvent(
          createPointerEvent("pointerdown", {
            bubbles: true,
            clientX: 75,
            clientY: 75,
            button: 0,
            pointerId: 4,
          })
        );
        leftStick!.dispatchEvent(
          createPointerEvent("pointermove", {
            bubbles: true,
            clientX: 120,
            clientY: 45,
            button: 0,
            pointerId: 4,
          })
        );
      });
      await settle();

      act(() => {
        window.dispatchEvent(new Event("blur"));
      });
      await waitForTimers(80);

      expect(telemetryService.setWorkloadInputFieldsData).toHaveBeenCalledTimes(2);
      const lastRequest =
        telemetryService.setWorkloadInputFieldsData.mock.calls.at(-1)?.[1];
      expect(lastRequest?.writes).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            field_path: "spine_interface.inputs.angular_speed_norm",
            value: 0,
          }),
          expect.objectContaining({
            field_path: "spine_interface.inputs.linear_speed_norm",
            value: 0,
          }),
        ])
      );
    } finally {
      act(() => {
        root.unmount();
      });
      container.remove();
      if (originalGetGamepads) {
        Object.defineProperty(
          Navigator.prototype,
          "getGamepads",
          originalGetGamepads
        );
      } else {
        delete (Navigator.prototype as Navigator & { getGamepads?: unknown })
          .getGamepads;
      }
      if (originalClientWidth) {
        Object.defineProperty(
          HTMLElement.prototype,
          "clientWidth",
          originalClientWidth
        );
      } else {
        delete (HTMLElement.prototype as HTMLElement & { clientWidth?: unknown })
          .clientWidth;
      }
      if (originalSetPointerCapture) {
        HTMLElement.prototype.setPointerCapture = originalSetPointerCapture;
      } else {
        delete (
          HTMLElement.prototype as HTMLElement & {
            setPointerCapture?: unknown;
          }
        ).setPointerCapture;
      }
      if (originalReleasePointerCapture) {
        HTMLElement.prototype.releasePointerCapture =
          originalReleasePointerCapture;
      } else {
        delete (
          HTMLElement.prototype as HTMLElement & {
            releasePointerCapture?: unknown;
          }
        ).releasePointerCapture;
      }
      if (originalHasPointerCapture) {
        HTMLElement.prototype.hasPointerCapture = originalHasPointerCapture;
      } else {
        delete (
          HTMLElement.prototype as HTMLElement & {
            hasPointerCapture?: unknown;
          }
        ).hasPointerCapture;
      }
    }
  });
});
