import React, { useEffect, useMemo, useState, useCallback } from "react";
import { ProjectData } from "../../../../data-sources/launcher";
import { useTelemetryStream } from "../../../../data-sources/telemetry";
import { useOptionalFloatingPanel } from "../../../workspaces/floating-panels";
import {
  ITelemetryField,
  ITelemetryStruct,
  ITelemetryWorkload,
} from "../../../../data-sources/telemetry";
import styles from "./TelemetryTreeViewer.module.css";

type PanelSettings = {
  telemetryBaseUrl?: string;
  modelPath?: string;
  modelName?: string;
  workloadName?: string;
  fieldPath?: string;
  dataKind?: "inputs" | "outputs" | "config";
};

export default function TelemetryTreeViewer() {
  const panel = useOptionalFloatingPanel();
  const [localSettings, setLocalSettings] = useState<PanelSettings>({});
  const settings =
    (panel?.settings as PanelSettings | undefined) ?? localSettings;
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
      : "";
  const dataKind = settings.dataKind ?? "outputs";
  const fieldPath = settings.fieldPath ?? "";

  const targetWorkload = workloads.find(
    (workload) => workload.name === workloadName
  );

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

  const rootNodes = useMemo(() => {
    if (!model) return [];
    if (workloadName && fieldPath) {
      const normalized = normalizeFieldPath(workloadName, fieldPath);
      const field = model.getField(normalized);
      return field ? [field] : [];
    }
    if (workloadName && targetWorkload) {
      const struct = getStruct(targetWorkload, dataKind);
      if (struct) {
        return struct.fields ?? [];
      }
      return [];
    }
    return model.workloads.flatMap((workload) => {
      const struct = getStruct(workload, dataKind);
      if (!struct) return [];
      return struct.fields ?? [];
    });
  }, [model, workloadName, dataKind, fieldPath, targetWorkload]);

  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(() => {
    return new Set<string>();
  });

  const toggleNode = (path: string) => {
    setExpandedNodes((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  };

  const handleModelChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const modelPath = event.target.value;
    const descriptor = modelOptions.find(
      (model) => model.modelPath === modelPath
    );
    updateSettings({
      modelPath,
      modelName: descriptor?.modelName,
      telemetryBaseUrl: descriptor?.telemetryBaseUrl,
      workloadName: "",
      fieldPath: "",
    });
  };

  const handleWorkloadChange = (
    event: React.ChangeEvent<HTMLSelectElement>
  ) => {
    updateSettings({
      workloadName: event.target.value,
      fieldPath: "",
    });
  };

  const handleFieldChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    updateSettings({
      fieldPath: event.target.value,
    });
  };

  const handleDataKindChange = (
    event: React.ChangeEvent<HTMLSelectElement>
  ) => {
    updateSettings({
      dataKind: event.target.value as PanelSettings["dataKind"],
    });
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
          <label htmlFor="tree-model">Model</label>
          <select
            id="tree-model"
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
          <label htmlFor="tree-workload">Workload</label>
          <select
            id="tree-workload"
            value={workloadName}
            onChange={handleWorkloadChange}
          >
            <option value="">All Workloads</option>
            {workloads.map((workload) => (
              <option value={workload.name} key={workload.name}>
                {workload.name}
              </option>
            ))}
          </select>
        </div>
        <div className={styles.control}>
          <label htmlFor="tree-section">Section</label>
          <select
            id="tree-section"
            value={dataKind}
            onChange={handleDataKindChange}
          >
            <option value="config">Config</option>
            <option value="inputs">Inputs</option>
            <option value="outputs">Outputs</option>
          </select>
        </div>
        <div className={styles.control}>
          <label htmlFor="tree-field">Field Path</label>
          <input
            id="tree-field"
            type="text"
            placeholder="outputs.camera.pose"
            value={fieldPath}
            onChange={handleFieldChange}
          />
        </div>
      </div>
      <div className={styles.tree}>
        {rootNodes.length === 0 ? (
          <div className={styles.message}>No telemetry fields available.</div>
        ) : (
          rootNodes.map((node) => (
            <TreeNode
              key={node.path}
              field={node}
              expandedPaths={expandedNodes}
              toggle={toggleNode}
            />
          ))
        )}
      </div>
    </div>
  );
}

