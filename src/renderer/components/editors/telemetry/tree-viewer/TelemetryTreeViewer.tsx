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
import { useFloatingPanelsScope } from "../../../workspaces/floating-panels";
import {
  ITelemetryField,
  ITelemetryModel,
  ITelemetryStruct,
  ITelemetryWorkload,
} from "../../../../data-sources/telemetry";
import styles from "./TelemetryTreeViewer.module.css";
import panelMenuStyles from "../../../workspaces/PanelLayout.module.css";
import { usePanelInstance } from "../../../workspaces/PanelInstanceContext";
import {
  buildNamespacedKey,
  createPanelInstanceId,
  getFirstAvailableValue,
  removeStorageValue,
  setStorageValue,
} from "../../../../services/storage";
import { migrateSelectionToStableIds } from "../utils/persisted-selection-migration";
import {
  deriveWorkloadStats,
  formatDurationMs,
  formatJitterPercent,
  TICK_DURATION_WINDOW_SIZE,
} from "../utils/workload-stats";
import type { FieldConnectionHint } from "../view/types";
import {
  buildFieldConnectionHintsByModelPath,
} from "../view/field-connections";
import {
  TelemetryFieldTree,
  TelemetryFieldTreeRuntimeProvider,
  type TelemetryFieldTreeContext,
} from "../view/TelemetryFieldTree";

type SectionKind = "inputs" | "outputs" | "config" | "stats";
type DataKindSelection = SectionKind | "all";

