import React, {
  useEffect,
  useMemo,
  useRef,
  useState,
  useCallback,
} from "react";
import {
  Project,
  ProjectData,
  useLauncherService,
  type WorkloadsRegistryResponse,
} from "../../../../data-sources/launcher";
import { useTelemetryStream } from "../../../../data-sources/telemetry";
import {
  ITelemetryField,
  ITelemetryStruct,
  ITelemetryWorkload,
} from "../../../../data-sources/telemetry";
import { useOptionalFloatingPanel } from "../../../workspaces/floating-panels";
import { getOrCreateBlobURL } from "../view/telemetry-image-blobs";
import {
  extractTelemetryImagePayload,
  getTelemetryImagePayloadSignature,
  isTelemetryImageField,
  tryDecodeTelemetryImageBytes,
} from "../utils/telemetry-image";
import { migrateSelectionToStableIds } from "../utils/persisted-selection-migration";
import styles from "./TelemetryImageViewer.module.css";
import { usePanelInstance } from "../../../workspaces/PanelInstanceContext";
import {
  buildNamespacedKey,
  createPanelInstanceId,
  getFirstAvailableValue,
  removeStorageValue,
  setStorageValue,
} from "../../../../services/storage";

type PanelSettings = {
  telemetryBaseUrl?: string;
  modelId?: string;
  modelPath?: string;
  modelName?: string;
  workloadId?: string;
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

type DeclaredWorkload = {
  id: string;
  name: string;
};

type RegistryTypeDef = {
  name: string;
  fields?: Array<{ type?: string }>;
  mime_type?: string;
  format?: string;
};

const STORAGE_KEYS = {
  modelId: "robotick-studio.telemetry.image.modelId",
  model: "robotick-studio.telemetry.image.model",
  workloadId: "robotick-studio.telemetry.image.workloadId",
  workload: "robotick-studio.telemetry.image.workload",
  field: "robotick-studio.telemetry.image.field",
};

/**
 * Render a panel that lets users pick a telemetry model, workload, and image field, and previews the latest image telemetry.
 *
 * The component persists panel-specific selections, reads telemetry models and streams image fields, and displays a live preview when image data is available.
 *
 * @returns The rendered React element for the telemetry image viewer.
 */
export default function TelemetryImageViewer() {
  const launcherService = useLauncherService();
  const { projectPath } = Project.Context.use();
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
      modelId: readPreference(STORAGE_KEYS.modelId) ?? undefined,
      modelPath: readPreference(STORAGE_KEYS.model) ?? undefined,
      workloadId: readPreference(STORAGE_KEYS.workloadId) ?? undefined,
      workloadName: readPreference(STORAGE_KEYS.workload) ?? undefined,
      fieldPath: readPreference(STORAGE_KEYS.field) ?? undefined,
    }),
    [readPreference]
  );

  const [localSettings, setLocalSettings] =
    useState<PanelSettings>(storedLocalSettings);

  const persistLocalSettings = useCallback(
    (next: Partial<PanelSettings>) => {
      if ("modelId" in next) {
        persistPreference(STORAGE_KEYS.modelId, next.modelId);
      }
      if ("modelPath" in next) {
        persistPreference(STORAGE_KEYS.model, next.modelPath);
      }
      if ("workloadId" in next) {
        persistPreference(STORAGE_KEYS.workloadId, next.workloadId);
      }
      if ("workloadName" in next) {
        persistPreference(STORAGE_KEYS.workload, next.workloadName);
      }
      if ("fieldPath" in next) {
        persistPreference(STORAGE_KEYS.field, next.fieldPath);
      }
    },
    [persistPreference]
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

  const settings =
    (panel?.settings as PanelSettings | undefined) ?? localSettings;

  const { projectModels } = ProjectData.use();
  const migratedSettings = useMemo(
    () => migrateSelectionToStableIds(settings, projectModels.data),
    [projectModels.data, settings]
  );
  useEffect(() => {
    if (JSON.stringify(migratedSettings) === JSON.stringify(settings)) return;
    updateSettings(migratedSettings);
  }, [migratedSettings, settings, updateSettings]);

  const [imageCapableWorkloadTypes, setImageCapableWorkloadTypes] = useState<
    Set<string> | null
  >(null);

  useEffect(() => {
    let cancelled = false;

    if (!projectPath) {
      setImageCapableWorkloadTypes(null);
      return;
    }

    void launcherService
      .fetchProjectWorkloadsRegistry(projectPath, "linux")
      .then((response) => {
        if (cancelled) return;
        setImageCapableWorkloadTypes(
          collectImageCapableWorkloadTypes(response)
        );
      })
      .catch(() => {
        if (cancelled) return;
        setImageCapableWorkloadTypes(null);
      });

    return () => {
      cancelled = true;
    };
  }, [launcherService, projectPath]);

  const modelOptions = useMemo(() => {
    if (!imageCapableWorkloadTypes || imageCapableWorkloadTypes.size === 0) {
      return projectModels.data;
    }

    return projectModels.data.filter((model) => {
      const modelData =
        model.data && typeof model.data === "object"
          ? (model.data as Record<string, unknown>)
          : null;
      const workloads = Array.isArray(modelData?.workloads)
        ? modelData.workloads
        : [];
      return workloads.some((entry) => {
        if (!entry || typeof entry !== "object") return false;
        const workloadType = String(
          (entry as Record<string, unknown>).type ?? ""
        ).trim();
        return workloadType
          ? imageCapableWorkloadTypes.has(workloadType)
          : false;
      });
    });
  }, [imageCapableWorkloadTypes, projectModels.data]);
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
  const samplingRateHz = selectedModel?.preferredTelemetrySampleRateHz ?? 20;

  const { model } = useTelemetryStream(telemetryBaseUrl, samplingRateHz);

  const schemaSessionId = model?.schemaSessionId ?? "";
  const previousSchemaSessionIdRef = useRef<string>("");
  const workloads = model?.workloads ?? [];
  const hasTelemetrySchema = !!model && !!schemaSessionId && workloads.length > 0;

  const declaredWorkloads = useMemo<DeclaredWorkload[]>(() => {
    const raw = selectedModel?.data;
    if (!raw || typeof raw !== "object") return [];
    const modelData = raw as Record<string, unknown>;
    const workloadEntries = Array.isArray(modelData.workloads)
      ? modelData.workloads
      : [];
    const parsed: DeclaredWorkload[] = [];
    for (const entry of workloadEntries) {
      if (!entry || typeof entry !== "object") continue;
      const workload = entry as Record<string, unknown>;
      const name = String(workload.name ?? "").trim();
      if (!name) continue;
      const id = String(workload.id ?? "").trim();
      parsed.push({ id, name });
    }
    return parsed;
  }, [selectedModel?.data]);

  const declaredWorkloadNames = useMemo(
    () => new Set(declaredWorkloads.map((workload) => workload.name)),
    [declaredWorkloads]
  );

  const telemetryWorkloadsForSelectedModel = useMemo(() => {
    if (declaredWorkloadNames.size === 0) return workloads;
    return workloads.filter((workload) => declaredWorkloadNames.has(workload.name));
  }, [declaredWorkloadNames, workloads]);

  const workloadName =
    migratedSettings.workloadName && migratedSettings.workloadName.length > 0
      ? migratedSettings.workloadName
      : "";

  const fieldPath = migratedSettings.fieldPath ?? "";

  const workloadsWithImages = useMemo(() => {
    const set = new Set<string>();

    if (!model) return set;

    for (const workload of telemetryWorkloadsForSelectedModel) {
      for (const section of SECTION_KEYS) {
        const struct = getStruct(workload, section);
        if (struct && hasImageField(struct.fields)) {
          set.add(workload.name);
          break;
        }
      }
    }

    return set;
  }, [model, telemetryWorkloadsForSelectedModel]);

  const declaredWorkloadsWithImages = useMemo<DeclaredWorkload[]>(() => {
    if (declaredWorkloads.length === 0) return [];
    return declaredWorkloads.filter((workload) =>
      workloadsWithImages.has(workload.name)
    );
  }, [declaredWorkloads, workloadsWithImages]);

  const availableWorkloads = useMemo<DeclaredWorkload[]>(() => {
    if (declaredWorkloads.length > 0) return declaredWorkloadsWithImages;
    return telemetryWorkloadsForSelectedModel
      .filter((workload) => workloadsWithImages.has(workload.name))
      .map((workload) => ({
      id: "",
      name: workload.name,
    }));
  }, [
    declaredWorkloads,
    declaredWorkloadsWithImages,
    telemetryWorkloadsForSelectedModel,
    workloadsWithImages,
  ]);

  const workloadsToScan = workloadName
    ? telemetryWorkloadsForSelectedModel.filter((w) => w.name === workloadName)
    : telemetryWorkloadsForSelectedModel;

  const imageFieldOptions = useMemo(() => {
    if (!hasTelemetrySchema || workloadsToScan.length === 0) return [];

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
  }, [hasTelemetrySchema, workloadsToScan]);

  useEffect(() => {
    if (!hasTelemetrySchema) return;

    if (!previousSchemaSessionIdRef.current) {
      previousSchemaSessionIdRef.current = schemaSessionId;
      return;
    }

    if (previousSchemaSessionIdRef.current === schemaSessionId) return;

    previousSchemaSessionIdRef.current = schemaSessionId;

    // Do not clear saved combo selections here. A schema refresh/reconnect should
    // not be treated as user intent to forget the selected workload/field.
    // The validation effects below will only replace them once a real schema
    // proves they are unavailable.
  }, [hasTelemetrySchema, schemaSessionId]);

  useEffect(() => {
    if (!hasTelemetrySchema) return;
    if (availableWorkloads.length === 0) return;

    if (!availableWorkloads.some((w) => w.name === workloadName)) {
      updateSettings({
        workloadId: "",
        workloadName: availableWorkloads[0].name,
      });
    }
  }, [hasTelemetrySchema, availableWorkloads, workloadName, updateSettings]);

  useEffect(() => {
    if (!hasTelemetrySchema) return;
    if (imageFieldOptions.length === 0) {
      if (fieldPath) {
        updateSettings({ fieldPath: "" });
      }
      return;
    }

    if (
      !fieldPath ||
      !imageFieldOptions.some((option) => option.path === fieldPath)
    ) {
      updateSettings({ fieldPath: imageFieldOptions[0].path });
    }
  }, [hasTelemetrySchema, fieldPath, imageFieldOptions, updateSettings]);

  const field = useMemo(() => {
    if (!model || !fieldPath || typeof model.getField !== "function") {
      return null;
    }

    return model.getField(fieldPath) ?? null;
  }, [model, fieldPath]);

  const imagePayload = extractTelemetryImagePayload(field);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const latestValidPayloadKeyRef = useRef<string | null>(null);

  useEffect(() => {
    let isCancelled = false;

    if (!imagePayload) {
      latestValidPayloadKeyRef.current = null;
      setPreviewUrl(null);
      return;
    }

    const payloadKey = getTelemetryImagePayloadSignature(imagePayload);

    if (payloadKey === latestValidPayloadKeyRef.current) {
      return;
    }

    void (async () => {
      const valid = await tryDecodeTelemetryImageBytes(
        imagePayload.bytes,
        imagePayload.mime
      );

      if (isCancelled) {
        return;
      }

      if (!valid) {
        return;
      }

      latestValidPayloadKeyRef.current = payloadKey;
      setPreviewUrl(getOrCreateBlobURL(imagePayload.bytes, imagePayload.mime));
    })();

    return () => {
      isCancelled = true;
    };
  }, [imagePayload]);

  const blobUrl = previewUrl;

  const handleModelChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const modelPath = event.target.value;
    const descriptor = modelOptions.find(
      (model) => model.modelPath === modelPath
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
      workloadId: undefined,
      workloadName: undefined,
      fieldPath: undefined,
    });
  };

  const handleWorkloadChange = (
    event: React.ChangeEvent<HTMLSelectElement>
  ) => {
    const selectedWorkloadName = event.target.value;
    const workloadId =
      Array.isArray(
        (selectedModel?.data as { workloads?: Array<Record<string, unknown>> })
          ?.workloads
      )
        ? (
            (selectedModel?.data as {
              workloads?: Array<Record<string, unknown>>;
            }).workloads ?? []
          ).find((workload) => String(workload?.name ?? "") === selectedWorkloadName)?.id
        : "";
    updateSettings({
      workloadId: typeof workloadId === "string" ? workloadId : "",
      workloadName: selectedWorkloadName,
    });
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
            disabled={!hasTelemetrySchema || availableWorkloads.length === 0}
          >
            {availableWorkloads.map((workload) => (
              <option
                value={workload.name}
                key={workload.id || workload.name}
              >
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
            disabled={!hasTelemetrySchema || imageFieldOptions.length === 0}
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
            {!hasTelemetrySchema
              ? "Waiting for telemetry schema…"
              : workloads.length === 0
                ? "Waiting for telemetry…"
                : availableWorkloads.length === 0
                  ? "No image telemetry workloads for this model."
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
    if (seen.has(field.path)) continue;

    if (isTelemetryImageField(field)) {
      seen.add(field.path);
      out.push({
        path: field.path,
        label: formatFieldLabel(field.path),
      });
      continue;
    }

    if (field.fields && field.fields.length > 0) {
      collectImageFields(field.fields, out, seen);
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
    if (isTelemetryImageField(field)) {
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

function collectImageCapableWorkloadTypes(
  response: WorkloadsRegistryResponse
): Set<string> {
  const typeMap = new Map<string, RegistryTypeDef>();
  for (const type of response.types ?? []) {
    const name = String(type?.name ?? "").trim();
    if (!name) continue;
    typeMap.set(name, {
      name,
      fields: Array.isArray(type.fields)
        ? type.fields.map((field) => ({ type: field?.type }))
        : undefined,
      mime_type: type.mime_type,
      format: type.format,
    });
  }

  const imageTypeMemo = new Map<string, boolean>();
  const visiting = new Set<string>();

  const typeContainsImage = (typeName: string): boolean => {
    const normalized = typeName.trim();
    if (!normalized) return false;
    if (imageTypeMemo.has(normalized)) {
      return imageTypeMemo.get(normalized) ?? false;
    }
    if (visiting.has(normalized)) return false;
    visiting.add(normalized);

    const def = typeMap.get(normalized);
    if (!def) {
      visiting.delete(normalized);
      imageTypeMemo.set(normalized, false);
      return false;
    }

    const mime = String(def.mime_type ?? "").toLowerCase();
    const format = String(def.format ?? "").toLowerCase();
    const isImagePrimitive =
      mime.startsWith("image/") ||
      format === "png" ||
      format === "jpeg" ||
      format === "jpg";

    if (isImagePrimitive) {
      visiting.delete(normalized);
      imageTypeMemo.set(normalized, true);
      return true;
    }

    const hasImageField =
      def.fields?.some((field) =>
        field?.type ? typeContainsImage(String(field.type)) : false
      ) ?? false;

    visiting.delete(normalized);
    imageTypeMemo.set(normalized, hasImageField);
    return hasImageField;
  };

  const imageCapableWorkloads = new Set<string>();
  for (const workload of response.workloads ?? []) {
    const workloadType = String(workload?.type ?? "").trim();
    if (!workloadType) continue;
    const roots = [workload.config?.type, workload.inputs?.type, workload.outputs?.type];
    if (roots.some((root) => (root ? typeContainsImage(root) : false))) {
      imageCapableWorkloads.add(workloadType);
    }
  }
  return imageCapableWorkloads;
}
