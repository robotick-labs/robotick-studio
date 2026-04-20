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
        modelPath: "models/barr-e-spine.model.yaml",
        modelShortName: "barr-e-spine",
        modelName: "Barr.e Spine",
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
                            x: "barr-e-spine.spine_interface.inputs.angular_speed_norm",
                            y: "barr-e-spine.spine_interface.inputs.linear_speed_norm",
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
        modelPath: "models/barr-e-spine.model.yaml",
        modelShortName: "barr-e-spine",
        modelName: "Barr.e Spine",
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
                x: "barr-e-spine.spine_interface.inputs.angular_speed_norm",
                y: "barr-e-spine.spine_interface.inputs.linear_speed_norm",
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
              projectPath="/robots/barr-e"
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
        modelPath: "models/barr-e-spine.model.yaml",
        modelShortName: "barr-e-spine",
        modelName: "Barr.e Spine",
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
                            x: "barr-e-spine.spine_interface.inputs.angular_speed_norm",
                            y: "barr-e-spine.spine_interface.inputs.linear_speed_norm",
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
          new MouseEvent("mousedown", {
            bubbles: true,
            clientX: 75,
            clientY: 75,
          })
        );
        document.dispatchEvent(
          new MouseEvent("mousemove", {
            bubbles: true,
            clientX: 105,
            clientY: 60,
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
    }
  });
});
