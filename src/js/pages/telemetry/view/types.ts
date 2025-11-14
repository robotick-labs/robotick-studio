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
  bufferSizeUsed: number;
  pollingController: AbortController;
  livePollingController: AbortController;
  hasInitialWorkloads: boolean;
  canLivePoll: boolean;
}
