// src/js/pages/telemetry/types.ts
export type EngineModel = {
  modelName: string;
  modelPath: string;
  instanceURL: string; // e.g. http://localhost:7090
};

export type TelemetryWorkload = {
  name: string;
  type: string;
  dt_ms: number | null;
  goal_ms: number | null;
  self_ms: number | null;
  config: any;
  inputs: any;
  outputs: any;
};

export type EngineState = {
  model: EngineModel;
  workloads: TelemetryWorkload[];
  workloadIndex: number;
  pollingController: AbortController;
  livePollingController: AbortController;
  hasInitialWorkloads: boolean;
  canLivePoll: boolean;
};