type PanelSettings = {
  telemetryBaseUrl?: string;
  modelId?: string;
  modelPath?: string;
  modelName?: string;
  workloadId?: string;
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
const TREE_ARRAY_PAGE_SIZE = 64;
type TelemetryTreeFilterTarget = {
  workloadName: string;
  sectionKind?: SectionKind;
  fieldFilter: string;
};

const TREE_STORAGE_KEYS = {
  modelId: "robotick-studio.telemetry.tree.modelId",
  model: "robotick-studio.telemetry.tree.model",
  workloadId: "robotick-studio.telemetry.tree.workloadId",
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

/**
 * Render a telemetry tree viewer UI that lets the user select a model, workload, section, and field filter and browse hierarchical telemetry fields.
 *
 * Persists per-panel and per-workspace viewer preferences and uses the selected telemetry model to populate the displayed tree.
 *
 * @returns The React element tree for the telemetry tree viewer.
 */
export default function TelemetryTreeViewer() {
  const panel = useOptionalFloatingPanel();
  const floatingPanelScope = useFloatingPanelsScope();
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
      modelId: readPreference(TREE_STORAGE_KEYS.modelId) ?? undefined,
      modelPath: readPreference(TREE_STORAGE_KEYS.model) ?? undefined,
      workloadId: readPreference(TREE_STORAGE_KEYS.workloadId) ?? undefined,
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
  const [treeContextMenu, setTreeContextMenu] = useState<{
    x: number;
    y: number;
    target: TelemetryTreeFilterTarget;
  } | null>(null);
  const [arrayVisibleCounts, setArrayVisibleCounts] = useState<
    Record<string, number>
  >({});
  const getVisibleCountForPath = useCallback(
    (path: string, total: number) => {
      if (total <= 0) return 0;
      const configured = arrayVisibleCounts[path] ?? TREE_ARRAY_PAGE_SIZE;
      return Math.max(1, Math.min(total, configured));
    },
    [arrayVisibleCounts]
  );
  const showNextArrayPage = useCallback((path: string, total: number) => {
    setArrayVisibleCounts((prev) => {
      const current = prev[path] ?? TREE_ARRAY_PAGE_SIZE;
      const next = Math.min(total, current + TREE_ARRAY_PAGE_SIZE);
      if (next === current) return prev;
      return { ...prev, [path]: next };
    });
  }, []);
  const storedExpandedPathsPreference = useMemo(
    () =>
      parseExpandedPathsPreference(
        readPreference(TREE_STORAGE_KEYS.expandedPaths) ?? undefined
      ),
    [readPreference]
  );
  const persistLocalSettings = useCallback(
    (next: Partial<PanelSettings>) => {
      if ("modelId" in next) {
        persistPreference(TREE_STORAGE_KEYS.modelId, next.modelId);
      }
      if ("modelPath" in next) {
        persistPreference(TREE_STORAGE_KEYS.model, next.modelPath);
      }
      if ("workloadId" in next) {
        persistPreference(TREE_STORAGE_KEYS.workloadId, next.workloadId);
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
  const migratedSettings = useMemo(
    () => migrateSelectionToStableIds(settings, projectModels.data),
    [projectModels.data, settings]
  );
  useEffect(() => {
    if (JSON.stringify(migratedSettings) === JSON.stringify(settings)) return;
    updateSettings(migratedSettings);
  }, [migratedSettings, settings, updateSettings]);
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
        if (migratedSettings.modelId) {
          const modelData =
            model.data && typeof model.data === "object"
              ? (model.data as Record<string, unknown>)
              : null;
          if (String(modelData?.id ?? "") === migratedSettings.modelId) {
            return true;
          }
        }
        if (
          migratedSettings.modelPath &&
          migratedSettings.modelPath === model.modelPath
        ) {
          return true;
        }
        if (
          migratedSettings.telemetryBaseUrl &&
          migratedSettings.telemetryBaseUrl === model.telemetryBaseUrl
        ) {
          return true;
        }
        if (
          migratedSettings.modelName &&
          migratedSettings.modelName.toLowerCase() ===
            model.modelName.toLowerCase()
        ) {
          return true;
        }
        return false;
      }) ?? modelOptions[0]
    : null;

  const telemetryBaseUrl =
    migratedSettings.telemetryBaseUrl ?? selectedModel?.telemetryBaseUrl ?? "";
  const requestedSamplingRateHz =
    selectedModel?.telemetryPushRateHz ?? 10;
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
  const declaredWorkloadsById = useMemo(() => {
    const map = new Map<string, string>();
    const modelData =
      selectedModel?.data && typeof selectedModel.data === "object"
        ? (selectedModel.data as Record<string, unknown>)
        : null;
    const entries = Array.isArray(modelData?.workloads) ? modelData.workloads : [];
    for (const entry of entries) {
      if (!entry || typeof entry !== "object") continue;
      const workload = entry as Record<string, unknown>;
      const id = String(workload.id ?? "").trim();
      const name = String(workload.name ?? "").trim();
      if (!id) continue;
      map.set(id, name || id);
    }
    return map;
  }, [selectedModel?.data]);
  const workloadOptions = useMemo(() => {
    return workloads.map((workload) => ({
      id: workload.name,
      name: declaredWorkloadsById.get(workload.name) ?? workload.name,
      runtimeName: workload.name,
    }));
  }, [declaredWorkloadsById, workloads]);
  const selectedWorkload = useMemo(() => {
    const selectedId = (migratedSettings.workloadId ?? "").trim();
    const selectedName = (migratedSettings.workloadName ?? "").trim();
    if (selectedId) {
      const byId = workloadOptions.find((workload) => workload.id === selectedId);
      if (byId) return byId;
    }
    if (selectedName) {
      const byName = workloadOptions.find((workload) => workload.name === selectedName);
      if (byName) return byName;
    }
    return null;
  }, [migratedSettings.workloadId, migratedSettings.workloadName, workloadOptions]);
  const sectionSelection: DataKindSelection = settings.dataKind ?? "outputs";
  const activeSectionKinds: SectionKind[] =
    sectionSelection === "all" ? SECTION_KINDS : [sectionSelection];
  const fieldFilterRaw = settings.fieldPath ?? "";
  const [debouncedFieldFilterRaw, setDebouncedFieldFilterRaw] =
    useState(fieldFilterRaw);
  const fieldFilter = debouncedFieldFilterRaw.trim().toLowerCase();

  const targetWorkload = selectedWorkload
    ? workloads.find((workload) => workload.name === selectedWorkload.runtimeName)
    : undefined;
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(
    () => new Set<string>(storedExpandedPathsPreference?.paths ?? [])
  );

  useEffect(() => {
    if (!migratedSettings.modelPath && selectedModel) {
      updateSettings({
        modelId: migratedSettings.modelId,
        modelPath: selectedModel.modelPath,
        modelName: selectedModel.modelName,
        telemetryBaseUrl: selectedModel.telemetryBaseUrl,
      });
    }
  }, [migratedSettings.modelId, migratedSettings.modelPath, selectedModel, updateSettings]);

  useEffect(() => {
    persistPreference(
      TREE_STORAGE_KEYS.expandedPaths,
      serializeExpandedPathsPreference({
        paths: Array.from(expandedNodes),
      })
    );
  }, [expandedNodes, persistPreference]);

  useEffect(() => {
    if (
      selectedWorkload &&
      workloads.length > 0 &&
      !workloads.some((workload) => workload.name === selectedWorkload.runtimeName)
    ) {
      updateSettings({ workloadId: "", workloadName: "" });
    }
  }, [selectedWorkload, updateSettings, workloads]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedFieldFilterRaw(fieldFilterRaw);
    }, FILTER_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [fieldFilterRaw]);

  const rootNodes = useMemo<ITelemetryField[]>(() => {
    if (!model) return [];
    const workloadsToInspect =
      selectedWorkload && targetWorkload ? [targetWorkload] : workloads;
    if (workloadsToInspect.length === 0) return [];

    if (fieldFilter) {
      return workloadsToInspect
        .map((workload) =>
          createFilteredWorkloadNode(
            model,
            workload,
            activeSectionKinds,
            fieldFilter,
            declaredWorkloadsById.get(workload.name) ?? workload.name
          )
        )
        .filter((node): node is ITelemetryField => Boolean(node));
    }

    return workloadsToInspect
      .map((workload) =>
        createWorkloadNode(
          model,
          workload,
          activeSectionKinds,
          declaredWorkloadsById.get(workload.name) ?? workload.name
        )
      )
      .filter((node): node is ITelemetryField => Boolean(node));
  }, [
    model,
    workloads,
    selectedWorkload,
    targetWorkload,
    fieldFilter,
    sectionSelection,
    declaredWorkloadsById,
  ]);
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

  const handleFieldTextContextMenu = useCallback(
    (
      field: ITelemetryField,
      context: TelemetryFieldTreeContext,
      event: React.MouseEvent<HTMLElement>
    ) => {
      const target = getTelemetryTreeRowFilterTarget(field, context);
      if (!target) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      setTreeContextMenu({
        x: event.clientX,
        y: event.clientY,
        target,
      });
    },
    []
  );

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
      modelId:
        typeof descriptor?.data === "object" &&
        descriptor?.data &&
        "id" in (descriptor.data as Record<string, unknown>)
          ? String((descriptor.data as Record<string, unknown>).id ?? "")
          : "",
      modelPath,
      modelName: descriptor?.modelName,
      telemetryBaseUrl: descriptor?.telemetryBaseUrl,
      workloadId: "",
      workloadName: "",
      fieldPath: "",
    });
  };

  const handleWorkloadChange = (
    event: React.ChangeEvent<HTMLSelectElement>
  ) => {
    const selectedWorkloadId = event.target.value;
    const selected = workloadOptions.find(
      (workload) => workload.id === selectedWorkloadId
    );
    updateSettings({
      workloadId: selected?.id ?? selectedWorkloadId,
      workloadName: selected?.name ?? selectedWorkloadId,
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

  const handleFilterToItem = useCallback(
    (target: TelemetryTreeFilterTarget) => {
      const selected =
        workloadOptions.find((workload) => workload.id === target.workloadName) ??
        workloadOptions.find((workload) => workload.name === target.workloadName);
      updateSettings({
        workloadId: selected?.id ?? "",
        workloadName: selected?.name ?? target.workloadName,
        dataKind: target.sectionKind ?? "all",
        fieldPath: target.fieldFilter,
      });
      setTreeContextMenu(null);
    },
    [updateSettings, workloadOptions]
  );

  useEffect(() => {
    if (!treeContextMenu) {
      return;
    }
    const handleClick = () => setTreeContextMenu(null);
    const handleContextMenu = () => setTreeContextMenu(null);
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setTreeContextMenu(null);
      }
    };
    window.addEventListener("click", handleClick);
    window.addEventListener("contextmenu", handleContextMenu, true);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("click", handleClick);
      window.removeEventListener("contextmenu", handleContextMenu, true);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [treeContextMenu]);

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
            value={selectedWorkload?.id ?? ""}
            onChange={handleWorkloadChange}
          >
            <option value="">All Workloads</option>
            {workloadOptions.map((workload) => (
              <option value={workload.id} key={workload.id}>
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
      <TelemetryFieldTreeRuntimeProvider
        sampleRevision={displayRevision}
        readValue={valueReader}
      >
          <div className={styles.tree} ref={treeViewportRef}>
            {rootNodes.length === 0 ? (
              <div className={styles.message}>No telemetry fields available.</div>
            ) : (
              <TelemetryFieldTree
                fields={rootNodes}
                telemetryBaseUrl={telemetryBaseUrl}
                panelScope={panel?.scope ?? floatingPanelScope}
                modelName={selectedModel?.modelName}
                fieldConnectionHints={fieldConnectionHints}
                expandedPaths={expandedNodes}
                onTogglePath={toggleNode}
                getArrayVisibleCount={getVisibleCountForPath}
                onShowNextArrayPage={showNextArrayPage}
                arrayPageSize={TREE_ARRAY_PAGE_SIZE}
                onFieldTextContextMenu={handleFieldTextContextMenu}
              />
            )}
          </div>
          {treeContextMenu ? (
            <div
              className={panelMenuStyles.contextMenu}
              style={{ left: treeContextMenu.x, top: treeContextMenu.y }}
              role="menu"
              onClick={(event) => event.stopPropagation()}
            >
              <button
                type="button"
                className={panelMenuStyles.contextMenuItem}
                onClick={() => handleFilterToItem(treeContextMenu.target)}
              >
                Filter To Item
              </button>
            </div>
          ) : null}
      </TelemetryFieldTreeRuntimeProvider>
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

function getTelemetryTreeRowFilterTarget(
  field: ITelemetryField,
  inherited: TelemetryFieldTreeContext
): TelemetryTreeFilterTarget | undefined {
  if (field.type === "workload") {
    return {
      workloadName: field.name,
      fieldFilter: "",
    };
  }

  const sectionKind = isSectionKind(field.type)
    ? (field.type as SectionKind)
    : (inherited.sectionKind as SectionKind | undefined);
  const workloadName = inherited.workloadName ?? "";
  if (!workloadName) {
    return undefined;
  }

  const isSectionNode = sectionKind !== inherited.sectionKind;
  return {
    workloadName,
    sectionKind,
    fieldFilter: sectionKind && !isSectionNode ? field.name : "",
  };
}

function isSectionKind(value: string): value is SectionKind {
  return SECTION_KINDS.includes(value as SectionKind);
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

function createFilteredSectionNode(
  model: ITelemetryModel,
  workload: ITelemetryWorkload,
  kind: SectionKind,
  filter: string
): ITelemetryField | null {
  const section = createSectionNode(model, workload, kind);
  if (!section?.fields) {
    return null;
  }
  const filteredFields = filterFieldsByName(section.fields, filter);
  if (filteredFields.length === 0) {
    return null;
  }
  return {
    ...section,
    fields: filteredFields,
  };
}

function createWorkloadNode(
  model: ITelemetryModel,
  workload: ITelemetryWorkload,
  kinds: SectionKind[],
  displayName: string
): ITelemetryField | null {
  const sections = kinds
    .map((kind) => createSectionNode(model, workload, kind))
    .filter((node): node is ITelemetryField => Boolean(node));
  if (!sections.length) return null;

  return {
    name: displayName,
    type: "workload",
    path: `workload:${workload.name}`,
    offset: sections[0].offset ?? 0,
    elementCount: 1,
    model,
    getValue: () => undefined,
    fields: sections,
  };
}

function createFilteredWorkloadNode(
  model: ITelemetryModel,
  workload: ITelemetryWorkload,
  kinds: SectionKind[],
  filter: string,
  displayName: string
): ITelemetryField | null {
  const sections = kinds
    .map((kind) => createFilteredSectionNode(model, workload, kind, filter))
    .filter((node): node is ITelemetryField => Boolean(node));
  if (!sections.length) return null;

  return {
    name: displayName,
    type: "workload",
    path: `workload:${workload.name}`,
    offset: sections[0].offset ?? 0,
    elementCount: 1,
    model,
    getValue: () => undefined,
    fields: sections,
  };
}

function filterFieldsByName(
  fields: ITelemetryField[],
  filter: string
): ITelemetryField[] {
  return fields
    .map((field) => {
      const name = field.name ?? "";
      if (name.toLowerCase().includes(filter)) {
        return field;
      }
      const filteredChildren = field.fields
        ? filterFieldsByName(field.fields, filter)
        : [];
      if (filteredChildren.length === 0) {
        return null;
      }
      return {
        ...field,
        fields: filteredChildren,
      };
    })
    .filter((field): field is ITelemetryField => Boolean(field));
}

function capitalize(value: string) {
  if (!value) return value;
  return value.charAt(0).toUpperCase() + value.slice(1);
}
