import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  createTelemetryModel,
  fetchLayout,
  fetchRaw,
} from "../../telemetry/document/telemetry-client";
import styles from "./styles/RcSubtitlesOverlay.module.css";

type RcSubtitlesConfig = {
  telemetryBaseUrl?: string;
  fieldPath?: string;
};

type RcSubtitlesProps = {
  config?: RcSubtitlesConfig;
};

export function RcSubtitlesOverlay({ config }: RcSubtitlesProps) {
  const [subtitle, setSubtitle] = useState("");
  const [visible, setVisible] = useState(false);
  const [animateKey, setAnimateKey] = useState(0);
  const lastTextRef = useRef("");

  const telemetryBaseUrl = config?.telemetryBaseUrl;
  const fieldPath = config?.fieldPath;

  if (!telemetryBaseUrl || !fieldPath) {
    console.warn(
      "[rc-subtitles] Missing module configuration (telemetryBaseUrl + fieldPath required)",
      config
    );
    return null;
  }

  const safeSubtitle = useMemo(() => normalizeForDisplay(subtitle), [subtitle]);

  useEffect(() => {
    let cachedLayout: any | null = null;
    let telemetryModel: any | null = null;
    let intervalId: number | undefined;
    let cancelled = false;

    async function poll() {
      try {
        if (!cachedLayout) {
          cachedLayout = await fetchLayout(telemetryBaseUrl);
          if (!cachedLayout) return;
          telemetryModel = createTelemetryModel(cachedLayout);
        }

        const { raw } = await fetchRaw(telemetryBaseUrl);
        if (!raw || !telemetryModel || cancelled) return;
        telemetryModel.raw = raw;

        const text = extractSubtitleText(telemetryModel, fieldPath);
        if (!text) return;

        const normalized = normalizeForDisplay(text);
        if (normalized !== lastTextRef.current) {
          lastTextRef.current = normalized;
          setSubtitle(normalized);
          setVisible(true);
          setAnimateKey((k) => (k + 1) % Number.MAX_SAFE_INTEGER);
        }
      } catch (err) {
        console.warn("[rc-subtitles] poll failed", err);
      }
    }

    poll();
    intervalId = window.setInterval(poll, 100);
    return () => {
      cancelled = true;
      if (intervalId) window.clearInterval(intervalId);
    };
  }, [fieldPath, telemetryBaseUrl]);

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

function extractSubtitleText(telemetryModel: any, fieldPath: string): string {
  if (!telemetryModel || !telemetryModel.getField) return "";
  const field = telemetryModel.getField(fieldPath);
  if (!field) return "";
  const value = field.getValue?.();
  return typeof value === "string" ? value : "";
}

function normalizeForDisplay(s: string): string {
  const trimmed = s.replace(/\r/g, "").trim();
  return trimmed.replace(/[ \t]{2,}/g, " ");
}
