import React from "react";

import { buildUrl } from "../../../../data-sources/launcher/internal/launcher-interface";
import {
  clipDataFromTelemetryMetadata,
  clipRefsFromAnimsetResponse,
  type AnimAuthoringActionResponse,
  type AnimLoadStatusLevel,
  type AnimSaveResponse,
  type AnimTelemetryAnimsetResponse,
  type AnimTelemetryClipResponse,
  type AnimTelemetryServicesResponse,
  type ClipData,
  type ClipRef,
} from "../anim-editor-shared";

type UseAnimTelemetryServiceArgs = {
  telemetryBaseUrl: string;
  preferredWorkloadName: string;
  selectedClipPath: string;
  reportAnimLoadStatus: (level: AnimLoadStatusLevel, message: string) => void;
  applyLoadedClipData: (nextClipData: ClipData) => void;
  setClipRefs: React.Dispatch<React.SetStateAction<ClipRef[]>>;
  setSelectedClipPath: React.Dispatch<React.SetStateAction<string>>;
  setAnimsetOptionsFromEngine: React.Dispatch<React.SetStateAction<string[]>>;
  setAnimsetPath: React.Dispatch<React.SetStateAction<string>>;
  setChannelsetPath: React.Dispatch<React.SetStateAction<string>>;
  setChannelsetId: React.Dispatch<React.SetStateAction<string>>;
  resetClipData: () => void;
};

