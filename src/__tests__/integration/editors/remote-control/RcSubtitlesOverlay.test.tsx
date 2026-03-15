import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RcSubtitlesOverlay } from "../../../../renderer/components/editors/remote-control/components/RcSubtitlesOverlay";
import { TelemetryServiceProvider } from "../../../../renderer/data-sources/telemetry";
import {
  resetLauncherDataTestState,
  resetTelemetryTestState,
} from "../../../helpers/renderWithProviders";
import { TestLauncherProviders } from "../../../helpers/mocks";

describe("RcSubtitlesOverlay", () => {
  afterEach(() => {
    resetTelemetryTestState();
    resetLauncherDataTestState();
    window.localStorage.clear();
    vi.clearAllMocks();
  });

  it("updates when a reused telemetry model changes the subtitle field", () => {
    const unsubscribe = vi.fn();
    let subscriber:
      | {
          callback: (model: any) => void;
          error?: (error: unknown) => void;
        }
      | undefined;
    const subscribeTelemetry = vi.fn((_baseUrl, _pollingRateHz, nextSubscriber) => {
      subscriber = nextSubscriber;
      return unsubscribe;
    });
    const telemetryService = {
      subscribeTelemetry,
      setWorkloadInputFieldsData: vi.fn(),
    };

    let currentSubtitle = "first subtitle";
    const field = {
      getValue: () => currentSubtitle,
    };
    const reusedModel = {
      getField: () => field,
      schemaSessionId: "sid",
      workloads: [],
      raw: null,
      workloads_buffer_size_used: 0,
      process_memory_used: 0,
      writable_inputs_by_path: new Map(),
    };

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    act(() => {
      root.render(
        <TelemetryServiceProvider service={telemetryService as any}>
          <TestLauncherProviders>
            <RcSubtitlesOverlay
              config={{
                telemetryBaseUrl: "http://example",
                fieldPath: "memory.outputs.subtitle",
              }}
            />
          </TestLauncherProviders>
        </TelemetryServiceProvider>
      );
    });

    act(() => {
      subscriber?.callback(reusedModel);
    });

    expect(document.body.textContent).toContain("first subtitle");

    act(() => {
      currentSubtitle = "second subtitle";
      subscriber?.callback(reusedModel);
    });

    expect(document.body.textContent).toContain("second subtitle");
    expect(document.body.textContent).not.toContain("first subtitle");

    act(() => {
      root.unmount();
    });
    container.remove();
    expect(unsubscribe).toHaveBeenCalled();
  });

  it("remembers collapsed state and hides subtitle text until expanded again", () => {
    const unsubscribe = vi.fn();
    let subscriber:
      | {
          callback: (model: any) => void;
          error?: (error: unknown) => void;
        }
      | undefined;
    const subscribeTelemetry = vi.fn((_baseUrl, _pollingRateHz, nextSubscriber) => {
      subscriber = nextSubscriber;
      return unsubscribe;
    });
    const telemetryService = {
      subscribeTelemetry,
      setWorkloadInputFieldsData: vi.fn(),
    };

    const field = {
      getValue: () => "hello there",
    };
    const reusedModel = {
      getField: () => field,
      schemaSessionId: "sid",
      workloads: [],
      raw: null,
      workloads_buffer_size_used: 0,
      process_memory_used: 0,
      writable_inputs_by_path: new Map(),
    };

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    const renderOverlay = () => (
      <TelemetryServiceProvider service={telemetryService as any}>
        <TestLauncherProviders>
          <RcSubtitlesOverlay
            config={{
              telemetryBaseUrl: "http://example",
              fieldPath: "memory.outputs.subtitle",
            }}
          />
        </TestLauncherProviders>
      </TelemetryServiceProvider>
    );

    act(() => {
      root.render(renderOverlay());
    });

    act(() => {
      subscriber?.callback(reusedModel);
    });

    expect(document.body.textContent).toContain("hello there");

    const collapseButton = document.body.querySelector(
      'button[aria-label="Collapse subtitles"]'
    ) as HTMLButtonElement | null;
    expect(collapseButton).not.toBeNull();

    act(() => {
      collapseButton?.click();
    });

    expect(document.body.textContent).not.toContain("hello there");
    expect(
      document.body.querySelector('button[aria-label="Expand subtitles"]')
    ).not.toBeNull();

    act(() => {
      root.unmount();
    });

    const remountRoot = createRoot(container);
    act(() => {
      remountRoot.render(renderOverlay());
    });

    act(() => {
      subscriber?.callback(reusedModel);
    });

    expect(document.body.textContent).not.toContain("hello there");
    const expandButton = document.body.querySelector(
      'button[aria-label="Expand subtitles"]'
    ) as HTMLButtonElement | null;
    expect(expandButton).not.toBeNull();

    act(() => {
      expandButton?.click();
    });

    expect(document.body.textContent).toContain("hello there");

    act(() => {
      remountRoot.unmount();
    });
    container.remove();
    expect(unsubscribe).toHaveBeenCalled();
  });
});
