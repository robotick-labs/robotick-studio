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
        "remote_control.inputs.use_web_inputs",
        {
          field_handle: 1,
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

  it("continues applying writes after remount without stale seq drops", async () => {
    const originalGetGamepads = Object.getOwnPropertyDescriptor(
      Navigator.prototype,
      "getGamepads"
    );
    Object.defineProperty(Navigator.prototype, "getGamepads", {
      configurable: true,
      writable: true,
      value: () => [],
    });
    const container = document.createElement("div");
    document.body.appendChild(container);
    let root: ReturnType<typeof createRoot> | null = null;
    let remountRoot: ReturnType<typeof createRoot> | null = null;

    try {
      const unsubscribe = vi.fn();
      let subscriber:
        | {
            callback: (model: any) => void;
            error?: (error: unknown) => void;
          }
        | undefined;

      const subscribeTelemetry = vi.fn(
        (_baseUrl, _samplingRateHz, nextSubscriber) => {
          subscriber = nextSubscriber;
          return unsubscribe;
        }
      );

      let liveModel: any = null;
      const latestSeqByHandle = new Map<number, number>();
      let appliedUseWebInputs: boolean | null = null;
      const setWorkloadInputFieldsData = vi.fn(async (_baseUrl, request) => {
        for (const write of request.writes ?? []) {
          if (typeof write.field_handle !== "number") {
            continue;
          }
          const previousSeq = latestSeqByHandle.get(write.field_handle) ?? 0;
          const nextSeq =
            typeof write.seq === "number" && Number.isFinite(write.seq)
              ? write.seq
              : previousSeq + 1;
          if (nextSeq <= previousSeq) {
            continue;
          }
          latestSeqByHandle.set(write.field_handle, nextSeq);
          if (write.field_handle === 1 && typeof write.value === "boolean") {
            appliedUseWebInputs = write.value;
          }
        }
        return { ok: true, status: 200, body: {} };
      });

      const telemetryService = {
        subscribeTelemetry,
        ensureLayout: vi.fn(async () => null),
        setWorkloadInputFieldsData,
        getLatestModel: vi.fn(() => liveModel),
      };

      const renderPanel = () => (
        <TelemetryServiceProvider service={telemetryService as any}>
          <TestLauncherProviders>
            <RemoteControlsPanel
              config={{
                telemetryBaseUrl: "http://example",
                workloadName: "remote_control",
              }}
            />
          </TestLauncherProviders>
        </TelemetryServiceProvider>
      );

      root = createRoot(container);
      act(() => {
        root?.render(renderPanel());
      });

      liveModel = makeTelemetryModel();
      act(() => {
        subscriber?.callback(liveModel);
      });
      await settle();

      const button = document.body.querySelector("button");
      expect(button?.textContent).toContain("TAKEOVER");

      act(() => {
        button?.click();
      });
      await settle();
      expect(appliedUseWebInputs).toBe(false);

      act(() => {
        button?.click();
      });
      await settle();
      expect(appliedUseWebInputs).toBe(true);

      act(() => {
        root?.unmount();
      });
      root = null;

      remountRoot = createRoot(container);
      act(() => {
        remountRoot?.render(renderPanel());
      });

      act(() => {
        subscriber?.callback(liveModel);
      });
      await settle();

      const remountButton = document.body.querySelector("button");
      act(() => {
        remountButton?.click();
      });
      await settle();

      expect(appliedUseWebInputs).toBe(false);

      const hasClientSeq = setWorkloadInputFieldsData.mock.calls.some(
        (_call: unknown[]) => {
          const request = _call[1] as { writes?: Array<{ seq?: number }> };
          return (request.writes ?? []).some((write) =>
            Object.prototype.hasOwnProperty.call(write, "seq")
          );
        }
      );
      expect(hasClientSeq).toBe(false);
    } finally {
      if (remountRoot) {
        act(() => {
          remountRoot?.unmount();
        });
      }
      if (root) {
        act(() => {
          root?.unmount();
        });
      }
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
});
