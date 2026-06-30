import type { RobotickLauncherBridge } from "../../electron/common/launcher-bridge-contract";
import type { RobotickTelemetryBridge } from "../../electron/common/telemetry-bridge-contract";

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
  readonly deleteChildWindow?: (
    projectPath: string,
    windowId: string
  ) => Promise<boolean>;
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

export interface RobotickHub {
  readonly getEndpoint: () => Promise<string | undefined>;
}

export interface RobotickStudioActiveResource {
  readonly window_id: string;
  readonly workbench_id?: string;
  readonly layout_id?: string;
  readonly panel_id?: string;
}

export interface RobotickStudioActivationEvent {
  readonly activated_path: string[];
}

export interface RobotickStudioControl {
  readonly reportActiveResource: (resource: RobotickStudioActiveResource) => void;
  readonly getLastActivation?: () => RobotickStudioActivationEvent | null;
  readonly onActivationChanged?: (
    callback: (event: RobotickStudioActivationEvent) => void
  ) => () => void;
}

export interface RobotickDiagnosticsBridge {
  readonly publishSnapshot: (snapshot: Record<string, unknown>) => void;
  readonly publishEvent?: (event: {
    source: string;
    level?: "debug" | "info" | "warn" | "error";
    message: string;
    payload?: Record<string, unknown> | null;
  }) => void;
  readonly requestCommand?: (
    commandId: string,
    input?: Record<string, unknown>
  ) => Promise<unknown>;
  readonly getLogSnapshot?: (options?: {
    tail?: number;
    target?: "studio";
  }) => Promise<RobotickDiagnosticsLogRecord[]>;
  readonly onLogEvent?: (
    callback: (record: RobotickDiagnosticsLogRecord) => void
  ) => () => void;
}

export interface RobotickDiagnosticsLogRecord {
  readonly target: "runtime" | "studio";
  readonly source: string;
  readonly window_id: string | null;
  readonly recorded_at: string;
  readonly level: "debug" | "info" | "warn" | "error";
  readonly message: string;
  readonly source_url: string | null;
  readonly line: number | null;
  readonly column: number | null;
  readonly stack: string | null;
  readonly payload: Record<string, unknown> | null;
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
  readonly hub?: RobotickHub;
  readonly windowControls?: RobotickWindowControls;
  readonly studioProcess?: RobotickStudioProcess;
  readonly studioControl?: RobotickStudioControl;
  readonly diagnostics?: RobotickDiagnosticsBridge;
  readonly storage?: RobotickStorage;
  readonly studioPersistence?: RobotickStudioPersistence;
  readonly projectSelection?: RobotickProjectSelection;
  readonly launcher?: RobotickLauncherBridge;
  readonly telemetry?: RobotickTelemetryBridge;
  [key: string]: unknown;
}

declare global {
  interface Window {
    robotick?: RobotickGlobals;
  }
}

export {};
