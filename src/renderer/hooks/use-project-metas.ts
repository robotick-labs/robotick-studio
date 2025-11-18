import { useEffect, useState } from "react";
import { fetchProjectMetas, ProjectMeta } from "../core/projects-api";

type MetasState = {
  projects: ProjectMeta[];
  loading: boolean;
  error: string | null;
};

const listeners = new Set<(state: MetasState) => void>();
let metasState: MetasState = {
  projects: [],
  loading: true,
  error: null,
};
let pollTimer: ReturnType<typeof setInterval> | null = null;
let pollInterval = 0;
let inflight = false;

function emit() {
  listeners.forEach((listener) => listener(metasState));
}

async function refreshMetas() {
  if (inflight) return;
  inflight = true;
  const shouldShowLoading = metasState.projects.length === 0;
  if (shouldShowLoading && !metasState.loading) {
    metasState = { ...metasState, loading: true };
    emit();
  }
  try {
    const metas = await fetchProjectMetas();
    metasState = { projects: metas, loading: false, error: null };
  } catch (err) {
    metasState = {
      ...metasState,
      loading: false,
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    inflight = false;
    emit();
  }
}

function ensurePolling(intervalMs: number) {
  if (pollTimer && pollInterval === intervalMs) {
    return;
  }
  if (pollTimer) {
    clearInterval(pollTimer);
  }
  pollInterval = intervalMs;
  pollTimer = setInterval(() => {
    void refreshMetas();
  }, pollInterval);
  void refreshMetas();
}

function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  inflight = false;
}

export function useProjectMetas(pollIntervalMs = 5000) {
  const [state, setState] = useState<MetasState>(metasState);

  useEffect(() => {
    const listener = (next: MetasState) => setState(next);
    listeners.add(listener);
    setState(metasState);
    ensurePolling(pollIntervalMs);

    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) {
        stopPolling();
      }
    };
  }, [pollIntervalMs]);

  return state;
}
