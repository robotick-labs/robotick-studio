import React, { useMemo, useRef, useState, useEffect } from "react";
import { createPortal } from "react-dom";
import styles from "./styles/RcSubtitlesOverlay.module.css";
import {
  ProjectData,
  useTelemetryStream,
} from "../studio-host";

const SUBTITLES_SAMPLE_RATE_HZ = 5; // sample 5x per second (every 200ms)
const DEFAULT_POSITION_X_NORM = 0.5;
const DEFAULT_POSITION_Y_NORM = 0.84;

function resolveRuntimeFieldPath(
  model: { workloads?: Array<{ name: string }>; getField?: (path: string) => unknown } | null,
  configuredFieldPath: string
): string {
  if (!model?.getField || !configuredFieldPath) {
    return configuredFieldPath;
  }
  if (model.getField(configuredFieldPath)) {
    return configuredFieldPath;
  }
  const dotIndex = configuredFieldPath.indexOf(".");
  if (dotIndex <= 0 || dotIndex >= configuredFieldPath.length - 1) {
    return configuredFieldPath;
  }
  const suffix = configuredFieldPath.slice(dotIndex + 1);
  for (const workload of model.workloads ?? []) {
    const candidate = `${workload.name}.${suffix}`;
    if (model.getField(candidate)) {
      return candidate;
    }
  }
  return configuredFieldPath;
}

type RcSubtitlesConfig = {
  telemetryBaseUrl?: string;
  fieldPath?: string;
  modelName?: string;
  x?: number;
  y?: number;
};

type RcSubtitlesProps = {
  config?: RcSubtitlesConfig;
  persistedState?: RcSubtitlesPersistedState;
  onPersistedStateChange?: (nextState: RcSubtitlesPersistedState) => void;
};

export type RcSubtitlesPersistedState = {
  positionNorm?: { x: number; y: number };
  collapsed?: boolean;
};

