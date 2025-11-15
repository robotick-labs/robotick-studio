// types.ts
export interface EngineModel {
  modelName: string;
  modelPath: string;
  instanceURL: string;
}

export interface EngineState {
  model: EngineModel;
  workloads: any[];
  workloadIndex: number;
  workloadsMemoryUsed: number;
  processMemoryUsed: number;
  pollingController: AbortController;
  livePollingController: AbortController;
  hasInitialWorkloads: boolean;
  canLivePoll: boolean;
}
