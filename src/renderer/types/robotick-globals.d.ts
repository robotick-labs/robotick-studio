export interface RobotickEnvironment {
  readonly isStandaloneApp: boolean;
  readonly appTitle: string;
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

export interface RobotickGlobals {
  readonly environment: RobotickEnvironment;
  readonly windowControls?: RobotickWindowControls;
  [key: string]: unknown;
}

declare global {
  interface Window {
    robotick?: RobotickGlobals;
  }
}

export {};
