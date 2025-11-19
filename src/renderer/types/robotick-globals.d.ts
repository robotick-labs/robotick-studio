export interface RobotickEnvironment {
  readonly isStandaloneApp: boolean;
  readonly appTitle: string;
  [key: string]: unknown;
}

export interface RobotickGlobals {
  readonly environment: RobotickEnvironment;
  [key: string]: unknown;
}

declare global {
  interface Window {
    robotick?: RobotickGlobals;
  }
}

export {};
