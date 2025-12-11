type SetIntervalHandle = ReturnType<typeof setInterval>;

type Scheduler = {
  setInterval: (handler: () => void, interval: number) => SetIntervalHandle;
  clearInterval: (handle: SetIntervalHandle) => void;
};

const defaultScheduler: Scheduler = {
  setInterval: (handler, interval) => {
    const set = globalThis.setInterval ?? setInterval;
    return set(handler, interval);
  },
  clearInterval: (handle) => {
    const clear = globalThis.clearInterval ?? clearInterval;
    clear(handle);
  },
};

export type PollingTask = {
  start: (options?: { immediate?: boolean }) => void;
  stop: () => void;
  flush: () => Promise<void>;
  setIntervalMs: (
    intervalMs: number,
    options?: { immediate?: boolean }
  ) => void;
  getIntervalMs: () => number;
  isRunning: () => boolean;
};

export type PollingTaskOptions = {
  intervalMs?: number;
  runImmediately?: boolean;
  scheduler?: Scheduler;
  onError?: (error: unknown) => void;
};

export function createPollingTask(
  handler: () => void | Promise<void>,
  options: PollingTaskOptions = {}
): PollingTask {
  const scheduler = options.scheduler ?? defaultScheduler;
  let intervalMs = Math.max(1, Math.floor(options.intervalMs ?? 1000));
  let timer: SetIntervalHandle | null = null;
  let running = false;
  let pending: Promise<void> | null = null;
  const defaultImmediate = options.runImmediately ?? true;

  const handleError = (error: unknown) => {
    if (options.onError) {
      options.onError(error);
      return;
    }
    console.warn("[polling] handler error", error);
  };

  const invoke = () => {
    if (pending) {
      return pending;
    }
    try {
      const result = handler();
      if (result && typeof (result as Promise<unknown>).then === "function") {
        pending = (result as Promise<void>)
          .catch((error) => {
            handleError(error);
          })
          .finally(() => {
            pending = null;
          });
        return pending;
      }
    } catch (error) {
      handleError(error);
    }
    pending = Promise.resolve().finally(() => {
      pending = null;
    });
    return pending;
  };

  const start = ({ immediate }: { immediate?: boolean } = {}) => {
    if (running) return;
    running = true;
    const shouldRun = immediate ?? defaultImmediate;
    if (shouldRun) {
      void invoke();
    }
    timer = scheduler.setInterval(() => {
      void invoke();
    }, intervalMs);
  };

  const stop = () => {
    if (!running) return;
    running = false;
    if (timer !== null) {
      scheduler.clearInterval(timer);
      timer = null;
    }
  };

  const setIntervalMs = (next: number, options?: { immediate?: boolean }) => {
    const safe = Math.max(1, Math.floor(next));
    intervalMs = safe;
    if (running) {
      stop();
      start({ immediate: options?.immediate });
    }
  };

  const flush = async () => {
    await invoke();
  };

  const getIntervalMs = () => intervalMs;

  return {
    start,
    stop,
    flush,
    setIntervalMs,
    getIntervalMs,
    isRunning: () => running,
  };
}
