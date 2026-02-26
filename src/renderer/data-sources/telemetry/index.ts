/**
 * Public telemetry API surface.
 *
 * Components outside this folder should import telemetry helpers and types
 * from here rather than reaching into internal modules. Everything that is
 * not exported from this file is considered an implementation detail.
 *
 * @example
 * import { useTelemetryStream } from "@/core/telemetry";
 */
export type {
  ITelemetryModel,
  ITelemetryWorkload,
  ITelemetryField,
  ITelemetryStruct,
  LayoutModel,
  SetWorkloadInputFieldDataRequest,
  SetWorkloadInputFieldDataResult,
  SetWorkloadInputFieldDataOptions,
} from "./internal/telemetry-client";
export { setWorkloadInputFieldData } from "./internal/telemetry-client";

// Public React hook for components that just want telemetry snapshots.
export { useTelemetryStream } from "./internal/useTelemetryStream";

// Low-level subscription for non-React code (e.g. viewer engines) that manage
// their own lifecycle and need raw access to telemetry updates.
export { subscribeTelemetry } from "./internal/telemetry-store";

export {
  TelemetryServiceProvider,
  useTelemetryService,
  createTelemetryService,
  telemetryService,
} from "./internal/TelemetryService";
export type { TelemetryService } from "./internal/TelemetryService";
export { resetTelemetryStore } from "./internal/telemetry-store";
