import React from "react";

import type { AnimLoadStatusLevel, ClipData, ClipRef } from "../anim-editor-shared";

type UseSelectedClipLoaderArgs = {
  animTelemetryServiceId: string;
  clipDataRef: React.RefObject<ClipData>;
  clipRefs: ClipRef[];
  loadLiveClipData: (clipIndex: number, clipName?: string) => Promise<ClipData | null>;
  applyLoadedClipData: (nextClipData: ClipData) => void;
  reportAnimLoadStatus: (level: AnimLoadStatusLevel, message: string) => void;
  selectedClipPath: string;
};

export function useSelectedClipLoader({
  animTelemetryServiceId,
  clipDataRef,
  clipRefs,
  loadLiveClipData,
  applyLoadedClipData,
  reportAnimLoadStatus,
  selectedClipPath,
}: UseSelectedClipLoaderArgs) {
  const selectedClipPathRef = React.useRef(selectedClipPath);
  const loadRequestSerialRef = React.useRef(0);

  React.useEffect(() => {
    selectedClipPathRef.current = selectedClipPath;
  }, [selectedClipPath]);

  React.useEffect(() => {
    let cancelled = false;

    async function loadSelectedClip() {
      if (!animTelemetryServiceId || !selectedClipPath) return;
      const selectedClip = clipRefs.find((clip) => clip.animclipPath === selectedClipPath) ?? null;
      const clipIndex = selectedClip ? clipRefs.findIndex((clip) => clip.animclipPath === selectedClip.animclipPath) : -1;
      if (clipIndex < 0) return;

      const requestSerial = loadRequestSerialRef.current + 1;
      loadRequestSerialRef.current = requestSerial;
      const requestedClipPath = selectedClipPath;
      const parsed = await loadLiveClipData(clipIndex, selectedClip?.name);
      if (cancelled || !parsed) return;
      if (loadRequestSerialRef.current !== requestSerial) return;
      if (selectedClipPathRef.current !== requestedClipPath) return;

      const currentClip = clipDataRef.current;
      if (currentClip?.dirty && currentClip.animclipPath === requestedClipPath) {
        return;
      }

      applyLoadedClipData(parsed);
    }

    void loadSelectedClip().catch(() => {
      if (cancelled) return;
      reportAnimLoadStatus("error", "Failed to load clip samples. Check Terminal logs.");
    });

    return () => {
      cancelled = true;
    };
  }, [
    animTelemetryServiceId,
    applyLoadedClipData,
    clipDataRef,
    clipRefs,
    loadLiveClipData,
    reportAnimLoadStatus,
    selectedClipPath,
  ]);
}
