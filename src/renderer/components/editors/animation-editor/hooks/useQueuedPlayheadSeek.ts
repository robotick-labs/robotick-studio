import React from "react";

const SEEK_MIN_SEND_INTERVAL_MS = 50;
const SEEK_IDLE_RELEASE_MS = 90;
const SEEK_LOCAL_CLEAR_DELAY_MS = 120;

type Args = {
  durationSec: number;
  setAnimControlConnectionState: (fieldName: string, enabled: boolean) => Promise<boolean>;
  setLocalScrubTimeSec: React.Dispatch<React.SetStateAction<number | null>>;
  writeAnimControlFieldRaw: (fieldName: string, value: unknown) => Promise<boolean>;
};

export function useQueuedPlayheadSeek(args: Args) {
  const { durationSec, setAnimControlConnectionState, setLocalScrubTimeSec, writeAnimControlFieldRaw } = args;

  const seekStateRef = React.useRef<{
    active: boolean;
    sessionId: number;
    pendingValueSec: number | null;
    inFlight: boolean;
    lastSentAtMs: number;
    flushTimerId: ReturnType<typeof setTimeout> | null;
    idleTimerId: ReturnType<typeof setTimeout> | null;
    clearLocalTimerId: ReturnType<typeof setTimeout> | null;
    connectionSuppressed: boolean;
    suppressInFlight: Promise<void> | null;
  }>({
    active: false,
    sessionId: 0,
    pendingValueSec: null,
    inFlight: false,
    lastSentAtMs: 0,
    flushTimerId: null,
    idleTimerId: null,
    clearLocalTimerId: null,
    connectionSuppressed: false,
    suppressInFlight: null,
  });

  const clearFlushTimer = React.useCallback(() => {
    const state = seekStateRef.current;
    if (state.flushTimerId !== null) {
      clearTimeout(state.flushTimerId);
      state.flushTimerId = null;
    }
  }, []);

  const clearIdleTimer = React.useCallback(() => {
    const state = seekStateRef.current;
    if (state.idleTimerId !== null) {
      clearTimeout(state.idleTimerId);
      state.idleTimerId = null;
    }
  }, []);

  const clearLocalTimer = React.useCallback(() => {
    const state = seekStateRef.current;
    if (state.clearLocalTimerId !== null) {
      clearTimeout(state.clearLocalTimerId);
      state.clearLocalTimerId = null;
    }
  }, []);

  const flushPendingSeek = React.useCallback(
    async (force: boolean) => {
      const state = seekStateRef.current;
      if (!state.active && !force) return;
      if (state.inFlight) return;
      if (state.pendingValueSec === null) return;

      const now = Date.now();
      const elapsed = now - state.lastSentAtMs;
      if (!force && elapsed < SEEK_MIN_SEND_INTERVAL_MS) {
        if (state.flushTimerId === null) {
          state.flushTimerId = setTimeout(() => {
            state.flushTimerId = null;
            void flushPendingSeek(false);
          }, SEEK_MIN_SEND_INTERVAL_MS - elapsed);
        }
        return;
      }

      const valueToSend = state.pendingValueSec;
      state.pendingValueSec = null;
      state.inFlight = true;
      const ok = await writeAnimControlFieldRaw("time_override_sec", valueToSend);
      if (ok) {
        state.lastSentAtMs = Date.now();
      }
      state.inFlight = false;

      if (state.pendingValueSec !== null) {
        void flushPendingSeek(false);
      }
    },
    [writeAnimControlFieldRaw]
  );

  const ensureSuppressed = React.useCallback(async () => {
    const state = seekStateRef.current;
    if (state.connectionSuppressed) return;
    if (state.suppressInFlight) {
      await state.suppressInFlight;
      return;
    }
    state.suppressInFlight = (async () => {
      const suppressed = await setAnimControlConnectionState("time_override_sec", false);
      state.connectionSuppressed = suppressed;
      state.suppressInFlight = null;
    })();
    await state.suppressInFlight;
  }, [setAnimControlConnectionState]);

  const endSeekSession = React.useCallback(
    async (sessionId: number) => {
      const state = seekStateRef.current;
      if (state.sessionId !== sessionId || !state.active) return;
      state.active = false;
      clearFlushTimer();
      clearIdleTimer();
      await flushPendingSeek(true);
      if (state.connectionSuppressed) {
        await setAnimControlConnectionState("time_override_sec", true);
        state.connectionSuppressed = false;
      }
      clearLocalTimer();
      state.clearLocalTimerId = setTimeout(() => {
        if (seekStateRef.current.sessionId !== sessionId || seekStateRef.current.active) return;
        setLocalScrubTimeSec(null);
        seekStateRef.current.clearLocalTimerId = null;
      }, SEEK_LOCAL_CLEAR_DELAY_MS);
    },
    [
      clearFlushTimer,
      clearIdleTimer,
      clearLocalTimer,
      flushPendingSeek,
      setAnimControlConnectionState,
      setLocalScrubTimeSec,
    ]
  );

  const seekPlayheadToTimeSec = React.useCallback(
    (nextTimeSec: number) => {
      const clamped = Math.min(durationSec, Math.max(0, nextTimeSec));
      const state = seekStateRef.current;
      if (!state.active) {
        state.active = true;
        state.sessionId += 1;
        void ensureSuppressed();
      }
      clearLocalTimer();
      setLocalScrubTimeSec(clamped);
      state.pendingValueSec = clamped;
      clearIdleTimer();
      const sessionId = state.sessionId;
      state.idleTimerId = setTimeout(() => {
        state.idleTimerId = null;
        void endSeekSession(sessionId);
      }, SEEK_IDLE_RELEASE_MS);
      void flushPendingSeek(false);
    },
    [
      clearIdleTimer,
      clearLocalTimer,
      durationSec,
      endSeekSession,
      ensureSuppressed,
      flushPendingSeek,
      setLocalScrubTimeSec,
    ]
  );

  React.useEffect(
    () => () => {
      const state = seekStateRef.current;
      state.active = false;
      clearFlushTimer();
      clearIdleTimer();
      clearLocalTimer();
      if (state.connectionSuppressed) {
        void setAnimControlConnectionState("time_override_sec", true);
        state.connectionSuppressed = false;
      }
    },
    [clearFlushTimer, clearIdleTimer, clearLocalTimer, setAnimControlConnectionState]
  );

  return { seekPlayheadToTimeSec };
}
