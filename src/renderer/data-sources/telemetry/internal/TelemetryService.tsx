import React, { createContext, useContext, useMemo } from "react";
import {
  ensureTelemetryLayout,
  refreshTelemetryLayout,
  getLatestTelemetryModel,
  subscribeTelemetry,
} from "./telemetry-store";
import {
  setWorkloadInputConnectionState,
  setWorkloadInputFieldsData,
} from "./telemetry-client";
import type { ITelemetryModel } from "./telemetry-client";

export interface TelemetryService {
  subscribeTelemetry: typeof subscribeTelemetry;
  ensureLayout: typeof ensureTelemetryLayout;
  refreshLayout: typeof refreshTelemetryLayout;
  setWorkloadInputFieldsData: typeof setWorkloadInputFieldsData;
  setWorkloadInputConnectionState: typeof setWorkloadInputConnectionState;
  getLatestModel: (baseUrl: string) => ITelemetryModel | null;
}

export type TelemetryServiceOverrides = Partial<TelemetryService>;

export function createTelemetryService(
  overrides?: TelemetryServiceOverrides
): TelemetryService {
  if (!overrides || Object.keys(overrides).length === 0) {
    return {
      subscribeTelemetry,
      ensureLayout: ensureTelemetryLayout,
      refreshLayout: refreshTelemetryLayout,
      setWorkloadInputFieldsData,
      setWorkloadInputConnectionState,
      getLatestModel: getLatestTelemetryModel,
    };
  }
  return {
    subscribeTelemetry,
    ensureLayout: ensureTelemetryLayout,
    refreshLayout: refreshTelemetryLayout,
    setWorkloadInputFieldsData,
    setWorkloadInputConnectionState,
    getLatestModel: getLatestTelemetryModel,
    ...overrides,
  };
}

export const telemetryService = createTelemetryService();

const TelemetryServiceContext = createContext<TelemetryService | null>(null);

export function TelemetryServiceProvider({
  service,
  children,
}: {
  service?: TelemetryService;
  children: React.ReactNode;
}) {
  const value = useMemo(
    () => service ?? telemetryService,
    [service]
  );
  return (
    <TelemetryServiceContext.Provider value={value}>
      {children}
    </TelemetryServiceContext.Provider>
  );
}

export function useTelemetryService(): TelemetryService {
  const ctx = useContext(TelemetryServiceContext);
  if (!ctx) {
    throw new Error(
      "useTelemetryService must be used within TelemetryServiceProvider"
    );
  }
  return ctx;
}
