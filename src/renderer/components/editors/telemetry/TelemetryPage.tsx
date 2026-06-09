import React, { useEffect, useRef, useState } from "react";
import { TelemetryApp } from "./view/TelemetryApp";
import styles from "./Telemetry.module.css";
import type { ModelSortKey } from "./view/TelemetryApp";
import type {
  TelemetryModelPersistedState,
  WorkloadSortKey,
} from "./view/TelemetryModel";
import {
  definePanelPersistence,
  defineStudioPanel,
  usePanelSettings,
} from "../../workbenches/PanelInstanceContext";

const MODEL_SORT_OPTIONS: ReadonlyArray<{
  value: ModelSortKey;
  label: string;
}> = [
  { value: "telemetry_port", label: "Telemetry Port" },
  { value: "model_name", label: "Model Name" },
  { value: "model_path", label: "Model Path" },
  { value: "memory_process", label: "Memory - Process" },
  { value: "memory_workloads", label: "Memory - Workloads" },
];
const RMB_PAN_DRAG_THRESHOLD_PX = 4;

type TelemetryPageSettings = {
  modelSortKey: ModelSortKey;
  models: Record<string, TelemetryModelPersistedState>;
};

function isTelemetryModelSortKey(value: unknown): value is ModelSortKey {
  return (
    value === "telemetry_port" ||
    value === "model_name" ||
    value === "model_path" ||
    value === "memory_process" ||
    value === "memory_workloads"
  );
}

function isTelemetryWorkloadSortKey(value: unknown): value is WorkloadSortKey {
  return (
    value === "none" ||
    value === "unique_name" ||
    value === "workload_type" ||
    value === "memory_total" ||
    value === "memory_static" ||
    value === "memory_dynamic"
  );
}

export const telemetryPagePersistence =
  definePanelPersistence<TelemetryPageSettings>({
    schemaVersion: 1,
    defaults: {
      modelSortKey: "telemetry_port",
      models: {},
    },
    sanitize(value) {
      const input =
        value && typeof value === "object"
          ? (value as Partial<TelemetryPageSettings>)
          : {};
      const models = Object.entries(input.models ?? {}).reduce<
        Record<string, TelemetryModelPersistedState>
      >((acc, [key, entry]) => {
        if (!entry || typeof entry !== "object") {
          return acc;
        }
        const next = entry as TelemetryModelPersistedState;
        acc[key] = {
          ...(typeof next.isExpanded === "boolean"
            ? { isExpanded: next.isExpanded }
            : {}),
          ...(isTelemetryWorkloadSortKey(next.workloadSortKey)
            ? { workloadSortKey: next.workloadSortKey }
            : {}),
        };
        return acc;
      }, {});
      return {
        modelSortKey: isTelemetryModelSortKey(input.modelSortKey)
          ? input.modelSortKey
          : "telemetry_port",
        models,
      };
    },
  });

