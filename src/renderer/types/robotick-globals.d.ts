export interface RobotickEnvironment {
  readonly isStandaloneApp: boolean;
  readonly appTitle: string;
  readonly cesiumToken?: string;
  readonly hubEndpoint?: string;
  readonly selectedProject?: string;
  readonly usesNativeWindowFrame?: boolean;
  readonly workspaceRoot?: string;
  readonly windowScope?: string;
  readonly isPrimaryWindow?: boolean;
  [key: string]: unknown;
}

export interface RobotickWindowState {
  readonly isMaximized: boolean;
}

export interface RobotickWindowControls {
  readonly minimize: () => void;
  readonly maximize: () => void;
  readonly restore: () => void;
  readonly close: () => void;
  readonly createWindow?: (
    projectPath?: string,
    scope?: string
  ) => Promise<void>;
  readonly getChildWindowScopes?: () => Promise<string[]>;
  readonly toggleMaximize: () => void;
  readonly showSystemMenu?: (x: number, y: number) => void;
  readonly onStateChange?: (
    callback: (state: RobotickWindowState) => void
  ) => () => void;
}

export interface RobotickStorage {
  readonly getItem: (key: string) => string | null;
  readonly setItem: (key: string, value: string) => void;
  readonly removeItem: (key: string) => void;
  readonly clear?: () => void;
}

export interface RobotickStudioPersistence {
  readonly readStudioDocument: (projectPath: string) => Promise<string | null>;
  readonly ensureStudioDocument: (projectPath: string) => Promise<void>;
  readonly writeStudioDocument: (
    projectPath: string,
    content: string
  ) => Promise<void>;
  readonly onDocumentChanged?: (
    callback: (projectPath: string) => void
  ) => () => void;
}

export interface RobotickStudioProcessStats {
  readonly cpuPercent: number;
  readonly memoryMb: number;
}

export interface RobotickStudioProcess {
  readonly getStats: () => Promise<RobotickStudioProcessStats>;
}

export interface RobotickProjectSelectionIssue {
  readonly type: "locked" | "error";
  readonly projectPath: string;
  readonly instanceName?: string;
  readonly pid?: number;
  readonly message: string;
}

export interface RobotickProjectSelectionState {
  readonly currentProjectPath: string;
  readonly bootstrapIssue: RobotickProjectSelectionIssue | null;
}

export interface RobotickProjectSelectionResult {
  readonly accepted: boolean;
  readonly currentProjectPath: string;
  readonly issue: RobotickProjectSelectionIssue | null;
}

export interface RobotickProjectLockStatus {
  readonly projectPath: string;
  readonly state: "available" | "current" | "locked";
  readonly instanceName?: string;
  readonly pid?: number;
  readonly message?: string;
}

export interface RobotickProjectSelection {
  readonly getState: () => Promise<RobotickProjectSelectionState>;
  readonly setProject: (
    projectPath: string
  ) => Promise<RobotickProjectSelectionResult>;
  readonly getLockStatuses: (
    projectPaths: string[]
  ) => Promise<{ statuses: RobotickProjectLockStatus[] }>;
  readonly onStateChanged?: (
    callback: (state: RobotickProjectSelectionState) => void
  ) => () => void;
}

export interface RobotickGlobals {
  readonly environment: RobotickEnvironment;
  readonly windowControls?: RobotickWindowControls;
  readonly studioProcess?: RobotickStudioProcess;
  readonly storage?: RobotickStorage;
  readonly studioPersistence?: RobotickStudioPersistence;
  readonly projectSelection?: RobotickProjectSelection;
  [key: string]: unknown;
}

declare global {
  interface Window {
    robotick?: RobotickGlobals;
  }
}

export {};
