export interface RobotickEnvironment {
  readonly isStandaloneApp: boolean;
  readonly appTitle: string;
  readonly cesiumToken?: string;
  readonly usesNativeWindowFrame?: boolean;
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

export interface RobotickGlobals {
  readonly environment: RobotickEnvironment;
  readonly windowControls?: RobotickWindowControls;
  readonly storage?: RobotickStorage;
  [key: string]: unknown;
}

declare global {
  interface Window {
    robotick?: RobotickGlobals;
  }
}

export {};
