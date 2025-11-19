import React, { useEffect, useMemo, useState, useCallback } from "react";
import { ProjectData } from "../../../../data-sources/launcher";
import { useTelemetryStream } from "../../../../data-sources/telemetry";
import { useOptionalFloatingPanel } from "../../../workspaces/floating-panels";
import { useBlobURL } from "../view/telemetry-image-blobs";
import styles from "./TelemetryImageViewer.module.css";

type PanelSettings = {
  telemetryBaseUrl?: string;
  modelPath?: string;
  modelName?: string;
  workloadName?: string;
  fieldPath?: string;
};

export default function TelemetryImageViewer() {
  const panel = useOptionalFloatingPanel();
  const [localSettings, setLocalSettings] = useState<PanelSettings>({});
  const settings = (panel?.settings as PanelSettings | undefined) ?? localSettings;
  const updateSettings = useCallback(
    (next: Partial<PanelSettings>) => {
      if (panel) {
        panel.updateSettings(next);
      } else {
        setLocalSettings((prev) => ({ ...prev, ...next }));
      }
    },
    [panel]
  );
  const { projectModels } = ProjectData.use();

  const modelOptions = projectModels.data;
  const hasModels = modelOptions.length > 0;

  const selectedModel = hasModels
    ? modelOptions.find((model) => {
        if (settings.modelPath && settings.modelPath === model.modelPath) {
          return true;
        }
        if (
          settings.telemetryBaseUrl &&
          settings.telemetryBaseUrl === model.telemetryBaseUrl
        ) {
          return true;
        }
        if (
          settings.modelName &&
          settings.modelName.toLowerCase() === model.modelName.toLowerCase()
        ) {
          return true;
        }
        return false;
      }) ?? modelOptions[0]
    : null;

  const telemetryBaseUrl =
    settings.telemetryBaseUrl ?? selectedModel?.telemetryBaseUrl ?? "";

  const { model } = useTelemetryStream(telemetryBaseUrl, 10);
  const workloads = model?.workloads ?? [];
  const workloadName =
    settings.workloadName && settings.workloadName.length > 0
      ? settings.workloadName
      : workloads[0]?.name ?? "";
  const fieldPath = settings.fieldPath ?? "";

  useEffect(() => {
    if (!settings.modelPath && selectedModel) {
      updateSettings({
        modelPath: selectedModel.modelPath,
        modelName: selectedModel.modelName,
        telemetryBaseUrl: selectedModel.telemetryBaseUrl,
      });
    }
  }, [selectedModel, settings.modelPath, updateSettings]);

  useEffect(() => {
    if (!settings.workloadName && workloads[0]) {
      updateSettings({ workloadName: workloads[0].name });
    }
  }, [settings.workloadName, updateSettings, workloads]);

  const field = useMemo(() => {
    if (!model || !workloadName || !fieldPath) return null;
    const normalizedPath = normalizeFieldPath(workloadName, fieldPath);
    return model.getField(normalizedPath) ?? null;
  }, [model, workloadName, fieldPath]);

  const value = field?.getValue();
  const blobUrl = useBlobURL(
    value instanceof Uint8Array ? value : undefined,
    field?.mime_type
  );

  const handleModelChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const modelPath = event.target.value;
    const descriptor = modelOptions.find(
      (model) => model.modelPath === modelPath
    );
    updateSettings({
      modelPath,
      modelName: descriptor?.modelName,
      telemetryBaseUrl: descriptor?.telemetryBaseUrl,
    });
  };

  const handleWorkloadChange = (
    event: React.ChangeEvent<HTMLSelectElement>
  ) => {
    updateSettings({ workloadName: event.target.value });
  };

  const handleFieldPathChange = (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    updateSettings({ fieldPath: event.target.value });
  };

  if (!hasModels) {
    return (
      <div className={styles.panelBody}>
        <div className={styles.message}>No telemetry models available.</div>
      </div>
    );
  }

  return (
    <div className={styles.panelBody}>
      <div className={styles.controls}>
        <div className={styles.control}>
          <label htmlFor="image-model">Model</label>
          <select
            id="image-model"
            value={selectedModel?.modelPath ?? ""}
            onChange={handleModelChange}
          >
            {modelOptions.map((model) => (
              <option value={model.modelPath} key={model.modelPath}>
                {model.modelName}
              </option>
            ))}
          </select>
        </div>
        <div className={styles.control}>
          <label htmlFor="image-workload">Workload</label>
          <select
            id="image-workload"
            value={workloadName}
            onChange={handleWorkloadChange}
          >
            {workloads.map((workload) => (
              <option value={workload.name} key={workload.name}>
                {workload.name}
              </option>
            ))}
          </select>
        </div>
        <div className={styles.control}>
          <label htmlFor="image-field">Field Path</label>
          <input
            id="image-field"
            type="text"
            placeholder="outputs.camera.image"
            value={fieldPath}
            onChange={handleFieldPathChange}
          />
        </div>
      </div>
      <div className={styles.preview}>
        {blobUrl ? (
          <img src={blobUrl} alt={field?.path ?? "telemetry-image"} />
        ) : (
          <div className={styles.message}>
            {workloads.length === 0
              ? "Waiting for telemetry…"
              : "Select a field with image telemetry."}
          </div>
        )}
      </div>
    </div>
  );
}

function normalizeFieldPath(workloadName: string, fieldPath: string) {
  const trimmed = fieldPath.trim().replace(/^\./, "");
  if (
    trimmed.startsWith("config.") ||
    trimmed.startsWith("inputs.") ||
    trimmed.startsWith("outputs.")
  ) {
    return `${workloadName}.${trimmed}`;
  }
  return `${workloadName}.outputs.${trimmed}`;
}
