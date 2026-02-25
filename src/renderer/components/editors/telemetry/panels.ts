import {
  spawnFloatingPanel,
  type FloatingPanelSpawnConfig,
} from "../../workspaces/floating-panels";

export type TelemetryPanelSettings = {
  telemetryBaseUrl?: string;
  modelName?: string;
  modelPath?: string;
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
    initialSize: { width: 680, height: 520 },
    minSize: { width: 360, height: 280 },
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
    initialSize: { width: 640, height: 720 },
    minSize: { width: 360, height: 320 },
  });
}

function createTelemetryPanel(
  scope: string,
  config: FloatingPanelSpawnConfig
): string {
  return spawnFloatingPanel(scope, config);
}
