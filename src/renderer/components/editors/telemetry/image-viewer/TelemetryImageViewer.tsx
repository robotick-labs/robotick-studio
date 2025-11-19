import React, { useEffect, useMemo, useState, useCallback } from "react";
import { ProjectData } from "../../../../data-sources/launcher";
import { useTelemetryStream } from "../../../../data-sources/telemetry";
import {
  ITelemetryField,
  ITelemetryStruct,
  ITelemetryWorkload,
} from "../../../../data-sources/telemetry";
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

const MAX_FIELD_OPTIONS = 250;

const SECTION_KEYS: Array<
  keyof Pick<ITelemetryWorkload, "outputs" | "inputs" | "config">
> = ["outputs", "inputs", "config"];

type ImageFieldOption = {
  path: string;
  label: string;
};

const STORAGE_KEYS = {
  model: "robotick-hub.telemetry.image.model",
  workload: "robotick-hub.telemetry.image.workload",
  field: "robotick-hub.telemetry.image.field",
};

function readPreference(key: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function persistPreference(key: string, value: string | undefined) {
  if (typeof window === "undefined") return;
  try {
    if (value === undefined) {
      window.localStorage.removeItem(key);
    } else {
      window.localStorage.setItem(key, value);
    }
  } catch {
    // ignore
  }
}

export default function TelemetryImageViewer() {
  const panel = useOptionalFloatingPanel();
  const storedLocalSettings = useMemo<PanelSettings>(() => ({
    modelPath: readPreference(STORAGE_KEYS.model) ?? undefined,
    workloadName: readPreference(STORAGE_KEYS.workload) ?? undefined,
    fieldPath: readPreference(STORAGE_KEYS.field) ?? undefined,
  }), []);
  const [localSettings, setLocalSettings] = useState<PanelSettings>(
    storedLocalSettings
  );
  const persistLocalSettings = useCallback(
    (next: Partial<PanelSettings>) => {
      if ("modelPath" in next) {
        persistPreference(STORAGE_KEYS.model, next.modelPath);
      }
      if ("workloadName" in next) {
        persistPreference(STORAGE_KEYS.workload, next.workloadName);
      }
      if ("fieldPath" in next) {
        persistPreference(STORAGE_KEYS.field, next.fieldPath);
      }
    },
    []
  );
  const updateSettings = useCallback(
    (next: Partial<PanelSettings>) => {
      if (panel) {
        panel.updateSettings(next);
      } else {
        setLocalSettings((prev) => ({ ...prev, ...next }));
      }
      persistLocalSettings(next);
    },
    [panel, persistLocalSettings]
  );
  const settings = (panel?.settings as PanelSettings | undefined) ?? localSettings;
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
  const workloadsWithImages = useMemo(() => {
    const set = new Set<string>();
    if (!model) return set;
    for (const workload of workloads) {
      for (const section of SECTION_KEYS) {
        const struct = getStruct(workload, section);
        if (struct && hasImageField(struct.fields)) {
          set.add(workload.name);
          break;
        }
      }
    }
    return set;
  }, [model, workloads]);
  const filteredWorkloads = workloads.filter((w) =>
    workloadsWithImages.has(w.name)
  );
  const availableWorkloads =
    filteredWorkloads.length > 0 ? filteredWorkloads : workloads;
  const workloadsToScan = workloadName
    ? availableWorkloads.filter((w) => w.name === workloadName)
    : availableWorkloads;
  const imageFieldOptions = useMemo(() => {
    if (!model || workloadsToScan.length === 0) return [];
    const options: ImageFieldOption[] = [];
    const seen = new Set<string>();
    for (const workload of workloadsToScan) {
      for (const section of SECTION_KEYS) {
        const struct = getStruct(workload, section);
        collectImageFields(struct?.fields ?? [], options, seen);
        if (options.length >= MAX_FIELD_OPTIONS) {
          return options.sort((a, b) => a.label.localeCompare(b.label));
        }
      }
    }
    return options.sort((a, b) => a.label.localeCompare(b.label));
  }, [model, workloadsToScan]);

  useEffect(() => {
    if (imageFieldOptions.length === 0) return;
    if (!fieldPath || !imageFieldOptions.some((option) => option.path === fieldPath)) {
      updateSettings({ fieldPath: imageFieldOptions[0].path });
    }
  }, [fieldPath, imageFieldOptions, updateSettings]);

  const imageField = useMemo(() => {
    if (!model || !fieldPath) return null;
    return model.getField(fieldPath) ?? null;
  }, [model, fieldPath]);
  const selectedImageField = fieldPath;

  const [modelsWithImages, setModelsWithImages] = useState<Set<string>>(
    () => new Set()
  );

  useEffect(() => {
    if (selectedModel && imageFieldOptions.length > 0) {
      setModelsWithImages((prev) => {
        if (prev.has(selectedModel.modelPath)) return prev;
        const next = new Set(prev);
        next.add(selectedModel.modelPath);
        return next;
      });
    }
  }, [selectedModel, imageFieldOptions]);

  const modelsToShow = useMemo(() => {
    if (modelsWithImages.size === 0) return modelOptions;
    const filtered = modelOptions.filter((entry) =>
      modelsWithImages.has(entry.modelPath)
    );
    return filtered.length > 0 ? filtered : modelOptions;
  }, [modelOptions, modelsWithImages]);

  useEffect(() => {
    if (modelsWithImages.size === 0) return;
    if (selectedModel && modelsWithImages.has(selectedModel.modelPath)) {
      return;
    }
    const next = modelsToShow[0];
    if (next) {
      updateSettings({
        modelPath: next.modelPath,
        modelName: next.modelName,
        telemetryBaseUrl: next.telemetryBaseUrl,
      });
    }
  }, [modelsWithImages, modelsToShow, selectedModel, updateSettings]);

  useEffect(() => {
    if (availableWorkloads.length === 0) return;
    if (!availableWorkloads.some((w) => w.name === workloadName)) {
      updateSettings({ workloadName: availableWorkloads[0].name });
    }
  }, [availableWorkloads, workloadName, updateSettings]);

  const field = useMemo(() => {
    if (!model || !fieldPath) return null;
    return model.getField(fieldPath) ?? null;
  }, [model, fieldPath]);

  const value = field?.getValue();
  const blobUrl = useBlobURL(
    value instanceof Uint8Array ? value : undefined,
    field?.mime_type
  );

  const handleModelChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const modelPath = event.target.value;
    const descriptor = modelsToShow.find(
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

  const handleFieldSelection = (
    event: React.ChangeEvent<HTMLSelectElement>
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
            {modelsToShow.map((model) => (
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
            disabled={availableWorkloads.length === 0}
          >
            {availableWorkloads.map((workload) => (
              <option value={workload.name} key={workload.name}>
                {workload.name}
              </option>
            ))}
          </select>
        </div>
        <div className={styles.control}>
          <label htmlFor="image-field">Field</label>
          <select
            id="image-field"
            value={fieldPath}
            onChange={handleFieldSelection}
          >
            {imageFieldOptions.map((option) => (
              <option key={option.path} value={option.path}>
                {option.label}
              </option>
            ))}
          </select>
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

function collectImageFields(
  fields: ITelemetryField[],
  out: ImageFieldOption[],
  seen: Set<string>
): void {
  for (const field of fields) {
    if (out.length >= MAX_FIELD_OPTIONS) return;
    if (field.fields && field.fields.length > 0) {
      collectImageFields(field.fields, out, seen);
      continue;
    }
    if (seen.has(field.path)) continue;
    if (field.mime_type && field.mime_type.startsWith("image/")) {
      seen.add(field.path);
      out.push({
        path: field.path,
        label: formatFieldLabel(field.path),
      });
    }
  }
}

function formatFieldLabel(path: string): string {
  const segments = path.split(".");
  return segments.length > 0 ? segments[segments.length - 1] : path;
}

function getStruct(
  workload: ITelemetryWorkload,
  key: keyof Pick<ITelemetryWorkload, "outputs" | "inputs" | "config">
): ITelemetryStruct | undefined {
  if (key === "outputs") return workload.outputs;
  if (key === "inputs") return workload.inputs;
  return workload.config;
}

function hasImageField(fields: ITelemetryField[]): boolean {
  for (const field of fields) {
    if (field.mime_type && field.mime_type.startsWith("image/")) {
      return true;
    }
    if (field.fields && field.fields.length > 0) {
      if (hasImageField(field.fields)) {
        return true;
      }
    }
  }
  return false;
}
