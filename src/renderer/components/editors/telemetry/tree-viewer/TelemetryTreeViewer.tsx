import React, {
  useEffect,
  useMemo,
  useRef,
  useState,
  useCallback,
} from "react";
import { ProjectData } from "../../../../data-sources/launcher";
import { useTelemetryStream } from "../../../../data-sources/telemetry";
import { useOptionalFloatingPanel } from "../../../workspaces/floating-panels";
import {
  ITelemetryField,
  ITelemetryModel,
  ITelemetryStruct,
  ITelemetryWorkload,
} from "../../../../data-sources/telemetry";
import styles from "./TelemetryTreeViewer.module.css";
import { usePanelInstance } from "../../../workspaces/PanelInstanceContext";
import {
  buildNamespacedKey,
  createPanelInstanceId,
  getFirstAvailableValue,
  removeStorageValue,
  setStorageValue,
} from "../../../../services/storage";

type SectionKind = "inputs" | "outputs" | "config";
type DataKindSelection = SectionKind | "all";

type PanelSettings = {
  telemetryBaseUrl?: string;
  modelPath?: string;
  modelName?: string;
  workloadName?: string;
  fieldPath?: string;
  dataKind?: DataKindSelection;
};

const SECTION_KINDS: SectionKind[] = ["config", "inputs", "outputs"];
const SECTION_OPTIONS: { value: DataKindSelection; label: string }[] = [
  { value: "all", label: "All Sections" },
  { value: "config", label: "Config" },
  { value: "inputs", label: "Inputs" },
  { value: "outputs", label: "Outputs" },
];

const TREE_STORAGE_KEYS = {
  model: "robotick-studio.telemetry.tree.model",
  workload: "robotick-studio.telemetry.tree.workload",
  field: "robotick-studio.telemetry.tree.field",
  dataKind: "robotick-studio.telemetry.tree.dataKind",
};