export function TelemetryPage() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [settings, updateSettings] = usePanelSettings(telemetryPagePersistence);
  const panListenersRef = useRef<{
    mousemove: (event: MouseEvent) => void;
    mouseup: (event: MouseEvent) => void;
    blur: () => void;
    contextmenu: (event: MouseEvent) => void;
  } | null>(null);
  const modelSortKey = settings.modelSortKey;
  const [isPanning, setIsPanning] = useState(false);
  const panStateRef = useRef<{
    scrollElement: HTMLElement;
    startX: number;
    startY: number;
    scrollLeft: number;
    scrollTop: number;
    isActive: boolean;
    previousBodyUserSelect: string;
    previousBodyCursor: string;
  } | null>(null);

  const updateModelState = React.useCallback(
    (
      modelStorageId: string,
      updater:
        | TelemetryModelPersistedState
        | ((
            current: TelemetryModelPersistedState
          ) => TelemetryModelPersistedState)
    ) => {
      const current = settings.models[modelStorageId] ?? {};
      const resolved = typeof updater === "function" ? updater(current) : updater;
      updateSettings({
        models: {
          ...settings.models,
          [modelStorageId]: resolved,
        },
      });
    },
    [settings.models, updateSettings]
  );

  const findScrollElement = (start: EventTarget | null): HTMLElement | null => {
    let node = start instanceof HTMLElement ? start : containerRef.current;
    while (node) {
      const style = window.getComputedStyle(node);
      const overflowX = style.overflowX;
      const overflowY = style.overflowY;
      const canScrollX =
        (overflowX === "auto" || overflowX === "scroll" || overflowX === "overlay") &&
        node.scrollWidth > node.clientWidth;
      const canScrollY =
        (overflowY === "auto" || overflowY === "scroll" || overflowY === "overlay") &&
        node.scrollHeight > node.clientHeight;
      if (canScrollX || canScrollY) {
        return node;
      }
      node = node.parentElement;
    }
    return null;
  };

  const detachPanListeners = () => {
    const listeners = panListenersRef.current;
    if (!listeners) {
      return;
    }
    window.removeEventListener("mousemove", listeners.mousemove);
    window.removeEventListener("mouseup", listeners.mouseup);
    window.removeEventListener("blur", listeners.blur);
    window.removeEventListener("contextmenu", listeners.contextmenu);
    panListenersRef.current = null;
  };

  const finishPan = (updateState = true) => {
    detachPanListeners();
    const panState = panStateRef.current;
    if (panState?.isActive) {
      containerRef.current?.removeAttribute("data-suppress-panel-rmb-menu");
      document.body.style.userSelect = panState.previousBodyUserSelect;
      document.body.style.cursor = panState.previousBodyCursor;
    }
    panStateRef.current = null;
    if (updateState) {
      setIsPanning(false);
    }
  };

  useEffect(() => () => finishPan(false), []);

  const handleMouseDownCapture = (event: React.MouseEvent<HTMLDivElement>) => {
    if (event.button !== 2) {
      return;
    }
    const scrollElement = findScrollElement(event.target);
    if (!scrollElement) {
      return;
    }
    event.preventDefault();
    panStateRef.current = {
      scrollElement,
      startX: event.clientX,
      startY: event.clientY,
      scrollLeft: scrollElement.scrollLeft,
      scrollTop: scrollElement.scrollTop,
      isActive: false,
      previousBodyUserSelect: document.body.style.userSelect,
      previousBodyCursor: document.body.style.cursor,
    };

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const panState = panStateRef.current;
      if (!panState) {
        return;
      }
      const dx = moveEvent.clientX - panState.startX;
      const dy = moveEvent.clientY - panState.startY;
      if (!panState.isActive) {
        if (Math.abs(dx) < RMB_PAN_DRAG_THRESHOLD_PX && Math.abs(dy) < RMB_PAN_DRAG_THRESHOLD_PX) {
          return;
        }
        panState.isActive = true;
        containerRef.current?.setAttribute("data-suppress-panel-rmb-menu", "active");
        document.body.style.userSelect = "none";
        document.body.style.cursor = "grabbing";
        setIsPanning(true);
      }
      moveEvent.preventDefault();
      panState.scrollElement.scrollLeft =
        panState.scrollLeft - dx;
      panState.scrollElement.scrollTop =
        panState.scrollTop - dy;
    };
    const handleMouseUp = (upEvent: MouseEvent) => {
      if (panStateRef.current?.isActive) {
        upEvent.preventDefault();
      }
      finishPan();
    };
    const handleWindowBlur = () => {
      finishPan();
    };
    const handleWindowContextMenu = (contextMenuEvent: MouseEvent) => {
      if (panStateRef.current?.isActive) {
        contextMenuEvent.preventDefault();
      }
    };

    panListenersRef.current = {
      mousemove: handleMouseMove,
      mouseup: handleMouseUp,
      blur: handleWindowBlur,
      contextmenu: handleWindowContextMenu,
    };
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    window.addEventListener("blur", handleWindowBlur);
    window.addEventListener("contextmenu", handleWindowContextMenu);
  };

  const handleContextMenu = (event: React.MouseEvent<HTMLDivElement>) => {
    if (isPanning) {
      event.preventDefault();
    }
  };

  return (
    <div
      ref={containerRef}
      className={isPanning ? `${styles.container} ${styles.containerPanning}` : styles.container}
      onMouseDownCapture={handleMouseDownCapture}
      onContextMenu={handleContextMenu}
    >
      <div className={styles.panelHeaderRow}>
        <h2>Workload Telemetry</h2>
        <label className={styles.panelHeaderControlLabel}>
          Sort models by:
          <select
            id="telemetry-model-sort"
            className={styles.panelHeaderControlSelect}
            value={modelSortKey}
            onChange={(e) =>
              updateSettings({ modelSortKey: e.target.value as ModelSortKey })
            }
          >
            {MODEL_SORT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className={styles.tableContainer}>
        <TelemetryApp
          modelSortKey={modelSortKey}
          modelStates={settings.models}
          onModelStateChange={updateModelState}
        />
      </div>
    </div>
  );
}

export const contribution = defineStudioPanel({
  component: TelemetryPage,
  persistence: telemetryPagePersistence,
});

export default TelemetryPage;
