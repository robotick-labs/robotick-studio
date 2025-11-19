import React, { useMemo, useRef, useState, useEffect } from "react";
import styles from "./styles/RcSubtitlesOverlay.module.css";
import { useTelemetryStream } from "../../../data-sources/telemetry";
import { ProjectData } from "../../../data-sources/launcher";

const SUBTITLES_POLL_RATE_HZ = 5; // poll 5x per second (every 200ms)

type RcSubtitlesConfig = {
  telemetryBaseUrl?: string;
  fieldPath?: string;
  modelName?: string;
};

type RcSubtitlesProps = {
  config?: RcSubtitlesConfig;
};

export function RcSubtitlesOverlay({ config }: RcSubtitlesProps) {
  const { projectModels, findModelByName } = ProjectData.use();
  const fieldPath = config?.fieldPath;
  const configuredBaseUrl = config?.telemetryBaseUrl?.trim();
  const configuredModelName = config?.modelName?.trim();

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
  const lastTextRef = useRef("");

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

  return (
    <div className={styles.overlay} aria-live="polite" aria-atomic="true">
      <div
        key={animateKey}
        className={`${styles.bubble} ${
          visible ? styles.show : styles.hide
        }`.trim()}
      >
        {safeSubtitle.split("\n").map((line, idx, arr) => (
          <span className={styles.line} key={idx}>
            {line}
            {idx < arr.length - 1 ? <br /> : null}
          </span>
        ))}
      </div>
    </div>
  );
}

function normalizeForDisplay(s: string): string {
  const trimmed = s.replace(/\r/g, "").trim();
  return trimmed.replace(/[ \t]{2,}/g, " ");
}
