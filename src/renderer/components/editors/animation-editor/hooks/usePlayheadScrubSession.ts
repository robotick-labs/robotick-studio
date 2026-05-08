import React from "react";

const SCRUB_MIN_SEND_INTERVAL_MS = 50;

export function usePlayheadScrubSession(args: {
  setAnimControlConnectionState: (fieldName: string, enabled: boolean) => Promise<boolean>;
  writeAnimControlFieldRaw: (fieldName: string, value: unknown) => Promise<boolean>;
  localScrubTimeSec: number | null;
  setPendingScrubAdoptSec: React.Dispatch<React.SetStateAction<number | null>>;
  setLocalScrubTimeSec: React.Dispatch<React.SetStateAction<number | null>>;
  heldSuppressedAnimControlFieldsRef: React.MutableRefObject<Set<string>>;
}) {
  const {
    setAnimControlConnectionState,
    writeAnimControlFieldRaw,
    localScrubTimeSec,
    setPendingScrubAdoptSec,
    setLocalScrubTimeSec,
    heldSuppressedAnimControlFieldsRef,
  } = args;

  const scrubWriteStateRef = React.useRef<{
    active: boolean;
    pendingValueSec: number | null;
    inFlight: boolean;
    lastSentAtMs: number;
    timerId: ReturnType<typeof setTimeout> | null;
    connectionSuppressed: boolean;
  }>({
    active: false,
    pendingValueSec: null,
    inFlight: false,
    lastSentAtMs: 0,
    timerId: null,
    connectionSuppressed: false,
  });

  const clearScrubTimer = React.useCallback(() => {
    const state = scrubWriteStateRef.current;
    if (state.timerId !== null) {
      clearTimeout(state.timerId);
      state.timerId = null;
    }
  }, []);

  const flushScrubTimeOverride = React.useCallback(
    async (force: boolean) => {
      const state = scrubWriteStateRef.current;
      if (!state.active && !force) return;
      if (state.inFlight) return;
      if (state.pendingValueSec === null) return;

      const now = Date.now();
      const elapsed = now - state.lastSentAtMs;
      if (!force && elapsed < SCRUB_MIN_SEND_INTERVAL_MS) {
        if (state.timerId === null) {
          state.timerId = setTimeout(() => {
            state.timerId = null;
            void flushScrubTimeOverride(false);
          }, SCRUB_MIN_SEND_INTERVAL_MS - elapsed);
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
        void flushScrubTimeOverride(false);
      }
    },
    [writeAnimControlFieldRaw]
  );

  const beginScrubSession = React.useCallback(async () => {
    const state = scrubWriteStateRef.current;
    state.active = true;
    state.pendingValueSec = null;
    clearScrubTimer();
    if (!state.connectionSuppressed) {
      const suppressed = await setAnimControlConnectionState("time_override_sec", false);
      state.connectionSuppressed = suppressed;
    }
  }, [clearScrubTimer, setAnimControlConnectionState]);

  const queueScrubTimeOverride = React.useCallback(
    (valueSec: number) => {
      const state = scrubWriteStateRef.current;
      state.pendingValueSec = valueSec;
      void flushScrubTimeOverride(false);
    },
    [flushScrubTimeOverride]
  );

  const endScrubSession = React.useCallback(async () => {
    const state = scrubWriteStateRef.current;
    state.active = false;
    clearScrubTimer();
    await flushScrubTimeOverride(true);
    if (state.connectionSuppressed) {
      await setAnimControlConnectionState("time_override_sec", true);
      state.connectionSuppressed = false;
    }
    if (localScrubTimeSec !== null) {
      setPendingScrubAdoptSec(localScrubTimeSec);
      setTimeout(() => {
        setPendingScrubAdoptSec((current) => {
          if (current !== null) {
            setLocalScrubTimeSec(null);
          }
          return null;
        });
      }, 900);
    } else {
      setLocalScrubTimeSec(null);
    }
  }, [
    clearScrubTimer,
    flushScrubTimeOverride,
    localScrubTimeSec,
    setAnimControlConnectionState,
    setLocalScrubTimeSec,
    setPendingScrubAdoptSec,
  ]);

  React.useEffect(
    () => () => {
      const state = scrubWriteStateRef.current;
      state.active = false;
      clearScrubTimer();
      if (state.connectionSuppressed) {
        void setAnimControlConnectionState("time_override_sec", true);
        state.connectionSuppressed = false;
      }
      const heldFields = Array.from(heldSuppressedAnimControlFieldsRef.current);
      heldSuppressedAnimControlFieldsRef.current.clear();
      heldFields.forEach((fieldName) => {
        void setAnimControlConnectionState(fieldName, true);
      });
    },
    [clearScrubTimer, heldSuppressedAnimControlFieldsRef, setAnimControlConnectionState]
  );

  return {
    beginScrubSession,
    queueScrubTimeOverride,
    endScrubSession,
  };
}
