import React, { useLayoutEffect } from "react";
import { describe, expect, it, vi } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import {
  TelemetryServiceProvider,
  useTelemetryService,
  createTelemetryService,
  useTelemetryStream,
} from "../../../../renderer/data-sources/telemetry";

function render(node: React.ReactElement) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(node);
  });
  return {
    unmount() {
      act(() => root.unmount());
      container.remove();
    },
  };
}

function ServiceConsumer({ onValue }: { onValue: (service: any) => void }) {
  const ctx = useTelemetryService();
  useLayoutEffect(() => {
    onValue(ctx);
  }, [ctx, onValue]);
  return null;
}

function StreamConsumer({
  baseUrl,
  pollingRateHz,
}: {
  baseUrl: string;
  pollingRateHz: number;
}) {
  useTelemetryStream(baseUrl, pollingRateHz);
  return null;
}

describe("TelemetryServiceProvider", () => {
  it("provides the telemetry service instance", () => {
    const service = createTelemetryService();
    const capture = vi.fn();
    const tree = render(
      <TelemetryServiceProvider service={service}>
        <ServiceConsumer onValue={capture} />
      </TelemetryServiceProvider>
    );
    expect(capture).toHaveBeenCalledWith(service);
    tree.unmount();
  });

  it("routes useTelemetryStream subscriptions through the injected service", () => {
    const unsubscribe = vi.fn();
    const subscribeTelemetry = vi.fn(() => unsubscribe);
    const setWorkloadInputFieldData = vi.fn();
    const mockService = { subscribeTelemetry, setWorkloadInputFieldData };

    const tree = render(
      <TelemetryServiceProvider service={mockService}>
        <StreamConsumer baseUrl="http://example" pollingRateHz={15} />
      </TelemetryServiceProvider>
    );

    expect(subscribeTelemetry).toHaveBeenCalledWith(
      "http://example",
      15,
      expect.objectContaining({ callback: expect.any(Function) })
    );

    tree.unmount();
    expect(unsubscribe).toHaveBeenCalled();
  });
});
