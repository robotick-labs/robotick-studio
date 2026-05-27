import React from "react";

type ClipRef = { name: string; animclipPath: string };
type ClipData = {
  animclipPath: string;
  name: string;
  channels: Record<string, Float32Array>;
  durationSec: number;
  loopResetDurationSec: number;
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
  beginInFlight: Promise<string | null> | null;
  inFlightPromise: Promise<void> | null;
  timerId: ReturnType<typeof setTimeout> | null;
  acceptedClipRevision: string;
  transactionId: string | null;
  sessionSerial: number;
  finalizeInFlightPromise: Promise<void> | null;
};

export function useClipWriteQueue(args: {
  clipDataRef: React.MutableRefObject<ClipData>;
  clipRefs: ClipRef[];
  loadLiveClipData: (clipIndex: number, clipNameHint?: string) => Promise<ClipData | null>;
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
    beginInFlight: null,
    inFlightPromise: null,
    timerId: null,
    acceptedClipRevision: "0",
    transactionId: null,
    sessionSerial: 0,
    finalizeInFlightPromise: null,
  });

  const clearDrawFlushTimer = React.useCallback(() => {
    const state = drawWriteStateRef.current;
    if (state.timerId !== null) {
      clearTimeout(state.timerId);
      state.timerId = null;
    }
  }, []);

  const errorTextFromPayload = React.useCallback((payload: { error?: string } | null | undefined, fallback: string) => {
    return typeof payload?.error === "string" && payload.error.length > 0 ? payload.error : fallback;
  }, []);

  const beginDrawStrokeSession = React.useCallback((clipIndex: number, channel: string) => {
    const state = drawWriteStateRef.current;
    if (state.beginInFlight || state.inFlightPromise || state.finalizeInFlightPromise || state.transactionId) {
      return false;
    }
    state.clipIndex = clipIndex;
    state.channel = channel;
    state.queuedStartSampleIndex = null;
    state.queuedEndSampleIndex = null;
    state.acceptedClipRevision = clipDataRef.current.clipRevision;
    state.transactionId = null;
    state.beginInFlight = null;
    state.inFlightPromise = null;
    state.sessionSerial += 1;
    return true;
  }, [clipDataRef]);

  const beginEditTransaction = React.useCallback(
    async (clipIndex: number) => {
      const state = drawWriteStateRef.current;
      if (state.transactionId) return state.transactionId;
      if (state.beginInFlight) {
        return state.beginInFlight;
      }
      const url = buildAnimServiceUrl("/begin-edit");
      if (!url) {
        throw new Error("Missing begin-edit URL");
      }
      const sessionSerial = state.sessionSerial;
      state.beginInFlight = (async () => {
        const response = await fetch(url, {
          method: "POST",
          cache: "no-store",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            clip_index: clipIndex,
            expected_clip_revision: state.acceptedClipRevision,
          }),
        });
        const payload = (await response.json()) as {
          transaction_id?: string;
          clip_revision?: string;
          error?: string;
        };
        if (!response.ok) {
          if (response.status === 409 && typeof payload.clip_revision === "string") {
            state.acceptedClipRevision = payload.clip_revision;
          }
          throw new Error(errorTextFromPayload(payload, `Failed to begin edit transaction: ${response.status}`));
        }
        if (state.sessionSerial !== sessionSerial) {
          return null;
        }
        state.transactionId = typeof payload.transaction_id === "string" ? payload.transaction_id : null;
        if (typeof payload.clip_revision === "string") {
          state.acceptedClipRevision = payload.clip_revision;
        }
        return state.transactionId;
      })();
      try {
        return await state.beginInFlight;
      } finally {
        state.beginInFlight = null;
      }
    },
    [buildAnimServiceUrl, errorTextFromPayload]
  );

  const refreshSelectedClipFromEngine = React.useCallback(
    async (clipIndex: number) => {
      const clipRef = clipRefs[clipIndex];
      if (!clipRef) return;
      const loaded = await loadLiveClipData(clipIndex, clipRef.name);
      if (loaded) {
        drawWriteStateRef.current.acceptedClipRevision = loaded.clipRevision;
        scheduleClipDataRender(loaded);
      }
    },
    [clipRefs, loadLiveClipData, scheduleClipDataRender]
  );

  const writePreviewRange = React.useCallback(
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
      const transactionId = await beginEditTransaction(clipIndex);
      if (!transactionId) {
        return;
      }
      const values = Array.from(
        channelSamples.subarray(startSampleIndex, endSampleIndex + 1)
      );
      const url = buildAnimServiceUrl("/apply-preview-delta");
      if (!url) {
        throw new Error("Missing apply-preview-delta URL");
      }
      const response = await fetch(url, {
        method: "POST",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          transaction_id: transactionId,
          operation: "replace_sample_range",
          expected_clip_revision: drawWriteStateRef.current.acceptedClipRevision,
          target: {
            start_sample_index: startSampleIndex,
            end_sample_index: endSampleIndex,
          },
          parameters: {
            channel_values: [
              {
                channel,
                values,
              },
            ],
          },
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
        throw new Error(errorTextFromPayload(payload, `Failed to apply preview delta: ${response.status}`));
      }
    },
    [beginEditTransaction, buildAnimServiceUrl, clipDataRef, errorTextFromPayload]
  );

  const flushPreviewStroke = React.useCallback(
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
      state.inFlightPromise = (async () => {
        try {
          state.acceptedClipRevision = clipRevision;
          await writePreviewRange(clipIndex, channel, startSampleIndex, endSampleIndex);
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
          const activeTransactionId = state.transactionId;
          state.transactionId = null;
          if (activeTransactionId) {
            const cancelUrl = buildAnimServiceUrl("/cancel-edit");
            if (cancelUrl) {
              await fetch(cancelUrl, {
                method: "POST",
                cache: "no-store",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ transaction_id: activeTransactionId }),
              }).catch(() => undefined);
            }
          }
          void refreshSelectedClipFromEngine(clipIndex).catch(() => undefined);
        } finally {
          state.inFlight = false;
          state.inFlightPromise = null;
          if (state.queuedStartSampleIndex !== null && state.queuedEndSampleIndex !== null) {
            if (force) {
              void flushPreviewStroke(true);
            } else {
              state.timerId = setTimeout(() => {
                state.timerId = null;
                void flushPreviewStroke(false);
              }, 40);
            }
          }
        }
      })();
      try {
        await state.inFlightPromise;
      } finally {
      }
    },
    [buildAnimServiceUrl, refreshSelectedClipFromEngine, writePreviewRange]
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
        void flushPreviewStroke(false);
        return;
      }
      if (state.timerId === null) {
        state.timerId = setTimeout(() => {
          state.timerId = null;
          void flushPreviewStroke(false);
        }, 40);
      }
    },
    [clearDrawFlushTimer, flushPreviewStroke]
  );

  const waitForInFlightPreview = React.useCallback(async () => {
    const state = drawWriteStateRef.current;
    while (state.inFlightPromise) {
      await state.inFlightPromise;
    }
  }, []);

  const commitDrawStrokeSession = React.useCallback(async () => {
    const state = drawWriteStateRef.current;
    if (state.finalizeInFlightPromise) {
      await state.finalizeInFlightPromise;
      return;
    }
    const finalizePromise = (async () => {
      clearDrawFlushTimer();
      await flushPreviewStroke(true);
      await waitForInFlightPreview();
      const activeState = drawWriteStateRef.current;
      if (!activeState.transactionId) {
        return;
      }
      const transactionId = activeState.transactionId;
      const url = buildAnimServiceUrl("/commit-edit");
      if (!url) {
        throw new Error("Missing commit-edit URL");
      }
      const response = await fetch(url, {
        method: "POST",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transaction_id: transactionId }),
      });
      const payload = (await response.json()) as { clip_revision?: string; error?: string };
      if (!response.ok) {
        if (response.status === 409 && typeof payload.clip_revision === "string") {
          activeState.acceptedClipRevision = payload.clip_revision;
        }
        activeState.transactionId = null;
        throw new Error(errorTextFromPayload(payload, `Failed to commit edit transaction: ${response.status}`));
      }
      activeState.transactionId = null;
      if (typeof payload.clip_revision === "string") {
        activeState.acceptedClipRevision = payload.clip_revision;
      }
      scheduleClipDataRender({
        ...clipDataRef.current,
        clipRevision: activeState.acceptedClipRevision,
        dirty: true,
      });
    })();
    state.finalizeInFlightPromise = finalizePromise;
    try {
      await finalizePromise;
    } finally {
      if (drawWriteStateRef.current.finalizeInFlightPromise === finalizePromise) {
        drawWriteStateRef.current.finalizeInFlightPromise = null;
      }
    }
  }, [buildAnimServiceUrl, clearDrawFlushTimer, clipDataRef, errorTextFromPayload, flushPreviewStroke, scheduleClipDataRender, waitForInFlightPreview]);

  const cancelDrawStrokeSession = React.useCallback(async () => {
    const state = drawWriteStateRef.current;
    if (state.finalizeInFlightPromise) {
      await state.finalizeInFlightPromise;
      return;
    }
    const finalizePromise = (async () => {
      clearDrawFlushTimer();
      state.queuedStartSampleIndex = null;
      state.queuedEndSampleIndex = null;
      await waitForInFlightPreview();
      if (!state.transactionId) {
        return;
      }
      const transactionId = state.transactionId;
      const url = buildAnimServiceUrl("/cancel-edit");
      if (!url) {
        throw new Error("Missing cancel-edit URL");
      }
      const response = await fetch(url, {
        method: "POST",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transaction_id: transactionId }),
      });
      state.transactionId = null;
      const payload = (await response.json().catch(() => ({}) as { error?: string })) as { error?: string };
      if (!response.ok) {
        throw new Error(errorTextFromPayload(payload, `Failed to cancel edit transaction: ${response.status}`));
      }
    })();
    state.finalizeInFlightPromise = finalizePromise;
    try {
      await finalizePromise;
    } finally {
      if (drawWriteStateRef.current.finalizeInFlightPromise === finalizePromise) {
        drawWriteStateRef.current.finalizeInFlightPromise = null;
      }
    }
  }, [buildAnimServiceUrl, clearDrawFlushTimer, errorTextFromPayload, waitForInFlightPreview]);

  React.useEffect(
    () => () => {
      const state = drawWriteStateRef.current;
      clearDrawFlushTimer();
      if (!state.transactionId) {
        return;
      }
      const url = buildAnimServiceUrl("/cancel-edit");
      if (!url) {
        return;
      }
      void fetch(url, {
        method: "POST",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transaction_id: state.transactionId }),
      }).catch(() => undefined);
    },
    [buildAnimServiceUrl, clearDrawFlushTimer]
  );

  return {
    drawWriteStateRef,
    clearDrawFlushTimer,
    beginDrawStrokeSession,
    commitDrawStrokeSession,
    cancelDrawStrokeSession,
    queueDrawStrokeRange,
  };
}
