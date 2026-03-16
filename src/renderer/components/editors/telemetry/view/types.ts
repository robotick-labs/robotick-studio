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
  preferredPollRateHz?: number;
  fieldConnectionHints: Record<string, FieldConnectionHint>;
}
