import React, { useMemo, useRef, useState, useEffect } from "react";
import styles from "./styles/RcSubtitlesOverlay.module.css";
import { useTelemetryStream } from "../../../../data-sources/telemetry";
import { ProjectData } from "../../../../data-sources/launcher";
import {
  buildNamespacedKey,
  readStorageValue,
  setStorageValue,
} from "../../../../services/storage";

const SUBTITLES_POLL_RATE_HZ = 5; // poll 5x per second (every 200ms)
const DEFAULT_POSITION_X_NORM = 0.5;
const DEFAULT_POSITION_Y_NORM = 0.84;
const SUBTITLES_POSITION_STORAGE_BASE = "robotick-studio.rc.subtitles.position";

type RcSubtitlesConfig = {
  telemetryBaseUrl?: string;
  fieldPath?: string;
  modelName?: string;
  x?: number;
  y?: number;
};

type RcSubtitlesProps = {
  config?: RcSubtitlesConfig;
};

export function RcSubtitlesOverlay({ config }: RcSubtitlesProps) {
  const { projectModels, findModelByName } = ProjectData.use();
  const fieldPath = config?.fieldPath;
  const configuredBaseUrl = config?.telemetryBaseUrl?.trim();
  const configuredModelName = config?.modelName?.trim();
  const configuredX = normalizeCoord(config?.x, DEFAULT_POSITION_X_NORM);
  const configuredY = normalizeCoord(config?.y, DEFAULT_POSITION_Y_NORM);
  const storageKey = useMemo(
    () =>
      buildNamespacedKey(
        SUBTITLES_POSITION_STORAGE_BASE,
        configuredModelName,
        configuredBaseUrl,
        fieldPath?.trim()
      ),
    [configuredBaseUrl, configuredModelName, fieldPath]
  );

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

  const { model } = useTelemetryStream(
    telemetryBaseUrl ?? "",
    SUBTITLES_POLL_RATE_HZ
  );
  const [subtitle, setSubtitle] = useState("");
  const [visible, setVisible] = useState(false);
  const [animateKey, setAnimateKey] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [positionNorm, setPositionNorm] = useState<{
    x: number;
    y: number;
  }>({
    x: configuredX,
    y: configuredY,
  });
  const [positionStorageReadyKey, setPositionStorageReadyKey] =
    useState<string>("");
  const lastTextRef = useRef("");
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const bubbleRef = useRef<HTMLDivElement | null>(null);
  const dragStateRef = useRef<{
    pointerId: number;
    halfXNorm: number;
    halfYNorm: number;
  } | null>(null);

  useEffect(() => {
    const stored = parseStoredPosition(readStorageValue(storageKey));
    if (stored) {
      setPositionNorm(stored);
    } else {
      setPositionNorm({ x: configuredX, y: configuredY });
    }
    setPositionStorageReadyKey(storageKey);
  }, [configuredX, configuredY, storageKey]);

  useEffect(() => {
    if (positionStorageReadyKey !== storageKey) return;
    setStorageValue(storageKey, JSON.stringify(positionNorm));
  }, [positionNorm, positionStorageReadyKey, storageKey]);

  useEffect(() => {
    if (!fieldPath || !telemetryBaseUrl || !model?.getField) return;
    const field = model.getField(fieldPath);
    const value = field?.getValue?.();
    if (typeof value !== "string") return;
    const normalized = normalizeForDisplay(value);
    if (normalized !== lastTextRef.current) {
      lastTextRef.current = normalized;
      setSubtitle(normalized);
      setVisible(Boolean(normalized));
      setAnimateKey((k) => (k + 1) % Number.MAX_SAFE_INTEGER);
    }
  }, [model, fieldPath, telemetryBaseUrl]);

  const safeSubtitle = useMemo(() => normalizeForDisplay(subtitle), [subtitle]);

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

  const pointerDown: React.PointerEventHandler<HTMLDivElement> = (event) => {
    if (event.button !== 0) return;
    const overlay = overlayRef.current;
    const bubble = bubbleRef.current;
    if (!overlay || !bubble) return;

    const overlayRect = overlay.getBoundingClientRect();
    if (overlayRect.width <= 0 || overlayRect.height <= 0) return;
    const bubbleRect = bubble.getBoundingClientRect();

    dragStateRef.current = {
      pointerId: event.pointerId,
      halfXNorm: clamp01((bubbleRect.width * 0.5) / overlayRect.width),
      halfYNorm: clamp01((bubbleRect.height * 0.5) / overlayRect.height),
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
    setPositionNorm({
      x: clamp(rawX, drag.halfXNorm, 1.0 - drag.halfXNorm),
      y: clamp(rawY, drag.halfYNorm, 1.0 - drag.halfYNorm),
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

  return (
    <div
      className={styles.overlay}
      aria-live="polite"
      aria-atomic="true"
      ref={overlayRef}
    >
      <div
        className={`${styles.anchor} ${dragging ? styles.dragging : ""}`.trim()}
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
          className={`${styles.bubble} ${
            visible ? styles.show : styles.hide
          }`.trim()}
          ref={bubbleRef}
        >
          {safeSubtitle.split("\n").map((line, idx, arr) => (
            <span className={styles.line} key={idx}>
              {line}
              {idx < arr.length - 1 ? <br /> : null}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

function normalizeForDisplay(s: string): string {
  const trimmed = s.replace(/\r/g, "").trim();
  return trimmed.replace(/[ \t]{2,}/g, " ");
}

function parseStoredPosition(
  raw: string | null
): { x: number; y: number } | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<{ x: number; y: number }>;
    const x = normalizeCoord(parsed.x, NaN);
    const y = normalizeCoord(parsed.y, NaN);
    if (Number.isFinite(x) && Number.isFinite(y)) {
      return { x, y };
    }
  } catch {
    // Ignore malformed values.
  }
  return null;
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
