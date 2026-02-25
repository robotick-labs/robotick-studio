import React, { createContext, useContext, useMemo } from "react";
import { subscribeTelemetry } from "./telemetry-store";

export interface TelemetryService {
  subscribeTelemetry: typeof subscribeTelemetry;
}

export type TelemetryServiceOverrides = Partial<TelemetryService>;

export function createTelemetryService(
  overrides?: TelemetryServiceOverrides
): TelemetryService {
  if (!overrides || Object.keys(overrides).length === 0) {
    return { subscribeTelemetry };
  }
  return {
    subscribeTelemetry,
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
