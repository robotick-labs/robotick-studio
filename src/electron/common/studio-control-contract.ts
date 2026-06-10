export type StudioControlCollection = {
  name: string;
  resource_type: string;
  item_count: number;
};

export type StudioControlResourceSummary = {
  resource_type: string;
  id: string;
  label?: string;
  [key: string]: unknown;
};

export type StudioControlStatus = {
  resource_type: string;
  id: string;
  child_collections?: StudioControlCollection[];
  child_resources?: StudioControlResourceSummary[];
  children?: Record<string, StudioControlResourceSummary[]>;
  state_sources?: Record<string, string>;
  [key: string]: unknown;
};

export type StudioControlProjectSelectionRequest = {
  project_path?: string;
};

export type StudioControlProjectSelectionResponse = {
  accepted: boolean;
  currentProjectPath: string;
  issue: {
    type: "locked" | "error";
    projectPath: string;
    instanceName?: string;
    pid?: number;
    message: string;
  } | null;
};

export type StudioControlActivationResponse = {
  accepted: boolean;
  changed: boolean;
  activated_path: string[];
  previous_active_path: string[] | null;
  message: string;
};
