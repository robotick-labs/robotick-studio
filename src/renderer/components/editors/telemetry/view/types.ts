// types.ts
export interface FieldConnectionHint {
  localIncomingFrom: string[];
  remoteIncomingFrom: string[];
  localOutgoingTo: string[];
  remoteOutgoingTo: string[];
}

export interface EngineModel {
  modelName: string;
  modelPath: string;
  instanceURL: string;
  preferredSampleRateHz?: number;
  fieldConnectionHints: Record<string, FieldConnectionHint>;
  expectedWorkloads?: Array<{ name: string; type: string }>;
}