export function useAnimTelemetryService({
  telemetryBaseUrl,
  preferredWorkloadName,
  selectedClipPath,
  reportAnimLoadStatus,
  applyLoadedClipData,
  setClipRefs,
  setSelectedClipPath,
  setAnimsetOptionsFromEngine,
  setAnimsetPath,
  setChannelsetPath,
  setChannelsetId,
  resetClipData,
}: UseAnimTelemetryServiceArgs) {
  const [animTelemetryServiceId, setAnimTelemetryServiceId] = React.useState("");

  const buildAnimServiceUrl = React.useCallback(
    (suffix = "", params?: Record<string, string | number | undefined>) => {
      if (!telemetryBaseUrl || !animTelemetryServiceId) return "";
      return buildUrl(
        telemetryBaseUrl,
        `/api/telemetry/services/${animTelemetryServiceId}${suffix}`,
        params
      );
    },
    [animTelemetryServiceId, telemetryBaseUrl]
  );

  const performAnimAuthoringAction = React.useCallback(
    async (suffix: string, body: Record<string, unknown>) => {
      const url = buildAnimServiceUrl(suffix);
      if (!url) {
        throw new Error("Missing animation authoring service URL");
      }
      const response = await fetch(url, {
        method: "POST",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        let errorText = `${suffix} failed: ${response.status}`;
        try {
          const payload = (await response.json()) as { error?: string };
          if (payload?.error) {
            errorText = payload.error;
          }
        } catch {
          // Ignore malformed error payloads and keep the HTTP status-based message.
        }
        throw new Error(errorText);
      }
      return (await response.json()) as AnimAuthoringActionResponse;
    },
    [buildAnimServiceUrl]
  );

  const performAnimSave = React.useCallback(async () => {
    const url = buildAnimServiceUrl("/save");
    if (!url) {
      throw new Error("Missing animation save service URL");
    }
    const response = await fetch(url, {
      method: "POST",
      cache: "no-store",
    });
    if (!response.ok) {
      let errorText = `save failed: ${response.status}`;
      try {
        const payload = (await response.json()) as { error?: string };
        if (payload?.error) {
          errorText = payload.error;
        }
      } catch {
        // Ignore malformed error payloads and keep the HTTP status-based message.
      }
      throw new Error(errorText);
    }
    return (await response.json()) as AnimSaveResponse;
  }, [buildAnimServiceUrl]);

  const reloadAnimsetClipRefs = React.useCallback(async () => {
    const url = buildAnimServiceUrl("/animset");
    if (!url) return;
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`Failed to load animset: ${response.status}`);
    }
    const payload = (await response.json()) as AnimTelemetryAnimsetResponse;
    const parsed = clipRefsFromAnimsetResponse(payload);
    setClipRefs(parsed);
    if (Array.isArray(payload.animset_options)) {
      setAnimsetOptionsFromEngine(payload.animset_options.filter((v) => typeof v === "string" && v.length > 0));
    }
    if (payload.animset_path) {
      setAnimsetPath(payload.animset_path);
    }
    if (payload.channelset_path) {
      setChannelsetPath(payload.channelset_path);
    }
    if (payload.channelset_id) {
      setChannelsetId(payload.channelset_id);
    }
    setSelectedClipPath((prev) => {
      if (prev && parsed.some((clip) => clip.animclipPath === prev)) {
        return prev;
      }
      return parsed.length > 0 ? parsed[0].animclipPath : "";
    });
  }, [
    buildAnimServiceUrl,
    setAnimsetOptionsFromEngine,
    setAnimsetPath,
    setChannelsetId,
    setChannelsetPath,
    setClipRefs,
    setSelectedClipPath,
  ]);

  const loadLiveClipData = React.useCallback(
    async (clipIndex: number, clipName?: string) => {
      if (!animTelemetryServiceId || clipIndex < 0) return null;
      const clipUrl = buildAnimServiceUrl("/clip", {
        clip_index: clipIndex,
      });
      if (!clipUrl) return null;
      const clipResponse = await fetch(clipUrl, { cache: "no-store" });
      if (!clipResponse.ok) {
        throw new Error(`Failed to load clip metadata: ${clipResponse.status}`);
      }
      const clipPayload = (await clipResponse.json()) as AnimTelemetryClipResponse;
      const metadata = clipDataFromTelemetryMetadata(clipPayload);
      const channelEntries = await Promise.all(
        Object.keys(metadata.channels).map(async (channel) => {
          const channelUrl = buildAnimServiceUrl("/samples", {
            clip_index: clipIndex,
            channel,
          });
          if (!channelUrl) {
            throw new Error("Missing samples URL");
          }
          const response = await fetch(channelUrl, { cache: "no-store" });
          if (!response.ok) {
            throw new Error(`Failed to load samples for '${channel}': ${response.status}`);
          }
          const sampleValues = new Float32Array(await response.arrayBuffer());
          return [channel, sampleValues] as const;
        })
      );
      const nextClipData: ClipData = {
        ...metadata,
        name: clipName?.trim() || metadata.name,
        channels: Object.fromEntries(channelEntries),
      };
      applyLoadedClipData(nextClipData);
      return nextClipData;
    },
    [animTelemetryServiceId, applyLoadedClipData, buildAnimServiceUrl]
  );

  React.useEffect(() => {
    let cancelled = false;
    async function discoverAnimService() {
      if (!telemetryBaseUrl) {
        setAnimTelemetryServiceId("");
        setClipRefs([]);
        resetClipData();
        return;
      }
      try {
        const response = await fetch(buildUrl(telemetryBaseUrl, "/api/telemetry/services"), {
          cache: "no-store",
        });
        if (!response.ok) {
          throw new Error(`Failed to load services: ${response.status}`);
        }
        const payload = (await response.json()) as AnimTelemetryServicesResponse;
        if (cancelled) return;
        const services = (payload.services ?? []).filter((service) => service.service_type === "anim");
        const exactDisplay = services.find((service) => service.display_name === preferredWorkloadName);
        const exactServiceId = services.find((service) => service.service_id === `anim:${preferredWorkloadName}`);
        const fallback = services[0];
        const nextServiceId = exactDisplay?.service_id ?? exactServiceId?.service_id ?? fallback?.service_id ?? "";
        setAnimTelemetryServiceId(nextServiceId);
        if (nextServiceId.length === 0) {
          reportAnimLoadStatus("warning", "No anim telemetry service found. Check Terminal logs.");
        }
      } catch {
        if (cancelled) return;
        setAnimTelemetryServiceId("");
        reportAnimLoadStatus("error", "Failed to discover anim telemetry services. Check Terminal logs.");
      }
    }
    void discoverAnimService();
    return () => {
      cancelled = true;
    };
  }, [preferredWorkloadName, reportAnimLoadStatus, resetClipData, setClipRefs, telemetryBaseUrl]);

  React.useEffect(() => {
    if (!animTelemetryServiceId) return;
    void reloadAnimsetClipRefs().catch(() => {
      reportAnimLoadStatus("error", "Failed to load Anim Set metadata. Check Terminal logs.");
    });
  }, [animTelemetryServiceId, reloadAnimsetClipRefs, reportAnimLoadStatus]);

  React.useEffect(() => {
    if (!animTelemetryServiceId) return;
    if (selectedClipPath) return;
    const timer = setTimeout(() => {
      void reloadAnimsetClipRefs().catch(() => {
        reportAnimLoadStatus("warning", "Anim Set data not ready yet. Check Terminal logs if this persists.");
      });
    }, 900);
    return () => clearTimeout(timer);
  }, [animTelemetryServiceId, reloadAnimsetClipRefs, reportAnimLoadStatus, selectedClipPath]);

  return {
    animTelemetryServiceId,
    buildAnimServiceUrl,
    loadLiveClipData,
    performAnimAuthoringAction,
    performAnimSave,
    reloadAnimsetClipRefs,
  };
}