function TreeNode({
  field,
  expandedPaths,
  toggle,
}: {
  field: ITelemetryField;
  expandedPaths: Set<string>;
  toggle: (path: string) => void;
}) {
  const value = field.getValue?.();
  const isArray = Array.isArray(value);
  const hasChildren =
    isArray || (field.fields && field.fields.length > 0);
  const expanded = expandedPaths.has(field.path);

  return (
    <div className={styles.node}>
      {hasChildren ? (
        <button
          type="button"
          className={styles.nodeToggle}
          onClick={() => toggle(field.path)}
        >
          {expanded ? "▼" : "▶"}
        </button>
      ) : (
        <span style={{ marginRight: 8 }} />
      )}
      <span>{field.name}: </span>
      <span className={styles.nodeValue}>
        {isArray ? formatArraySummary(value) : formatValue(field)}
      </span>
      {expanded && hasChildren
        ? isArray && Array.isArray(value)
          ? value.map((entry, index) => (
              <JsonNode
                key={`${field.path}[${index}]`}
                label={`[${index}]`}
                path={`${field.path}[${index}]`}
                value={entry}
                expandedPaths={expandedPaths}
                toggle={toggle}
              />
            ))
          : field.fields?.map((child) => (
              <TreeNode
                key={child.path}
                field={child}
                expandedPaths={expandedPaths}
                toggle={toggle}
              />
            ))
        : null}
    </div>
  );
}

function JsonNode({
  label,
  path,
  value,
  expandedPaths,
  toggle,
}: {
  label: string;
  path: string;
  value: unknown;
  expandedPaths: Set<string>;
  toggle: (path: string) => void;
}) {
  const isArray = Array.isArray(value);
  const isObject =
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    !(value instanceof Uint8Array);
  const hasChildren = isArray
    ? value.length > 0
    : isObject && Object.keys(value as Record<string, unknown>).length > 0;
  const expanded = expandedPaths.has(path);
  return (
    <div className={styles.node}>
      {hasChildren ? (
        <button
          type="button"
          className={styles.nodeToggle}
          onClick={() => toggle(path)}
        >
          {expanded ? "▼" : "▶"}
        </button>
      ) : (
        <span style={{ marginRight: 8 }} />
      )}
      <span>{label}: </span>
      <span className={styles.nodeValue}>{formatJsonValue(value)}</span>
      {expanded && hasChildren
        ? isArray && Array.isArray(value)
          ? value.map((entry, index) => (
              <JsonNode
                key={`${path}[${index}]`}
                label={`[${index}]`}
                path={`${path}[${index}]`}
                value={entry}
                expandedPaths={expandedPaths}
                toggle={toggle}
              />
            ))
          : Object.entries(value as Record<string, unknown>).map(
              ([key, child]) => (
                <JsonNode
                  key={`${path}.${key}`}
                  label={key}
                  path={`${path}.${key}`}
                  value={child}
                  expandedPaths={expandedPaths}
                  toggle={toggle}
                />
              )
            )
        : null}
    </div>
  );
}

function formatValue(field: ITelemetryField) {
  const value = field.getValue?.();
  if (value === null || value === undefined) return "<null>";
  if (typeof value === "string") return `"${value}"`;
  if (typeof value === "number") return value.toString();
  if (Array.isArray(value)) return `[${value.length} items]`;
  if (value instanceof Uint8Array) return `<bytes ${value.byteLength}>`;
  if (typeof value === "object") return "{…}";
  return String(value);
}

function formatArraySummary(value: unknown): string {
  if (!Array.isArray(value)) return "[]";
  return `[${value.length} items]`;
}

function formatJsonValue(value: unknown): string {
  if (value === null || value === undefined) return "<null>";
  if (typeof value === "string") return `"${value}"`;
  if (typeof value === "number") return value.toString();
  if (typeof value === "boolean") return value ? "true" : "false";
  if (Array.isArray(value)) return `[${value.length} items]`;
  if (value instanceof Uint8Array) return `<bytes ${value.byteLength}>`;
  if (typeof value === "object") return "{…}";
  return String(value);
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

function getStruct(
  workload: ITelemetryWorkload,
  kind: "inputs" | "outputs" | "config"
): ITelemetryStruct | undefined {
  if (kind === "config") return workload.config;
  if (kind === "inputs") return workload.inputs;
  return workload.outputs;
}