export default function TelemetryTreeViewer() {
  const panel = useOptionalFloatingPanel();
  const panelInstance = usePanelInstance();
  const fallbackPanelIdRef = useRef<string | undefined>(undefined);
  if (!fallbackPanelIdRef.current) {
    fallbackPanelIdRef.current = createPanelInstanceId();
  }
  const panelInstanceId = panelInstance.panelId ?? fallbackPanelIdRef.current;
  const workspaceIdentifier = panelInstance.workspaceId ?? "workspace";
  const buildPanelKey = useCallback(
    (base: string) =>
      buildNamespacedKey(base, workspaceIdentifier, panelInstanceId),
    [workspaceIdentifier, panelInstanceId]
  );
  const readPreference = useCallback(
    (base: string) => {
      const primaryKey = buildPanelKey(base);
      const { value, key } = getFirstAvailableValue([primaryKey, base]);
      if (value !== null && key && key !== primaryKey) {
        setStorageValue(primaryKey, value);
      }
      return value;
    },
    [buildPanelKey]
  );
  const persistPreference = useCallback(
    (base: string, value: string | undefined) => {
      const key = buildPanelKey(base);
      if (value === undefined) {
        removeStorageValue(key);
      } else {
        setStorageValue(key, value);
      }
    },
    [buildPanelKey]
  );
  const storedLocalSettings = useMemo<PanelSettings>(
    () => ({
      modelPath: readPreference(TREE_STORAGE_KEYS.model) ?? undefined,
      workloadName: readPreference(TREE_STORAGE_KEYS.workload) ?? undefined,
      fieldPath: readPreference(TREE_STORAGE_KEYS.field) ?? undefined,
      dataKind: (readPreference(TREE_STORAGE_KEYS.dataKind) ?? undefined) as
        | PanelSettings["dataKind"]
        | undefined,
    }),
    [readPreference]
  );
  const [localSettings, setLocalSettings] =
    useState<PanelSettings>(storedLocalSettings);
  const persistLocalSettings = useCallback(
    (next: Partial<PanelSettings>) => {
      if ("modelPath" in next) {
        persistPreference(TREE_STORAGE_KEYS.model, next.modelPath);
      }
      if ("workloadName" in next) {
        persistPreference(TREE_STORAGE_KEYS.workload, next.workloadName);
      }
      if ("fieldPath" in next) {
        persistPreference(TREE_STORAGE_KEYS.field, next.fieldPath);
      }
      if ("dataKind" in next) {
        persistPreference(TREE_STORAGE_KEYS.dataKind, next.dataKind);
      }
    },
    [persistPreference]
  );
  const settings =
    (panel?.settings as PanelSettings | undefined) ?? localSettings;
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
  const sectionSelection: DataKindSelection = settings.dataKind ?? "outputs";
  const activeSectionKinds: SectionKind[] =
    sectionSelection === "all" ? SECTION_KINDS : [sectionSelection];
  const fieldFilterRaw = settings.fieldPath ?? "";
  const fieldFilter = fieldFilterRaw.trim().toLowerCase();

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

  const rootNodes = useMemo<ITelemetryField[]>(() => {
    if (!model) return [];
    const workloadsToInspect =
      workloadName && targetWorkload ? [targetWorkload] : workloads;
    if (workloadsToInspect.length === 0) return [];

    if (fieldFilter) {
      const matches: ITelemetryField[] = [];
      const seen = new Set<string>();
      for (const workload of workloadsToInspect) {
        for (const kind of activeSectionKinds) {
          const struct = getStruct(workload, kind);
          if (!struct || !struct.fields) continue;
          collectMatchingFields(struct.fields, fieldFilter, matches, seen);
        }
      }
      return matches;
    }

    if (workloadName && targetWorkload) {
      if (activeSectionKinds.length === 1) {
        const struct = getStruct(targetWorkload, activeSectionKinds[0]);
        return struct?.fields ?? [];
      }
      return activeSectionKinds
        .map((kind) => createSectionNode(model, targetWorkload, kind))
        .filter((node): node is ITelemetryField => Boolean(node));
    }

    return model.workloads
      .map((workload) =>
        createWorkloadNode(model, workload, activeSectionKinds)
      )
      .filter((node): node is ITelemetryField => Boolean(node));
  }, [
    model,
    workloads,
    workloadName,
    targetWorkload,
    fieldFilter,
    sectionSelection,
  ]);

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
            value={sectionSelection}
            onChange={handleDataKindChange}
          >
            {SECTION_OPTIONS.map((option) => (
              <option value={option.value} key={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
        <div className={styles.control}>
          <label htmlFor="tree-field">Field</label>
          <input
            id="tree-field"
            type="text"
            placeholder="full or partial name"
            value={fieldFilterRaw}
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
  const hasChildren = isArray || (field.fields && field.fields.length > 0);
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

function formatNumberSmart(n: number): string {
  if (!isFinite(n)) return String(n);
  if (Number.isInteger(n)) return String(n);
  const abs = Math.abs(n);
  const decimals = abs >= 100 ? 1 : abs >= 10 ? 2 : 3;
  return n.toFixed(decimals);
}

function formatEnumNumber(field: ITelemetryField, value: number): string {
  const formatted = formatNumberSmart(value);
  if (!field.enum_values || field.enum_values.length === 0) return formatted;
  const match = field.enum_values.find((entry) => entry.value === value);
  return match ? `${formatted} (${match.name})` : formatted;
}

function formatEnumArrayPreview(
  field: ITelemetryField,
  values: unknown[]
): string {
  const limit = 4;
  const preview = values.slice(0, limit).map((entry) => {
    if (typeof entry === "number") {
      return formatEnumNumber(field, entry);
    }
    return String(entry);
  });
  const suffix = values.length > limit ? ", …" : "";
  return `[${preview.join(", ")}${suffix}]`;
}

function formatValue(field: ITelemetryField) {
  const value = field.getValue?.();
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return `"${value}"`;
  if (typeof value === "number") return formatEnumNumber(field, value);
  if (Array.isArray(value)) {
    if (field.enum_values && field.enum_values.length > 0) {
      return formatEnumArrayPreview(field, value);
    }
    return `[${value.length} items]`;
  }
  if (value instanceof Uint8Array) return `<bytes ${value.byteLength}>`;
  if (typeof value === "object") return "{…}";
  return String(value);
}

function formatArraySummary(value: unknown): string {
  if (!Array.isArray(value)) return "[]";
  return `[${value.length} items]`;
}

function formatJsonValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return `"${value}"`;
  if (typeof value === "number") return value.toString();
  if (typeof value === "boolean") return value ? "true" : "false";
  if (Array.isArray(value)) return `[${value.length} items]`;
  if (value instanceof Uint8Array) return `<bytes ${value.byteLength}>`;
  if (typeof value === "object") return "{…}";
  return String(value);
}

function getStruct(
  workload: ITelemetryWorkload,
  kind: "inputs" | "outputs" | "config"
): ITelemetryStruct | undefined {
  if (kind === "config") return workload.config;
  if (kind === "inputs") return workload.inputs;
  return workload.outputs;
}

function collectMatchingFields(
  fields: ITelemetryField[],
  filter: string,
  matches: ITelemetryField[],
  seen: Set<string>
) {
  for (const field of fields) {
    const name = field.name ?? "";
    const match = name.toLowerCase().includes(filter);
    if (match && !seen.has(field.path)) {
      seen.add(field.path);
      matches.push(field);
      // include child tree for matched node; no need to continue filtering children here
    }

    if (field.fields && field.fields.length > 0) {
      collectMatchingFields(field.fields, filter, matches, seen);
    }
  }
}

function createSectionNode(
  model: ITelemetryModel,
  workload: ITelemetryWorkload,
  kind: SectionKind
): ITelemetryField | null {
  const struct = getStruct(workload, kind);
  if (!struct || !struct.fields || struct.fields.length === 0) {
    return null;
  }
  return {
    name: capitalize(kind),
    type: kind,
    path: `${workload.name}.${kind}`,
    offset: struct.offset,
    model,
    getValue: () => undefined,
    fields: struct.fields,
  };
}

function createWorkloadNode(
  model: ITelemetryModel,
  workload: ITelemetryWorkload,
  kinds: SectionKind[]
): ITelemetryField | null {
  const sections = kinds
    .map((kind) => createSectionNode(model, workload, kind))
    .filter((node): node is ITelemetryField => Boolean(node));
  if (!sections.length) return null;

  return {
    name: workload.name,
    type: "workload",
    path: `workload:${workload.name}`,
    offset: sections[0].offset ?? 0,
    model,
    getValue: () => undefined,
    fields: sections,
  };
}

function capitalize(value: string) {
  if (!value) return value;
  return value.charAt(0).toUpperCase() + value.slice(1);
}
