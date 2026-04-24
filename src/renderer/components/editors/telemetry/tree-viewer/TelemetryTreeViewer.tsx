import React, {
  useEffect,
  useMemo,
  useRef,
  useState,
  useCallback,
} from "react";
import { ProjectData } from "../../../../data-sources/launcher";
import {
  useTelemetryStream,
} from "../../../../data-sources/telemetry";
import { useOptionalFloatingPanel } from "../../../workspaces/floating-panels";
import {
  ITelemetryField,
  ITelemetryModel,
  ITelemetryStruct,
  ITelemetryWorkload,
} from "../../../../data-sources/telemetry";
import styles from "./TelemetryTreeViewer.module.css";
import sharedStyles from "../Telemetry.module.css";
import { usePanelInstance } from "../../../workspaces/PanelInstanceContext";
import {
  buildNamespacedKey,
  createPanelInstanceId,
  getFirstAvailableValue,
  removeStorageValue,
  setStorageValue,
} from "../../../../services/storage";
import {
  formatEnumArrayPreview,
  formatEnumNumber,
} from "../utils/telemetry-formatters";
import { extractTelemetryImagePayload } from "../utils/telemetry-image";
import {
  deriveWorkloadStats,
  formatDurationMs,
  formatJitterPercent,
  TICK_DURATION_WINDOW_SIZE,
} from "../utils/workload-stats";
import type { FieldConnectionHint } from "../view/types";
import { WritableTelemetryInputField } from "../view/WritableTelemetryInputField";
import {
  buildFieldConnectionHintsByModelPath,
  type ConnectionKind,
  getConnectionHint,
  getConnectionKindFromHint,
  getConnectionTooltip,
} from "../view/field-connections";

type SectionKind = "inputs" | "outputs" | "config" | "stats";
type DataKindSelection = SectionKind | "all";

type PanelSettings = {
  telemetryBaseUrl?: string;
  modelPath?: string;
  modelName?: string;
  workloadName?: string;
  fieldPath?: string;
  dataKind?: DataKindSelection;
};

const SECTION_KINDS: SectionKind[] = [
  "config",
  "inputs",
  "outputs",
  "stats",
];
const SECTION_OPTIONS: { value: DataKindSelection; label: string }[] = [
  { value: "all", label: "All Sections" },
  { value: "config", label: "Config" },
  { value: "inputs", label: "Inputs" },
  { value: "outputs", label: "Outputs" },
  { value: "stats", label: "Stats" },
];
const FILTER_DEBOUNCE_MS = 160;
const TREE_REFRESH_INTERVAL_MS = 200;
const TREE_VIEWER_MAX_SAMPLE_RATE_HZ = 5;
const TelemetrySampleRevisionContext = React.createContext(0);
const TelemetryValueReaderContext = React.createContext<
  ((field: ITelemetryField) => unknown) | null
>(null);

type FlatTreeRow = {
  field: ITelemetryField;
  depth: number;
  expanded: boolean;
  hasChildren: boolean;
  isArrayField: boolean;
};

const TREE_STORAGE_KEYS = {
  model: "robotick-studio.telemetry.tree.model",
  workload: "robotick-studio.telemetry.tree.workload",
  field: "robotick-studio.telemetry.tree.field",
  dataKind: "robotick-studio.telemetry.tree.dataKind",
  expandedPaths: "robotick-studio.telemetry.tree.expandedPaths",
};

type ExpandedPathsPreference = {
  paths: string[];
};

function parseExpandedPathsPreference(
  rawValue: string | undefined
): ExpandedPathsPreference | null {
  if (!rawValue) return null;
  try {
    const parsed = JSON.parse(rawValue) as
      | Partial<ExpandedPathsPreference>
      | string[];
    // Current format.
    if (
      parsed &&
      typeof parsed === "object" &&
      !Array.isArray(parsed) &&
      Array.isArray(parsed.paths)
    ) {
      const paths = parsed.paths.filter(
        (path): path is string => typeof path === "string"
      );
      return { paths };
    }
    // Legacy format fallback (raw array of paths).
    if (Array.isArray(parsed)) {
      const paths = parsed.filter(
        (path): path is string => typeof path === "string"
      );
      return { paths };
    }
    return null;
  } catch {
    return null;
  }
}

