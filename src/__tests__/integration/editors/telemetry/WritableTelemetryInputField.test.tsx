import React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WritableTelemetryInputField } from "../../../../renderer/components/editors/telemetry/view/WritableTelemetryInputField";
import { TelemetryServiceProvider } from "../../../../renderer/data-sources/telemetry";
import type {
  ITelemetryField,
  ITelemetryModel,
} from "../../../../renderer/data-sources/telemetry";
import { resetTelemetryTestState } from "../../../helpers/renderWithProviders";

async function settle() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("WritableTelemetryInputField", () => {
  afterEach(() => {
    resetTelemetryTestState();
    vi.clearAllMocks();
  });

  it("continues applying bool writes after remount without stale seq drops", async () => {
    const model: ITelemetryModel = {
      workloads: [],
      raw: null,
      schemaSessionId: "sid-1",
      workloads_buffer_size_used: 0,
      process_memory_used: 0,
    };
    let currentValue = true;
    const field: ITelemetryField = {
      name: "enabled",
      type: "bool",
      path: "workload.inputs.enabled",
      offset: 0,
      elementCount: 1,
      writable_input_handle: 7,
      model,
      getValue: () => currentValue,
    };

    const latestSeqByHandle = new Map<number, number>();
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
        if (write.field_handle === 7 && typeof write.value === "boolean") {
          currentValue = write.value;
        }
      }
      return { ok: true, status: 200, body: {} };
    });

    const telemetryService = {
      subscribeTelemetry: vi.fn(() => () => undefined),
      ensureLayout: vi.fn(async () => null),
      setWorkloadInputFieldsData,
      getLatestModel: vi.fn(() => null),
    };

    const container = document.createElement("div");
    document.body.appendChild(container);
    let root: ReturnType<typeof createRoot> | null = null;
    let remountRoot: ReturnType<typeof createRoot> | null = null;

    try {
      const renderField = () => (
        <TelemetryServiceProvider service={telemetryService as any}>
          <WritableTelemetryInputField
            field={field}
            telemetryBaseUrl="http://example"
          />
        </TelemetryServiceProvider>
      );

      root = createRoot(container);
      act(() => {
        root?.render(renderField());
      });

      const firstCheckbox = container.querySelector(
        "input[type='checkbox']"
      ) as HTMLInputElement | null;
      expect(firstCheckbox).not.toBeNull();
      act(() => {
        firstCheckbox?.click();
      });
      await settle();
      expect(currentValue).toBe(false);

      act(() => {
        root?.unmount();
      });
      root = null;

      remountRoot = createRoot(container);
      act(() => {
        remountRoot?.render(renderField());
      });

      const secondCheckbox = container.querySelector(
        "input[type='checkbox']"
      ) as HTMLInputElement | null;
      expect(secondCheckbox).not.toBeNull();
      act(() => {
        secondCheckbox?.click();
      });
      await settle();
      expect(currentValue).toBe(true);

      const hasClientSeq = setWorkloadInputFieldsData.mock.calls.some(
        (call: unknown[]) => {
          const request = call[1] as { writes?: Array<{ seq?: number }> };
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
    }
  });
});
