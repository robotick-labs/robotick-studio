// types.ts
export interface FieldConnectionHint {
  localIncomingFrom: string[];
  remoteIncomingFrom: string[];
  localOutgoingTo: string[];
  remoteOutgoingTo: string[];
}

export interface EngineModel {
  modelId?: string;
  modelName: string;
  modelPath: string;
  instanceURL: string;
  telemetryPushRateHz?: number;
  fieldConnectionHints: Record<string, FieldConnectionHint>;
  expectedWorkloads?: Array<{ id?: string; name?: string; type: string }>;
}
