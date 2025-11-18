import React, { useMemo, useRef, useState, useEffect } from "react";
import styles from "./styles/RcSubtitlesOverlay.module.css";
import { useTelemetryStream } from "../../../core/telemetry/useTelemetryStream";

type RcSubtitlesConfig = {
  telemetryBaseUrl?: string;
  fieldPath?: string;
};

type RcSubtitlesProps = {
  config?: RcSubtitlesConfig;
};

export function RcSubtitlesOverlay({ config }: RcSubtitlesProps) {
  const telemetryBaseUrl = config?.telemetryBaseUrl;
  const fieldPath = config?.fieldPath;

  if (!telemetryBaseUrl || !fieldPath) {
    console.warn(
      "[rc-subtitles] Missing module configuration (telemetryBaseUrl + fieldPath required)",
      config
    );
    return null;
  }

  const { model } = useTelemetryStream(telemetryBaseUrl, 100);
  const [subtitle, setSubtitle] = useState("");
  const [visible, setVisible] = useState(false);
  const [animateKey, setAnimateKey] = useState(0);
  const lastTextRef = useRef("");

  useEffect(() => {
    if (!model || !model.getField) return;
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
  }, [model, fieldPath]);

  const safeSubtitle = useMemo(() => normalizeForDisplay(subtitle), [subtitle]);

  if (!safeSubtitle) {
    return null;
  }

  return (
    <div className={styles.overlay} aria-live="polite" aria-atomic="true">
      <div
        key={animateKey}
        className={`${styles.bubble} ${
          visible && safeSubtitle ? styles.show : styles.hide
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
