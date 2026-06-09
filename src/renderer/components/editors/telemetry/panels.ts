import {
  spawnFloatingPanel,
  type FloatingPanelSpawnConfig,
} from "../../workspaces/floating-panels";

export type TelemetryPanelSettings = {
  telemetryBaseUrl?: string;
  modelId?: string;
  modelName?: string;
  modelPath?: string;
  workloadId?: string;
  workloadName?: string;
  fieldPath?: string;
  dataKind?: "inputs" | "outputs" | "config";
  panelTitle?: string;
};

type SpawnParams = {
  scope: string;
  settings: TelemetryPanelSettings;
};

export function spawnTelemetryImagePanel({
  scope,
  settings,
}: SpawnParams): string {
  return createTelemetryPanel(scope, {
    editorId: "telemetry-image-viewer",
    title: settings.panelTitle ?? "Telemetry Image",
    settings,
    frame: {
      x: 160,
      y: 160,
      width: 680,
      height: 520,
      minWidth: 360,
      minHeight: 280,
    },
  });
}

export function spawnTelemetryTreePanel({
  scope,
  settings,
}: SpawnParams): string {
  return createTelemetryPanel(scope, {
    editorId: "telemetry-tree-viewer",
    title: settings.panelTitle ?? "Telemetry Tree",
    settings,
    frame: {
      x: 160,
      y: 160,
      width: 640,
      height: 720,
      minWidth: 360,
      minHeight: 320,
    },
  });
}

function createTelemetryPanel(
  scope: string,
  config: FloatingPanelSpawnConfig
): string {
  return spawnFloatingPanel(scope, config);
}