export function RcSubtitlesOverlay({
  config,
  persistedState,
  onPersistedStateChange,
}: RcSubtitlesProps) {
  const { projectModels, findModelByName } = ProjectData.use();
  const fieldPath = config?.fieldPath;
  const configuredBaseUrl = config?.telemetryBaseUrl?.trim();
  const configuredModelName = config?.modelName?.trim();
  const configuredX = normalizeCoord(config?.x, DEFAULT_POSITION_X_NORM);
  const configuredY = normalizeCoord(config?.y, DEFAULT_POSITION_Y_NORM);

  const telemetryBaseUrl = useMemo(() => {
    if (configuredBaseUrl) {
      return configuredBaseUrl;
    }
    if (!configuredModelName) return null;
    const descriptor = findModelByName(configuredModelName);
    return descriptor?.telemetryBaseUrl ?? null;
  }, [configuredBaseUrl, configuredModelName, findModelByName]);

  useEffect(() => {
    if (
      !telemetryBaseUrl &&
      configuredModelName &&
      !projectModels.loading &&
      !projectModels.error
    ) {
      console.warn(
        `[rc-subtitles] Model "${configuredModelName}" not found in project telemetry.`
      );
    }
  }, [
    configuredModelName,
    projectModels.error,
    projectModels.loading,
    telemetryBaseUrl,
  ]);

  const { model, revision } = useTelemetryStream(
    telemetryBaseUrl ?? "",
    SUBTITLES_SAMPLE_RATE_HZ
  );
  const effectiveFieldPath = useMemo(
    () => resolveRuntimeFieldPath(model, fieldPath ?? ""),
    [fieldPath, model, revision]
  );
  const [subtitle, setSubtitle] = useState("");
  const [visible, setVisible] = useState(false);
  const [animateKey, setAnimateKey] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [uncontrolledPositionNorm, setUncontrolledPositionNorm] = useState<{
    x: number;
    y: number;
  }>({
    x: normalizeCoord(persistedState?.positionNorm?.x, configuredX),
    y: normalizeCoord(persistedState?.positionNorm?.y, configuredY),
  });
  const [uncontrolledCollapsed, setUncontrolledCollapsed] = useState(
    Boolean(persistedState?.collapsed)
  );
  const positionNorm = {
    x: normalizeCoord(
      persistedState?.positionNorm?.x,
      uncontrolledPositionNorm.x,
    ),
    y: normalizeCoord(
      persistedState?.positionNorm?.y,
      uncontrolledPositionNorm.y,
    ),
  };
  const collapsed = persistedState?.collapsed ?? uncontrolledCollapsed;
  const lastTextRef = useRef("");
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const anchorRef = useRef<HTMLDivElement | null>(null);
  const bubbleRef = useRef<HTMLDivElement | null>(null);
  const dragStateRef = useRef<{
    pointerId: number;
    halfXNorm: number;
    halfYNorm: number;
  } | null>(null);

  useEffect(() => {
    if (persistedState?.positionNorm) {
      return;
    }
    setUncontrolledPositionNorm({
      x: configuredX,
      y: configuredY,
    });
  }, [configuredX, configuredY, persistedState?.positionNorm]);

  useEffect(() => {
    if (persistedState?.collapsed !== undefined) {
      return;
    }
    setUncontrolledCollapsed(false);
  }, [persistedState?.collapsed]);

  useEffect(() => {
    if (!effectiveFieldPath || !telemetryBaseUrl || !model?.getField) return;
    const field = model.getField(effectiveFieldPath);
    const value = field?.getValue?.();
    if (typeof value !== "string") return;
    const normalized = normalizeForDisplay(value);
    if (normalized !== lastTextRef.current) {
      lastTextRef.current = normalized;
      setSubtitle(normalized);
      setVisible(Boolean(normalized));
      setAnimateKey((k) => (k + 1) % Number.MAX_SAFE_INTEGER);
    }
  }, [effectiveFieldPath, model, revision, telemetryBaseUrl]);

  const safeSubtitle = useMemo(() => normalizeForDisplay(subtitle), [subtitle]);

  useEffect(() => {
    const clampToViewport = () => {
      const overlay = overlayRef.current;
      const anchor = anchorRef.current;
      if (!overlay || !anchor) return;

      const overlayRect = overlay.getBoundingClientRect();
      const anchorRect = anchor.getBoundingClientRect();
      if (overlayRect.width <= 0 || overlayRect.height <= 0) return;

      const halfXNorm = clamp01((anchorRect.width * 0.5) / overlayRect.width);
      const halfYNorm = clamp01((anchorRect.height * 0.5) / overlayRect.height);
      const next = {
        x: clamp(positionNorm.x, halfXNorm, 1.0 - halfXNorm),
        y: clamp(positionNorm.y, halfYNorm, 1.0 - halfYNorm),
      };
      if (next.x === positionNorm.x && next.y === positionNorm.y) {
        return;
      }
      if (persistedState?.positionNorm === undefined) {
        setUncontrolledPositionNorm(next);
      }
      onPersistedStateChange?.({
        positionNorm: next,
        collapsed,
      });
    };

    const frame = window.requestAnimationFrame(clampToViewport);
    window.addEventListener("resize", clampToViewport);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", clampToViewport);
    };
  }, [collapsed, onPersistedStateChange, persistedState?.positionNorm, positionNorm.x, positionNorm.y, safeSubtitle, visible]);

  if (!fieldPath) {
    console.warn(
      "[rc-subtitles] Missing fieldPath in module configuration",
      config
    );
    return null;
  }

  if (!telemetryBaseUrl || !model) {
    return null;
  }

  if (typeof document === "undefined" || !document.body) {
    return null;
  }

  const pointerDown: React.PointerEventHandler<HTMLDivElement> = (event) => {
    if (event.button !== 0) return;
    const target = event.target as HTMLElement | null;
    if (target?.closest("button")) return;
    const overlay = overlayRef.current;
    const anchor = anchorRef.current;
    if (!overlay || !anchor) return;

    const overlayRect = overlay.getBoundingClientRect();
    if (overlayRect.width <= 0 || overlayRect.height <= 0) return;
    const anchorRect = anchor.getBoundingClientRect();

    dragStateRef.current = {
      pointerId: event.pointerId,
      halfXNorm: clamp01((anchorRect.width * 0.5) / overlayRect.width),
      halfYNorm: clamp01((anchorRect.height * 0.5) / overlayRect.height),
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(true);
  };

  const pointerMove: React.PointerEventHandler<HTMLDivElement> = (event) => {
    const drag = dragStateRef.current;
    const overlay = overlayRef.current;
    if (!drag || !overlay || event.pointerId !== drag.pointerId) return;

    const overlayRect = overlay.getBoundingClientRect();
    if (overlayRect.width <= 0 || overlayRect.height <= 0) return;

    const rawX = (event.clientX - overlayRect.left) / overlayRect.width;
    const rawY = (event.clientY - overlayRect.top) / overlayRect.height;
    const nextPosition = {
      x: clamp(rawX, drag.halfXNorm, 1.0 - drag.halfXNorm),
      y: clamp(rawY, drag.halfYNorm, 1.0 - drag.halfYNorm),
    };
    if (persistedState?.positionNorm === undefined) {
      setUncontrolledPositionNorm(nextPosition);
    }
    onPersistedStateChange?.({
      positionNorm: nextPosition,
      collapsed,
    });
  };

  const pointerUpOrCancel: React.PointerEventHandler<HTMLDivElement> = (
    event
  ) => {
    if (event.pointerId !== dragStateRef.current?.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    dragStateRef.current = null;
    setDragging(false);
  };

  const toggleCollapsed: React.MouseEventHandler<HTMLButtonElement> = (
    event
  ) => {
    event.preventDefault();
    event.stopPropagation();
    const nextCollapsed = !collapsed;
    if (persistedState?.collapsed === undefined) {
      setUncontrolledCollapsed(nextCollapsed);
    }
    onPersistedStateChange?.({
      positionNorm,
      collapsed: nextCollapsed,
    });
  };

  const togglePointerDown: React.PointerEventHandler<HTMLButtonElement> = (
    event
  ) => {
    event.preventDefault();
    event.stopPropagation();
  };

  const bubbleClassName = `${styles.bubble} ${
    collapsed ? styles.collapsed : visible ? styles.show : styles.hide
  }`.trim();

  return createPortal(
    <div
      className={styles.overlay}
      aria-live="polite"
      aria-atomic="true"
      ref={overlayRef}
    >
      <div
        className={`${styles.anchor} ${dragging ? styles.dragging : ""}`.trim()}
        ref={anchorRef}
        style={{
          left: `${positionNorm.x * 100}%`,
          top: `${positionNorm.y * 100}%`,
        }}
        onPointerDown={pointerDown}
        onPointerMove={pointerMove}
        onPointerUp={pointerUpOrCancel}
        onPointerCancel={pointerUpOrCancel}
      >
        <div
          key={animateKey}
          className={bubbleClassName}
          ref={bubbleRef}
        >
          <div className={styles.chrome}>
            <button
              type="button"
              className={styles.toggleButton}
              onPointerDown={togglePointerDown}
              onClick={toggleCollapsed}
              aria-label={collapsed ? "Expand subtitles" : "Collapse subtitles"}
              aria-expanded={!collapsed}
            >
              <span className={styles.toggleGlyph} aria-hidden="true">
                {collapsed ? "▾" : "▴"}
              </span>
            </button>
          </div>
          {!collapsed ? (
            <div className={styles.body}>
              {safeSubtitle.split("\n").map((line, idx, arr) => (
                <span className={styles.line} key={idx}>
                  {line}
                  {idx < arr.length - 1 ? <br /> : null}
                </span>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </div>,
    document.body
  );
}

function normalizeForDisplay(s: string): string {
  const trimmed = s.replace(/\r/g, "").trim();
  return trimmed.replace(/[ \t]{2,}/g, " ");
}

function normalizeCoord(value: unknown, fallback: number): number {
  if (typeof value !== "number" || Number.isNaN(value)) return fallback;
  return clamp01(value);
}

function clamp(value: number, min: number, max: number): number {
  if (value <= min) return min;
  if (value >= max) return max;
  return value;
}

function clamp01(value: number): number {
  return clamp(value, 0.0, 1.0);
}