function serializeExpandedPathsPreference(
  preference: ExpandedPathsPreference
): string {
  return JSON.stringify(preference);
}

function getConnectionCapsuleClass(kind: ConnectionKind | null): string {
  if (kind === "local") return sharedStyles.localConnectedCapsule;
  if (kind === "remote") return sharedStyles.remoteConnectedCapsule;
  if (kind === "both") return sharedStyles.bothConnectedCapsule;
  return "";
}

/**
 * Render a telemetry tree viewer UI that lets the user select a model, workload, section, and field filter and browse hierarchical telemetry fields.
 *
 * Persists per-panel and per-workspace viewer preferences and uses the selected telemetry model to populate the displayed tree.
 *
 * @returns The React element tree for the telemetry tree viewer.
 */
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
  const storedExpandedPathsPreference = useMemo(
    () =>
      parseExpandedPathsPreference(
        readPreference(TREE_STORAGE_KEYS.expandedPaths) ?? undefined
      ),
    [readPreference]
  );
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
  const fieldConnectionHintsByModelPath = useMemo(
    () =>
      buildFieldConnectionHintsByModelPath(
        projectModels.data.map((projectModel) => ({
          modelPath: projectModel.modelPath,
          modelShortName: projectModel.modelShortName,
          modelName: projectModel.modelName,
          data: projectModel.data,
        }))
      ),
    [projectModels.data]
  );

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
  const requestedSamplingRateHz =
    selectedModel?.preferredTelemetrySampleRateHz ?? 10;
  const samplingRateHz = Math.min(
    requestedSamplingRateHz,
    TREE_VIEWER_MAX_SAMPLE_RATE_HZ
  );
  const fieldConnectionHints = useMemo(() => {
    if (!selectedModel) {
      return new Map<string, FieldConnectionHint>();
    }
    const serializedHints =
      fieldConnectionHintsByModelPath.get(selectedModel.modelPath) ?? {};
    return new Map<string, FieldConnectionHint>(Object.entries(serializedHints));
  }, [fieldConnectionHintsByModelPath, selectedModel]);
  const panelBodyRef = useRef<HTMLDivElement | null>(null);
  const treeViewportRef = useRef<HTMLDivElement | null>(null);
  const isPanelVisible = useElementActive(panelBodyRef);

  const { model, revision } = useTelemetryStream(
    telemetryBaseUrl,
    samplingRateHz,
    {
      active: isPanelVisible,
      ensureLayout: isPanelVisible,
    }
  );
  const displayRevision = useThrottledRevision(
    revision,
    TREE_REFRESH_INTERVAL_MS
  );
  const workloads = model?.workloads ?? [];
  const workloadName =
    settings.workloadName && settings.workloadName.length > 0
      ? settings.workloadName
      : "";
  const sectionSelection: DataKindSelection = settings.dataKind ?? "outputs";
  const activeSectionKinds: SectionKind[] =
    sectionSelection === "all" ? SECTION_KINDS : [sectionSelection];
  const fieldFilterRaw = settings.fieldPath ?? "";
  const [debouncedFieldFilterRaw, setDebouncedFieldFilterRaw] =
    useState(fieldFilterRaw);
  const fieldFilter = debouncedFieldFilterRaw.trim().toLowerCase();

  const targetWorkload = workloads.find(
    (workload) => workload.name === workloadName
  );
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(
    () => new Set<string>(storedExpandedPathsPreference?.paths ?? [])
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
    persistPreference(
      TREE_STORAGE_KEYS.expandedPaths,
      serializeExpandedPathsPreference({
        paths: Array.from(expandedNodes),
      })
    );
  }, [expandedNodes, persistPreference]);

  useEffect(() => {
    if (!workloads[0]) return;
    if (
      !settings.workloadName ||
      !workloads.some((workload) => workload.name === settings.workloadName)
    ) {
      updateSettings({ workloadName: workloads[0].name });
    }
  }, [settings.workloadName, updateSettings, workloads]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedFieldFilterRaw(fieldFilterRaw);
    }, FILTER_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [fieldFilterRaw]);

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
          const struct = getStruct(model, workload, kind);
          if (!struct || !struct.fields) continue;
          collectMatchingFields(struct.fields, fieldFilter, matches, seen);
        }
      }
      return matches;
    }

    if (workloadName && targetWorkload) {
      if (activeSectionKinds.length === 1) {
        const struct = getStruct(model, targetWorkload, activeSectionKinds[0]);
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
  const flatRows = useMemo(
    () => flattenTreeRows(rootNodes, expandedNodes),
    [expandedNodes, rootNodes]
  );
  const valueReader = useMemo(() => {
    const cache = new WeakMap<ITelemetryField, unknown>();
    return (field: ITelemetryField) => {
      if (!cache.has(field)) {
        cache.set(field, field.getValue?.());
      }
      return cache.get(field);
    };
  }, [displayRevision]);

  const toggleNode = useCallback((path: string) => {
    setExpandedNodes((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }, []);

  const handleModelChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const modelPath = event.target.value;
    const descriptor = modelOptions.find(
      (model) => model.modelPath === modelPath
    );
    setExpandedNodes(new Set());
    persistPreference(
      TREE_STORAGE_KEYS.expandedPaths,
      serializeExpandedPathsPreference({ paths: [] })
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
      <div className={styles.panelBody} ref={panelBodyRef}>
        <div className={styles.message}>No telemetry models available.</div>
      </div>
    );
  }

  return (
    <div className={styles.panelBody} ref={panelBodyRef}>
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
      <TelemetrySampleRevisionContext.Provider value={displayRevision}>
        <TelemetryValueReaderContext.Provider value={valueReader}>
          <div className={styles.tree} ref={treeViewportRef}>
          {rootNodes.length === 0 ? (
            <div className={styles.message}>No telemetry fields available.</div>
          ) : (
            <div className={styles.treeRows}>
              {flatRows.map((row) => (
                <div
                  key={row.field.path}
                  className={styles.treeRow}
                >
                  <TreeRow
                    field={row.field}
                    depth={row.depth}
                    expanded={row.expanded}
                    hasChildren={row.hasChildren}
                    isArrayField={row.isArrayField}
                    toggle={toggleNode}
                    telemetryBaseUrl={telemetryBaseUrl}
                    fieldConnectionHints={fieldConnectionHints}
                  />
                </div>
              ))}
            </div>
          )}
          </div>
        </TelemetryValueReaderContext.Provider>
      </TelemetrySampleRevisionContext.Provider>
    </div>
  );
}

function useThrottledRevision(revision: number, intervalMs: number): number {
  const [displayRevision, setDisplayRevision] = useState(revision);
  const latestRevisionRef = useRef(revision);
  const timeoutRef = useRef<number | null>(null);

  useEffect(() => {
    latestRevisionRef.current = revision;
    if (revision === displayRevision || timeoutRef.current !== null) {
      return;
    }

    timeoutRef.current = window.setTimeout(() => {
      timeoutRef.current = null;
      setDisplayRevision(latestRevisionRef.current);
    }, intervalMs);
  }, [displayRevision, intervalMs, revision]);

  useEffect(() => {
    return () => {
      if (timeoutRef.current !== null) {
        window.clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  return displayRevision;
}

function useElementActive(ref: React.RefObject<HTMLElement | null>): boolean {
  const [isDocumentVisible, setIsDocumentVisible] = useState(
    typeof document === "undefined" ? true : document.visibilityState !== "hidden"
  );
  const [isElementVisible, setIsElementVisible] = useState(true);

  useEffect(() => {
    if (typeof document === "undefined") {
      return;
    }
    const handleVisibilityChange = () => {
      setIsDocumentVisible(document.visibilityState !== "hidden");
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  useEffect(() => {
    const element = ref.current;
    if (!element || typeof IntersectionObserver !== "function") {
      setIsElementVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        setIsElementVisible(
          Boolean(entry?.isIntersecting && entry.intersectionRatio > 0)
        );
      },
      { threshold: 0.01 }
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);

  return isDocumentVisible && isElementVisible;
}

function flattenTreeRows(
  fields: ITelemetryField[],
  expandedPaths: Set<string>,
  depth = 0
): FlatTreeRow[] {
  const rows: FlatTreeRow[] = [];

  for (const field of fields) {
    const isArrayField = field.elementCount > 1;
    const hasChildren = isArrayField || Boolean(field.fields?.length);
    const expanded = expandedPaths.has(field.path);
    rows.push({
      field,
      depth,
      expanded,
      hasChildren,
      isArrayField,
    });

    if (!expanded || !hasChildren) {
      continue;
    }

    if (isArrayField) {
      for (let index = 0; index < field.elementCount; index += 1) {
        const child = field.getArrayElement?.(index);
        if (!child) {
          continue;
        }
        rows.push(...flattenTreeRows([child], expandedPaths, depth + 1));
      }
      continue;
    }

    if (field.fields?.length) {
      rows.push(...flattenTreeRows(field.fields, expandedPaths, depth + 1));
    }
  }

  return rows;
}

function useTelemetryValueReader() {
  const reader = React.useContext(TelemetryValueReaderContext);
  return reader ?? ((field: ITelemetryField) => field.getValue?.());
}

function formatNodeSummary(field: ITelemetryField, hasChildren: boolean): string {
  const imagePayload = extractTelemetryImagePayload(field);
  if (imagePayload) {
    return `<image ${imagePayload.bytes.byteLength} bytes>`;
  }
  if (field.elementCount > 1) {
    return `[${field.elementCount} items]`;
  }
  if (!hasChildren) {
    return "";
  }
  const fieldCount = field.fields?.length ?? 0;
  return fieldCount > 0 ? `{${fieldCount} fields}` : "{…}";
}

function TreeNodeValue({
  field,
  isArrayField,
  hasChildren,
}: {
  field: ITelemetryField;
  isArrayField: boolean;
  hasChildren: boolean;
}) {
  React.useContext(TelemetrySampleRevisionContext);
  const readValue = useTelemetryValueReader();
  const value = hasChildren
    ? formatNodeSummary(field, hasChildren)
    : formatFieldValue(field, readValue(field));
  return (
    <span className={styles.nodeValue}>
      {hasChildren
        ? value
        : isArrayField
          ? formatArraySummary(value)
          : value}
    </span>
  );
}

function WritableTreeNodeField({
  field,
  telemetryBaseUrl,
  capsuleClassName,
  tooltipText,
}: {
  field: ITelemetryField;
  telemetryBaseUrl?: string;
  capsuleClassName?: string;
  tooltipText?: string | null;
}) {
  React.useContext(TelemetrySampleRevisionContext);
  const readValue = useTelemetryValueReader();
  return (
    <WritableTelemetryInputField
      field={field}
      telemetryBaseUrl={telemetryBaseUrl}
      className={styles.writableNodeEntry}
      capsuleClassName={capsuleClassName}
      tooltipText={tooltipText}
      readCurrentValue={readValue}
      formatCurrentValue={(targetField) =>
        formatFieldValue(targetField, readValue(targetField))
      }
    />
  );
}

const TreeRow = React.memo(function TreeRow({
  field,
  depth,
  expanded,
  hasChildren,
  isArrayField,
  toggle,
  telemetryBaseUrl,
  fieldConnectionHints,
}: {
  field: ITelemetryField;
  depth: number;
  expanded: boolean;
  hasChildren: boolean;
  isArrayField: boolean;
  toggle: (path: string) => void;
  telemetryBaseUrl?: string;
  fieldConnectionHints?: ReadonlyMap<string, FieldConnectionHint>;
}) {
  const connectionHint = getConnectionHint(field.path, fieldConnectionHints);
  const connectionKind = getConnectionKindFromHint(connectionHint);
  const capsuleClass = getConnectionCapsuleClass(connectionKind);
  const tooltipText = getConnectionTooltip(field.path, connectionHint);
  const isWritableInput =
    typeof field.writable_input_handle === "number" &&
    field.path.includes(".inputs.") &&
    !hasChildren;

  return (
    <div className={styles.node} style={{ paddingLeft: `${depth * 16}px` }}>
      <div className={styles.nodeRow}>
        {hasChildren ? (
          <button
            type="button"
            className={styles.nodeToggle}
            onClick={() => toggle(field.path)}
          >
            {expanded ? "▼" : "▶"}
          </button>
        ) : (
          <span className={styles.nodeToggleSpacer} aria-hidden="true" />
        )}
        {isWritableInput ? (
          <WritableTreeNodeField
            field={field}
            telemetryBaseUrl={telemetryBaseUrl}
            capsuleClassName={capsuleClass}
            tooltipText={tooltipText}
          />
        ) : (
          <span
            className={`${styles.nodeEntry} ${capsuleClass}`.trim()}
            title={tooltipText ?? undefined}
          >
            <span>{field.name}:</span>
            <TreeNodeValue
              field={field}
              isArrayField={isArrayField}
              hasChildren={hasChildren}
            />
          </span>
        )}
      </div>
    </div>
  );
});

function TreeArrayChildren({
  field,
  expandedPaths,
  toggle,
  telemetryBaseUrl,
  fieldConnectionHints,
}: {
  field: ITelemetryField;
  expandedPaths: Set<string>;
  toggle: (path: string) => void;
  telemetryBaseUrl?: string;
  fieldConnectionHints?: ReadonlyMap<string, FieldConnectionHint>;
}) {
  React.useContext(TelemetrySampleRevisionContext);
  const arrayChildren = Array.from({ length: field.elementCount }, (_, index) =>
    field.getArrayElement?.(index)
  ).filter((entry): entry is ITelemetryField => Boolean(entry));
  if (arrayChildren.length === 0) {
    return null;
  }
  return arrayChildren.map((entry) => (
    <TreeNode
      key={entry.path}
      field={entry}
      expanded={expandedPaths.has(entry.path)}
      expandedPaths={expandedPaths}
      toggle={toggle}
      telemetryBaseUrl={telemetryBaseUrl}
      fieldConnectionHints={fieldConnectionHints}
    />
  ));
}

const TreeNodeChildren = React.memo(function TreeNodeChildren({
  field,
  expanded,
  isArrayField,
  expandedPaths,
  toggle,
  telemetryBaseUrl,
  fieldConnectionHints,
}: {
  field: ITelemetryField;
  expanded: boolean;
  isArrayField: boolean;
  expandedPaths: Set<string>;
  toggle: (path: string) => void;
  telemetryBaseUrl?: string;
  fieldConnectionHints?: ReadonlyMap<string, FieldConnectionHint>;
}) {
  if (!expanded) {
    return null;
  }
  if (isArrayField) {
    return (
      <TreeArrayChildren
        field={field}
        expandedPaths={expandedPaths}
        toggle={toggle}
        telemetryBaseUrl={telemetryBaseUrl}
        fieldConnectionHints={fieldConnectionHints}
      />
    );
  }
  return field.fields?.map((child) => (
    <TreeNode
      key={child.path}
      field={child}
      expanded={expandedPaths.has(child.path)}
      expandedPaths={expandedPaths}
      toggle={toggle}
      telemetryBaseUrl={telemetryBaseUrl}
      fieldConnectionHints={fieldConnectionHints}
    />
  ));
});

const TreeNode = React.memo(function TreeNode({
  field,
  expanded,
  expandedPaths,
  toggle,
  telemetryBaseUrl,
  fieldConnectionHints,
}: {
  field: ITelemetryField;
  expanded: boolean;
  expandedPaths: Set<string>;
  toggle: (path: string) => void;
  telemetryBaseUrl?: string;
  fieldConnectionHints?: ReadonlyMap<string, FieldConnectionHint>;
}) {
  const isArrayField = field.elementCount > 1;
  const hasChildren = isArrayField || Boolean(field.fields?.length);
  const connectionHint = getConnectionHint(field.path, fieldConnectionHints);
  const connectionKind = getConnectionKindFromHint(connectionHint);
  const capsuleClass = getConnectionCapsuleClass(connectionKind);
  const tooltipText = getConnectionTooltip(field.path, connectionHint);
  const isWritableInput =
    typeof field.writable_input_handle === "number" &&
    field.path.includes(".inputs.") &&
    !hasChildren;

  return (
    <div className={styles.node}>
      <div className={styles.nodeRow}>
        {hasChildren ? (
          <button
            type="button"
            className={styles.nodeToggle}
            onClick={() => toggle(field.path)}
          >
            {expanded ? "▼" : "▶"}
          </button>
        ) : (
          <span className={styles.nodeToggleSpacer} aria-hidden="true" />
        )}
        {isWritableInput ? (
          <WritableTreeNodeField
            field={field}
            telemetryBaseUrl={telemetryBaseUrl}
            capsuleClassName={capsuleClass}
            tooltipText={tooltipText}
          />
        ) : (
          <span
            className={`${styles.nodeEntry} ${capsuleClass}`.trim()}
            title={tooltipText ?? undefined}
          >
            <span>{field.name}:</span>
            <TreeNodeValue
              field={field}
              isArrayField={isArrayField}
              hasChildren={hasChildren}
            />
          </span>
        )}
      </div>
      <TreeNodeChildren
        field={field}
        expanded={expanded}
        isArrayField={isArrayField}
        expandedPaths={expandedPaths}
        toggle={toggle}
        telemetryBaseUrl={telemetryBaseUrl}
        fieldConnectionHints={fieldConnectionHints}
      />
    </div>
  );
});

const JsonNode = React.memo(function JsonNode({
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
});

/**
 * Formats a telemetry field's value for display in the UI.
 *
 * @param field - The telemetry field whose value will be formatted.
 * @returns A string representation suitable for display: `""` for null/undefined, quoted strings for string values, formatted numeric values for numbers/bigints, array previews or `"[N items]"`, `"<bytes N>"` for byte arrays, `"{…}"` for objects, or `String(value)` as a fallback.
 */
function formatFieldValue(field: ITelemetryField, value: unknown) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return `"${value}"`;
  if (typeof value === "number" || typeof value === "bigint") {
    return formatEnumNumber(field, value);
  }
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

function formatCurrentFieldValue(field: ITelemetryField) {
  return formatFieldValue(field, field.getValue?.());
}

function formatArraySummary(value: unknown): string {
  if (!Array.isArray(value)) return "[]";
  return `[${value.length} items]`;
}

/**
 * Produce a concise, human-readable string summary for a JSON-like value.
 *
 * @param value - Any JSON-like value (primitive, array, object, or Uint8Array)
 * @returns A compact representation:
 *  - `""` for `null` or `undefined`
 *  - quoted string for string values
 *  - numeric string for numbers and bigints
 *  - `"true"` or `"false"` for booleans
 *  - `"[N items]"` for arrays
 *  - `"<bytes N>"` for `Uint8Array`
 *  - `"{…}"` for objects
 *  - otherwise `String(value)`
 */
function formatJsonValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return `"${value}"`;
  if (typeof value === "number" || typeof value === "bigint") {
    return value.toString();
  }
  if (typeof value === "boolean") return value ? "true" : "false";
  if (Array.isArray(value)) return `[${value.length} items]`;
  if (value instanceof Uint8Array) return `<bytes ${value.byteLength}>`;
  if (typeof value === "object") return "{…}";
  return String(value);
}

function getStruct(
  model: ITelemetryModel,
  workload: ITelemetryWorkload,
  kind: SectionKind
): ITelemetryStruct | undefined {
  if (kind === "stats") {
    const fields = createStatsFields(model, workload);
    if (!fields.length) return undefined;
    return {
      typeName: "stats",
      offset: workload.stats?.offset ?? 0,
      fields,
    };
  }
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

function createStatsFields(
  model: ITelemetryModel,
  workload: ITelemetryWorkload
): ITelemetryField[] {
  const stats = deriveWorkloadStats(workload);
  const workloadJitterPercent = formatJitterPercent(
    stats.workloadDuration.jitterMs,
    stats.goalPeriodMs
  );
  const actualJitterPercent = formatJitterPercent(
    stats.actualPeriod.jitterMs,
    stats.goalPeriodMs
  );
  const workloadDurationField = createStatsGroupField(
    model,
    workload.name,
    "Workload Duration (ms)",
    ["workload-duration"],
    [
      {
        name: "Last",
        value: `${formatDurationMs(stats.workloadDuration.lastMs)} ms`,
      },
      {
        name: `Mean (last ${TICK_DURATION_WINDOW_SIZE} ticks)`,
        value: `${formatDurationMs(stats.workloadDuration.meanMs)} ms`,
      },
      {
        name: `Jitter (last ${TICK_DURATION_WINDOW_SIZE} ticks)`,
        value: formatJitterDisplay(
          workloadJitterPercent,
          stats.workloadDuration.jitterMs
        ),
      },
    ]
  );
  const actualPeriodField = createStatsGroupField(
    model,
    workload.name,
    "Actual Period (ms)",
    ["actual-period"],
    [
      {
        name: "Last",
        value: `${formatDurationMs(stats.actualPeriod.lastMs)} ms`,
      },
      {
        name: `Mean (last ${TICK_DURATION_WINDOW_SIZE} intervals)`,
        value: `${formatDurationMs(stats.actualPeriod.meanMs)} ms`,
      },
      {
        name: `Jitter (last ${TICK_DURATION_WINDOW_SIZE} intervals)`,
        value: formatJitterDisplay(
          actualJitterPercent,
          stats.actualPeriod.jitterMs
        ),
      },
    ]
  );
  const goalPeriodField = createStatsLeafField(
    model,
    workload.name,
    ["goal-period"],
    "Goal Period (ms)",
    `${stats.goalPeriodMs.toFixed(3)} ms`
  );
  const budgetField = createStatsLeafField(
    model,
    workload.name,
    ["budget-usage"],
    "Budget Usage %",
    `${stats.budgetUsagePercent.toFixed(1)}%`
  );

  return [workloadDurationField, actualPeriodField, goalPeriodField, budgetField];
}

function createStatsGroupField(
  model: ITelemetryModel,
  workloadName: string,
  label: string,
  segments: string[],
  rows: { name: string; value: string }[]
): ITelemetryField {
  const path = buildStatsPath(workloadName, ...segments);
  return {
    name: label,
    type: "stats",
    path,
    offset: 0,
    elementCount: 1,
    model,
    getValue: () => undefined,
    fields: rows.map((row) =>
      createStatsLeafField(
        model,
        workloadName,
        [...segments, row.name],
        row.name,
        row.value
      )
    ),
  };
}

function createStatsLeafField(
  model: ITelemetryModel,
  workloadName: string,
  segments: string[],
  label: string,
  value: string
): ITelemetryField {
  return {
    name: label,
    type: "stat",
    path: buildStatsPath(workloadName, ...segments),
    offset: 0,
    elementCount: 1,
    model,
    getValue: () => value,
  };
}

function buildStatsPath(
  workloadName: string,
  ...segments: string[]
): string {
  const sanitize = (value: string) =>
    value
      .toLowerCase()
      .replace(/\s+/g, "-")
      .replace(/[^a-z0-9-]/g, "");
  return ["stats", sanitize(workloadName), ...segments.map(sanitize)].join(".");
}

function formatJitterDisplay(
  percent: string | undefined,
  jitterMs?: number
): string {
  const base = `${formatDurationMs(jitterMs)} ms`;
  return percent ? `${percent} (${base})` : base;
}

function createSectionNode(
  model: ITelemetryModel,
  workload: ITelemetryWorkload,
  kind: SectionKind
): ITelemetryField | null {
  const struct = getStruct(model, workload, kind);
  if (!struct || !struct.fields || struct.fields.length === 0) {
    return null;
  }
  return {
    name: capitalize(kind),
    type: kind,
    path: `${workload.name}.${kind}`,
    offset: struct.offset,
    elementCount: 1,
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
    elementCount: 1,
    model,
    getValue: () => undefined,
    fields: sections,
  };
}

function capitalize(value: string) {
  if (!value) return value;
  return value.charAt(0).toUpperCase() + value.slice(1);
}
