import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  useRemoteControlClient,
  type RemoteControlState,
  type RemoteControlStateKeysMeta,
} from "./UseRemoteControlClient";
import {
  applyStickModeTransform,
  normalizeRemoteControlsConfig,
  type NormalizedRemoteControlsConfig,
  type RemoteControlButtonKey,
  type RemoteControlStickConfig,
  type RemoteControlStickMode,
  type RemoteControlStickName,
  type RemoteControlTargetBinding,
} from "./remote-control-config";
import styles from "../styles/RemoteControlsPanel.module.css";
import { Project, ProjectData } from "../../../../../data-sources/launcher";
import {
  type ITelemetryModel,
  type LayoutWritableInput,
  useTelemetryService,
} from "../../../../../data-sources/telemetry";
import {
  buildNamespacedKey,
  readStorageValue,
  setStorageValue,
} from "../../../../../services/storage";
import { usePanelInstance } from "../../../../workspaces/PanelInstanceContext";

type DesiredFieldState = {
  binding: ResolvedTargetBinding;
  value: boolean | number;
  shouldSuppress: boolean;
  reassertSuppressionOnWrite: boolean;
};

type ResolvedTargetBinding = RemoteControlTargetBinding & {
  telemetryBaseUrl: string | null;
};

type PendingWrite = {
  value: boolean | number;
  requiresSuppression: boolean;
};

type PendingBaseUrlWork = {
  disableUpdates: Map<string, false>;
  writes: Map<string, PendingWrite>;
  enableUpdates: Map<string, true>;
};

type SelectedModesState = Partial<Record<RemoteControlStickName, string>>;
type PersistedSelectedModesState = {
  storageKey: string;
  selectedModes: SelectedModesState;
};

export type RemoteControlsPanelConfig = Record<string, unknown>;

const REMOTE_CONTROLS_TELEMETRY_POLL_HZ = 2;

const DEFAULT_REMOTE_CONTROL_STATE: RemoteControlState = {
  left: { x: 0, y: 0 },
  right: { x: 0, y: 0 },
  left_trigger: 0,
  right_trigger: 0,
  a: false,
  b: false,
  x: false,
  y: false,
  left_bumper: false,
  right_bumper: false,
  back: false,
  start: false,
  guide: false,
  left_stick_button: false,
  right_stick_button: false,
  dpad_up: false,
  dpad_down: false,
  dpad_left: false,
  dpad_right: false,
};

function desiredStateEquals(
  left?: DesiredFieldState,
  right?: DesiredFieldState
): boolean {
  if (!left && !right) {
    return true;
  }
  if (!left || !right) {
    return false;
  }
  return (
    left.binding.qualifiedPath === right.binding.qualifiedPath &&
    left.binding.telemetryBaseUrl === right.binding.telemetryBaseUrl &&
    left.value === right.value &&
    left.shouldSuppress === right.shouldSuppress &&
    left.reassertSuppressionOnWrite === right.reassertSuppressionOnWrite
  );
}

function buildSelectedModesDefaults(
  config: NormalizedRemoteControlsConfig
): SelectedModesState {
  const selectedModes: SelectedModesState = {};
  for (const stickName of ["left", "right"] as const) {
    const stickConfig = config.sticks[stickName];
    if (stickConfig) {
      selectedModes[stickName] = stickConfig.selectedMode;
    }
  }
  return selectedModes;
}

function hashString(value: string): string {
  let hash = 5381;
  for (let i = 0; i < value.length; i += 1) {
    hash = ((hash << 5) + hash) ^ value.charCodeAt(i);
  }
  return (hash >>> 0).toString(36);
}

function buildSelectedModesStorageSignature(
  config: NormalizedRemoteControlsConfig
): string {
  const sticks = Object.fromEntries(
    (["left", "right"] as const).map((stickName) => {
      const stickConfig = config.sticks[stickName];
      if (!stickConfig) {
        return [stickName, null];
      }
      return [
        stickName,
        Object.fromEntries(
          Object.entries(stickConfig.modes).map(([modeId, mode]) => [
            modeId,
            {
              shapeTransform: mode.shapeTransform,
              deadZone: mode.deadZone,
              outputs: mode.outputs,
            },
          ])
        ),
      ];
    })
  );
  return hashString(JSON.stringify(sticks));
}

