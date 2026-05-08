import React from "react";

type ClipRef = { name: string; animclipPath: string };
type ClipData = {
  name: string;
  channels: Record<string, Float32Array>;
  durationSec: number;
  sampleCount: number;
  liveSampleRateHz: number;
  clipRevision: string;
  dirty: boolean;
};

type DrawWriteState = {
  clipIndex: number;
  channel: string;
  queuedStartSampleIndex: number | null;
  queuedEndSampleIndex: number | null;
  inFlight: boolean;
  timerId: ReturnType<typeof setTimeout> | null;
  acceptedClipRevision: string;
};

export function useClipWriteQueue(args: {
  clipDataRef: React.MutableRefObject<ClipData>;
  clipRefs: ClipRef[];
  loadLiveClipData: (clipIndex: number, clipNameHint?: string) => Promise<{ clipRevision: string } | null>;
  buildAnimServiceUrl: (suffix?: string, params?: Record<string, string | number | undefined>) => string;
  scheduleClipDataRender: (nextClipData: ClipData) => void;
}) {
  const {
    clipDataRef,
    clipRefs,
    loadLiveClipData,
    buildAnimServiceUrl,
    scheduleClipDataRender,
  } = args;

  const drawWriteStateRef = React.useRef<DrawWriteState>({
    clipIndex: -1,
    channel: "",
    queuedStartSampleIndex: null,
    queuedEndSampleIndex: null,
    inFlight: false,
    timerId: null,
    acceptedClipRevision: "0",
  });

  const clearDrawFlushTimer = React.useCallback(() => {
    const state = drawWriteStateRef.current;
    if (state.timerId !== null) {
      clearTimeout(state.timerId);
      state.timerId = null;
    }
  }, []);

  const beginDrawStrokeSession = React.useCallback((clipIndex: number, channel: string) => {
    const state = drawWriteStateRef.current;
    state.clipIndex = clipIndex;
    state.channel = channel;
    state.queuedStartSampleIndex = null;
    state.queuedEndSampleIndex = null;
    state.acceptedClipRevision = clipDataRef.current.clipRevision;
  }, [clipDataRef]);

  const refreshSelectedClipFromEngine = React.useCallback(
    async (clipIndex: number) => {
      const clipRef = clipRefs[clipIndex];
      if (!clipRef) return;
      const loaded = await loadLiveClipData(clipIndex, clipRef.name);
      if (loaded) {
        drawWriteStateRef.current.acceptedClipRevision = loaded.clipRevision;
      }
    },
    [clipRefs, loadLiveClipData]
  );

  const writeSampleRange = React.useCallback(
    async (
      clipIndex: number,
      channel: string,
      startSampleIndex: number,
      endSampleIndex: number
    ) => {
      const currentClip = clipDataRef.current;
      const channelSamples = currentClip.channels[channel] ?? new Float32Array(0);
      if (
        startSampleIndex < 0 ||
        endSampleIndex < startSampleIndex ||
        endSampleIndex >= channelSamples.length
      ) {
        throw new Error("Invalid sample range");
      }
      const url = buildAnimServiceUrl("/samples-write-range", {
        clip_index: clipIndex >= 0 ? clipIndex : undefined,
      });
      if (!url) {
        throw new Error("Missing samples-write-range URL");
      }
      const response = await fetch(url, {
        method: "POST",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clip_revision: drawWriteStateRef.current.acceptedClipRevision,
          channel,
          start_sample_index: startSampleIndex,
          values: Array.from(
            channelSamples.subarray(startSampleIndex, endSampleIndex + 1)
          ),
        }),
      });
      const payload = (await response.json()) as {
        clip_revision?: string;
        error?: string;
      };
      if (!response.ok) {
        if (response.status === 409 && typeof payload.clip_revision === "string") {
          drawWriteStateRef.current.acceptedClipRevision = payload.clip_revision;
        }
        throw new Error(`Failed to write live samples: ${response.status}`);
      }
      if (typeof payload.clip_revision === "string") {
        drawWriteStateRef.current.acceptedClipRevision = payload.clip_revision;
      }
      scheduleClipDataRender({
        ...clipDataRef.current,
        clipRevision: drawWriteStateRef.current.acceptedClipRevision,
        dirty: true,
      });
    },
    [buildAnimServiceUrl, clipDataRef, scheduleClipDataRender]
  );

  const flushDrawStroke = React.useCallback(
    async (force: boolean) => {
      const state = drawWriteStateRef.current;
      if (
        state.inFlight ||
        state.queuedStartSampleIndex === null ||
        state.queuedEndSampleIndex === null ||
        !state.channel
      ) {
        return;
      }

      const clipIndex = state.clipIndex;
      const channel = state.channel;
      const startSampleIndex = state.queuedStartSampleIndex;
      const endSampleIndex = state.queuedEndSampleIndex;
      const clipRevision = state.acceptedClipRevision;
      state.queuedStartSampleIndex = null;
      state.queuedEndSampleIndex = null;
      state.inFlight = true;
      try {
        state.acceptedClipRevision = clipRevision;
        await writeSampleRange(clipIndex, channel, startSampleIndex, endSampleIndex);
      } catch (error) {
        console.warn("Live draw request failed", {
          clipIndex,
          channel,
          startSampleIndex,
          endSampleIndex,
          error,
        });
        state.queuedStartSampleIndex = null;
        state.queuedEndSampleIndex = null;
        void refreshSelectedClipFromEngine(clipIndex).catch(() => undefined);
      } finally {
        state.inFlight = false;
        if (state.queuedStartSampleIndex !== null && state.queuedEndSampleIndex !== null) {
          if (force) {
            void flushDrawStroke(true);
          } else {
            state.timerId = setTimeout(() => {
              state.timerId = null;
              void flushDrawStroke(false);
            }, 40);
          }
        }
      }
    },
    [refreshSelectedClipFromEngine, writeSampleRange]
  );

  const queueDrawStrokeRange = React.useCallback(
    (
      clipIndex: number,
      channel: string,
      startSampleIndex: number,
      endSampleIndex: number
    ) => {
      const state = drawWriteStateRef.current;
      if (state.channel !== channel || state.clipIndex !== clipIndex) {
        state.clipIndex = clipIndex;
        state.channel = channel;
        state.queuedStartSampleIndex = null;
        state.queuedEndSampleIndex = null;
      }
      if (endSampleIndex < startSampleIndex) {
        return;
      }
      state.queuedStartSampleIndex =
        state.queuedStartSampleIndex === null
          ? startSampleIndex
          : Math.min(state.queuedStartSampleIndex, startSampleIndex);
      state.queuedEndSampleIndex =
        state.queuedEndSampleIndex === null
          ? endSampleIndex
          : Math.max(state.queuedEndSampleIndex, endSampleIndex);
      if (
        state.queuedStartSampleIndex !== null &&
        state.queuedEndSampleIndex !== null &&
        state.queuedEndSampleIndex - state.queuedStartSampleIndex >= 8
      ) {
        clearDrawFlushTimer();
        void flushDrawStroke(false);
        return;
      }
      if (state.timerId === null) {
        state.timerId = setTimeout(() => {
          state.timerId = null;
          void flushDrawStroke(false);
        }, 40);
      }
    },
    [clearDrawFlushTimer, flushDrawStroke]
  );

  return {
    drawWriteStateRef,
    clearDrawFlushTimer,
    beginDrawStrokeSession,
    flushDrawStroke,
    queueDrawStrokeRange,
  };
}
