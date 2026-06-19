import type { LayoutModel } from "./telemetry/telemetry-decoder";

export type ElectronTelemetryRawFrame = {
  raw: ArrayBuffer;
  sid: string;
  frameSeq: number | null;
  timestamp: number;
};

export type ElectronTelemetryLayoutFrame = {
  layout: LayoutModel;
  latestRaw: ElectronTelemetryRawFrame | null;
};

export type ElectronTelemetryBaseUrlDiagnostics = {
  subscriberCount: number;
  layoutLoaded: boolean;
  lastFrameAt: string | null;
  lastErrorAt: string | null;
  lastErrorMessage: string | null;
};

export type ElectronTelemetrySharedBaseUrlDiagnostics =
  ElectronTelemetryBaseUrlDiagnostics & {
    baseUrl: string;
    rawLoaded: boolean;
    latestFrameSeq: number | null;
    latestEngineSessionId: string | null;
    websocketConnected: boolean;
  };

export type ElectronTelemetrySharedDiagnostics = {
  activeBaseUrlCount: number;
  totalSubscriberCount: number;
  baseUrls: ElectronTelemetrySharedBaseUrlDiagnostics[];
};

export type ElectronTelemetryBridgeEvent =
  | {
      readonly type: "layout";
      readonly payload: unknown;
    }
  | {
      readonly type: "frame";
      readonly payload: unknown;
    }
  | {
      readonly type: "error";
      readonly message: string;
    };

export type ElectronTelemetryIpcEvent =
  | ({
      readonly subscriptionId: string;
    } & ElectronTelemetryBridgeEvent);

export type ElectronTelemetryBaseUrlPayload = {
  baseUrl?: string;
};

export type ElectronTelemetrySubscriptionPayload = {
  subscriptionId?: string;
  baseUrl?: string;
};

export type RobotickTelemetryBridge = {
  readonly ensureLayout: (baseUrl: string) => Promise<unknown>;
  readonly refreshLayout: (baseUrl: string) => Promise<unknown>;
  readonly getDiagnostics: (baseUrl: string) => Promise<unknown>;
  readonly getSharedDiagnostics: () => Promise<ElectronTelemetrySharedDiagnostics>;
  readonly getHealth: (baseUrl: string) => Promise<unknown>;
  readonly getPushStats: (baseUrl: string) => Promise<unknown>;
  readonly setWorkloadInputFieldsData: (
    baseUrl: string,
    request: unknown,
  ) => Promise<unknown>;
  readonly setWorkloadInputConnectionState: (
    baseUrl: string,
    request: unknown,
  ) => Promise<unknown>;
  readonly subscribe: (
    baseUrl: string,
    callback: (event: ElectronTelemetryBridgeEvent) => void,
  ) => () => void;
};