function buildSelectedModesStorageKey(
  projectPath: string,
  config: NormalizedRemoteControlsConfig,
  workspaceId: string,
  panelId: string
): string {
  return buildNamespacedKey(
    "robotick.remote-controls.selected-modes",
    projectPath || "default-project",
    workspaceId || "workspace",
    panelId || "default",
    buildSelectedModesStorageSignature(config)
  );
}

function buildLegacySelectedModesStorageKey(
  projectPath: string,
  config: NormalizedRemoteControlsConfig
): string {
  return buildNamespacedKey(
    "robotick.remote-controls.selected-modes",
    projectPath || "default-project",
    buildSelectedModesStorageSignature(config)
  );
}

function readStoredSelectedModes(
  storageKey: string,
  config: NormalizedRemoteControlsConfig,
  legacyStorageKey?: string
): SelectedModesState {
  const defaults = buildSelectedModesDefaults(config);
  const raw = readStorageValue(storageKey) ?? (
    legacyStorageKey ? readStorageValue(legacyStorageKey) : null
  );
  if (!raw) {
    return defaults;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<Record<RemoteControlStickName, unknown>>;
    const selectedModes: SelectedModesState = { ...defaults };
    for (const stickName of ["left", "right"] as const) {
      const savedMode = parsed[stickName];
      const stickConfig = config.sticks[stickName];
      if (
        typeof savedMode === "string" &&
        stickConfig?.modes[savedMode]
      ) {
        selectedModes[stickName] = savedMode;
      }
    }
    return selectedModes;
  } catch {
    return defaults;
  }
}

function writeStoredSelectedModes(
  storageKey: string,
  selectedModes: SelectedModesState
): void {
  setStorageValue(storageKey, JSON.stringify(selectedModes));
}

function clonePendingWork(work: PendingBaseUrlWork): PendingBaseUrlWork {
  return {
    disableUpdates: new Map(work.disableUpdates),
    writes: new Map(
      Array.from(work.writes.entries()).map(([fieldPath, write]) => [
        fieldPath,
        { ...write },
      ])
    ),
    enableUpdates: new Map(work.enableUpdates),
  };
}

function createEmptyPendingWork(): PendingBaseUrlWork {
  return {
    disableUpdates: new Map(),
    writes: new Map(),
    enableUpdates: new Map(),
  };
}

function resolveRuntimeFieldPath(
  model: ITelemetryModel | null,
  configuredFieldPath: string
): string {
  if (!model?.writable_inputs_by_path || !configuredFieldPath) {
    return configuredFieldPath;
  }
  if (model.writable_inputs_by_path.has(configuredFieldPath)) {
    return configuredFieldPath;
  }
  const dotIndex = configuredFieldPath.indexOf(".");
  if (dotIndex <= 0 || dotIndex >= configuredFieldPath.length - 1) {
    return configuredFieldPath;
  }
  const suffix = configuredFieldPath.slice(dotIndex + 1);
  for (const fieldPath of model.writable_inputs_by_path.keys()) {
    if (fieldPath.endsWith(`.${suffix}`)) {
      return fieldPath;
    }
  }
  return configuredFieldPath;
}

function buildModeTooltip(
  stickName: RemoteControlStickName,
  mode: RemoteControlStickMode | undefined
): string {
  const stickLabel = stickName === "left" ? "Left stick" : "Right stick";
  if (!mode) {
    return `${stickLabel}: no mode selected`;
  }

  const lines = [
    `${stickLabel}: ${mode.label}`,
    `mode: ${mode.id}`,
    `shapeTransform: ${mode.shapeTransform}`,
    `deadZone: x=${mode.deadZone.x}, y=${mode.deadZone.y}`,
  ];

  const outputLines = Object.entries(mode.outputs).map(
    ([axis, binding]) => `outputs.${axis}: ${binding?.qualifiedPath ?? "(none)"}`
  );
  if (outputLines.length > 0) {
    lines.push(...outputLines);
  } else {
    lines.push("outputs: none");
  }

  return lines.join("\n");
}

export default function RemoteControlsPanel({
  config,
}: {
  config?: RemoteControlsPanelConfig;
}) {
  const { projectPath } = Project.Context.use();
  const { findModelByName } = ProjectData.use();
  const telemetryService = useTelemetryService();
  const panelInstance = usePanelInstance();
  const workspaceIdentifier = panelInstance.workspaceId ?? "workspace";
  const panelIdentifier = panelInstance.panelId ?? "default";
  const [leftAreaEl, setLeftAreaEl] = useState<HTMLDivElement | null>(null);
  const [leftKnobEl, setLeftKnobEl] = useState<HTMLDivElement | null>(null);
  const [rightAreaEl, setRightAreaEl] = useState<HTMLDivElement | null>(null);
  const [rightKnobEl, setRightKnobEl] = useState<HTMLDivElement | null>(null);

  const normalizedConfig = useMemo(
    () => normalizeRemoteControlsConfig(config),
    [config]
  );
  const selectedModesStorageKey = useMemo(
    () =>
      buildSelectedModesStorageKey(
        projectPath,
        normalizedConfig,
        workspaceIdentifier,
        panelIdentifier
      ),
    [normalizedConfig, panelIdentifier, projectPath, workspaceIdentifier]
  );
  const legacySelectedModesStorageKey = useMemo(
    () => buildLegacySelectedModesStorageKey(projectPath, normalizedConfig),
    [normalizedConfig, projectPath]
  );
  const [persistedSelectedModes, setPersistedSelectedModes] =
    useState<PersistedSelectedModesState>(() => ({
      storageKey: selectedModesStorageKey,
      selectedModes: readStoredSelectedModes(
        selectedModesStorageKey,
        normalizedConfig,
        legacySelectedModesStorageKey
      ),
    })
  );
  const selectedModes = persistedSelectedModes.selectedModes;

  useEffect(() => {
    setPersistedSelectedModes((current) => {
      if (current.storageKey === selectedModesStorageKey) {
        return current;
      }
      return {
        storageKey: selectedModesStorageKey,
        selectedModes: readStoredSelectedModes(
          selectedModesStorageKey,
          normalizedConfig,
          legacySelectedModesStorageKey
        ),
      };
    });
  }, [legacySelectedModesStorageKey, normalizedConfig, selectedModesStorageKey]);

  useEffect(() => {
    if (persistedSelectedModes.storageKey !== selectedModesStorageKey) {
      return;
    }
    writeStoredSelectedModes(
      selectedModesStorageKey,
      persistedSelectedModes.selectedModes
    );
  }, [persistedSelectedModes, selectedModesStorageKey]);

  const resolveBinding = useCallback(
    (binding: RemoteControlTargetBinding): ResolvedTargetBinding => {
      const descriptor = findModelByName(binding.modelName);
      return {
        ...binding,
        telemetryBaseUrl: descriptor?.telemetryBaseUrl ?? null,
      };
    },
    [findModelByName]
  );

  const resolvedStickBindings = useMemo(() => {
    const resolved: Partial<
      Record<
        RemoteControlStickName,
        {
          selectedMode: string;
          modes: Record<
            string,
            ReturnType<typeof applyResolvedBindingsToMode>
          >;
        }
      >
    > = {};

    for (const stickName of ["left", "right"] as const) {
      const stickConfig = normalizedConfig.sticks[stickName];
      if (!stickConfig) {
        continue;
      }
      const modes = Object.fromEntries(
        Object.entries(stickConfig.modes).map(([modeId, mode]) => [
          modeId,
          applyResolvedBindingsToMode(mode, resolveBinding),
        ])
      );
      resolved[stickName] = {
        selectedMode: stickConfig.selectedMode,
        modes,
      };
    }
    return resolved;
  }, [normalizedConfig.sticks, resolveBinding]);

  const resolvedButtons = useMemo(() => {
    return Object.fromEntries(
      Object.entries(normalizedConfig.buttons).map(([buttonKey, binding]) => [
        buttonKey,
        resolveBinding(binding),
      ])
    ) as Partial<Record<RemoteControlButtonKey, ResolvedTargetBinding>>;
  }, [normalizedConfig.buttons, resolveBinding]);

  const resolvedTargetBaseUrls = useMemo(() => {
    const urls = new Set<string>();
    for (const stickName of ["left", "right"] as const) {
      const stickConfig = resolvedStickBindings[stickName];
      if (!stickConfig) {
        continue;
      }
      for (const mode of Object.values(stickConfig.modes)) {
        for (const binding of Object.values(mode.outputs)) {
          if (binding?.telemetryBaseUrl) {
            urls.add(binding.telemetryBaseUrl);
          }
        }
      }
    }
    for (const binding of Object.values(resolvedButtons)) {
      if (binding?.telemetryBaseUrl) {
        urls.add(binding.telemetryBaseUrl);
      }
    }
    return Array.from(urls);
  }, [resolvedButtons, resolvedStickBindings]);

  useEffect(() => {
    if (resolvedTargetBaseUrls.length === 0) {
      return;
    }

    const unsubscribers = resolvedTargetBaseUrls.map((baseUrl) => {
      void telemetryService.ensureLayout(baseUrl);
      return telemetryService.subscribeTelemetry(
        baseUrl,
        REMOTE_CONTROLS_TELEMETRY_POLL_HZ,
        {
          callback: () => {},
          error: (error) => {
            console.warn("[remote-controls] telemetry subscription error", {
              baseUrl,
              error,
            });
          },
        }
      );
    });

    return () => {
      unsubscribers.forEach((unsubscribe) => {
        try {
          unsubscribe();
        } catch (error) {
          console.warn("[remote-controls] telemetry unsubscribe failed", error);
        }
      });
    };
  }, [resolvedTargetBaseUrls, telemetryService]);

  const pendingBaseUrlWorkRef = useRef<Map<string, PendingBaseUrlWork>>(new Map());
  const inFlightBaseUrlsRef = useRef<Set<string>>(new Set());
  const heldSuppressedFieldsRef = useRef<Set<string>>(new Set());
  const lastDesiredStatesRef = useRef<Map<string, DesiredFieldState>>(new Map());
  const lastControlStateRef = useRef<RemoteControlState>({
    ...DEFAULT_REMOTE_CONTROL_STATE,
  });
  const lastControlInputSourcesRef =
    useRef<RemoteControlStateKeysMeta["inputSources"]>({});

  const getCurrentTelemetryModel = useCallback(
    async (baseUrl: string): Promise<ITelemetryModel | null> => {
      const liveModel = telemetryService.getLatestModel(baseUrl);
      if (liveModel?.schemaSessionId) {
        return liveModel;
      }
      return await telemetryService.ensureLayout(baseUrl);
    },
    [telemetryService]
  );

  const getWritableMeta = useCallback(
    (model: ITelemetryModel | null, fieldPath: string): LayoutWritableInput | null => {
      if (!model?.writable_inputs_by_path) {
        return null;
      }
      return model.writable_inputs_by_path.get(fieldPath) ?? null;
    },
    []
  );

  const setConnectionStateWithRetry = useCallback(
    async (
      baseUrl: string,
      updates: Array<{ field_path: string; enabled: boolean }>
    ): Promise<ITelemetryModel | null> => {
      if (updates.length === 0) {
        return await getCurrentTelemetryModel(baseUrl);
      }
      let model = await getCurrentTelemetryModel(baseUrl);
      if (!model?.schemaSessionId) {
        return null;
      }

      let result = await telemetryService.setWorkloadInputConnectionState(baseUrl, {
        engine_session_id: model.schemaSessionId,
        updates,
      });
      if (!result.ok && result.status === 412) {
        model = await telemetryService.refreshLayout(baseUrl);
        if (model?.schemaSessionId) {
          result = await telemetryService.setWorkloadInputConnectionState(baseUrl, {
            engine_session_id: model.schemaSessionId,
            updates,
          });
        }
      }

      if (!result.ok) {
        console.warn("setWorkloadInputConnectionState rejected", {
          baseUrl,
          updates,
          status: result.status,
          body: result.body,
        });
        return null;
      }

      return model;
    },
    [getCurrentTelemetryModel, telemetryService]
  );

  const flushPendingBaseUrlWork = useCallback(
    async (baseUrl: string) => {
      if (inFlightBaseUrlsRef.current.has(baseUrl)) {
        return;
      }
      inFlightBaseUrlsRef.current.add(baseUrl);
      let deferRetry = false;

      try {
        while (true) {
          const queued = pendingBaseUrlWorkRef.current.get(baseUrl);
          if (!queued) {
            return;
          }

          if (
            queued.disableUpdates.size === 0 &&
            queued.writes.size === 0 &&
            queued.enableUpdates.size === 0
          ) {
            return;
          }

          let model = await getCurrentTelemetryModel(baseUrl);
          if (!model?.schemaSessionId) {
            deferRetry = true;
            return;
          }

          const snapshot = clonePendingWork(queued);
          pendingBaseUrlWorkRef.current.set(baseUrl, createEmptyPendingWork());

          const disableFieldPaths = new Set(snapshot.disableUpdates.keys());
          for (const [fieldPath, write] of snapshot.writes.entries()) {
            if (!write.requiresSuppression) {
              continue;
            }
            const writableMeta = getWritableMeta(model, fieldPath);
            if (typeof writableMeta?.incoming_connection_handle === "number") {
              disableFieldPaths.add(fieldPath);
            }
          }

          if (disableFieldPaths.size > 0) {
            const updatedModel = await setConnectionStateWithRetry(
              baseUrl,
              Array.from(disableFieldPaths).map((field_path) => ({
                field_path,
                enabled: false,
              }))
            );
            if (updatedModel?.schemaSessionId) {
              model = updatedModel;
            }
          }

          if (snapshot.writes.size > 0) {
            const writes = Array.from(snapshot.writes.entries())
              .map(([fieldPath, write]) => {
                const writableMeta = getWritableMeta(model, fieldPath);
                if (!writableMeta || typeof writableMeta.field_handle !== "number") {
                  return null;
                }
                return {
                  field_handle: writableMeta.field_handle,
                  field_path: fieldPath,
                  value: write.value,
                };
              })
              .filter((write): write is {
                field_handle: number;
                field_path: string;
                value: boolean | number;
              } => write !== null);

            if (writes.length > 0) {
              let result = await telemetryService.setWorkloadInputFieldsData(
                baseUrl,
                {
                  engine_session_id: model.schemaSessionId,
                  writes,
                },
                {
                  maxAttempts: 1,
                }
              );
              if (!result.ok && result.status === 412) {
                const refreshedModel = await telemetryService.refreshLayout(baseUrl);
                if (refreshedModel?.schemaSessionId) {
                  model = refreshedModel;
                  const retryWrites = writes
                    .map((write) => {
                      const writableMeta = getWritableMeta(
                        refreshedModel,
                        write.field_path
                      );
                      if (
                        !writableMeta ||
                        typeof writableMeta.field_handle !== "number"
                      ) {
                        return null;
                      }
                      return {
                        field_handle: writableMeta.field_handle,
                        field_path: write.field_path,
                        value: write.value,
                      };
                    })
                    .filter((write): write is {
                      field_handle: number;
                      field_path: string;
                      value: boolean | number;
                    } => write !== null);

                  if (retryWrites.length > 0) {
                    result = await telemetryService.setWorkloadInputFieldsData(
                      baseUrl,
                      {
                        engine_session_id: refreshedModel.schemaSessionId,
                        writes: retryWrites,
                      },
                      {
                        maxAttempts: 1,
                      }
                    );
                  }
                }
              }
              if (!result.ok) {
                console.warn("setWorkloadInputFieldsData rejected", {
                  baseUrl,
                  writes: writes.map((write) => write.field_path),
                  status: result.status,
                  body: result.body,
                });
              }
            }
          }

          if (snapshot.enableUpdates.size > 0) {
            await setConnectionStateWithRetry(
              baseUrl,
              Array.from(snapshot.enableUpdates.keys()).map((field_path) => ({
                field_path,
                enabled: true,
              }))
            );
          }
        }
      } finally {
        inFlightBaseUrlsRef.current.delete(baseUrl);
        const queued = pendingBaseUrlWorkRef.current.get(baseUrl);
        if (
          !deferRetry &&
          queued &&
          (queued.disableUpdates.size > 0 ||
            queued.writes.size > 0 ||
            queued.enableUpdates.size > 0)
        ) {
          void flushPendingBaseUrlWork(baseUrl);
        }
      }
    },
    [
      getCurrentTelemetryModel,
      getWritableMeta,
      setConnectionStateWithRetry,
      telemetryService,
    ]
  );

  const queuePendingWork = useCallback(
    (
      baseUrl: string,
      updates: {
        disableFieldPath?: string | null;
        writeFieldPath?: string | null;
        writeValue?: boolean | number;
        writeRequiresSuppression?: boolean;
        enableFieldPath?: string | null;
      }
    ) => {
      const queued =
        pendingBaseUrlWorkRef.current.get(baseUrl) ?? createEmptyPendingWork();
      if (updates.disableFieldPath) {
        queued.disableUpdates.set(updates.disableFieldPath, false);
        queued.enableUpdates.delete(updates.disableFieldPath);
      }
      if (updates.writeFieldPath && updates.writeValue !== undefined) {
        const existingWrite = queued.writes.get(updates.writeFieldPath);
        queued.writes.set(updates.writeFieldPath, {
          value: updates.writeValue,
          requiresSuppression:
            Boolean(updates.writeRequiresSuppression) ||
            Boolean(existingWrite?.requiresSuppression),
        });
      }
      if (updates.enableFieldPath) {
        queued.enableUpdates.set(updates.enableFieldPath, true);
        queued.disableUpdates.delete(updates.enableFieldPath);
      }
      pendingBaseUrlWorkRef.current.set(baseUrl, queued);
      void flushPendingBaseUrlWork(baseUrl);
    },
    [flushPendingBaseUrlWork]
  );
  const queuePendingWorkRef = useRef(queuePendingWork);

  useEffect(() => {
    queuePendingWorkRef.current = queuePendingWork;
  }, [queuePendingWork]);

  const computeDesiredStates = useCallback(
    (
      state: RemoteControlState,
      inputSources: RemoteControlStateKeysMeta["inputSources"]
    ) => {
      const desiredStates = new Map<string, DesiredFieldState>();

      for (const stickName of ["left", "right"] as const) {
        const stickConfig = resolvedStickBindings[stickName];
        if (!stickConfig) {
          continue;
        }
        const selectedModeId =
          selectedModes[stickName] && stickConfig.modes[selectedModes[stickName] ?? ""]
            ? selectedModes[stickName]
            : stickConfig.selectedMode;
        if (!selectedModeId) {
          continue;
        }
        const mode = stickConfig.modes[selectedModeId];
        if (!mode) {
          continue;
        }

        const transformed = applyStickModeTransform(state[stickName], mode, {
          applyShapeTransform: inputSources[stickName] === "gamepad",
        });
        const outputValues = {
          x: transformed.x,
          y: transformed.y,
        } as const;
        const modeHasOutputs = Object.keys(mode.outputs).length > 0;

        for (const axis of ["x", "y"] as const) {
          const binding = mode.outputs[axis];
          if (!binding) {
            continue;
          }
          desiredStates.set(binding.qualifiedPath, {
            binding,
            value: outputValues[axis],
            // Stick modes acquire their target fields while selected, even
            // at neutral, so the selected RC output remains authoritative.
            shouldSuppress: modeHasOutputs,
            reassertSuppressionOnWrite: true,
          });
        }
      }

      for (const [buttonKey, binding] of Object.entries(resolvedButtons) as Array<
        [RemoteControlButtonKey, ResolvedTargetBinding]
      >) {
        const pressed = Boolean(state[buttonKey]);
        desiredStates.set(binding.qualifiedPath, {
          binding,
          value: pressed,
          shouldSuppress: pressed,
          reassertSuppressionOnWrite: false,
        });
      }

      return desiredStates;
    },
    [resolvedButtons, resolvedStickBindings, selectedModes]
  );

  const applyDesiredStates = useCallback(
    (nextDesiredStates: Map<string, DesiredFieldState>) => {
      const previousDesiredStates = lastDesiredStatesRef.current;
      const fieldKeys = new Set<string>([
        ...previousDesiredStates.keys(),
        ...nextDesiredStates.keys(),
      ]);

      for (const fieldKey of fieldKeys) {
        const previous = previousDesiredStates.get(fieldKey);
        const next = nextDesiredStates.get(fieldKey);
        if (desiredStateEquals(previous, next)) {
          continue;
        }

        const binding = next?.binding ?? previous?.binding;
        if (!binding?.telemetryBaseUrl) {
          continue;
        }
        const baseUrl = binding.telemetryBaseUrl;
        const liveModel = telemetryService.getLatestModel(baseUrl);
        const runtimeFieldPath = resolveRuntimeFieldPath(
          liveModel,
          binding.fieldPath
        );
        const writableMeta = getWritableMeta(liveModel, runtimeFieldPath);
        const hasIncomingConnection =
          typeof writableMeta?.incoming_connection_handle === "number";
        const wasSuppressed = heldSuppressedFieldsRef.current.has(fieldKey);
        const wantsSuppression =
          Boolean(next?.shouldSuppress) && hasIncomingConnection;

        if (wantsSuppression && !wasSuppressed) {
          heldSuppressedFieldsRef.current.add(fieldKey);
          queuePendingWork(baseUrl, {
            disableFieldPath: runtimeFieldPath,
          });
        }

        const nextValue =
          next?.value ??
          (typeof previous?.value === "boolean" ? false : 0);
        queuePendingWork(baseUrl, {
          writeFieldPath: runtimeFieldPath,
          writeValue: nextValue,
          writeRequiresSuppression:
            Boolean(next?.reassertSuppressionOnWrite) && wantsSuppression,
        });

        if (!wantsSuppression && wasSuppressed) {
          heldSuppressedFieldsRef.current.delete(fieldKey);
          queuePendingWork(baseUrl, {
            enableFieldPath: runtimeFieldPath,
          });
        }
      }

      lastDesiredStatesRef.current = nextDesiredStates;
    },
    [getWritableMeta, queuePendingWork, telemetryService]
  );

  const handleStateKeys = useCallback(
    (
      state: RemoteControlState,
      _keys: ReadonlyArray<keyof RemoteControlState>,
      meta: RemoteControlStateKeysMeta
    ) => {
      lastControlStateRef.current = state;
      lastControlInputSourcesRef.current = {
        ...lastControlInputSourcesRef.current,
        ...meta.inputSources,
      };
      applyDesiredStates(
        computeDesiredStates(state, lastControlInputSourcesRef.current)
      );
    },
    [applyDesiredStates, computeDesiredStates]
  );

  useEffect(() => {
    applyDesiredStates(
      computeDesiredStates(
        lastControlStateRef.current,
        lastControlInputSourcesRef.current
      )
    );
  }, [applyDesiredStates, computeDesiredStates]);

  useEffect(() => {
    return () => {
      const finalStates = lastDesiredStatesRef.current;
      for (const [fieldKey, desiredState] of finalStates.entries()) {
        if (!desiredState.binding.telemetryBaseUrl) {
          continue;
        }
        const liveModel = telemetryService.getLatestModel(
          desiredState.binding.telemetryBaseUrl
        );
        const runtimeFieldPath = resolveRuntimeFieldPath(
          liveModel,
          desiredState.binding.fieldPath
        );
        queuePendingWorkRef.current(desiredState.binding.telemetryBaseUrl, {
          writeFieldPath: runtimeFieldPath,
          writeValue: typeof desiredState.value === "boolean" ? false : 0,
          enableFieldPath: heldSuppressedFieldsRef.current.has(fieldKey)
            ? runtimeFieldPath
            : null,
        });
      }
      heldSuppressedFieldsRef.current.clear();
      lastDesiredStatesRef.current = new Map();
    };
  }, []);

  const controlsEnabled = resolvedTargetBaseUrls.length > 0;

  const unresolvedTargets = useMemo(() => {
    const missing = new Set<string>();
    for (const stickName of ["left", "right"] as const) {
      const stickConfig = resolvedStickBindings[stickName];
      if (!stickConfig) {
        continue;
      }
      for (const mode of Object.values(stickConfig.modes)) {
        for (const binding of Object.values(mode.outputs)) {
          if (binding && !binding.telemetryBaseUrl) {
            missing.add(binding.qualifiedPath);
          }
        }
      }
    }
    for (const binding of Object.values(resolvedButtons)) {
      if (binding && !binding.telemetryBaseUrl) {
        missing.add(binding.qualifiedPath);
      }
    }
    return Array.from(missing);
  }, [resolvedButtons, resolvedStickBindings]);

  const renderModeSelector = (
    stickName: RemoteControlStickName,
    stickConfig: RemoteControlStickConfig | undefined
  ) => {
    if (!stickConfig || Object.keys(stickConfig.modes).length <= 1) {
      return null;
    }

    const currentMode =
      selectedModes[stickName] && stickConfig.modes[selectedModes[stickName] ?? ""]
        ? selectedModes[stickName]
        : stickConfig.selectedMode;
    const tooltip = buildModeTooltip(
      stickName,
      currentMode ? stickConfig.modes[currentMode] : undefined
    );

    return (
      <label className={styles.modeControl} key={stickName} title={tooltip}>
        <span>{stickName === "left" ? "Left Stick" : "Right Stick"}</span>
        <select
          title={tooltip}
          value={currentMode}
          onChange={(event) => {
            const nextMode = event.target.value;
            setPersistedSelectedModes({
              storageKey: selectedModesStorageKey,
              selectedModes: {
                ...selectedModes,
                [stickName]: nextMode,
              },
            });
          }}
        >
          {Object.values(stickConfig.modes).map((mode) => (
            <option key={mode.id} value={mode.id}>
              {mode.label}
            </option>
          ))}
        </select>
      </label>
    );
  };

  useRemoteControlClient({
    leftArea: leftAreaEl,
    leftKnob: leftKnobEl,
    rightArea: rightAreaEl,
    rightKnob: rightKnobEl,
    onStateKeys: handleStateKeys,
    enabled: controlsEnabled,
  });

  return (
    <>
      <div className={styles.joystickRow}>
        <div
          className={styles.stickArea}
          ref={setLeftAreaEl}
          data-testid="left-stick-area"
        >
          <div className={styles.knob} ref={setLeftKnobEl} />
        </div>
        <div
          className={styles.stickArea}
          ref={setRightAreaEl}
          data-testid="right-stick-area"
        >
          <div className={styles.knob} ref={setRightKnobEl} />
        </div>
      </div>

      <div className={styles.controls}>
        <div className={styles.modeControls}>
          {renderModeSelector("left", normalizedConfig.sticks.left)}
          {renderModeSelector("right", normalizedConfig.sticks.right)}
        </div>
        {!controlsEnabled ? (
          <div className={styles.statusNote}>Remote control targets unavailable.</div>
        ) : null}
        {unresolvedTargets.length > 0 ? (
          <div className={styles.statusWarning}>
            Unresolved targets: {unresolvedTargets.join(", ")}
          </div>
        ) : null}
      </div>
    </>
  );
}

function applyResolvedBindingsToMode(
  mode: RemoteControlStickMode,
  resolveBinding: (binding: RemoteControlTargetBinding) => ResolvedTargetBinding
) {
  return {
    ...mode,
    outputs: Object.fromEntries(
      Object.entries(mode.outputs).map(([axis, binding]) => [
        axis,
        binding ? resolveBinding(binding) : binding,
      ])
    ),
  };
}
